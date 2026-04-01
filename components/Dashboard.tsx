import React, { useState, useEffect, useRef, useCallback } from 'react';
import { UserRole, Asset } from '../types';
import { DollarSign, Activity, Calendar, Clock, Loader2, Signal, Check, Calculator, Wallet, Coins, ExternalLink, Shield, Briefcase, RefreshCw, Terminal, Play, AlertCircle, TrendingUp } from 'lucide-react';
import { collection, query, where, onSnapshot, getDocs, orderBy, doc, setDoc, getDoc, deleteField } from 'firebase/firestore';
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

type PerformanceBucket = {
  key: string;
  label: string;
  invested: number;
  gainLoss: number;
  roi: number;
  trades: number;
};

type PerformanceDataOverride = {
  enabled: boolean;
  monthlyBuckets: PerformanceBucket[];
  quarterlyBuckets: PerformanceBucket[];
};

type UserPayoutRow = {
  userLabel: string;
  invested: number;
  estPayout: number;
};

const SCREENSHOT_BASELINE = {
  currentMonthTradeROI: 300.48,
  currentQuarterTradeROI: 0,
  currentMonthAccountRaw: 29.09,
  currentQuarterAccountRaw: 0,
  previousQuarterTradeROI: 764.23,
  previousQuarterAccountRaw: 232.55,
  totalPnlUsd: 76.51
};

const TRACK_FROM_DATE_UTC = Date.UTC(2026, 2, 26, 0, 0, 0);
const TRACK_FROM_DATE_INPUT = '2026-03-26';
const Q1_2026_FINAL_TRADE_ROI = 764.23;
const Q1_2026_FINAL_ACCOUNT_RAW = 232.55;

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
const PortfolioIntelligence = ({
  stats,
  manualPerformance,
  onRefresh,
  isRefreshing,
  totalPool,
  isInvestor,
  userEquity,
  userPayouts
}: {
  stats: any;
  manualPerformance: any;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  totalPool: number;
  isInvestor: boolean;
  userEquity: number;
  userPayouts: UserPayoutRow[];
  rangeStart?: string;
  rangeEnd?: string;
  onRangeStartChange?: (value: string) => void;
  onRangeEndChange?: (value: string) => void;
  onPreviewRange?: () => void;
  onCommitRange?: () => void;
  rangePreviewCount?: number;
}) => {
  const effectiveQuarterPercent = Math.max(0, manualPerformance?.currentQuarterROI ?? stats.currentQuarterAccountRaw);
  const [showUserPayouts, setShowUserPayouts] = useState(false);
  return (
    <div className="bg-slate-800/40 rounded-3xl border border-slate-700/50 overflow-hidden backdrop-blur-md p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">Performance</h3>
          <span className="text-[8px] bg-sky-500/10 text-sky-400 px-1.5 py-0.5 rounded border border-sky-500/20 font-bold">LIVE BYBIT API</span>
        </div>
        <button onClick={onRefresh} disabled={isRefreshing} className="p-1.5 hover:bg-slate-700/50 rounded-lg transition-colors text-slate-500 hover:text-sky-400">
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Current Month Raw Account %</p>
          <h4 className="text-3xl font-bold text-white">+{(manualPerformance?.currentMonthROI ?? stats.currentMonthAccountRaw)?.toFixed(2)}%</h4>
        </div>
        <div className="text-left md:text-right">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Current Quarter Raw Account %</p>
          <h4 className="text-xl font-bold text-emerald-400">+{effectiveQuarterPercent?.toFixed(2)}%</h4>
        </div>
      </div>

      <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all duration-1000" style={{ width: `${Math.min(100, (stats.currentMonthAccountRaw || 0) * 5)}%` }} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => !isInvestor && setShowUserPayouts((prev) => !prev)}
          className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/30 text-left"
        >
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">
            {isInvestor ? 'Quarter Est. Payout (Your Equity)' : `Quarter Est. Payout${showUserPayouts ? ' • click to hide user payouts' : ' • click for user payouts'}`}
          </p>
          <p className="text-lg font-bold text-white">
            ${Math.max(0, ((isInvestor ? userEquity : totalPool) * (effectiveQuarterPercent / 100))).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          {!isInvestor && showUserPayouts && (
            <div className="mt-3 space-y-1 max-h-40 overflow-y-auto pr-1">
              {userPayouts.map((row, idx) => (
                <div key={`${row.userLabel}-${idx}`} className="flex items-center justify-between text-[10px] text-slate-300 border-t border-slate-800 pt-1">
                  <span className="truncate pr-2">{row.userLabel}</span>
                  <span className="font-mono">${row.estPayout.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
              ))}
              {userPayouts.length === 0 && <div className="text-[10px] text-slate-500">No user payout rows found.</div>}
            </div>
          )}
        </button>
        <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/30">
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Total Distributed</p>
          <p className="text-lg font-bold text-sky-400">$0</p>
        </div>
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
  const isNonZero = (value: string | undefined | null) => {
    if (value === undefined || value === null || value === '') return false;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed !== 0;
  };

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
            isNonZero(p.size) || 
            isNonZero(p.positionValue) ||
            isNonZero(p.unrealisedPnl)
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

const BotStatusCard = () => {
  const [status, setStatus] = useState<'RUNNING' | 'DOWN' | 'CHECKING'>('CHECKING');
  const [checkedAt, setCheckedAt] = useState<string>('');

  const refreshStatus = useCallback(async () => {
    try {
      setStatus('CHECKING');
      const response = await fetch('/api/bot-status');
      const data = await response.json();
      if (!response.ok || !data?.success) {
        setStatus('DOWN');
        return;
      }
      setStatus(data.status === 'RUNNING' ? 'RUNNING' : 'DOWN');
      setCheckedAt(data.checkedAt || '');
    } catch {
      setStatus('DOWN');
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 30000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  const isRunning = status === 'RUNNING';

  return (
    <div className="mt-8 bg-slate-800 border border-slate-700 rounded-2xl p-4 shadow-[0_10px_24px_rgba(0,0,0,0.25)]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Bot Status</div>
          <div className={`text-sm font-bold mt-1 ${isRunning ? 'text-emerald-400' : 'text-amber-300'}`}>
            {status === 'CHECKING' ? 'Checking bot status...' : isRunning ? 'Bot is Running' : 'Bot is Down for Maintenance'}
          </div>
          {checkedAt && (
            <div className="text-[10px] text-slate-500 mt-1">Last checked: {new Date(checkedAt).toLocaleString()}</div>
          )}
        </div>
        <div className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${isRunning ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-200'}`}>
          {status === 'CHECKING' ? 'Checking' : isRunning ? 'Running' : 'Maintenance'}
        </div>
      </div>
    </div>
  );
};

const LiveLogs = ({ executions }: { executions: any[] }) => {
    const logs = executions.map(exec => ({
        time: new Date(parseInt(exec.execTime)).toLocaleString(),
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

const PerformanceDetailsModal = ({
  open,
  onClose,
  metric,
  monthly,
  quarterly
}: {
  open: boolean;
  onClose: () => void;
  metric: 'INVESTED' | 'GAIN_LOSS';
  monthly: PerformanceBucket[];
  quarterly: PerformanceBucket[];
}) => {
  const [view, setView] = useState<'MONTHLY' | 'QUARTERLY'>('MONTHLY');
  if (!open) return null;

  const rows = view === 'MONTHLY' ? monthly : quarterly;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-4xl bg-slate-900 border border-slate-700 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-white">
              {metric === 'INVESTED' ? 'Invested Breakdown' : 'Gain/Loss Breakdown'}
            </h3>
            <p className="text-xs text-slate-400">Grouped by month and quarter from closed trades.</p>
          </div>
          <button className="text-slate-400 hover:text-white" onClick={onClose}>✕</button>
        </div>

        <div className="flex gap-2 mb-4">
          <button
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${view === 'MONTHLY' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400'}`}
            onClick={() => setView('MONTHLY')}
          >
            Monthly
          </button>
          <button
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${view === 'QUARTERLY' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400'}`}
            onClick={() => setView('QUARTERLY')}
          >
            Quarterly
          </button>
        </div>

        <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-800 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-slate-300">{view === 'MONTHLY' ? 'Month' : 'Quarter'}</th>
                <th className="px-3 py-2 text-slate-300">Trades</th>
                <th className="px-3 py-2 text-slate-300">Invested</th>
                <th className="px-3 py-2 text-slate-300">Gain/Loss</th>
                <th className="px-3 py-2 text-slate-300">ROI %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-slate-800">
                  <td className="px-3 py-2 text-white">{row.label}</td>
                  <td className="px-3 py-2 text-slate-300">{row.trades}</td>
                  <td className="px-3 py-2 text-slate-300">${row.invested.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  <td className={`px-3 py-2 ${row.gainLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {row.gainLoss >= 0 ? '+' : ''}${row.gainLoss.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td className={`${row.roi >= 0 ? 'text-emerald-400' : 'text-rose-400'} px-3 py-2`}>
                    {row.roi >= 0 ? '+' : ''}{row.roi.toFixed(2)}%
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-slate-500" colSpan={5}>No trade data yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const computePerformanceFromTrades = (trades: any[], walletBalance: number) => {
  let currentMonthPnl = 0;
  let currentMonthInvested = 0;
  let currentQuarterPnl = 0;
  let currentQuarterInvested = 0;
  let previousQuarterPnl = 0;
  let previousQuarterInvested = 0;
  let totalPnlUsd = 0;
  const monthlyMap = new Map<string, PerformanceBucket>();
  const quarterlyMap = new Map<string, PerformanceBucket>();

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

  trades.forEach((trade) => {
    const timestamp = parseInt(trade.updatedTime);
    const date = new Date(timestamp);
    const tradeMonth = date.getMonth();
    const tradeYear = date.getFullYear();
    const tradeQuarter = Math.floor(tradeMonth / 3);
    const pnl = parseFloat(trade.closedPnl) || 0;
    totalPnlUsd += pnl;

    const entryValue = parseFloat(trade.cumEntryValue) || (parseFloat(trade.qty) * parseFloat(trade.avgEntryPrice)) || 0;
    const leverage = parseFloat(trade.leverage) || 1;
    const margin = leverage > 0 ? entryValue / leverage : entryValue;
    const monthKey = `${tradeYear}-${String(tradeMonth + 1).padStart(2, '0')}`;
    const monthLabel = date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    const quarterNumber = Math.floor(tradeMonth / 3) + 1;
    const quarterKey = `${tradeYear}-Q${quarterNumber}`;
    const quarterLabel = `Q${quarterNumber} ${tradeYear}`;

    const monthBucket = monthlyMap.get(monthKey) || { key: monthKey, label: monthLabel, invested: 0, gainLoss: 0, roi: 0, trades: 0 };
    monthBucket.invested += margin;
    monthBucket.gainLoss += pnl;
    monthBucket.trades += 1;
    monthlyMap.set(monthKey, monthBucket);

    const quarterBucket = quarterlyMap.get(quarterKey) || { key: quarterKey, label: quarterLabel, invested: 0, gainLoss: 0, roi: 0, trades: 0 };
    quarterBucket.invested += margin;
    quarterBucket.gainLoss += pnl;
    quarterBucket.trades += 1;
    quarterlyMap.set(quarterKey, quarterBucket);

    if (tradeYear === currentYear && tradeMonth === currentMonth) {
      currentMonthPnl += pnl;
      currentMonthInvested += margin;
    }
    if (tradeYear === currentYear && tradeQuarter === currentQuarter) {
      currentQuarterPnl += pnl;
      currentQuarterInvested += margin;
    }
    if (tradeYear === prevQuarterYear && tradeQuarter === prevQuarter) {
      previousQuarterPnl += pnl;
      previousQuarterInvested += margin;
    }
  });

  const months = [...monthlyMap.values()].map((b) => ({ ...b, roi: b.invested > 0 ? (b.gainLoss / b.invested) * 100 : 0 })).sort((a, b) => b.key.localeCompare(a.key));
  const quarters = [...quarterlyMap.values()].map((b) => ({ ...b, roi: b.invested > 0 ? (b.gainLoss / b.invested) * 100 : 0 })).sort((a, b) => b.key.localeCompare(a.key));
  const currentMonthTradeRoi = currentMonthInvested > 0 ? (currentMonthPnl / currentMonthInvested) * 100 : 0;
  const currentMonthAccountRaw = walletBalance > 0 ? (currentMonthPnl / walletBalance) * 100 : 0;
  const currentQuarterTradeRoi = currentQuarterInvested > 0 ? (currentQuarterPnl / currentQuarterInvested) * 100 : 0;
  const currentQuarterAccountRaw = walletBalance > 0 ? (currentQuarterPnl / walletBalance) * 100 : 0;
  const previousQuarterTradeRoi = previousQuarterInvested > 0 ? (previousQuarterPnl / previousQuarterInvested) * 100 : 0;
  const previousQuarterAccountRaw = walletBalance > 0 ? (previousQuarterPnl / walletBalance) * 100 : 0;

  return {
    stats: { currentMonthTradeRoi, currentMonthAccountRaw, currentQuarterTradeRoi, currentQuarterAccountRaw, previousQuarterTradeRoi, previousQuarterAccountRaw, totalPnlUsd },
    months,
    quarters
  };
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
                const now = new Date();
                const isQ2_2026 = now.getUTCFullYear() === 2026 && now.getUTCMonth() >= 3 && now.getUTCMonth() <= 5;
                const docRef = doc(db, 'settings', 'performance');
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    setCurrentQuarterROI(data.currentQuarterROI?.toString() || '0');
                    setCurrentMonthROI(data.currentMonthROI?.toString() || '0');
                    setPreviousQuarterROI((isQ2_2026 ? Q1_2026_FINAL_ACCOUNT_RAW : (data.previousQuarterROI || 0)).toString());
                    setCurrentQuarterTradeROI(data.currentQuarterTradeROI?.toString() || '0');
                    setCurrentMonthTradeROI(data.currentMonthTradeROI?.toString() || '0');
                    setPreviousQuarterTradeROI((isQ2_2026 ? Q1_2026_FINAL_TRADE_ROI : (data.previousQuarterTradeROI || 0)).toString());
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

const AdminPerformanceDataOverrides = ({
  autoMonthly,
  autoQuarterly,
  onOverrideChange
}: {
  autoMonthly: PerformanceBucket[];
  autoQuarterly: PerformanceBucket[];
  onOverrideChange: (override: PerformanceDataOverride | null) => void;
}) => {
  const [enabled, setEnabled] = useState(false);
  const [monthlyJson, setMonthlyJson] = useState('[]');
  const [quarterlyJson, setQuarterlyJson] = useState('[]');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const fetchOverride = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'performanceDataOverride'));
        if (snap.exists()) {
          const data = snap.data() as PerformanceDataOverride;
          setEnabled(!!data.enabled);
          setMonthlyJson(JSON.stringify(data.monthlyBuckets || [], null, 2));
          setQuarterlyJson(JSON.stringify(data.quarterlyBuckets || [], null, 2));
          onOverrideChange({
            enabled: !!data.enabled,
            monthlyBuckets: data.monthlyBuckets || [],
            quarterlyBuckets: data.quarterlyBuckets || []
          });
        } else {
          onOverrideChange(null);
        }
      } catch (error) {
        console.error('Failed to load performance overrides', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchOverride();
  }, [onOverrideChange]);

  const loadAutoDataIntoEditors = () => {
    setMonthlyJson(JSON.stringify(autoMonthly, null, 2));
    setQuarterlyJson(JSON.stringify(autoQuarterly, null, 2));
    setFeedback('Loaded current auto-calculated data into editors.');
  };

  const appendMonthlyRecord = () => {
    try {
      const parsed = JSON.parse(monthlyJson);
      const next = Array.isArray(parsed) ? parsed : [];
      next.push({ key: `record-${Date.now()}`, label: 'New Month', invested: 0, gainLoss: 0, roi: 0, trades: 0 });
      setMonthlyJson(JSON.stringify(next, null, 2));
    } catch {
      setMonthlyJson(JSON.stringify([{ key: `record-${Date.now()}`, label: 'New Month', invested: 0, gainLoss: 0, roi: 0, trades: 0 }], null, 2));
    }
  };

  const appendQuarterlyRecord = () => {
    try {
      const parsed = JSON.parse(quarterlyJson);
      const next = Array.isArray(parsed) ? parsed : [];
      next.push({ key: `record-${Date.now()}`, label: 'New Quarter', invested: 0, gainLoss: 0, roi: 0, trades: 0 });
      setQuarterlyJson(JSON.stringify(next, null, 2));
    } catch {
      setQuarterlyJson(JSON.stringify([{ key: `record-${Date.now()}`, label: 'New Quarter', invested: 0, gainLoss: 0, roi: 0, trades: 0 }], null, 2));
    }
  };

  const saveOverride = async () => {
    setFeedback(null);
    setIsSaving(true);
    try {
      const parsedMonthly = JSON.parse(monthlyJson) as PerformanceBucket[];
      const parsedQuarterly = JSON.parse(quarterlyJson) as PerformanceBucket[];

      await setDoc(doc(db, 'settings', 'performanceDataOverride'), {
        enabled,
        monthlyBuckets: parsedMonthly,
        quarterlyBuckets: parsedQuarterly,
        updatedAt: new Date()
      }, { merge: true });

      onOverrideChange({
        enabled,
        monthlyBuckets: parsedMonthly,
        quarterlyBuckets: parsedQuarterly
      });
      setFeedback('Override data saved.');
    } catch (error) {
      setFeedback(`Invalid JSON or save failure: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const clearOverride = async () => {
    setFeedback(null);
    setIsSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'performanceDataOverride'), {
        enabled: false,
        monthlyBuckets: deleteField(),
        quarterlyBuckets: deleteField(),
        updatedAt: new Date()
      }, { merge: true });

      setEnabled(false);
      setMonthlyJson('[]');
      setQuarterlyJson('[]');
      onOverrideChange(null);
      setFeedback('Overrides cleared. Live API grouped data will be used.');
    } catch (error) {
      setFeedback(`Failed to clear override: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="text-xs text-slate-500">Loading override settings...</div>;
  }

  return (
    <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-bold text-white">Performance Data Override</h4>
          <p className="text-xs text-slate-400">Replace grouped monthly/quarterly trade data manually from admin.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enable override
        </label>
      </div>

      <div className="flex gap-2">
        <button onClick={loadAutoDataIntoEditors} className="px-3 py-1.5 text-xs rounded bg-slate-800 text-slate-300 hover:bg-slate-700">
          Load Auto Data
        </button>
        <button onClick={appendMonthlyRecord} className="px-3 py-1.5 text-xs rounded bg-slate-800 text-slate-300 hover:bg-slate-700">
          Add Monthly Record
        </button>
        <button onClick={appendQuarterlyRecord} className="px-3 py-1.5 text-xs rounded bg-slate-800 text-slate-300 hover:bg-slate-700">
          Add Quarterly Record
        </button>
        <button onClick={saveOverride} disabled={isSaving} className="px-3 py-1.5 text-xs rounded bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-60">
          {isSaving ? 'Saving...' : 'Save Override'}
        </button>
        <button onClick={clearOverride} disabled={isSaving} className="px-3 py-1.5 text-xs rounded bg-rose-700/80 text-white hover:bg-rose-700 disabled:opacity-60">
          Wipe Override
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] text-slate-400 uppercase mb-1">Monthly Buckets JSON</label>
          <textarea value={monthlyJson} onChange={(e) => setMonthlyJson(e.target.value)} className="w-full min-h-[180px] bg-slate-950 border border-slate-700 rounded p-2 text-xs font-mono text-slate-200" />
        </div>
        <div>
          <label className="block text-[10px] text-slate-400 uppercase mb-1">Quarterly Buckets JSON</label>
          <textarea value={quarterlyJson} onChange={(e) => setQuarterlyJson(e.target.value)} className="w-full min-h-[180px] bg-slate-950 border border-slate-700 rounded p-2 text-xs font-mono text-slate-200" />
        </div>
      </div>
      {feedback && <p className="text-xs text-slate-300">{feedback}</p>}
    </div>
  );
};

const AdminTradeRangeCommit = ({
  rangeStart,
  rangeEnd,
  onRangeStartChange,
  onRangeEndChange,
  onPreviewRange,
  onCommitRange,
  onRefreshRange,
  rangePreviewCount
}: {
  rangeStart: string;
  rangeEnd: string;
  onRangeStartChange: (value: string) => void;
  onRangeEndChange: (value: string) => void;
  onPreviewRange: () => void;
  onCommitRange: () => void;
  onRefreshRange: () => void;
  rangePreviewCount: number;
}) => (
  <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Performance Date Range (Preview + Commit)</p>
    <p className="text-[10px] text-slate-500">Trades are pulled from March 26, 2026 onward.</p>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <input type="date" value={rangeStart} onChange={(e) => onRangeStartChange(e.target.value)} style={{ colorScheme: 'dark' }} className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white" />
      <input type="date" value={rangeEnd} onChange={(e) => onRangeEndChange(e.target.value)} style={{ colorScheme: 'dark' }} className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white" />
    </div>
    <div className="flex items-center gap-2">
      <button onClick={onRefreshRange} className="px-3 py-1.5 bg-emerald-700 text-white rounded-lg text-xs font-bold hover:bg-emerald-600">Refresh Trades by Date</button>
      <button onClick={onPreviewRange} className="px-3 py-1.5 bg-slate-800 text-slate-200 rounded-lg text-xs font-bold hover:bg-slate-700">Preview Range</button>
      <button onClick={onCommitRange} className="px-3 py-1.5 bg-sky-600 text-white rounded-lg text-xs font-bold hover:bg-sky-500">Commit Found Trades</button>
      <span className="text-xs text-slate-400">{rangePreviewCount} trades found</span>
    </div>
  </div>
);

const InvestmentModal = ({ onClose }: { onClose: () => void }) => {
    const [status, setStatus] = useState<'IDLE' | 'PROCESSING' | 'COMPLETED'>('IDLE');
    const [investAmount, setInvestAmount] = useState<string>('');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [confirmMessage, setConfirmMessage] = useState<string>('Waiting for payment confirmation...');
    const [hasCopiedAddress, setHasCopiedAddress] = useState(false);
    const MAX_INVEST_INPUT = 10_000;
    const SOL_DEPOSIT_ADDRESS = '6ujTKvwE9Aa5oPKGTz174HJUa89uX13dWwMWUQ1257G6';

    const amountNum = parseFloat(investAmount) || 0;
    const fee = amountNum * 0.18; // 18% Fee
    const netInvested = amountNum - fee; // 82% Invested

    const handleConfirm = async () => {
      if (amountNum <= 0) return;
      if (amountNum > MAX_INVEST_INPUT) {
        setErrorMsg(`Maximum deposit entry is $${MAX_INVEST_INPUT.toLocaleString()}.`);
        return;
      }
      setStatus('PROCESSING');
      setErrorMsg(null);
      setConfirmMessage('Confirming deposit from Bybit...');
      
      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Not authenticated");

        let confirmed = false;
        for (let attempt = 0; attempt < 12; attempt += 1) {
          setConfirmMessage(`Checking Bybit deposit records... (${attempt + 1}/12)`);
          const response = await fetch('/api/payment/confirm-sol-deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: amountNum,
              userId: user.uid,
              userEmail: user.email,
              depositAddress: SOL_DEPOSIT_ADDRESS
            })
          });
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error || 'Failed to confirm deposit');
          }
          if (data.status === 'CONFIRMED') {
            confirmed = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        if (!confirmed) {
          throw new Error('Deposit not detected yet. Please wait a moment and try confirm again.');
        }

        setStatus('COMPLETED');
        setConfirmMessage('Deposit confirmed. Updating your profile...');
        setTimeout(() => onClose(), 1200);
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
                    <p className="text-sm text-slate-400 mt-1">Send USDT (SOL) to the address below, then confirm.</p>
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
                        onChange={(e) => {
                          const nextRaw = e.target.value;
                          const nextValue = Math.min(MAX_INVEST_INPUT, Math.max(0, Number(nextRaw) || 0));
                          setInvestAmount(nextRaw === '' ? '' : String(nextValue));
                        }}
                        placeholder="0"
                        min={0}
                        max={MAX_INVEST_INPUT}
                        className="w-full bg-transparent text-3xl font-bold text-white outline-none placeholder-slate-600"
                    />
                </div>
                <p className="text-[10px] text-slate-500 mb-3">Per deposit entry max: ${MAX_INVEST_INPUT.toLocaleString()}.</p>
                
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

            <div className="mb-6">
                <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">USDT (SOL) Deposit Address</label>
                <div className="bg-slate-900/50 py-3 px-4 rounded-xl border border-sky-500/30 font-mono text-xs break-all text-sky-300">
                    {SOL_DEPOSIT_ADDRESS}
                </div>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(SOL_DEPOSIT_ADDRESS);
                    setHasCopiedAddress(true);
                    setTimeout(() => setHasCopiedAddress(false), 1500);
                  }}
                  className="mt-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-700 text-slate-200 hover:bg-slate-600"
                >
                  {hasCopiedAddress ? 'Copied' : 'Copy Address'}
                </button>
                <p className="text-[10px] text-slate-500 mt-2">Maximum invested capital per user is $10,000 total.</p>
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
                    {status === 'PROCESSING' ? <><Loader2 className="animate-spin text-slate-200" /> Confirming Deposit...</> : status === 'COMPLETED' ? 'Deposit Confirmed' : "I've Sent to This Address"}
                </button>
                
                <p className="text-[10px] text-slate-400 text-center leading-relaxed">
                    SOL confirmations are near-instant. We will auto-check Bybit records and apply to your profile once detected.
                </p>
                {status === 'PROCESSING' && (
                  <div className="mt-2 p-3 rounded-xl border border-sky-500/30 bg-sky-500/10 text-xs text-sky-200 text-center">
                    {confirmMessage}
                  </div>
                )}
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
        fetchClosedPnL(undefined, 120)
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
  const [dashboardStats, setDashboardStats] = useState({
    currentMonthTradeRoi: SCREENSHOT_BASELINE.currentMonthTradeROI,
    currentMonthAccountRaw: SCREENSHOT_BASELINE.currentMonthAccountRaw,
    currentQuarterTradeRoi: SCREENSHOT_BASELINE.currentQuarterTradeROI,
    currentQuarterAccountRaw: SCREENSHOT_BASELINE.currentQuarterAccountRaw,
    previousQuarterTradeRoi: SCREENSHOT_BASELINE.previousQuarterTradeROI,
    previousQuarterAccountRaw: SCREENSHOT_BASELINE.previousQuarterAccountRaw,
    totalPnlUsd: SCREENSHOT_BASELINE.totalPnlUsd,
  });
  const [manualPerformance, setManualPerformance] = useState({
    currentQuarterROI: SCREENSHOT_BASELINE.currentQuarterAccountRaw,
    currentMonthROI: SCREENSHOT_BASELINE.currentMonthAccountRaw,
    previousQuarterROI: SCREENSHOT_BASELINE.previousQuarterAccountRaw,
    currentQuarterTradeROI: SCREENSHOT_BASELINE.currentQuarterTradeROI,
    currentMonthTradeROI: SCREENSHOT_BASELINE.currentMonthTradeROI,
    previousQuarterTradeROI: SCREENSHOT_BASELINE.previousQuarterTradeROI
  });
  const [isRefreshingPerformance, setIsRefreshingPerformance] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [performanceByMonth, setPerformanceByMonth] = useState<PerformanceBucket[]>([]);
  const [performanceByQuarter, setPerformanceByQuarter] = useState<PerformanceBucket[]>([]);
  const [autoPerformanceByMonth, setAutoPerformanceByMonth] = useState<PerformanceBucket[]>([]);
  const [autoPerformanceByQuarter, setAutoPerformanceByQuarter] = useState<PerformanceBucket[]>([]);
  const [performanceOverride, setPerformanceOverride] = useState<PerformanceDataOverride | null>(null);
  const [detailsMetric, setDetailsMetric] = useState<'INVESTED' | 'GAIN_LOSS'>('INVESTED');
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showPayoutBreakdown, setShowPayoutBreakdown] = useState(false);
  const [showAdminPayoutBreakdown, setShowAdminPayoutBreakdown] = useState(false);
  const [trackedClosedTrades, setTrackedClosedTrades] = useState<any[]>([]);
  const [closedTradesCache, setClosedTradesCache] = useState<any[]>([]);
  const [rangeStart, setRangeStart] = useState<string>(TRACK_FROM_DATE_INPUT);
  const [rangeEnd, setRangeEnd] = useState<string>(new Date().toISOString().slice(0, 10));
  const [rangePreviewTrades, setRangePreviewTrades] = useState<any[]>([]);
  const [adminUserPayouts, setAdminUserPayouts] = useState<UserPayoutRow[]>([]);

  useEffect(() => {
    const fetchManualPerformance = async () => {
        try {
            const now = new Date();
            const isQ2_2026 = now.getUTCFullYear() === 2026 && now.getUTCMonth() >= 3 && now.getUTCMonth() <= 5;
            const docRef = doc(db, 'settings', 'performance');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                setManualPerformance({
                    currentQuarterROI: data.currentQuarterROI ?? SCREENSHOT_BASELINE.currentQuarterAccountRaw,
                    currentMonthROI: data.currentMonthROI ?? SCREENSHOT_BASELINE.currentMonthAccountRaw,
                    previousQuarterROI: isQ2_2026 ? Q1_2026_FINAL_ACCOUNT_RAW : (data.previousQuarterROI ?? SCREENSHOT_BASELINE.previousQuarterAccountRaw),
                    currentQuarterTradeROI: data.currentQuarterTradeROI ?? SCREENSHOT_BASELINE.currentQuarterTradeROI,
                    currentMonthTradeROI: data.currentMonthTradeROI ?? SCREENSHOT_BASELINE.currentMonthTradeROI,
                    previousQuarterTradeROI: isQ2_2026 ? Q1_2026_FINAL_TRADE_ROI : (data.previousQuarterTradeROI ?? SCREENSHOT_BASELINE.previousQuarterTradeROI)
                });
            }
        } catch (error) {
            console.error("Error fetching manual performance:", error);
        }
    };
    fetchManualPerformance();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    const fetchAdminUserPayouts = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'users'));
        const rows = snapshot.docs.map((userDoc) => {
          const user = userDoc.data() as any;
          const invested = Number(user.totalInvested || 0);
          const label = user.name || user.email || user.username || userDoc.id;
          return { userLabel: label, invested, estPayout: 0 };
        });
        setAdminUserPayouts(rows);
      } catch (error) {
        console.error('Failed to load admin user payout rows', error);
      }
    };
    fetchAdminUserPayouts();
  }, [isAdmin]);

  const handleRefreshPerformance = useCallback(async () => {
    setIsRefreshingPerformance(true);
    try {
        // 1. Fetch from Bybit API
        const now = Date.now();
        const lookbackDays = Math.max(1, Math.ceil((now - TRACK_FROM_DATE_UTC) / (24 * 60 * 60 * 1000)));
        const [closedTrades, walletBalance, recentExecs] = await Promise.all([
            fetchClosedPnL(undefined, lookbackDays),
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

        const mergedTrackedTrades = [...trackedClosedTrades];
        const seenTradeIds = new Set(mergedTrackedTrades.map((trade: any) => `${trade.orderId}-${trade.updatedTime}`));
        closedTrades
          .filter((trade: any) => parseInt(trade.updatedTime) >= TRACK_FROM_DATE_UTC)
          .forEach((trade: any) => {
          const key = `${trade.orderId}-${trade.updatedTime}`;
          if (!seenTradeIds.has(key)) {
            seenTradeIds.add(key);
            mergedTrackedTrades.push(trade);
          }
        });

        setTrackedClosedTrades(mergedTrackedTrades);
        setClosedTradesCache(mergedTrackedTrades);
        const { stats, months, quarters } = computePerformanceFromTrades(mergedTrackedTrades, walletBalance);
        setAutoPerformanceByMonth(months);
        setAutoPerformanceByQuarter(quarters);
        if (performanceOverride?.enabled) {
            setPerformanceByMonth(performanceOverride.monthlyBuckets || []);
            setPerformanceByQuarter(performanceOverride.quarterlyBuckets || []);
        } else {
            setPerformanceByMonth(months);
            setPerformanceByQuarter(quarters);
        }

        setDashboardStats(stats);

        if (walletBalance > 0) {
            setLiveBalance(walletBalance);
        } else {
            setLiveBalance(totalPool + stats.totalPnlUsd);
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
  }, [totalPool, performanceOverride, trackedClosedTrades]);

  const handlePreviewRange = useCallback(() => {
    if (!rangeStart || !rangeEnd) return;
    const start = new Date(`${rangeStart}T00:00:00Z`).getTime();
    const end = new Date(`${rangeEnd}T23:59:59Z`).getTime();
    const filtered = closedTradesCache.filter((trade) => {
      const timestamp = parseInt(trade.updatedTime);
      return timestamp >= start && timestamp <= end;
    });
    setRangePreviewTrades(filtered);
  }, [rangeStart, rangeEnd, closedTradesCache]);

  const handleCommitRange = useCallback(() => {
    if (rangePreviewTrades.length === 0) return;
    const { stats, months, quarters } = computePerformanceFromTrades(rangePreviewTrades, liveBalance || 0);
    setDashboardStats(stats);
    setPerformanceByMonth(months);
    setPerformanceByQuarter(quarters);
  }, [rangePreviewTrades, liveBalance]);

  const handleRefreshRange = useCallback(async () => {
    if (!rangeStart || !rangeEnd) return;
    setIsRefreshingPerformance(true);
    try {
      const start = new Date(`${rangeStart}T00:00:00Z`).getTime();
      const end = new Date(`${rangeEnd}T23:59:59Z`).getTime();
      const lookbackDays = Math.max(1, Math.ceil((Date.now() - start) / (24 * 60 * 60 * 1000)));
      const [closedTrades, walletBalance] = await Promise.all([
        fetchClosedPnL(undefined, lookbackDays),
        fetchWalletBalance()
      ]);
      const filtered = closedTrades.filter((trade: any) => {
        const ts = parseInt(trade.updatedTime);
        return ts >= start && ts <= end && ts >= TRACK_FROM_DATE_UTC;
      });
      setTrackedClosedTrades(filtered);
      setClosedTradesCache(filtered);
      setRangePreviewTrades(filtered);
      const { stats, months, quarters } = computePerformanceFromTrades(filtered, walletBalance);
      setDashboardStats(stats);
      setAutoPerformanceByMonth(months);
      setAutoPerformanceByQuarter(quarters);
      setPerformanceByMonth(months);
      setPerformanceByQuarter(quarters);
    } catch (error) {
      console.error('Failed to refresh trades by date range', error);
    } finally {
      setIsRefreshingPerformance(false);
    }
  }, [rangeStart, rangeEnd]);

  const handleRefreshFromMarch27 = useCallback(async () => {
    setIsRefreshingPerformance(true);
    try {
      const now = new Date();
      const march26 = TRACK_FROM_DATE_UTC;
      const lookbackDays = Math.max(1, Math.ceil((now.getTime() - march26) / (24 * 60 * 60 * 1000)));
      const [closedTrades, walletBalance] = await Promise.all([
        fetchClosedPnL(undefined, lookbackDays),
        fetchWalletBalance()
      ]);

      const filtered = closedTrades.filter((trade: any) => parseInt(trade.updatedTime) >= march26);
      setTrackedClosedTrades(filtered);
      setClosedTradesCache(filtered);
      const { stats, months, quarters } = computePerformanceFromTrades(filtered, walletBalance);
      setDashboardStats(stats);
      setAutoPerformanceByMonth(months);
      setAutoPerformanceByQuarter(quarters);
      if (performanceOverride?.enabled) {
        setPerformanceByMonth(performanceOverride.monthlyBuckets || []);
        setPerformanceByQuarter(performanceOverride.quarterlyBuckets || []);
      } else {
        setPerformanceByMonth(months);
        setPerformanceByQuarter(quarters);
      }
    } catch (error) {
      console.error('Failed to refresh trades from March 26 onward', error);
    } finally {
      setIsRefreshingPerformance(false);
    }
  }, [performanceOverride]);

    useEffect(() => {
        // Initial fetch from Bybit
        handleRefreshPerformance();
        
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
  
  const getPayoutPercentage = () => {
      if (userShare <= 0.5) return 50;
      if (userShare <= 0.75) return 75;
      return 100;
  };

  // Equity Calculation based on quarter USDT gain relative to total equity.
  const exchangeProfit = liveBalance ? liveBalance - totalPool : 0;
  const effectiveQuarterPercent = Math.max(0, manualPerformance?.currentQuarterROI ?? dashboardStats.currentQuarterAccountRaw);
  const totalQuarterGainUsd = Math.max(0, totalPool * (effectiveQuarterPercent / 100));
  const userQuarterContribution = totalPool > 0 ? Math.max(0, investorStats.q3Invested) / totalPool : 0;
  const userProfit = totalQuarterGainUsd * userQuarterContribution;
  const currentQuarterEquity = Math.max(0, investorStats.q3Invested + userProfit);
  const totalBalance = Math.max(0, currentQuarterEquity);
  const adminUserPayoutRows = adminUserPayouts.map((row) => ({
    ...row,
    estPayout: Math.max(
      0,
      totalQuarterGainUsd * (totalPool > 0 ? row.invested / totalPool : 0)
    )
  }));
  const adminPayoutTier50 = Math.max(0, totalQuarterGainUsd * 0.5);
  const adminPayoutTier75 = Math.max(0, totalQuarterGainUsd * 0.75);
  const adminPayoutTier100 = Math.max(0, totalQuarterGainUsd * 1.0);
  const investorModalMonthly = isInvestor
    ? performanceByMonth.map((row) => {
        const invested = Math.min(row.invested, Math.max(0, investorStats.q3Invested));
        const roi = invested > 0 ? (row.gainLoss / invested) * 100 : 0;
        return { ...row, invested, roi };
      })
    : performanceByMonth;
  const investorModalQuarterly = isInvestor
    ? performanceByQuarter.map((row) => {
        const invested = Math.min(row.invested, Math.max(0, investorStats.q3Invested));
        const roi = invested > 0 ? (row.gainLoss / invested) * 100 : 0;
        return { ...row, invested, roi };
      })
    : performanceByQuarter;

  const tabs = [
      { id: 'OVERVIEW', label: 'Overview' },
      ...(isAdmin ? [
          { id: 'PAYOUTS', label: 'Performance' },
          { id: 'MARKET', label: 'Market' },
          { id: 'LOGS', label: 'Logs' },
          { id: 'DEBUG', label: 'Debug' }
      ] : [])
  ];

  return (
    <div className="space-y-6 pb-20 md:pb-0 animate-fade-in">
      {showInvestModal && <InvestmentModal onClose={() => setShowInvestModal(false)} />}

      {/* Header & Tabs */}
      <div className="sticky top-0 bg-transparent z-30 pt-2 pb-2 -mx-4 px-4 md:static md:p-0 md:mx-0">
          <div className="flex items-center justify-between mb-4 md:mb-6">
            <div>
                <h2 className={`text-2xl font-bold tracking-tight ${'text-white'}`}>
                    {activeTab === 'OVERVIEW' ? (
                        isInvestor ? `Investor - ${username?.split('@')[0] || 'Investor'}` : 'Admin Console'
                    ) : (
                        activeTab === 'PAYOUTS' ? 'Performance' : 'Live Terminal'
                    )}
                </h2>
                {isInvestor && (
                    <p className="text-xs text-slate-500 font-medium">Portfolio Overview</p>
                )}
            </div>
            {(!isAdmin || activeTab === 'PAYOUTS') && (
              <button
                onClick={handleRefreshPerformance}
                disabled={isRefreshingPerformance}
                className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-bold text-sky-400 hover:bg-slate-700 disabled:opacity-60 flex items-center gap-2"
              >
                <RefreshCw size={14} className={isRefreshingPerformance ? 'animate-spin' : ''} />
                Pull API Data
              </button>
            )}
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
                        <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Current Amount Invested</div>
                        <div className="text-4xl font-bold tracking-tight mb-6">
                            ${Math.max(0, investorStats.q3Invested).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            {isRefreshingPerformance && <span className="ml-2 inline-flex text-xs text-sky-300 align-middle"><Loader2 size={12} className="animate-spin mr-1" /> syncing</span>}
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => { setDetailsMetric('INVESTED'); setShowDetailsModal(true); }}
                                className="bg-white/10 px-4 py-3 rounded-2xl backdrop-blur-md text-left hover:bg-white/15 transition-colors"
                            >
                                <div className="text-[10px] text-slate-300 uppercase font-bold mb-1">Total Equity</div>
                                <div className="font-mono font-bold text-lg">${totalBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                            </button>
                            <button
                                onClick={() => { setDetailsMetric('GAIN_LOSS'); setShowDetailsModal(true); }}
                                className="bg-emerald-500/20 px-4 py-3 rounded-2xl backdrop-blur-md border border-emerald-500/20 text-left hover:bg-emerald-500/25 transition-colors"
                            >
                                <div className="text-[10px] text-emerald-300 uppercase font-bold mb-1">{userProfit >= 0 ? 'Profit' : 'Loss'}</div>
                                <div className={`font-mono font-bold text-lg ${userProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {userProfit >= 0 ? '+' : ''}${userProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                            </button>
                            {investorStats.pendingInvested > 0 && (
                                <div className="bg-sky-500/20 px-4 py-3 rounded-2xl backdrop-blur-md border border-sky-500/20 col-span-2 flex justify-between items-center animate-fade-in">
                                    <div className="text-[10px] text-sky-300 uppercase font-bold tracking-wider">Pending (Next Quarter)</div>
                                    <div className="font-mono font-bold text-lg text-sky-400">
                                        ${investorStats.pendingInvested.toLocaleString()}
                                    </div>
                                </div>
                            )}
                            <button
                                onClick={() => setShowPayoutBreakdown((prev) => !prev)}
                                className="bg-gradient-to-r from-emerald-500/20 to-teal-500/10 px-4 py-3 rounded-2xl backdrop-blur-md border border-emerald-500/30 col-span-2 flex justify-between items-center text-left hover:from-emerald-500/30 hover:to-teal-500/20 transition-colors"
                            >
                                <div>
                                    <div className="text-[10px] text-emerald-300 uppercase font-bold tracking-wider">Current Quarterly Payout</div>
                                    <div className="text-[9px] text-emerald-400/70">% Qualified: {getPayoutPercentage().toFixed(0)}% {showPayoutBreakdown ? '• click to hide breakdown' : '• click for breakdown'}</div>
                                    {showPayoutBreakdown && (
                                      <div className="text-[9px] text-emerald-300/90 mt-1">
                                        Quarter USDT gain share: ${userProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} • Equity contribution: {(userQuarterContribution * 100).toFixed(2)}%
                                      </div>
                                    )}
                                </div>
                                <div className="font-mono font-bold text-xl text-emerald-400">
                                    ${Math.max(0, userProfit * (getPayoutPercentage() / 100)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                            </button>
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
                             
                             <button
                                 onClick={() => setShowAdminPayoutBreakdown((prev) => !prev)}
                                 className="col-span-2 bg-purple-500/10 p-3 rounded-xl backdrop-blur-md border border-purple-500/20 mt-2 flex justify-between items-center text-left hover:bg-purple-500/20 transition-colors"
                             >
                                 <div>
                                     <div className="text-[10px] text-purple-300 uppercase font-bold mb-1">Total Payout on Total Equity</div>
                                     <div className="font-mono font-bold text-purple-400 text-lg">
                                        ${adminPayoutTier100.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                     </div>
                                     {showAdminPayoutBreakdown && (
                                       <div className="text-[10px] text-purple-300/80 mt-1">
                                          Equity: ${totalPool.toLocaleString(undefined, { maximumFractionDigits: 2 })} • Quarter USDT Gain: ${totalQuarterGainUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} • 50%: ${adminPayoutTier50.toLocaleString(undefined, { maximumFractionDigits: 2 })} • 75%: ${adminPayoutTier75.toLocaleString(undefined, { maximumFractionDigits: 2 })} • 100%: ${adminPayoutTier100.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                       </div>
                                     )}
                                 </div>
                                 <Wallet size={20} className="text-purple-400 opacity-50" />
                             </button>
                        </div>
                    </div>
                </div>
            )}

            <TradeStatusWidget isInvestor={isInvestor} userShare={userShare} liveBalance={liveBalance} />

            {/* Live Logs */}
            <LiveLogs executions={executions} />
            {isInvestor && <BotStatusCard />}
        </div>
      )}
      <PerformanceDetailsModal
        open={showDetailsModal}
        onClose={() => setShowDetailsModal(false)}
        metric={detailsMetric}
        monthly={investorModalMonthly}
        quarterly={investorModalQuarterly}
      />

      {activeTab === 'PAYOUTS' && isAdmin && (
          <div className="animate-fade-in">
              <div className="mb-4 flex items-center justify-end">
                <button
                  onClick={handleRefreshFromMarch27}
                  disabled={isRefreshingPerformance}
                  className="px-3 py-2 rounded-lg bg-sky-600 text-white text-xs font-bold hover:bg-sky-500 disabled:opacity-60 flex items-center gap-2"
                >
                  <RefreshCw size={12} className={isRefreshingPerformance ? 'animate-spin' : ''} />
                  Refresh Trades (3/26 onward)
                </button>
              </div>
              <AdminPerformanceSettings poolCapital={totalPool} dashboardStats={dashboardStats} />
              <AdminPerformanceDataOverrides
                autoMonthly={autoPerformanceByMonth}
                autoQuarterly={autoPerformanceByQuarter}
                onOverrideChange={setPerformanceOverride}
              />
              <AdminTradeRangeCommit
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                onRangeStartChange={setRangeStart}
                onRangeEndChange={setRangeEnd}
                onPreviewRange={handlePreviewRange}
                onCommitRange={handleCommitRange}
                onRefreshRange={handleRefreshRange}
                rangePreviewCount={rangePreviewTrades.length}
              />
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
