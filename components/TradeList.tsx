import React, { useState, useEffect } from 'react';
import { UserRole } from '../types';
import { BarChart2, TrendingUp, Clock, Signal, Loader2, PieChart, ArrowUpRight, ArrowRight, Calendar } from 'lucide-react';
import { fetchClosedPnL, fetchWalletBalance } from '../services/bybit';

interface TradeListProps {
  userRole: UserRole;
}

interface PeriodStat {
    label: string;
    pnl: number;
    trades: number;
    winRate: number;
    sortKey: string; // Used for sorting YYYY-MM
}

export const TradeList: React.FC<TradeListProps> = ({ userRole }) => {
  const isInvestor = userRole === 'INVESTOR';
  const [quarterlyStats, setQuarterlyStats] = useState<PeriodStat[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<PeriodStat[]>([]);
  const [viewMode, setViewMode] = useState<'QUARTERLY' | 'MONTHLY'>('MONTHLY');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
      const fetchData = async () => {
          setIsLoading(true);
          try {
              const history = await fetchClosedPnL();
              
              // Process Data
              const quarters: Record<string, PeriodStat> = {};
              const months: Record<string, PeriodStat> = {};
              
              history.forEach(trade => {
                  const date = new Date(parseInt(trade.updatedTime));
                  
                  // Monthly Key: "Sep 2024"
                  const monthKey = date.toLocaleString('default', { month: 'short', year: 'numeric' });
                  const sortKeyMonth = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
                  
                  // Quarterly Key: "Q3 24"
                  const q = `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear().toString().substr(2)}`;
                  const sortKeyQuarter = `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;

                  const pnl = parseFloat(trade.closedPnl);

                  // Update Quarters
                  if (!quarters[q]) quarters[q] = { label: q, pnl: 0, trades: 0, winRate: 0, sortKey: sortKeyQuarter };
                  quarters[q].pnl += pnl;
                  quarters[q].trades += 1;
                  if (pnl > 0) quarters[q].winRate += 1;

                  // Update Months
                  if (!months[monthKey]) months[monthKey] = { label: monthKey, pnl: 0, trades: 0, winRate: 0, sortKey: sortKeyMonth };
                  months[monthKey].pnl += pnl;
                  months[monthKey].trades += 1;
                  if (pnl > 0) months[monthKey].winRate += 1;
              });

              const formatStats = (record: Record<string, PeriodStat>) => Object.values(record).map(s => ({
                  ...s,
                  winRate: (s.winRate / s.trades) * 100
              })).sort((a,b) => b.sortKey.localeCompare(a.sortKey));

              setQuarterlyStats(formatStats(quarters));
              setMonthlyStats(formatStats(months));
          } catch (e) {
              console.error(e);
          } finally {
              setIsLoading(false);
          }
      };

      fetchData();
  }, []);

  const displayedStats = viewMode === 'QUARTERLY' ? quarterlyStats : monthlyStats;

  return (
    <div className="space-y-6 pb-20 animate-fade-in">
      <div className="flex items-center justify-between">
         <h2 className={`text-2xl font-bold ${isInvestor ? 'text-slate-900' : 'text-white'}`}>Performance</h2>
         <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
             <button 
                onClick={() => setViewMode('MONTHLY')}
                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${viewMode === 'MONTHLY' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
             >
                 Monthly
             </button>
             <button 
                onClick={() => setViewMode('QUARTERLY')}
                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${viewMode === 'QUARTERLY' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
             >
                 Quarterly
             </button>
         </div>
      </div>

      {/* Stats List */}
      <div className={`
        rounded-3xl min-h-[400px] flex flex-col relative overflow-hidden
        ${isInvestor ? 'bg-white border border-slate-100 shadow-sm' : 'bg-slate-900 border border-slate-800'}
      `}>
          <div className="p-5 border-b border-slate-100/10 flex items-center justify-between">
              <span className={`text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${isInvestor ? 'text-slate-500' : 'text-slate-400'}`}>
                 <Clock size={16} /> {viewMode === 'MONTHLY' ? 'Monthly Breakdown' : 'Quarterly Breakdown'}
              </span>
          </div>
          
          <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                  <div className="p-10 text-center space-y-4">
                      <Loader2 className={`animate-spin mx-auto ${isInvestor ? 'text-slate-300' : 'text-sky-500'}`} size={32} />
                      <p className={`text-sm ${isInvestor ? 'text-slate-400' : 'text-slate-500'}`}>Syncing trade ledger...</p>
                  </div>
              ) : displayedStats.length === 0 ? (
                  <div className="p-10 text-center space-y-3">
                      <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-2 ${isInvestor ? 'bg-slate-50 text-slate-300' : 'bg-slate-800 text-slate-600'}`}>
                          <Signal size={24} />
                      </div>
                      <p className={`font-bold ${isInvestor ? 'text-slate-700' : 'text-slate-300'}`}>No Closed Trades Found</p>
                  </div>
              ) : (
                  <div className="divide-y divide-slate-100/10">
                      {displayedStats.map((s) => (
                          <div key={s.label} className="p-4 flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs ${s.pnl >= 0 ? (isInvestor ? 'bg-emerald-100 text-emerald-600' : 'bg-emerald-500/20 text-emerald-400') : (isInvestor ? 'bg-rose-100 text-rose-600' : 'bg-rose-500/20 text-rose-400')}`}>
                                      {s.pnl >= 0 ? 'WIN' : 'LOSS'}
                                  </div>
                                  <div>
                                      <div className={`font-bold text-sm ${isInvestor ? 'text-slate-900' : 'text-white'}`}>{s.label}</div>
                                      <div className="text-[10px] text-slate-500">{s.trades} Trades Executed</div>
                                  </div>
                              </div>
                              <div className="text-right">
                                  <div className={`font-mono font-bold ${s.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                      {s.pnl >= 0 ? '+' : ''}${s.pnl.toLocaleString()}
                                  </div>
                                  <div className="text-[10px] text-slate-400">Win Rate: {s.winRate.toFixed(0)}%</div>
                              </div>
                          </div>
                      ))}
                  </div>
              )}
          </div>
      </div>
    </div>
  );
};