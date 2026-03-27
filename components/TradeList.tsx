import React, { useState, useEffect } from 'react';
import { UserRole } from '../types';
import { BarChart2, TrendingUp, Clock, Signal, Loader2, PieChart, ArrowUpRight, ArrowRight, Calendar, ChevronDown, ChevronUp, Edit, Trash2, X, Save, AlertTriangle } from 'lucide-react';
import { collection, query, where, onSnapshot, orderBy, doc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';

interface TradeListProps {
  userRole: UserRole;
  userShare: number;
}

interface PeriodStat {
    label: string;
    pnl: number;
    trades: number;
    winRate: number;
    cumTradeRoi: number;
    cumAccountRaw: number;
    sortKey: string; // Used for sorting YYYY-MM
    tradeList: any[]; // Siloed trades
}

export const TradeList: React.FC<TradeListProps> = ({ userRole, userShare }) => {
  const isInvestor = userRole === 'INVESTOR';
  const [quarterlyStats, setQuarterlyStats] = useState<PeriodStat[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<PeriodStat[]>([]);
  const [allTrades, setAllTrades] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<'QUARTERLY' | 'MONTHLY'>('MONTHLY');
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [editingTrade, setEditingTrade] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const handleDeleteTrade = async (tradeId: string) => {
    if (!window.confirm('Are you sure you want to delete this trade record? This action cannot be undone.')) return;
    
    try {
        await deleteDoc(doc(db, 'trades', tradeId));
    } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `trades/${tradeId}`);
    }
  };

  const handleUpdateTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTrade) return;

    try {
        const tradeRef = doc(db, 'trades', editingTrade.id);
        
        // Only update the fields that are editable in the form
        const cleanData = {
            symbol: editingTrade.symbol,
            side: editingTrade.side,
            tradePnl: parseFloat(editingTrade.tradePnl) || 0,
            tradeRoiPercent: parseFloat(editingTrade.tradeRoiPercent) || 0,
            entryPrice: parseFloat(editingTrade.entryPrice) || 0,
            exitPrice: parseFloat(editingTrade.exitPrice) || 0,
            // Recalculate account raw if possible, or just keep what was entered
            tradeAccountRawPercent: parseFloat(editingTrade.tradeAccountRawPercent) || 0,
            lastUpdated: Timestamp.now()
        };

        await updateDoc(tradeRef, cleanData);
        setEditingTrade(null);
    } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `trades/${editingTrade.id}`);
    }
  };

  useEffect(() => {
      // Fetch closed PnL history from Firestore
      const q = query(collection(db, 'trades'), where('status', '==', 'CLOSED'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
          // Process Data
          const quarters: Record<string, PeriodStat> = {};
          const months: Record<string, PeriodStat> = {};
          
          snapshot.docs.forEach(doc => {
              const trade = doc.data();
              // Use closeTimestamp if available, otherwise timestamp
              const timestamp = trade.closeTimestamp?.toMillis() || trade.timestamp?.toMillis() || Date.now();
              const date = new Date(timestamp);
              
              // Monthly Key: "Sep 2024"
              const monthKey = date.toLocaleString('default', { month: 'short', year: 'numeric' });
              const sortKeyMonth = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
              
              // Quarterly Key: "Q3 24"
              const qKey = `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear().toString().substr(2)}`;
              const sortKeyQuarter = `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;

              // Base trade numbers
              const rawPnl = parseFloat(trade.tradePnl) || 0;
              
              // Prorate PnL based on user share
              const pnl = rawPnl * userShare;

              // Percentages
              const tradePercent = parseFloat(trade.tradeRoiPercent) || 0;
              const accountPercent = parseFloat(trade.tradeAccountRawPercent) || 0;

              const tradeWithSiloedPnl = { 
                  ...trade,
                  id: doc.id,
                  symbol: trade.symbol,
                  side: trade.side,
                  closedPnl: rawPnl.toString(),
                  avgEntryPrice: trade.entryPrice?.toString() || '0',
                  avgExitPrice: trade.exitPrice?.toString() || '0',
                  updatedTime: timestamp.toString(),
                  proratedPnl: pnl,
                  tradePercent,
                  accountPercent
              };

              // Update Quarters
              if (!quarters[qKey]) quarters[qKey] = { label: qKey, pnl: 0, trades: 0, winRate: 0, cumTradeRoi: 0, cumAccountRaw: 0, sortKey: sortKeyQuarter, tradeList: [] };
              quarters[qKey].pnl += pnl;
              quarters[qKey].trades += 1;
              quarters[qKey].cumTradeRoi += tradePercent;
              quarters[qKey].cumAccountRaw += accountPercent;
              if (pnl > 0) quarters[qKey].winRate += 1;
              quarters[qKey].tradeList.push(tradeWithSiloedPnl);

              // Update Months
              if (!months[monthKey]) months[monthKey] = { label: monthKey, pnl: 0, trades: 0, winRate: 0, cumTradeRoi: 0, cumAccountRaw: 0, sortKey: sortKeyMonth, tradeList: [] };
              months[monthKey].pnl += pnl;
              months[monthKey].trades += 1;
              months[monthKey].cumTradeRoi += tradePercent;
              months[monthKey].cumAccountRaw += accountPercent;
              if (pnl > 0) months[monthKey].winRate += 1;
              months[monthKey].tradeList.push(tradeWithSiloedPnl);
          });

          const formatStats = (record: Record<string, PeriodStat>) => Object.values(record).map(s => ({
              ...s,
              winRate: s.trades > 0 ? (s.winRate / s.trades) * 100 : 0
          })).sort((a,b) => b.sortKey.localeCompare(a.sortKey));

          setQuarterlyStats(formatStats(quarters));
          setMonthlyStats(formatStats(months));
          
          // Store all trades for advanced metrics
          const allTradesList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setAllTrades(allTradesList);
          
          setIsLoading(false);
      }, (error) => {
          console.error("Error fetching performance data:", error);
          setIsLoading(false);
      });

      return () => unsubscribe();
  }, [userShare]);

  const displayedStats = viewMode === 'QUARTERLY' ? quarterlyStats : monthlyStats;

  return (
    <div className="space-y-6 pb-20 animate-fade-in">
      {!isInvestor && <AdminPerformanceMetrics trades={allTrades} />}
      
      <div className="flex items-center justify-between">
         <h2 className={`text-2xl font-bold ${'text-white'}`}>Performance</h2>
         <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
             <button 
                onClick={() => { setViewMode('MONTHLY'); setExpandedRow(null); }}
                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${viewMode === 'MONTHLY' ? 'bg-slate-600 shadow text-white' : 'text-slate-400 hover:text-slate-300'}`}
             >
                 Monthly
             </button>
             <button 
                onClick={() => { setViewMode('QUARTERLY'); setExpandedRow(null); }}
                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${viewMode === 'QUARTERLY' ? 'bg-slate-600 shadow text-white' : 'text-slate-400 hover:text-slate-300'}`}
             >
                 Quarterly
             </button>
         </div>
      </div>

      {/* Stats List */}
      <div className={`
        rounded-3xl min-h-[400px] flex flex-col relative overflow-hidden
        ${'bg-slate-900 border border-slate-800'}
      `}>
          <div className="p-5 border-b border-slate-100/10 flex items-center justify-between">
              <span className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${'text-slate-400'}`}>
                 <Clock size={16} /> {viewMode === 'MONTHLY' ? 'Monthly Breakdown' : 'Quarterly Breakdown'}
              </span>
              {!isLoading && (
                 <span className="flex items-center gap-1.5 text-[10px] text-emerald-500 font-bold uppercase">
                     <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                     Synced
                 </span>
              )}
          </div>
          
          <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                  <div className="p-10 text-center space-y-4">
                      <Loader2 className={`animate-spin mx-auto ${'text-sky-500'}`} size={32} />
                      <p className={`text-sm ${'text-slate-500'}`}>Syncing Live Trade Ledger...</p>
                  </div>
              ) : displayedStats.length === 0 ? (
                  <div className="p-10 text-center space-y-3">
                      <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-2 ${'bg-slate-800 text-slate-600'}`}>
                          <Signal size={24} />
                      </div>
                      <p className={`font-bold ${'text-slate-300'}`}>No Closed Trades Found</p>
                      <p className={`text-xs ${'text-slate-500'}`}>Awaiting completed positions from exchange.</p>
                  </div>
              ) : (
                  <div className="divide-y divide-slate-100/10 dark:divide-slate-800">
                      {displayedStats.map((s) => (
                          <div key={s.sortKey} className="flex flex-col">
                              {/* Main Row */}
                              <div 
                                onClick={() => setExpandedRow(expandedRow === s.label ? null : s.label)}
                                className={`p-4 flex items-center justify-between cursor-pointer transition-colors ${'hover:bg-slate-800/50'}`}
                              >
                                  <div className="flex items-center gap-3">
                                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs ${s.pnl >= 0 ? ('bg-emerald-500/20 text-emerald-400') : ('bg-rose-500/20 text-rose-400')}`}>
                                          {s.pnl >= 0 ? 'WIN' : 'LOSS'}
                                      </div>
                                      <div>
                                          <div className={`font-bold text-sm ${'text-white'}`}>{s.label}</div>
                                          <div className="text-[10px] text-slate-500">{s.trades} Trades Executed</div>
                                      </div>
                                  </div>
                                  <div className="flex items-center gap-4">
                                      <div className="text-right">
                                          {!isInvestor && (
                                              <div className={`font-mono font-bold ${s.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                  {s.pnl >= 0 ? '+' : ''}${s.pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                              </div>
                                          )}
                                          <div className={`font-mono font-bold text-xs ${s.cumAccountRaw >= 0 ? 'text-sky-400' : 'text-rose-400'}`}>
                                              Acc: {s.cumAccountRaw >= 0 ? '+' : ''}{s.cumAccountRaw.toFixed(2)}%
                                          </div>
                                          <div className="text-[10px] text-slate-400">
                                              ROI: {s.cumTradeRoi >= 0 ? '+' : ''}{s.cumTradeRoi.toFixed(2)}% | Win Rate: {s.winRate.toFixed(0)}%
                                          </div>
                                      </div>
                                      <div className={'text-slate-600'}>
                                          {expandedRow === s.label ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                      </div>
                                  </div>
                              </div>
                              
                              {/* Expanded Trades List */}
                              {expandedRow === s.label && (
                                  <div className={`p-4 border-t ${'bg-slate-800/30 border-slate-800'}`}>
                                      {s.tradeList.map((t, index) => (
                                          <div key={t.id || t.orderId || `trade-${index}`} className={`flex justify-between items-center py-2.5 border-b last:border-0 ${'border-slate-700/50'}`}>
                                              <div className="flex flex-col gap-1.5 w-full">
                                                  <div className="flex items-center justify-between w-full">
                                                      <div className="flex items-center gap-2 flex-wrap">
                                                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${t.side === 'LONG' || t.side === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                                              {t.side} {t.leverage ? `${t.leverage}x` : ''}
                                                          </span>
                                                          <span className={`text-xs font-bold ${'text-slate-300'}`}>
                                                              {t.symbol}
                                                          </span>
                                                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${t.tradePercent >= 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                                              Trade ROI: {t.tradePercent >= 0 ? '+' : ''}{t.tradePercent.toFixed(2)}%
                                                          </span>
                                                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${t.accountPercent >= 0 ? 'bg-sky-500/10 text-sky-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                                              Acc Raw: {t.accountPercent >= 0 ? '+' : ''}{t.accountPercent.toFixed(2)}%
                                                          </span>
                                                      </div>
                                                      <div className="text-right shrink-0 flex items-center gap-3">
                                                          <div className="text-right">
                                                              {!isInvestor && (
                                                                  <div className={`text-xs font-mono font-bold ${t.proratedPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                                      {t.proratedPnl >= 0 ? '+' : ''}${t.proratedPnl.toFixed(2)}
                                                                  </div>
                                                              )}
                                                              <div className="text-[9px] text-slate-500 mt-0.5">
                                                                  {new Date(parseInt(t.updatedTime)).toLocaleString()}
                                                              </div>
                                                          </div>
                                                          
                                                          {!isInvestor && (
                                                              <div className="flex items-center gap-1">
                                                                  <button 
                                                                    onClick={(e) => { e.stopPropagation(); setEditingTrade(t); }}
                                                                    className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-sky-400 transition-colors"
                                                                  >
                                                                      <Edit size={12} />
                                                                  </button>
                                                                  <button 
                                                                    onClick={(e) => { e.stopPropagation(); handleDeleteTrade(t.id); }}
                                                                    className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-rose-400 transition-colors"
                                                                  >
                                                                      <Trash2 size={12} />
                                                                  </button>
                                                              </div>
                                                          )}
                                                      </div>
                                                  </div>
                                                  
                                                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono bg-slate-900/50 p-1.5 rounded">
                                                      <span>Entry: ${parseFloat(t.avgEntryPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
                                                      <span>→</span>
                                                      <span>Exit: ${parseFloat(t.avgExitPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</span>
                                                  </div>

                                                  {/* Extended Webhook Data */}
                                                  {(t.monthlyTradeRoiPercent !== undefined || t.reason) && (
                                                      <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[9px] bg-slate-800/50 p-2 rounded border border-slate-700/50">
                                                          {t.monthlyTradeRoiPercent !== undefined && (
                                                              <div className="space-y-1">
                                                                  <div className="text-slate-400 font-bold uppercase tracking-wider mb-1 border-b border-slate-700 pb-1">Monthly Stats</div>
                                                                  <div className="flex justify-between"><span className="text-slate-500">Trade ROI:</span> <span className={t.monthlyTradeRoiPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{t.monthlyTradeRoiPercent >= 0 ? '+' : ''}{t.monthlyTradeRoiPercent}%</span></div>
                                                                  <div className="flex justify-between"><span className="text-slate-500">Account Raw:</span> <span className={t.monthlyAccountRawPercent >= 0 ? 'text-sky-400' : 'text-rose-400'}>{t.monthlyAccountRawPercent >= 0 ? '+' : ''}{t.monthlyAccountRawPercent}%</span></div>
                                                                  <div className="flex justify-between"><span className="text-slate-500">PnL:</span> <span className={t.monthlyPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{t.monthlyPnl >= 0 ? '+' : ''}{t.monthlyPnl} USDT</span></div>
                                                              </div>
                                                          )}
                                                          {t.quarterlyCumulativePercent !== undefined && (
                                                              <div className="space-y-1">
                                                                  <div className="text-slate-400 font-bold uppercase tracking-wider mb-1 border-b border-slate-700 pb-1">Quarterly Stats</div>
                                                                  <div className="flex justify-between"><span className="text-slate-500">Cumulative ROI:</span> <span className={t.quarterlyCumulativePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{t.quarterlyCumulativePercent >= 0 ? '+' : ''}{t.quarterlyCumulativePercent}%</span></div>
                                                                  <div className="flex justify-between"><span className="text-slate-500">Account Raw:</span> <span className={t.quarterlyAccountRawPercent >= 0 ? 'text-sky-400' : 'text-rose-400'}>{t.quarterlyAccountRawPercent >= 0 ? '+' : ''}{t.quarterlyAccountRawPercent}%</span></div>
                                                                  <div className="flex justify-between"><span className="text-slate-500">PnL:</span> <span className={t.quarterlyPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{t.quarterlyPnl >= 0 ? '+' : ''}{t.quarterlyPnl} USDT</span></div>
                                                              </div>
                                                          )}
                                                          {t.previousQuarterRoiPercent !== undefined && (
                                                              <div className="space-y-1 sm:col-span-2 border-t border-slate-700 pt-1 mt-1">
                                                                  <div className="flex justify-between"><span className="text-slate-500">Previous Quarter:</span> <span><span className={t.previousQuarterRoiPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{t.previousQuarterRoiPercent >= 0 ? '+' : ''}{t.previousQuarterRoiPercent}% ROI</span> <span className="text-slate-600">|</span> <span className={t.previousQuarterAccountRawPercent >= 0 ? 'text-sky-400' : 'text-rose-400'}>Acc Raw: {t.previousQuarterAccountRawPercent >= 0 ? '+' : ''}{t.previousQuarterAccountRawPercent}%</span></span></div>
                                                              </div>
                                                          )}
                                                          {t.reason && (
                                                              <div className="space-y-1 sm:col-span-2 border-t border-slate-700 pt-1 mt-1">
                                                                  <div className="flex justify-between"><span className="text-slate-500">Reason:</span> <span className="text-slate-300">{t.reason}</span></div>
                                                              </div>
                                                          )}
                                                      </div>
                                                  )}
                                              </div>
                                          </div>
                                      ))}
                                  </div>
                              )}
                          </div>
                      ))}
                  </div>
              )}
          </div>
      </div>

      {/* Edit Modal */}
      {editingTrade && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl">
                  <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
                      <div className="flex items-center gap-3">
                          <div className="p-2 bg-sky-500/20 rounded-xl">
                              <Edit className="text-sky-400" size={20} />
                          </div>
                          <div>
                              <h3 className="text-lg font-bold text-white">Edit Trade Record</h3>
                              <p className="text-xs text-slate-400">Modify Firestore trade data</p>
                          </div>
                      </div>
                      <button onClick={() => setEditingTrade(null)} className="p-2 hover:bg-slate-800 rounded-xl text-slate-400 transition-colors">
                          <X size={20} />
                      </button>
                  </div>

                  <form onSubmit={handleUpdateTrade} className="p-6 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                              <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Symbol</label>
                              <input 
                                  type="text" 
                                  value={editingTrade.symbol}
                                  onChange={(e) => setEditingTrade({...editingTrade, symbol: e.target.value})}
                                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-sky-500/50"
                              />
                          </div>
                          <div className="space-y-1.5">
                              <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Side</label>
                              <select 
                                  value={editingTrade.side}
                                  onChange={(e) => setEditingTrade({...editingTrade, side: e.target.value})}
                                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-sky-500/50"
                              >
                                  <option value="LONG">LONG</option>
                                  <option value="SHORT">SHORT</option>
                                  <option value="BUY">BUY</option>
                                  <option value="SELL">SELL</option>
                              </select>
                          </div>
                          <div className="space-y-1.5">
                              <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Trade PnL (USDT)</label>
                              <input 
                                  type="number" 
                                  step="0.01"
                                  value={editingTrade.tradePnl}
                                  onChange={(e) => setEditingTrade({...editingTrade, tradePnl: e.target.value})}
                                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-sky-500/50"
                              />
                          </div>
                          <div className="space-y-1.5">
                              <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Trade ROI %</label>
                              <input 
                                  type="number" 
                                  step="0.01"
                                  value={editingTrade.tradeRoiPercent}
                                  onChange={(e) => setEditingTrade({...editingTrade, tradeRoiPercent: e.target.value})}
                                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-sky-500/50"
                              />
                          </div>
                          <div className="space-y-1.5">
                              <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Entry Price</label>
                              <input 
                                  type="number" 
                                  step="0.000001"
                                  value={editingTrade.entryPrice}
                                  onChange={(e) => setEditingTrade({...editingTrade, entryPrice: e.target.value})}
                                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-sky-500/50"
                              />
                          </div>
                          <div className="space-y-1.5">
                              <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Exit Price</label>
                              <input 
                                  type="number" 
                                  step="0.000001"
                                  value={editingTrade.exitPrice}
                                  onChange={(e) => setEditingTrade({...editingTrade, exitPrice: e.target.value})}
                                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-sky-500/50"
                              />
                          </div>
                          <div className="space-y-1.5">
                              <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Account Raw %</label>
                              <input 
                                  type="number" 
                                  step="0.01"
                                  value={editingTrade.tradeAccountRawPercent}
                                  onChange={(e) => setEditingTrade({...editingTrade, tradeAccountRawPercent: e.target.value})}
                                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-sky-500/50"
                              />
                          </div>
                      </div>

                      <div className="pt-4 flex gap-3">
                          <button 
                              type="button"
                              onClick={() => setEditingTrade(null)}
                              className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-2xl transition-all"
                          >
                              Cancel
                          </button>
                          <button 
                              type="submit"
                              className="flex-1 py-3 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-2xl shadow-lg shadow-sky-500/20 transition-all flex items-center justify-center gap-2"
                          >
                              <Save size={18} /> Save Changes
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}
    </div>
  );
};

const AdminPerformanceMetrics = ({ trades }: { trades: any[] }) => {
    // Sort trades by date ascending
    const sortedTrades = [...trades].sort((a, b) => {
        const timeA = a.closeTimestamp?.toMillis() || a.timestamp?.toMillis() || 0;
        const timeB = b.closeTimestamp?.toMillis() || b.timestamp?.toMillis() || 0;
        return timeA - timeB;
    });

    let grossProfit = 0;
    let grossLoss = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let totalWinAmount = 0;
    let totalLossAmount = 0;
    
    let peak = 100;
    let currentBalance = 100;
    let maxDrawdown = 0;
    
    let peakDollar = 0;
    let currentDollar = 0;
    let maxDrawdownDollar = 0;

    const returns: number[] = [];
    const downsideReturns: number[] = [];

    sortedTrades.forEach(t => {
        const pnl = parseFloat(t.tradePnl) || 0;
        const accPercent = parseFloat(t.tradeAccountRawPercent) || 0;
        
        if (pnl > 0) {
            grossProfit += pnl;
            totalWins++;
            totalWinAmount += pnl;
        } else if (pnl < 0) {
            grossLoss += Math.abs(pnl);
            totalLosses++;
            totalLossAmount += Math.abs(pnl);
        }

        returns.push(accPercent);
        if (accPercent < 0) {
            downsideReturns.push(accPercent);
        }

        currentBalance *= (1 + accPercent / 100);
        if (currentBalance > peak) peak = currentBalance;
        const drawdown = (peak - currentBalance) / peak * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;

        currentDollar += pnl;
        if (currentDollar > peakDollar) peakDollar = currentDollar;
        const ddDollar = peakDollar - currentDollar;
        if (ddDollar > maxDrawdownDollar) maxDrawdownDollar = ddDollar;
    });

    const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 999 : 0) : grossProfit / grossLoss;
    const winRate = trades.length > 0 ? (totalWins / trades.length) * 100 : 0;
    const lossRate = trades.length > 0 ? (totalLosses / trades.length) * 100 : 0;
    
    const avgWin = totalWins > 0 ? totalWinAmount / totalWins : 0;
    const avgLoss = totalLosses > 0 ? totalLossAmount / totalLosses : 0;
    
    const expectancy = (winRate / 100 * avgWin) - (lossRate / 100 * avgLoss);
    
    const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const variance = returns.length > 0 ? returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / returns.length : 0;
    const stdDev = Math.sqrt(variance);

    const downsideMean = downsideReturns.length > 0 ? downsideReturns.reduce((a, b) => a + b, 0) / downsideReturns.length : 0;
    const downsideVariance = downsideReturns.length > 0 ? downsideReturns.reduce((a, b) => a + Math.pow(b - downsideMean, 2), 0) / downsideReturns.length : 0;
    const downsideStdDev = Math.sqrt(downsideVariance);

    const firstDate = sortedTrades[0]?.closeTimestamp?.toMillis() || sortedTrades[0]?.timestamp?.toMillis() || Date.now();
    const lastDate = sortedTrades[sortedTrades.length - 1]?.closeTimestamp?.toMillis() || sortedTrades[sortedTrades.length - 1]?.timestamp?.toMillis() || Date.now();
    const days = Math.max(1, (lastDate - firstDate) / (1000 * 60 * 60 * 24));
    const years = days / 365.25;
    const totalReturnPercent = (currentBalance - 100);
    const annualReturn = years > 0 ? totalReturnPercent / years : totalReturnPercent;

    const riskFreeRate = 4;
    const tradesPerYear = years > 0 ? trades.length / years : trades.length;
    
    const annStdDev = stdDev * Math.sqrt(tradesPerYear);
    const sharpeRatio = annStdDev === 0 ? 0 : (annualReturn - riskFreeRate) / annStdDev;

    const annDownsideStdDev = downsideStdDev * Math.sqrt(tradesPerYear);
    const sortinoRatio = annDownsideStdDev === 0 ? 0 : (annualReturn - riskFreeRate) / annDownsideStdDev;

    const effectiveMaxDrawdown = maxDrawdown === 0 ? 0.01 : maxDrawdown;
    const calmarRatio = annualReturn / effectiveMaxDrawdown;

    const netProfit = grossProfit - grossLoss;
    const effectiveMaxDrawdownDollar = maxDrawdownDollar === 0 ? 1 : maxDrawdownDollar;
    const recoveryFactor = netProfit / effectiveMaxDrawdownDollar;

    const pnlMean = returns.length > 0 ? sortedTrades.reduce((a, b) => a + (parseFloat(b.tradePnl) || 0), 0) / returns.length : 0;
    const pnlVariance = returns.length > 0 ? sortedTrades.reduce((a, b) => a + Math.pow((parseFloat(b.tradePnl) || 0) - pnlMean, 2), 0) / returns.length : 0;
    const pnlStdDev = Math.sqrt(pnlVariance);
    const sqn = pnlStdDev === 0 ? 0 : Math.sqrt(trades.length) * (expectancy / pnlStdDev);

    return (
        <div className="bg-slate-800/40 rounded-3xl border border-slate-700/50 p-6 mb-6">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <BarChart2 size={16} className="text-sky-400" /> Advanced Performance Metrics (Admin)
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                <MetricCard label="Sharpe Ratio" value={sharpeRatio.toFixed(2)} subtitle="> 3.0 is Top 1%" />
                <MetricCard label="Sortino Ratio" value={sortinoRatio.toFixed(2)} subtitle="Downside risk adjusted" />
                <MetricCard label="Calmar Ratio" value={calmarRatio.toFixed(2)} subtitle="Return vs Max DD" />
                <MetricCard label="Profit Factor" value={profitFactor.toFixed(2)} subtitle="Gross Profit / Loss" />
                <MetricCard label="Win Rate" value={`${winRate.toFixed(1)}%`} subtitle="Profit Consistency" />
                <MetricCard label="Recovery Factor" value={recoveryFactor.toFixed(2)} subtitle="Net Profit / Max DD" />
                <MetricCard label="Expectancy" value={`$${expectancy.toFixed(2)}`} subtitle="Per trade avg" />
                <MetricCard label="SQN" value={sqn.toFixed(2)} subtitle="> 5.0 is Holy Grail" />
                <MetricCard label="Avg Slippage" value="< 0.05%" subtitle="Estimated" />
            </div>
        </div>
    );
};

const MetricCard = ({ label, value, subtitle }: { label: string, value: string, subtitle: string }) => (
    <div className="bg-slate-900/50 rounded-2xl p-4 border border-slate-700/50">
        <div className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-1">{label}</div>
        <div className="text-xl font-bold text-white mb-1">{value}</div>
        <div className="text-[9px] text-slate-500">{subtitle}</div>
    </div>
);