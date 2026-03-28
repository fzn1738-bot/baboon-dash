import React, { useState, useEffect, useRef, useCallback } from 'react';
import { UserRole, Asset } from '../types';
import { DollarSign, Activity, Calendar, Clock, Loader2, Signal, Check, Calculator, Wallet, Coins, ExternalLink, Shield, Briefcase, RefreshCw, Terminal, Play, AlertCircle, TrendingUp } from 'lucide-react';
import { collection, query, where, onSnapshot, getDocs, orderBy, doc, setDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { fetchBybitPositions, fetchClosedPnL, fetchRecentExecutions, fetchWalletBalance, apiLogs, ApiLog } from '../services/bybit';

interface DashboardProps {
  userRole: UserRole;
  username?: string;
  investorStats?: {
    q3Invested: number;
    pendingInvested: number;
    q3CurrentRoi: number;
    totalWithdrawn: number;
  };
  onCapitalInject?: (amount: number) => void;
  userShare: number;
  totalPool: number;
}

const ALL_ASSETS: Asset[] = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', type: 'CRYPTO', price: 64230.50, change: 2.4 },
  { symbol: 'ETHUSDT', name: 'Ethereum', type: 'CRYPTO', price: 3450.20, change: 1.8 },
  { symbol: 'SOLUSDT', name: 'Solana', type: 'CRYPTO', price: 145.80, change: 5.2 },
  { symbol: 'BNBUSDT', name: 'Binance Coin', type: 'CRYPTO', price: 590.10, change: 0.5 },
];

const getNextQuarterWindow = () => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    let nextQuarterMonth;
    let nextQuarterYear = currentYear;

    if (currentMonth < 3) {
        nextQuarterMonth = 3;
    } else if (currentMonth < 6) {
        nextQuarterMonth = 6;
    } else if (currentMonth < 9) {
        nextQuarterMonth = 9;
    } else {
        nextQuarterMonth = 0;
        nextQuarterYear++;
    }

    const startDate = new Date(nextQuarterYear, nextQuarterMonth, 1);
    const endDate = new Date(nextQuarterYear, nextQuarterMonth, 3);

    const startStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    return `${startStr} - ${endStr}`;
};

// --- Sub-components ---

const TradingViewWidget = ({ selectedAsset, selectedTimeframe }: { selectedAsset: Asset, selectedTimeframe: string }) => (
  <div className="w-full h-[350px] bg-slate-900 rounded-2xl overflow-hidden relative shadow-lg">
    <div className="absolute inset-0 flex items-center justify-center text-slate-600 z-0">
      <div className="text-center space-y-2">
        <Activity size={32} className="mx-auto opacity-50" />
        <p className="text-sm font-medium">Loading {selectedAsset.symbol}...</p>
      </div>
    </div>
    <iframe 
      src={`https://s.tradingview.com/widgetembed/?frameElementId=tradingview_widget&symbol=${selectedAsset.type === 'CRYPTO' ? 'BYBIT:' : 'NASDAQ:'}${selectedAsset.symbol.replace('USDT', '')}${selectedAsset.type === 'CRYPTO' ? 'USDT' : ''}&interval=${selectedTimeframe === '1H' ? '60' : selectedTimeframe === '2H' ? '120' : selectedTimeframe === '4H' ? '240' : 'D'}&hidesidetoolbar=1&symboledit=1&saveimage=1&toolbarbg=f1f3f6&studies=[]&theme=dark&style=1&timezone=Etc%2FUTC`}
      className="w-full h-full relative z-10"
      {...({ allowtransparency: 'true' } as any)}
      frameBorder="0"
    />
  </div>
);

// --- Portfolio Intelligence Component ---
const PortfolioIntelligence = ({ stats, manualPerformance, userRole, onRefresh, isRefreshing, totalPool }: { stats: any, manualPerformance: any, userRole: string, onRefresh?: () => void, isRefreshing?: boolean, totalPool: number }) => {
  const [activeSubTab, setActiveSubTab] = useState<'GROWTH' | 'PAYOUTS' | 'ALLOCATION'>('GROWTH');

  return (
    <div className="bg-slate-800/40 rounded-3xl border border-slate-700/50 overflow-hidden backdrop-blur-md">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">Performance</h3>
          <span className="text-[8px] bg-sky-500/10 text-sky-400 px-1.5 py-0.5 rounded border border-sky-500/20 font-bold">LIVE BYBIT API</span>
        </div>
        <button 
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-1.5 hover:bg-slate-700/50 rounded-lg transition-colors text-slate-500 hover:text-sky-400"
          title="Refresh Performance"
        >
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="flex border-b border-slate-700/50">
        {(['GROWTH', 'PAYOUTS', 'ALLOCATION'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveSubTab(tab)}
            className={`flex-1 py-4 text-xs font-bold tracking-widest transition-all ${
              activeSubTab === tab 
                ? 'text-sky-400 bg-sky-500/5 border-b-2 border-sky-500' 
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab} {tab === 'GROWTH' ? '%' : tab === 'PAYOUTS' ? '$' : ''}
          </button>
        ))}
      </div>

      <div className="p-6">
        {activeSubTab === 'GROWTH' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-end justify-between w-full">
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Current Month Raw Account %</p>
                  <h4 className="text-3xl font-bold text-white">+{manualPerformance?.currentMonthROI !== undefined && manualPerformance?.currentMonthROI !== null ? manualPerformance.currentMonthROI.toFixed(2) : stats.currentMonthAccountRaw?.toFixed(2)}%</h4>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Current Quarter Raw Account %</p>
                  <h4 className="text-xl font-bold text-emerald-400">+{manualPerformance?.currentQuarterROI !== undefined && manualPerformance?.currentQuarterROI !== null ? manualPerformance.currentQuarterROI.toFixed(2) : stats.currentQuarterAccountRaw?.toFixed(2)}%</h4>
                </div>
              </div>
            </div>
            <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all duration-1000"
                style={{ width: `${Math.min(100, (stats.currentMonthAccountRaw || 0) * 5)}%` }}
              ></div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-slate-500 italic">Target ROI: 15-25% per month. Performance varies based on volatility.</p>
              <button 
                onClick={onRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/50 hover:bg-slate-700/50 rounded-lg transition-all text-[10px] font-bold text-sky-400 border border-sky-500/20 active:scale-95"
              >
                <RefreshCw size={10} className={isRefreshing ? 'animate-spin' : ''} />
                REFRESH DATA
              </button>
            </div>
          </div>
        )}

        {activeSubTab === 'PAYOUTS' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/30">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Q3 Est. Payout</p>
                <p className="text-lg font-bold text-white">${(totalPool * ((manualPerformance?.currentQuarterROI !== undefined && manualPerformance?.currentQuarterROI !== null ? manualPerformance.currentQuarterROI : stats.currentQuarterAccountRaw) / 100)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              </div>
              <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/30">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Total Distributed</p>
                <p className="text-lg font-bold text-sky-400">$42,500</p>
              </div>
            </div>
            <div className="p-4 bg-indigo-500/5 border border-indigo-500/10 rounded-2xl">
              <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
                <Shield size={12} /> Payout Security
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">
                Profits are distributed quarterly via LTC. Ensure your address is updated in settings before the window closes.
              </p>
            </div>
          </div>
        )}

        {activeSubTab === 'ALLOCATION' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-xl border border-slate-700/30">
              <span className="text-xs font-bold text-slate-300">Trend Following</span>
              <span className="text-xs font-bold text-sky-400">65%</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-xl border border-slate-700/30">
              <span className="text-xs font-bold text-slate-300">Mean Reversion</span>
              <span className="text-xs font-bold text-emerald-400">25%</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-xl border border-slate-700/30">
              <span className="text-xs font-bold text-slate-300">Scalping</span>
              <span className="text-xs font-bold text-amber-400">10%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Strategy Monitor Component ---
const StrategyMonitor = () => {
  const [strategies, setStrategies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchStrategies = async () => {
    setIsRefreshing(true);
    try {
      const snapshot = await getDocs(collection(db, 'strategies'));
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStrategies(data);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'strategies');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'strategies'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStrategies(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'strategies');
      setLoading(false);
    });

    return () => unsub();
  }, []);

  return (
    <div className="bg-slate-800/40 rounded-3xl border border-slate-700/50 p-6 backdrop-blur-md">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">Strategy Monitor</h3>
        <div className="flex items-center gap-4">
          <button 
            onClick={fetchStrategies}
            disabled={isRefreshing}
            className="p-1.5 hover:bg-slate-700/50 rounded-lg transition-colors text-slate-500 hover:text-sky-400"
            title="Refresh Strategies"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
            <span className="text-[10px] font-bold text-emerald-500 uppercase">Live Signals</span>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {strategies.map((strat) => (
          <div key={strat.id} className="flex items-center justify-between p-4 bg-slate-900/40 rounded-2xl border border-slate-700/30 hover:border-sky-500/30 transition-colors group">
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                strat.signal === 'LONG' ? 'bg-emerald-500/10 text-emerald-500' : 
                strat.signal === 'SHORT' ? 'bg-rose-500/10 text-rose-500' : 
                'bg-slate-500/10 text-slate-500'
              }`}>
                {strat.signal === 'LONG' ? 'L' : strat.signal === 'SHORT' ? 'S' : 'N'}
              </div>
              <div>
                <p className="text-sm font-bold text-white group-hover:text-sky-400 transition-colors">{strat.name}</p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{strat.status}</p>
              </div>
            </div>
            <div className="text-right">
              <p className={`text-sm font-bold ${
                strat.confidence > 70 ? 'text-emerald-400' : 
                strat.confidence > 40 ? 'text-amber-400' : 
                'text-slate-400'
              }`}>{strat.confidence}%</p>
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Confidence</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const TradeStatusWidget = ({ isInvestor, userShare, liveBalance }: { isInvestor: boolean, userShare: number, liveBalance: number | null }) => {
  const [activeTrades, setActiveTrades] = useState<{
      isActive: boolean;
      pair: string;
      side: string;
      currentPnl: number;
      entryPrice: number;
      size: string;
      tradePercent: number;
      accountPercent: number;
  }[]>([]);
  const [isTradeLoading, setIsTradeLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Use a ref for liveBalance so the polling interval doesn't constantly reset if balance changes slightly
  const liveBalanceRef = useRef(liveBalance);
  useEffect(() => {
      liveBalanceRef.current = liveBalance;
  }, [liveBalance]);

  const fetchActiveTrade = useCallback(async () => {
    try {
      console.log("[TradeStatusWidget] Fetching active positions...");
      const positions = await fetchBybitPositions();
      
      if (positions && positions.length > 0) {
        // Find all non-zero positions - be more inclusive with positionValue check
        const activePositions = positions.filter(p => 
            (parseFloat(p.size) !== 0) || 
            (parseFloat(p.positionValue) !== 0) ||
            (parseFloat(p.unrealisedPnl) !== 0)
        );
        console.log(`[TradeStatusWidget] Found ${activePositions.length} active positions out of ${positions.length} total.`);
        
        if (activePositions.length > 0) {
          const mappedTrades = activePositions.map(activePos => {
            const pnl = parseFloat(activePos.unrealisedPnl) || 0;
            const proratedPnl = pnl * userShare;
            const leverage = parseFloat(activePos.leverage) || 1;
            const posValue = parseFloat(activePos.positionValue) || 0;
            
            // Calculate ROI based on margin (positionValue / leverage)
            const margin = leverage > 0 ? posValue / leverage : posValue;
            const tradePercent = margin > 0 ? (pnl / margin) * 100 : 0;

            console.log(`[TradeStatusWidget] Mapping ${activePos.symbol}: PnL=${pnl}, Size=${activePos.size}, Value=${activePos.positionValue}, Side=${activePos.side}`);
            
            return {
                isActive: true,
                pair: activePos.symbol,
                side: activePos.side === 'Buy' ? 'LONG' : 'SHORT',
                currentPnl: proratedPnl,
                entryPrice: parseFloat(activePos.avgPrice),
                size: activePos.leverage ? `${activePos.leverage}x` : '1x',
                tradePercent: tradePercent,
                accountPercent: liveBalanceRef.current ? (proratedPnl / liveBalanceRef.current) * 100 : 0
            };
          });
          setActiveTrades(mappedTrades);
        } else {
          console.log("[TradeStatusWidget] No positions met the 'active' criteria (size/value/pnl != 0).");
          setActiveTrades([]);
        }
      } else {
        console.log("[TradeStatusWidget] No positions returned from API.");
        setActiveTrades([]);
      }
    } catch (error) {
      console.error("[TradeStatusWidget] Error fetching Bybit positions:", error);
    } finally {
      setIsTradeLoading(false);
      setIsRefreshing(false);
    }
  }, [userShare]);

  useEffect(() => {
    fetchActiveTrade();
    const interval = setInterval(fetchActiveTrade, 15000); // Poll every 15s
    return () => clearInterval(interval);
  }, [fetchActiveTrade]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    fetchActiveTrade();
  };

  if (isTradeLoading) return (
      <div className={`rounded-2xl p-6 flex items-center justify-center gap-2 ${'bg-slate-900 border border-slate-800'}`}>
          <Loader2 className="animate-spin text-emerald-500" size={20} />
          <span className="text-xs text-slate-500 font-bold">Connecting to Exchange...</span>
      </div>
  );

  if (activeTrades.length === 0) return (
      <div className={`rounded-2xl p-6 flex items-center justify-between gap-3 ${'bg-slate-900 border border-slate-800'}`}>
           <div className="flex items-center gap-3">
                <div className="bg-slate-800 p-2 rounded-full text-slate-400">
                    <Signal size={18} />
                </div>
                <div>
                    <div className="text-sm font-bold text-slate-500">No Active Positions</div>
                </div>
           </div>
           <button 
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-sky-400"
                title="Refresh Active Position"
           >
                <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
           </button>
      </div>
  );

  return (
    <div className="space-y-3">
      {activeTrades.map((activeTrade, idx) => (
        <div key={`${activeTrade.pair}-${idx}`} className={`
            rounded-2xl p-4 flex items-center justify-between gap-4 shadow-sm relative overflow-hidden
            ${'bg-slate-900 border border-slate-800'}
        `}>
            <div className={`absolute left-0 top-0 bottom-0 w-1 ${activeTrade.side === 'LONG' ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
            
            <div className="flex items-center gap-3">
               <div className={`${activeTrade.side === 'LONG' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'} p-2 rounded-full`}>
                  <Signal size={18} className="animate-pulse" />
               </div>
               <div>
                  <div className="flex items-center gap-2">
                      <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Active Position</div>
                      <span className="text-[8px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20 font-bold">LIVE BYBIT API</span>
                      {idx === 0 && (
                        <button 
                            onClick={handleManualRefresh}
                            disabled={isRefreshing}
                            className="text-slate-500 hover:text-sky-400 transition-colors"
                        >
                            <RefreshCw size={10} className={isRefreshing ? 'animate-spin' : ''} />
                        </button>
                      )}
                  </div>
                  <div className="flex items-center gap-1.5">
                     <span className={`font-bold ${'text-white'}`}>{activeTrade.pair}</span>
                     <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${activeTrade.side === 'LONG' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                         {activeTrade.side}
                     </span>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                     <span className="text-[10px] text-slate-500 font-bold uppercase">Entry:</span>
                     <span className={`font-mono text-xs ${'text-slate-300'}`}>${activeTrade.entryPrice.toFixed(2)}</span>
                  </div>
               </div>
            </div>

            <div className="text-right">
               <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Unrealized PnL</div>
               {!isInvestor && (
                   <div className={`font-mono font-bold text-lg leading-none mb-1.5 ${activeTrade.currentPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {activeTrade.currentPnl >= 0 ? '+' : ''}{activeTrade.currentPnl.toFixed(2)}
                   </div>
               )}
               <div className="flex flex-col items-end gap-1">
                   <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${activeTrade.tradePercent >= 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                       Trade: {activeTrade.tradePercent >= 0 ? '+' : ''}{activeTrade.tradePercent.toFixed(2)}%
                   </span>
                   <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${activeTrade.accountPercent >= 0 ? 'bg-sky-500/10 text-sky-500' : 'bg-rose-500/10 text-rose-500'}`}>
                       Raw: {activeTrade.accountPercent >= 0 ? '+' : ''}{activeTrade.accountPercent.toFixed(2)}%
                   </span>
               </div>
            </div>
        </div>
      ))}
    </div>
  );
};

const LiveLogs = ({ executions }: { executions: any[] }) => {
    const logs = executions.map(exec => ({
        time: new Date(parseInt(exec.execTime)).toLocaleTimeString(),
        msg: `${exec.side} ${exec.symbol} - Price: ${exec.execPrice} | Qty: ${exec.execQty}`,
        id: exec.execId
    }));

    return (
      <div className="bg-slate-950 rounded-2xl p-4 font-mono text-[10px] text-slate-400 h-40 overflow-hidden relative shadow-inner border border-slate-800">
          <div className="absolute top-2 right-3 flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
               <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
               <span className="text-emerald-500 font-bold text-[9px]">LIVE EXECUTIONS</span>
            </div>
            <span className="text-[7px] bg-sky-500/10 text-sky-400 px-1 py-0.5 rounded border border-sky-500/20 font-bold">LIVE BYBIT API</span>
          </div>
         <div className="space-y-1 mt-6 h-full overflow-y-auto pb-4 custom-scrollbar">
            {logs.length === 0 && <span className="opacity-50">Syncing execution stream...</span>}
            {logs.map((log, index) => (
                <div key={log.id || `log-${index}`} className="truncate opacity-80 border-l-2 border-slate-800 pl-2 hover:bg-slate-900 transition-colors cursor-default">
                    <span className="text-slate-500 mr-2">[{log.time}]</span>
                    {log.msg}
                </div>
            ))}
         </div>
      </div>
    );
};

const AdminPerformanceSettings = ({ poolCapital, dashboardStats }: { poolCapital: number, dashboardStats: any }) => {
    const [totalCapital, setTotalCapital] = useState<string>(poolCapital.toString());
    const [currentQuarterROI, setCurrentQuarterROI] = useState<string>('0');
    const [currentMonthROI, setCurrentMonthROI] = useState<string>('0');
    const [previousQuarterROI, setPreviousQuarterROI] = useState<string>('0');
    const [currentQuarterTradeROI, setCurrentQuarterTradeROI] = useState<string>('0');
    const [currentMonthTradeROI, setCurrentMonthTradeROI] = useState<string>('0');
    const [previousQuarterTradeROI, setPreviousQuarterTradeROI] = useState<string>('0');
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    
    useEffect(() => {
        setTotalCapital(poolCapital.toString());
    }, [poolCapital]);

    useEffect(() => {
        const fetchPerformance = async () => {
            try {
                const docRef = doc(db, 'settings', 'performance');
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    setCurrentQuarterROI(data.currentQuarterROI?.toString() || '0');
                    setCurrentMonthROI(data.currentMonthROI?.toString() || '0');
                    setPreviousQuarterROI(data.previousQuarterROI?.toString() || '0');
                    setCurrentQuarterTradeROI(data.currentQuarterTradeROI?.toString() || '0');
                    setCurrentMonthTradeROI(data.currentMonthTradeROI?.toString() || '0');
                    setPreviousQuarterTradeROI(data.previousQuarterTradeROI?.toString() || '0');
                }
            } catch (error) {
                console.error("Error fetching performance settings:", error);
            }
        };
        fetchPerformance();
    }, []);

    const handleQuarterlyChange = (val: string) => {
        setCurrentQuarterROI(val);
    };

    const handleSave = async () => {
        setIsSaving(true);
        setSaveSuccess(false);
        try {
            const docRef = doc(db, 'settings', 'performance');
            await setDoc(docRef, {
                currentQuarterROI: parseFloat(currentQuarterROI) || 0,
                currentMonthROI: parseFloat(currentMonthROI) || 0,
                previousQuarterROI: parseFloat(previousQuarterROI) || 0,
                currentQuarterTradeROI: parseFloat(currentQuarterTradeROI) || 0,
                currentMonthTradeROI: parseFloat(currentMonthTradeROI) || 0,
                previousQuarterTradeROI: parseFloat(previousQuarterTradeROI) || 0,
                updatedAt: new Date()
            }, { merge: true });
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (error) {
            handleFirestoreError(error, OperationType.UPDATE, 'settings/performance');
        } finally {
            setIsSaving(false);
        }
    };

    const capital = parseFloat(totalCapital) || 0;
    const roi = parseFloat(currentQuarterROI) || 0;
    const estimatedPayout = capital * (roi / 100);

    return (
        <div className="bg-slate-800 border border-slate-700 rounded-3xl p-5 shadow-lg mb-6 max-w-xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <div className="bg-sky-500/20 p-3 rounded-xl text-sky-400">
                        <Calculator size={24} />
                    </div>
                    <div>
                        <h3 className="font-bold text-white text-lg">Performance & Payouts</h3>
                        <p className="text-xs text-slate-400">Update official performance metrics used for investor payouts.</p>
                    </div>
                </div>
                <button 
                    onClick={() => {
                        handleQuarterlyChange(dashboardStats.currentQuarterAccountRaw.toFixed(2));
                        setCurrentMonthROI(dashboardStats.currentMonthAccountRaw.toFixed(2));
                        setPreviousQuarterROI(dashboardStats.previousQuarterAccountRaw.toFixed(2));
                        setCurrentQuarterTradeROI(dashboardStats.currentQuarterTradeRoi.toFixed(2));
                        setCurrentMonthTradeROI(dashboardStats.currentMonthTradeRoi.toFixed(2));
                        setPreviousQuarterTradeROI(dashboardStats.previousQuarterTradeRoi.toFixed(2));
                    }}
                    className="bg-sky-500/20 text-sky-400 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-sky-500/30 transition-colors flex items-center gap-1"
                >
                    <RefreshCw size={14} />
                    Populate from API
                </button>
            </div>
            
            <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Current Qtr Raw Account %</label>
                        <div className="flex items-center gap-2">
                             <input 
                                type="number" 
                                value={currentQuarterROI}
                                onChange={e => handleQuarterlyChange(e.target.value)}
                                className="w-full bg-transparent text-xl text-white font-mono font-bold outline-none"
                            />
                            <span className="text-emerald-500 font-bold">%</span>
                        </div>
                    </div>
                    <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Current Qtr Trade ROI %</label>
                        <div className="flex items-center gap-2">
                             <input 
                                type="number" 
                                value={currentQuarterTradeROI}
                                onChange={e => setCurrentQuarterTradeROI(e.target.value)}
                                className="w-full bg-transparent text-xl text-white font-mono font-bold outline-none"
                            />
                            <span className="text-emerald-500 font-bold">%</span>
                        </div>
                    </div>
                    <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Current Month Raw Account %</label>
                        <div className="flex items-center gap-2">
                             <input 
                                type="number" 
                                value={currentMonthROI}
                                onChange={e => setCurrentMonthROI(e.target.value)}
                                className="w-full bg-transparent text-xl text-white font-mono font-bold outline-none"
                            />
                            <span className="text-emerald-500 font-bold">%</span>
                        </div>
                    </div>
                    <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Current Month Trade ROI %</label>
                        <div className="flex items-center gap-2">
                             <input 
                                type="number" 
                                value={currentMonthTradeROI}
                                onChange={e => setCurrentMonthTradeROI(e.target.value)}
                                className="w-full bg-transparent text-xl text-white font-mono font-bold outline-none"
                            />
                            <span className="text-emerald-500 font-bold">%</span>
                        </div>
                    </div>
                    <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Previous Qtr Raw Account %</label>
                        <div className="flex items-center gap-2">
                             <input 
                                type="number" 
                                value={previousQuarterROI}
                                onChange={e => setPreviousQuarterROI(e.target.value)}
                                className="w-full bg-transparent text-xl text-white font-mono font-bold outline-none"
                            />
                            <span className="text-emerald-500 font-bold">%</span>
                        </div>
                    </div>
                    <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Previous Qtr Trade ROI %</label>
                        <div className="flex items-center gap-2">
                             <input 
                                type="number" 
                                value={previousQuarterTradeROI}
                                onChange={e => setPreviousQuarterTradeROI(e.target.value)}
                                className="w-full bg-transparent text-xl text-white font-mono font-bold outline-none"
                            />
                            <span className="text-emerald-500 font-bold">%</span>
                        </div>
                    </div>
                    <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700 col-span-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Total Pool Capital</label>
                        <div className="flex items-center gap-2">
                             <span className="text-slate-500 font-bold">$</span>
                             <input 
                                type="number" 
                                value={totalCapital}
                                onChange={e => setTotalCapital(e.target.value)}
                                className="w-full bg-transparent text-xl text-white font-mono font-bold outline-none"
                            />
                        </div>
                    </div>
                </div>

                <div className="border-t border-slate-700/50 pt-4 mt-2">
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-4">Quarterly Payout Tiers (Calculated)</h4>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-700">
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">50% Share</label>
                            <div className="flex items-center gap-1">
                                <span className="w-full bg-transparent text-lg text-white font-mono font-bold outline-none">
                                    {(parseFloat(currentQuarterROI) * 0.5).toFixed(2)}
                                </span>
                                <span className="text-emerald-500 font-bold text-sm">%</span>
                            </div>
                        </div>
                        <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-700">
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">75% Share</label>
                            <div className="flex items-center gap-1">
                                <span className="w-full bg-transparent text-lg text-white font-mono font-bold outline-none">
                                    {(parseFloat(currentQuarterROI) * 0.75).toFixed(2)}
                                </span>
                                <span className="text-emerald-500 font-bold text-sm">%</span>
                            </div>
                        </div>
                        <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-700">
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">100% Share</label>
                            <div className="flex items-center gap-1">
                                <span className="w-full bg-transparent text-lg text-white font-mono font-bold outline-none">
                                    {(parseFloat(currentQuarterROI) * 1.0).toFixed(2)}
                                </span>
                                <span className="text-emerald-500 font-bold text-sm">%</span>
                            </div>
                        </div>
                    </div>
                </div>

                <button 
                    onClick={handleSave}
                    disabled={isSaving}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-sky-600 hover:bg-sky-500 text-white rounded-xl font-bold transition-colors disabled:opacity-50"
                >
                    {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                    {saveSuccess ? 'Saved Successfully!' : 'Save Official Performance'}
                </button>
                
                <div className="bg-gradient-to-r from-emerald-900/40 to-emerald-900/10 rounded-2xl p-6 border border-emerald-500/20 mt-6">
                    <div className="flex justify-between items-center mb-1">
                         <span className="text-sm text-emerald-300 font-bold uppercase tracking-wide">Estimated Total Payout (Current Qtr)</span>
                         <Coins size={20} className="text-emerald-400 opacity-50" />
                    </div>
                    <div className="text-3xl font-bold text-emerald-400 font-mono tracking-tight">
                        ${estimatedPayout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <p className="text-[10px] text-emerald-500/70 mt-2 uppercase tracking-wider font-bold">Based on {roi}% of ${capital.toLocaleString()}</p>
                </div>
            </div>
        </div>
    );
};

const InvestmentModal = ({ onClose, onCapitalInject }: { onClose: () => void, onCapitalInject: (amount: number) => void }) => {
    const [status, setStatus] = useState<'IDLE' | 'PROCESSING' | 'COMPLETED'>('IDLE');
    const [investAmount, setInvestAmount] = useState<string>('');
    const [currency, setCurrency] = useState<string>('ltc');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const amountNum = parseFloat(investAmount) || 0;
    const fee = amountNum * 0.18; // 18% Fee
    const netInvested = amountNum - fee; // 82% Invested

    const handleConfirm = async () => {
      if (amountNum <= 0) return;
      setStatus('PROCESSING');
      setErrorMsg(null);
      
      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Not authenticated");

        const response = await fetch('/api/payment/invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: amountNum,
            userId: user.uid,
            userEmail: user.email,
            currency: currency
          })
        });

        let data;
        const responseText = await response.text();
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error("Raw response:", responseText);
            throw new Error(`Server returned invalid JSON: ${responseText.substring(0, 100)}`, { cause: e });
        }
        
        if (!response.ok) {
          throw new Error(data.error || "Failed to create invoice");
        }

        if (data.invoice_url) {
          window.open(data.invoice_url, '_blank');
          setStatus('IDLE');
          onClose();
        } else {
          throw new Error("No invoice URL returned");
        }
      } catch (error: any) {
        console.error("Payment error:", error);
        setErrorMsg(error.message || "An error occurred");
        setStatus('IDLE');
      }
    };

    return (
      <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center p-4 sm:p-0">
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={onClose}></div>
        <div className="bg-slate-800 border border-slate-700 w-full max-w-md rounded-t-3xl md:rounded-3xl p-6 relative z-10 animate-fade-in-up shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="w-12 h-1 bg-slate-600 rounded-full mx-auto mb-6 md:hidden"></div>
            
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h3 className="text-xl font-bold text-white">Invest</h3>
                    <p className="text-sm text-slate-400 mt-1">Instant deposit via NOWPayments.</p>
                </div>
                <div className="bg-emerald-500/20 p-2 rounded-xl text-emerald-400 border border-emerald-500/30 shadow-sm">
                    <Wallet size={24} />
                </div>
            </div>
            
            <div className="bg-slate-900/50 p-4 rounded-2xl mb-6 border border-slate-700">
                <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Total USD to Deposit</label>
                <div className="flex items-center gap-2 mb-4">
                    <span className="text-slate-500 font-bold text-xl">$</span>
                    <input 
                        type="number" 
                        value={investAmount}
                        onChange={(e) => setInvestAmount(e.target.value)}
                        placeholder="0"
                        className="w-full bg-transparent text-3xl font-bold text-white outline-none placeholder-slate-600"
                    />
                </div>
                
                {amountNum > 0 && (
                    <div className="bg-slate-800 rounded-xl p-3 space-y-2 border border-slate-700">
                        <div className="flex justify-between text-xs text-slate-400">
                            <span>Platform Fee (18%)</span>
                            <span className="text-rose-400 font-mono">-${fee.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                        <div className="flex justify-between text-sm font-bold text-white border-t border-slate-700 pt-2">
                            <span>Actual Amount Invested (82%)</span>
                            <span className="font-mono text-emerald-400">${netInvested.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Currency is locked to LTC as requested */}
            <div className="mb-6">
                <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Payment Currency</label>
                <div className="bg-slate-900/50 py-3 px-4 rounded-xl border border-sky-500/30 font-bold flex items-center justify-center gap-2 text-sky-400">
                    LTC (Litecoin)
                </div>
            </div>

            {errorMsg && (
              <div className="mb-4 p-3 bg-rose-900/20 text-rose-400 text-xs rounded-xl border border-rose-500/30">
                {errorMsg}
              </div>
            )}

            <div className="space-y-3">
                <button 
                    onClick={handleConfirm}
                    disabled={status !== 'IDLE' || amountNum === 0}
                    className={`w-full py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg ${amountNum > 0 ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-sky-900/30 active:scale-95' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}
                >
                    {status === 'PROCESSING' ? <Loader2 className="animate-spin text-slate-400" /> : 'Proceed to Payment'}
                </button>
                
                <p className="text-[10px] text-slate-400 text-center leading-relaxed">
                    By clicking "Proceed to Payment", you will be redirected to NOWPayments to complete your transaction securely.
                </p>
            </div>
        </div>
      </div>
    );
};

const ServerLogs = () => {
  const [logs, setLogs] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchLogs = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch('/api/admin/logs');
      const data = await response.json();
      setLogs(data.logs || []);
    } catch (err) {
      console.error("Failed to fetch server logs:", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/20 rounded-xl">
            <Terminal className="text-indigo-400" size={20} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Server Console</h3>
            <p className="text-xs text-slate-400">Real-time backend logs (Last 100)</p>
          </div>
        </div>
        <button 
          onClick={fetchLogs}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg transition-all text-[10px] font-bold text-indigo-400 border border-indigo-500/20"
        >
          <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
          REFRESH
        </button>
      </div>

      <div className="bg-black/60 rounded-2xl p-4 font-mono text-[11px] h-[600px] overflow-y-auto custom-scrollbar border border-slate-800/50">
        {logs.length === 0 ? (
          <div className="text-slate-600 italic">Waiting for server output...</div>
        ) : (
          <div className="space-y-1.5">
            {logs.map((log, i) => {
              const isError = log.includes('[ERROR]');
              const isWarn = log.includes('[WARN]');
              return (
                <div key={i} className={`pb-1 border-b border-slate-800/30 last:border-0 ${
                  isError ? 'text-rose-400' : isWarn ? 'text-amber-400' : 'text-slate-300'
                }`}>
                  {log}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Main Dashboard ---

export const Dashboard: React.FC<DashboardProps> = ({ 
  userRole, 
  username, 
  investorStats = { q3Invested: 0, pendingInvested: 0, q3CurrentRoi: 0, totalWithdrawn: 0 },
  onCapitalInject,
  userShare,
  totalPool
}) => {
  const isInvestor = userRole === 'INVESTOR';
  const isAdmin = userRole === 'ADMIN';
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'PAYOUTS' | 'MARKET' | 'LOGS' | 'DEBUG'>('OVERVIEW');
  const [debugData, setDebugData] = useState<any>(null);
  const [isDebugLoading, setIsDebugLoading] = useState(false);

  const runDebugFetch = async () => {
    setIsDebugLoading(true);
    try {
      const [positions, balance, pnl] = await Promise.all([
        fetchBybitPositions(),
        fetchWalletBalance(),
        fetchClosedPnL()
      ]);
      setDebugData({
        timestamp: new Date().toISOString(),
        positions,
        balance,
        closedPnL: pnl.slice(0, 5) // Just first 5
      });
    } catch (error) {
      setDebugData({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsDebugLoading(false);
    }
  };
  const [showInvestModal, setShowInvestModal] = useState(false);
  
  // Real-time Dashboard Data Fetching
  const [liveBalance, setLiveBalance] = useState<number | null>(null);
  const [executions, setExecutions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dashboardStats, setDashboardStats] = useState({
    currentMonthTradeRoi: 0,
    currentMonthAccountRaw: 0,
    currentQuarterTradeRoi: 0,
    currentQuarterAccountRaw: 0,
    previousQuarterTradeRoi: 0,
    previousQuarterAccountRaw: 0,
    totalPnlUsd: 0,
  });
  const [manualPerformance, setManualPerformance] = useState({
    currentQuarterROI: 0,
    currentMonthROI: 0,
    previousQuarterROI: 0,
    currentQuarterTradeROI: 0,
    currentMonthTradeROI: 0,
    previousQuarterTradeROI: 0
  });
  const [isRefreshingPerformance, setIsRefreshingPerformance] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    const fetchManualPerformance = async () => {
        try {
            const docRef = doc(db, 'settings', 'performance');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                setManualPerformance({
                    currentQuarterROI: data.currentQuarterROI || 0,
                    currentMonthROI: data.currentMonthROI || 0,
                    previousQuarterROI: data.previousQuarterROI || 0,
                    currentQuarterTradeROI: data.currentQuarterTradeROI || 0,
                    currentMonthTradeROI: data.currentMonthTradeROI || 0,
                    previousQuarterTradeROI: data.previousQuarterTradeROI || 0
                });
            }
        } catch (error) {
            console.error("Error fetching manual performance:", error);
        }
    };
    fetchManualPerformance();
  }, []);

  const handleRefreshPerformance = useCallback(async () => {
    setIsRefreshingPerformance(true);
    try {
        // 1. Fetch from Bybit API
        const [closedTrades, walletBalance, recentExecs] = await Promise.all([
            fetchClosedPnL(),
            fetchWalletBalance(),
            fetchRecentExecutions()
        ]);

        // Check for API errors
        const recentError = apiLogs.find(log => log.error && new Date().getTime() - new Date(log.timestamp).getTime() < 5000);
        if (recentError) {
            setApiError(recentError.error || "Failed to fetch data from Bybit API.");
        } else {
            setApiError(null);
        }

        let currentMonthTradeRoi = 0;
        let currentMonthAccountRaw = 0;
        let currentQuarterTradeRoi = 0;
        let currentQuarterAccountRaw = 0;
        let previousQuarterTradeRoi = 0;
        let previousQuarterAccountRaw = 0;
        let totalPnlUsd = 0;

        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const currentQuarter = Math.floor(currentMonth / 3);
        
        let prevQuarter = currentQuarter - 1;
        let prevQuarterYear = currentYear;
        if (prevQuarter < 0) {
            prevQuarter = 3;
            prevQuarterYear -= 1;
        }

        closedTrades.forEach((trade) => {
            const timestamp = parseInt(trade.updatedTime);
            const date = new Date(timestamp);
            
            const tradeMonth = date.getMonth();
            const tradeYear = date.getFullYear();
            const tradeQuarter = Math.floor(tradeMonth / 3);

            const pnl = parseFloat(trade.closedPnl) || 0;
            totalPnlUsd += pnl;

            // Calculate ROI based on cumulative entry value and leverage
            const entryValue = parseFloat(trade.cumEntryValue) || (parseFloat(trade.qty) * parseFloat(trade.avgEntryPrice)) || 0;
            const leverage = parseFloat(trade.leverage) || 1;
            const margin = leverage > 0 ? entryValue / leverage : entryValue;
            const tradePercent = margin > 0 ? (pnl / margin) * 100 : 0;
            const accountPercent = walletBalance > 0 ? (pnl / walletBalance) * 100 : 0;

            if (tradeYear === currentYear && tradeMonth === currentMonth) {
                currentMonthTradeRoi += tradePercent;
                currentMonthAccountRaw += accountPercent;
            }

            if (tradeYear === currentYear && tradeQuarter === currentQuarter) {
                currentQuarterTradeRoi += tradePercent;
                currentQuarterAccountRaw += accountPercent;
            }

            if (tradeYear === prevQuarterYear && tradeQuarter === prevQuarter) {
                previousQuarterTradeRoi += tradePercent;
                previousQuarterAccountRaw += accountPercent;
            }
        });

        setDashboardStats({
            currentMonthTradeRoi,
            currentMonthAccountRaw,
            currentQuarterTradeRoi,
            currentQuarterAccountRaw,
            previousQuarterTradeRoi,
            previousQuarterAccountRaw,
            totalPnlUsd
        });

        if (walletBalance > 0) {
            setLiveBalance(walletBalance);
        } else {
            setLiveBalance(totalPool + totalPnlUsd);
        }

        setExecutions(recentExecs.map(exec => ({
            ...exec,
            execTime: exec.execTime,
            execPrice: exec.execPrice,
            execQty: exec.execQty,
            side: exec.side,
            symbol: exec.symbol
        })));
    } catch (error) {
        console.error("Error refreshing Bybit performance:", error);
    } finally {
        setIsRefreshingPerformance(false);
    }
  }, [totalPool]);

    useEffect(() => {
        // Initial fetch from Bybit
        handleRefreshPerformance().then(() => setIsLoading(false));
        
        // Keep Firestore listener as a fallback or for real-time webhook updates if needed, 
        // but Bybit is primary now.
        const q = query(collection(db, 'trades'), where('status', '==', 'CLOSED'), orderBy('timestamp', 'desc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            // We only update if we don't have Bybit data yet or if we want to merge
            // For now, let's just let Bybit handle the main stats on refresh
        }, (error) => {
            handleFirestoreError(error, OperationType.LIST, 'trades');
        });

        return () => unsubscribe();
    }, [handleRefreshPerformance]);
  
  if (isLoading) {
    return (
      <div className="w-full h-[60vh] flex flex-col items-center justify-center space-y-4 animate-fade-in">
          <Loader2 className={`animate-spin ${'text-sky-500'}`} size={36} />
          <p className={`text-sm font-bold tracking-wide ${'text-slate-400'}`}>
              Syncing live exchange data...
          </p>
      </div>
    );
  }

  const getPayoutPercentage = () => {
      if (manualPerformance?.currentQuarterROI !== undefined && manualPerformance?.currentQuarterROI !== null) {
          return manualPerformance.currentQuarterROI * userShare;
      }
      return dashboardStats.currentQuarterAccountRaw * userShare;
  };

  // Equity Calculation Siloed to User Share (ONLY applies to active capital)
  const exchangeProfit = liveBalance ? liveBalance - totalPool : 0;
  const userProfit = exchangeProfit * userShare;
  const totalBalance = investorStats.q3Invested + userProfit;

  const tabs = [
      { id: 'OVERVIEW', label: 'Overview' },
      ...(isAdmin ? [
          { id: 'PAYOUTS', label: 'Payouts' },
          { id: 'MARKET', label: 'Market' },
          { id: 'LOGS', label: 'Logs' },
          { id: 'DEBUG', label: 'Debug' }
      ] : [])
  ];

  return (
    <div className="space-y-6 pb-20 md:pb-0 animate-fade-in">
      {showInvestModal && <InvestmentModal onClose={() => setShowInvestModal(false)} onCapitalInject={onCapitalInject!} />}

      {/* Header & Tabs */}
      <div className="sticky top-0 bg-transparent z-30 pt-2 pb-2 -mx-4 px-4 md:static md:p-0 md:mx-0">
          <div className="flex items-center justify-between mb-4 md:mb-6">
            <div>
                <h2 className={`text-2xl font-bold tracking-tight ${'text-white'}`}>
                    {activeTab === 'OVERVIEW' ? (
                        isInvestor ? `Investor - ${username?.split('@')[0] || 'Investor'}` : 'Admin Console'
                    ) : (
                        activeTab === 'PAYOUTS' ? 'Simulator' : 'Live Terminal'
                    )}
                </h2>
                {isInvestor && (
                    <p className="text-xs text-slate-500 font-medium">Portfolio Overview</p>
                )}
            </div>
          </div>

          {apiError && (
              <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl mb-6 text-sm flex items-start gap-3">
                  <span className="mt-0.5">⚠️</span>
                  <div>
                      <p className="font-bold">Bybit API Connection Error</p>
                      <p className="opacity-80">{apiError}</p>
                      <p className="opacity-80 mt-1 text-xs">If you are testing in the AI Studio preview, Bybit blocks requests from US servers. Deploy to a non-US region to resolve this.</p>
                  </div>
              </div>
          )}

          {/* Admin Tab Switcher */}
          {isAdmin && (
            <div className={`grid grid-cols-3 gap-3 mb-6`}>
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`
                            py-3 rounded-xl text-xs font-bold transition-all border-b-4 active:border-b-0 active:translate-y-1
                            ${activeTab === tab.id 
                                ? 'bg-sky-500 text-white border-sky-700 shadow-lg'
                                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                            }
                        `}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
          )}
      </div>

      {/* Content View */}
      {activeTab === 'OVERVIEW' && (
        <div className="space-y-6">
            {/* Investor Top Action Area */}
            {isInvestor && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button 
                        onClick={() => setShowInvestModal(true)}
                        className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold py-5 rounded-2xl shadow-lg shadow-emerald-500/30 active:scale-95 transition-all flex items-center justify-center gap-2 text-lg"
                    >
                        <DollarSign size={24} /> Invest
                    </button>
                    <div className="bg-slate-800/40 border border-slate-700/50 p-4 rounded-2xl flex items-center justify-between backdrop-blur-md">
                        <div>
                            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Next Payout Window</p>
                            <div className="text-white font-bold flex items-center gap-1">
                                <Calendar size={14} className="text-purple-500" /> {getNextQuarterWindow()}
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Status</p>
                            <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-sm">
                                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                                ACTIVE
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Main Balance Card (Divergent for Admin vs Investor) */}
            {isInvestor ? (
                <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 mb-4">
                            <Briefcase className="text-emerald-400" size={20} />
                            <h3 className="font-bold text-slate-300 uppercase tracking-widest text-xs">Investor Portfolio</h3>
                        </div>
                        <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Total Equity (Active)</div>
                        <div className="text-4xl font-bold tracking-tight mb-6">
                            ${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white/10 px-4 py-3 rounded-2xl backdrop-blur-md">
                                <div className="text-[10px] text-slate-300 uppercase font-bold mb-1">Invested</div>
                                <div className="font-mono font-bold text-lg">${investorStats.q3Invested.toLocaleString()}</div>
                            </div>
                            <div className="bg-emerald-500/20 px-4 py-3 rounded-2xl backdrop-blur-md border border-emerald-500/20">
                                <div className="text-[10px] text-emerald-300 uppercase font-bold mb-1">{userProfit >= 0 ? 'Profit' : 'Loss'}</div>
                                <div className={`font-mono font-bold text-lg ${userProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {userProfit >= 0 ? '+' : ''}${userProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                            </div>
                            {investorStats.pendingInvested > 0 && (
                                <div className="bg-sky-500/20 px-4 py-3 rounded-2xl backdrop-blur-md border border-sky-500/20 col-span-2 flex justify-between items-center animate-fade-in">
                                    <div className="text-[10px] text-sky-300 uppercase font-bold tracking-wider">Pending (Next Quarter)</div>
                                    <div className="font-mono font-bold text-lg text-sky-400">
                                        ${investorStats.pendingInvested.toLocaleString()}
                                    </div>
                                </div>
                            )}
                            <div className="bg-gradient-to-r from-emerald-500/20 to-teal-500/10 px-4 py-3 rounded-2xl backdrop-blur-md border border-emerald-500/30 col-span-2 flex justify-between items-center">
                                <div>
                                    <div className="text-[10px] text-emerald-300 uppercase font-bold tracking-wider">Current Quarterly Payout</div>
                                    <div className="text-[9px] text-emerald-400/70">Based on {getPayoutPercentage().toFixed(2)}% ROI</div>
                                </div>
                                <div className="font-mono font-bold text-xl text-emerald-400">
                                    ${(investorStats.q3Invested * (getPayoutPercentage() / 100)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 text-white shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 mb-4">
                            <Shield className="text-rose-500" size={20} />
                            <h3 className="font-bold text-slate-300 uppercase tracking-widest text-xs">Admin Command Center</h3>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                             <div className="col-span-2 mb-2">
                                <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Live Exchange Equity</div>
                                <div className="text-3xl font-bold tracking-tight text-white">
                                    ${liveBalance !== null ? liveBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Loading...'}
                                </div>
                             </div>
                             
                             <div className="bg-white/5 p-3 rounded-xl backdrop-blur-md border border-white/10">
                                 <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Total Pool Deposits</div>
                                 <div className="font-mono font-bold text-white">${totalPool.toLocaleString()}</div>
                             </div>
                             <div className="bg-white/5 p-3 rounded-xl backdrop-blur-md border border-white/10">
                                 <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Current PnL</div>
                                 <div className={`font-mono font-bold ${exchangeProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {exchangeProfit >= 0 ? '+' : ''}${exchangeProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                 </div>
                             </div>
                             
                             <div className="col-span-2 bg-purple-500/10 p-3 rounded-xl backdrop-blur-md border border-purple-500/20 mt-2 flex justify-between items-center">
                                 <div>
                                     <div className="text-[10px] text-purple-300 uppercase font-bold mb-1">Estimated Admin Fees (12%)</div>
                                     <div className="font-mono font-bold text-purple-400 text-lg">
                                        ${(exchangeProfit > 0 ? exchangeProfit * 0.12 : 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                     </div>
                                 </div>
                                 <Wallet size={20} className="text-purple-400 opacity-50" />
                             </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Portfolio Intelligence */}
            <div className="grid grid-cols-1 gap-6">
                <PortfolioIntelligence 
                    stats={dashboardStats} 
                    manualPerformance={manualPerformance}
                    userRole={userRole} 
                    onRefresh={handleRefreshPerformance}
                    isRefreshing={isRefreshingPerformance}
                    totalPool={totalPool}
                />
            </div>

            <TradeStatusWidget isInvestor={isInvestor} userShare={userShare} liveBalance={liveBalance} />

            {/* Live Logs */}
            <LiveLogs executions={executions} />
        </div>
      )}

      {activeTab === 'PAYOUTS' && isAdmin && (
          <div className="animate-fade-in">
              <AdminPerformanceSettings poolCapital={totalPool} dashboardStats={dashboardStats} />
          </div>
      )}

      {activeTab === 'MARKET' && isAdmin && (
         <div className="space-y-6 animate-fade-in">
            <TradingViewWidget selectedAsset={ALL_ASSETS[0]} selectedTimeframe={'4H'} />
            <div className="grid grid-cols-1 gap-6">
              <StrategyMonitor />
            </div>
            <LiveLogs executions={executions} />
         </div>
      )}

      {activeTab === 'LOGS' && isAdmin && (
        <ServerLogs />
      )}

      {activeTab === 'DEBUG' && isAdmin && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight">API Debugger</h2>
            <button 
              onClick={runDebugFetch}
              disabled={isDebugLoading}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {isDebugLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
              Run Full API Debug
            </button>
          </div>
          
          {debugData && (
            <div className="grid grid-cols-1 gap-6">
              <div className="bg-[#151619] border border-white/10 rounded-xl p-6">
                <h3 className="text-sm font-medium text-white/50 mb-4 uppercase tracking-wider">Raw API Response</h3>
                <pre className="text-[11px] font-mono text-indigo-300 overflow-auto max-h-[600px] custom-scrollbar p-4 bg-black/40 rounded-lg">
                  {JSON.stringify(debugData, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};