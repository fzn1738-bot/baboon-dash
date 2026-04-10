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
  currentUserId?: string;
  currentUserEmail?: string;
  investorStats?: {
    q3Invested: number;
    pendingInvested: number;
    q3CurrentRoi: number;
    totalWithdrawn: number;
  };
  onCapitalInject?: (amount: number) => void;
  userShare: number;
  totalPool: number;
  adminImpersonateUserId?: string;
  onAdminImpersonateUserIdChange?: (userId: string) => void;
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
  accountRawPercent?: number;
};
type DepositEvent = {
  timestamp: number;
  netAmount: number;
};
type AdminUserSummary = {
  id: string;
  email?: string;
  name?: string;
  totalInvested: number;
  pendingInvested: number;
  currentEquity?: number;
  profitLoss?: number;
};

type PerformanceDataOverride = {
  enabled: boolean;
  monthlyBuckets: PerformanceBucket[];
  quarterlyBuckets: PerformanceBucket[];
};

type QuarterOverrideRow = {
  tradeRoi: number;
  accountRaw: number;
  usdt: number;
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

const getQuarterKeyFromDate = (date: Date) => {
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `${date.getFullYear()}-Q${quarter}`;
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
  quarterly,
  isInvestor = false,
  closedTrades = [],
  userDepositEvents = [],
  totalPool = 0,
  currentEquityBase = 0
}: {
  open: boolean;
  onClose: () => void;
  metric: 'INVESTED' | 'GAIN_LOSS';
  monthly: PerformanceBucket[];
  quarterly: PerformanceBucket[];
  isInvestor?: boolean;
  closedTrades?: any[];
  userDepositEvents?: DepositEvent[];
  totalPool?: number;
  currentEquityBase?: number;
}) => {
  const [view, setView] = useState<'MONTHLY' | 'QUARTERLY'>('MONTHLY');
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string | null>(null);
  if (!open) return null;

  const rows = view === 'MONTHLY' ? monthly : quarterly;
  const selectedRow = selectedPeriodKey ? rows.find((row) => row.key === selectedPeriodKey) || null : null;
  const sortedDeposits = [...userDepositEvents].sort((a, b) => a.timestamp - b.timestamp);
  const firstDepositTs = sortedDeposits.length > 0 ? sortedDeposits[0].timestamp : null;

  const selectedPeriodTrades = selectedRow
    ? closedTrades
        .filter((trade) => {
          const ts = Number(trade.updatedTime || trade.timestamp || 0);
          if (!ts) return false;
          const date = new Date(ts);
          if (view === 'MONTHLY') {
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            return monthKey === selectedRow.key;
          }
          const q = Math.floor(date.getMonth() / 3) + 1;
          const quarterKey = `${date.getFullYear()}-Q${q}`;
          return quarterKey === selectedRow.key;
        })
        .map((trade) => {
          const ts = Number(trade.updatedTime || trade.timestamp || 0);
          const pnl = Number(trade.closedPnl || trade.trade_pnl || 0);
          const accountRawFromText = (() => {
            const rawText = String(trade.content || trade.reason || '');
            const match = rawText.match(/ACC\s*RAW\s*[:=]\s*([+-]?\d+(\.\d+)?)/i);
            return match ? Number(match[1]) : NaN;
          })();
          const accountRawPercent = Number(
            trade.trade_account_raw_percent ??
            trade.tradeAccountRawPercent ??
            trade.account_raw_percent ??
            trade.accountRawPercent ??
            trade.accRaw ??
            (Number.isFinite(accountRawFromText) ? accountRawFromText : undefined) ??
            (selectedRow.trades > 0 ? (selectedRow.accountRawPercent || 0) / selectedRow.trades : undefined) ??
            (totalPool > 0 ? (pnl / totalPool) * 100 : 0)
          ) || 0;
          const eligibleEquity = isInvestor
            ? (firstDepositTs && ts < firstDepositTs ? 0 : currentEquityBase)
            : totalPool;
          const userPnl = (eligibleEquity * accountRawPercent) / 100;
          const entryValue = Number(trade.cumEntryValue || 0) || ((Number(trade.qty) || 0) * (Number(trade.avgEntryPrice) || 0));
          const leverage = Number(trade.leverage || 1) || 1;
          const margin = leverage > 0 ? entryValue / leverage : entryValue;
          const tradeRoiPercent = Number(
            trade.trade_roi_percent ??
            trade.tradeRoiPercent ??
            (margin > 0 ? (pnl / margin) * 100 : 0)
          ) || 0;
          return {
            id: `${trade.orderId || trade.symbol || 'trade'}-${ts}`,
            ts,
            symbol: trade.symbol || '—',
            side: trade.side || '—',
            accountRawPercent,
            tradeRoiPercent,
            eligibleEquity,
            userPnl
          };
        })
        .sort((a, b) => b.ts - a.ts)
    : [];

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
                <th className="px-3 py-2 text-slate-300">Trade ROI %</th>
                {isInvestor && <th className="px-3 py-2 text-slate-300">Account Raw %</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={`border-t border-slate-800 cursor-pointer hover:bg-slate-800/40 ${selectedPeriodKey === row.key ? 'bg-slate-800/30' : ''}`}
                  onClick={() => setSelectedPeriodKey((prev) => (prev === row.key ? null : row.key))}
                >
                  <td className="px-3 py-2 text-white">{row.label}</td>
                  <td className="px-3 py-2 text-slate-300">{row.trades}</td>
                  <td className="px-3 py-2 text-slate-300">${row.invested.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  <td className={`px-3 py-2 ${row.gainLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {row.gainLoss >= 0 ? '+' : ''}${row.gainLoss.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                  <td className={`${row.roi >= 0 ? 'text-emerald-400' : 'text-rose-400'} px-3 py-2`}>
                    {row.roi >= 0 ? '+' : ''}{row.roi.toFixed(2)}%
                  </td>
                  {isInvestor && (
                    <td className={`${(row.accountRawPercent || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'} px-3 py-2`}>
                      {(row.accountRawPercent || 0) >= 0 ? '+' : ''}{(row.accountRawPercent || 0).toFixed(2)}%
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-slate-500" colSpan={isInvestor ? 6 : 5}>No trade data yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedRow && (
          <div className="mt-4 rounded-xl border border-slate-800 p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-white">
                Trades for {selectedRow.label}
              </h4>
              <span className="text-[11px] text-slate-400">{selectedPeriodTrades.length} trade(s)</span>
            </div>
            <div className="max-h-56 overflow-auto rounded-lg border border-slate-800">
              <table className="w-full text-[11px]">
                <thead className="bg-slate-800 sticky top-0">
                  <tr>
                    <th className="px-2 py-2 text-left text-slate-300">Time</th>
                    <th className="px-2 py-2 text-left text-slate-300">Symbol</th>
                    <th className="px-2 py-2 text-left text-slate-300">Side</th>
                    <th className="px-2 py-2 text-right text-slate-300">Trade ROI %</th>
                    <th className="px-2 py-2 text-right text-slate-300">Account Raw %</th>
                    {isInvestor && <th className="px-2 py-2 text-right text-slate-300">Equity @ Trade</th>}
                    <th className="px-2 py-2 text-right text-slate-300">{isInvestor ? 'User PnL' : 'PnL'}</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPeriodTrades.map((trade) => (
                    <tr key={trade.id} className="border-t border-slate-800">
                      <td className="px-2 py-2 text-slate-300">{new Date(trade.ts).toLocaleString()}</td>
                      <td className="px-2 py-2 text-white">{trade.symbol}</td>
                      <td className="px-2 py-2 text-slate-300">{trade.side}</td>
                      <td className={`px-2 py-2 text-right ${trade.tradeRoiPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {trade.tradeRoiPercent >= 0 ? '+' : ''}{trade.tradeRoiPercent.toFixed(2)}%
                      </td>
                      <td className={`px-2 py-2 text-right ${trade.accountRawPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {trade.accountRawPercent >= 0 ? '+' : ''}{trade.accountRawPercent.toFixed(2)}%
                      </td>
                      {isInvestor && (
                        <td className="px-2 py-2 text-right text-slate-300">
                          ${trade.eligibleEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      )}
                      <td className={`px-2 py-2 text-right ${trade.userPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {trade.userPnl >= 0 ? '+' : ''}${trade.userPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                  {selectedPeriodTrades.length === 0 && (
                    <tr>
                      <td colSpan={isInvestor ? 7 : 6} className="px-2 py-4 text-center text-slate-500">
                        No trades found for this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
    const monthBucket = monthlyMap.get(monthKey) || { key: monthKey, label: monthLabel, invested: 0, gainLoss: 0, roi: 0, trades: 0 };
    monthBucket.invested += margin;
    monthBucket.gainLoss += pnl;
    monthBucket.trades += 1;
    monthlyMap.set(monthKey, monthBucket);

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
  const quarterlyMap = new Map<string, PerformanceBucket>();
  months.forEach((month) => {
    const [yearStr, monthStr] = month.key.split('-');
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);
    if (!Number.isFinite(year) || !Number.isFinite(monthNum)) return;
    const quarterNumber = Math.floor((monthNum - 1) / 3) + 1;
    const quarterKey = `${year}-Q${quarterNumber}`;
    const quarterLabel = `Q${quarterNumber} ${year}`;
    const quarterBucket = quarterlyMap.get(quarterKey) || { key: quarterKey, label: quarterLabel, invested: 0, gainLoss: 0, roi: 0, trades: 0 };
    quarterBucket.invested += month.invested;
    quarterBucket.gainLoss += month.gainLoss;
    quarterBucket.trades += month.trades;
    quarterlyMap.set(quarterKey, quarterBucket);
  });
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
  const [newQuarterLabel, setNewQuarterLabel] = useState('');
  const [newQuarterInvested, setNewQuarterInvested] = useState('');
  const [newQuarterRoi, setNewQuarterRoi] = useState('');
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

  const appendQuarterFromPerformance = () => {
    const label = newQuarterLabel.trim() || `Q${Math.floor(new Date().getMonth() / 3) + 1} ${new Date().getFullYear()}`;
    const invested = parseFloat(newQuarterInvested) || 0;
    const roi = parseFloat(newQuarterRoi) || 0;
    const gainLoss = invested > 0 ? (invested * roi) / 100 : 0;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `quarter-${Date.now()}`;
    try {
      const parsed = JSON.parse(quarterlyJson);
      const next = Array.isArray(parsed) ? parsed : [];
      next.push({ key, label, invested, gainLoss, roi, trades: 0 });
      setQuarterlyJson(JSON.stringify(next, null, 2));
      setFeedback('Quarter performance record added to Quarterly JSON.');
    } catch {
      setQuarterlyJson(JSON.stringify([{ key, label, invested, gainLoss, roi, trades: 0 }], null, 2));
      setFeedback('Quarter performance record created in Quarterly JSON.');
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

      <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Add Quarter Performance (No Trades Required)</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input
            value={newQuarterLabel}
            onChange={(e) => setNewQuarterLabel(e.target.value)}
            placeholder="Label (e.g. Q2 2026)"
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
          />
          <input
            value={newQuarterInvested}
            onChange={(e) => setNewQuarterInvested(e.target.value)}
            placeholder="Invested (optional)"
            type="number"
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
          />
          <input
            value={newQuarterRoi}
            onChange={(e) => setNewQuarterRoi(e.target.value)}
            placeholder="Quarter ROI %"
            type="number"
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
          />
          <button
            onClick={appendQuarterFromPerformance}
            className="px-3 py-1.5 text-xs rounded bg-purple-700 text-white hover:bg-purple-600"
          >
            Add Quarter Performance
          </button>
        </div>
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

const AdminTradePane = ({
  trades,
  onAddManualTrade,
  onAddQuarterPerformance
}: {
  trades: any[];
  onAddManualTrade: (input: { symbol: string; closedPnl: number; updatedTime: number }) => void;
  onAddQuarterPerformance: (input: { quarterKey: string; tradeRoi: number; accountRaw: number }) => void;
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTab, setAddTab] = useState<'TRADE' | 'QUARTER'>('TRADE');
  const [manualSymbol, setManualSymbol] = useState('BTCUSDT');
  const [manualPnl, setManualPnl] = useState('');
  const [manualDateTime, setManualDateTime] = useState(() => new Date().toISOString().slice(0, 16));
  const [quarter, setQuarter] = useState<'Q1' | 'Q2' | 'Q3' | 'Q4'>('Q1');
  const [quarterYear, setQuarterYear] = useState(new Date().getUTCFullYear().toString());
  const [quarterTradeRoi, setQuarterTradeRoi] = useState('');
  const [quarterAccountRaw, setQuarterAccountRaw] = useState('');

  const submitTrade = () => {
    const closedPnl = Number(manualPnl);
    const updatedTime = new Date(manualDateTime).getTime();
    if (!Number.isFinite(closedPnl) || !Number.isFinite(updatedTime)) return;
    onAddManualTrade({
      symbol: manualSymbol.trim().toUpperCase() || 'MANUAL',
      closedPnl,
      updatedTime
    });
    setManualPnl('');
    setShowAddModal(false);
  };

  const submitQuarter = () => {
    const year = Number(quarterYear);
    const qNum = quarter.replace('Q', '');
    const tradeRoi = Number(quarterTradeRoi);
    const accountRaw = Number(quarterAccountRaw);
    if (!Number.isFinite(year) || !Number.isFinite(tradeRoi) || !Number.isFinite(accountRaw)) return;
    onAddQuarterPerformance({
      quarterKey: `${year}-Q${qNum}`,
      tradeRoi,
      accountRaw
    });
    setQuarterTradeRoi('');
    setQuarterAccountRaw('');
    setShowAddModal(false);
  };

  return (
    <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Trade Pane (All Pulled Trades)</p>
        <button onClick={() => setShowAddModal(true)} className="px-2.5 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold">
          Add Trade / Quarter
        </button>
      </div>
      <div className="max-h-72 overflow-auto rounded-xl border border-slate-800">
        <table className="w-full text-xs">
          <thead className="bg-slate-900 sticky top-0">
            <tr className="text-slate-400">
              <th className="px-2 py-2 text-left">Date/Time</th>
              <th className="px-2 py-2 text-left">Symbol</th>
              <th className="px-2 py-2 text-right">PnL (USDT)</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr><td colSpan={3} className="px-2 py-3 text-slate-500">No trades loaded.</td></tr>
            ) : (
              trades.map((trade, idx) => (
                <tr key={`${trade.orderId || idx}-${trade.updatedTime || idx}`} className="border-t border-slate-800 text-slate-300">
                  <td className="px-2 py-1.5">{trade.updatedTime ? new Date(Number(trade.updatedTime)).toLocaleString() : '-'}</td>
                  <td className="px-2 py-1.5">{trade.symbol || '-'}</td>
                  <td className={`px-2 py-1.5 text-right font-mono ${(Number(trade.closedPnl || 0) >= 0) ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {Number(trade.closedPnl || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <button onClick={() => setAddTab('TRADE')} className={`px-3 py-1.5 text-xs rounded ${addTab === 'TRADE' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}>Add Trade</button>
                <button onClick={() => setAddTab('QUARTER')} className={`px-3 py-1.5 text-xs rounded ${addTab === 'QUARTER' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}>Quarter Results</button>
              </div>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            {addTab === 'TRADE' ? (
              <div className="space-y-3">
                <input value={manualSymbol} onChange={(e) => setManualSymbol(e.target.value)} placeholder="Symbol (e.g. BTCUSDT)" className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
                <input type="number" value={manualPnl} onChange={(e) => setManualPnl(e.target.value)} placeholder="Trade PnL (USDT)" className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
                <input type="datetime-local" value={manualDateTime} onChange={(e) => setManualDateTime(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
                <button onClick={submitTrade} className="w-full py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold">Save Trade</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <select value={quarter} onChange={(e) => setQuarter(e.target.value as any)} className="bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white">
                    <option>Q1</option>
                    <option>Q2</option>
                    <option>Q3</option>
                    <option>Q4</option>
                  </select>
                  <input type="number" value={quarterYear} onChange={(e) => setQuarterYear(e.target.value)} placeholder="Year" className="bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
                </div>
                <input type="number" value={quarterTradeRoi} onChange={(e) => setQuarterTradeRoi(e.target.value)} placeholder="Quarterly Trade ROI %" className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
                <input type="number" value={quarterAccountRaw} onChange={(e) => setQuarterAccountRaw(e.target.value)} placeholder="Quarterly Account Raw %" className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
                <button onClick={submitQuarter} className="w-full py-2 rounded bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold">Save Quarterly Result</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const InvestmentModal = ({ onClose, currentUserId, currentUserEmail }: { onClose: () => void, currentUserId?: string, currentUserEmail?: string }) => {
    const [status, setStatus] = useState<'IDLE' | 'PROCESSING' | 'COMPLETED'>('IDLE');
    const [investAmount, setInvestAmount] = useState<string>('');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [confirmMessage, setConfirmMessage] = useState<string>('Waiting for payment confirmation...');
    const [hasCopiedAddress, setHasCopiedAddress] = useState(false);
    const MAX_INVEST_INPUT = 10_000;
    const SOL_DEPOSIT_ADDRESS = '6ujTKvwE9Aa5oPKGTz174HJUa89uX13dWwMWUQ1257G6';

    const amountNum = parseFloat(investAmount) || 0;
    const fee = amountNum * 0.16; // 16% Fee
    const netInvested = amountNum - fee; // 84% Invested

    const handleConfirm = async () => {
      if (amountNum <= 0) return;
      if (amountNum > MAX_INVEST_INPUT) {
        setErrorMsg(`Maximum deposit entry is $${MAX_INVEST_INPUT.toLocaleString()}.`);
        return;
      }
      setStatus('PROCESSING');
      setErrorMsg(null);
      setConfirmMessage('Confirming deposit from OrbMarkets...');
      
      try {
        const uid = currentUserId || auth.currentUser?.uid;
        const email = currentUserEmail || auth.currentUser?.email || '';
        if (!uid) throw new Error("Not authenticated");

        let confirmed = false;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          setConfirmMessage(`Checking OrbMarkets transaction status... (${attempt + 1}/20)`);
          const response = await fetch('/api/payment/confirm-sol-deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: amountNum,
              userId: uid,
              userEmail: email,
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
          if (data.status === 'CHAIN_DETECTED') {
            setConfirmMessage(data.message || 'Transfer detected on OrbMarkets. Waiting for full confirmation...');
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
                          if (nextRaw === '') {
                            setInvestAmount('');
                            return;
                          }
                          if (!/^\d*(\.\d{0,2})?$/.test(nextRaw)) return;
                          const nextValue = Number(nextRaw);
                          if (Number.isNaN(nextValue)) return;
                          if (nextValue < 0) return;
                          if (nextValue > MAX_INVEST_INPUT) {
                            setInvestAmount(MAX_INVEST_INPUT.toFixed(2));
                            return;
                          }
                          setInvestAmount(nextRaw);
                        }}
                        placeholder="0"
                        min={0}
                        max={MAX_INVEST_INPUT}
                        step="0.01"
                        className="w-full bg-transparent text-3xl font-bold text-white outline-none placeholder-slate-600"
                    />
                </div>
                <p className="text-[10px] text-slate-500 mb-3">Per deposit entry max: ${MAX_INVEST_INPUT.toLocaleString()}.</p>
                
                {amountNum > 0 && (
                    <div className="bg-slate-800 rounded-xl p-3 space-y-2 border border-slate-700">
                        <div className="flex justify-between text-xs text-slate-400">
                            <span>Platform Fee (16%)</span>
                            <span className="text-rose-400 font-mono">-${fee.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between text-sm font-bold text-white border-t border-slate-700 pt-2">
                            <span>Actual Amount Invested (84%)</span>
                            <span className="font-mono text-emerald-400">${netInvested.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="mb-6">
                <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">USDT (SOL) Deposit Address</label>
                <div className="mb-3 flex justify-center">
                  <div className="bg-white p-2 rounded-xl border border-slate-700 shadow">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(SOL_DEPOSIT_ADDRESS)}`}
                      alt="SOL deposit address QR code"
                      className="w-44 h-44 rounded"
                    />
                  </div>
                </div>
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
                <a
                  href="https://www.youtube.com/watch?v=WZIPKhC3CBI"
                  target="_blank"
                  rel="noreferrer"
                  className="block text-center text-[11px] text-sky-300 hover:text-sky-200 underline"
                >
                  Need help? Watch how to send Solana
                </a>
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
  currentUserId,
  currentUserEmail,
  investorStats = { q3Invested: 0, pendingInvested: 0, q3CurrentRoi: 0, totalWithdrawn: 0 },
  onCapitalInject,
  userShare,
  totalPool,
  adminImpersonateUserId,
  onAdminImpersonateUserIdChange
}) => {
  const isInvestor = userRole === 'INVESTOR';
  const isAdmin = userRole === 'ADMIN';
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'PAYOUTS' | 'MARKET' | 'LOGS' | 'DEBUG'>('OVERVIEW');
  const [debugData, setDebugData] = useState<any>(null);
  const [isDebugLoading, setIsDebugLoading] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [impersonatedUserId, setImpersonatedUserId] = useState<string>('');
  const [manualUserInvested, setManualUserInvested] = useState<string>('');
  const [manualDepositTimestamp, setManualDepositTimestamp] = useState<string>('');
  const [manualDepositAmount, setManualDepositAmount] = useState<string>('');
  const [manualTradeRoi, setManualTradeRoi] = useState<string>('');
  const [manualTradeAccountRaw, setManualTradeAccountRaw] = useState<string>('');
  const [manualTradePnl, setManualTradePnl] = useState<string>('');
  const [selectedTradeOverrideId, setSelectedTradeOverrideId] = useState<string>('');
  const [editableTrades, setEditableTrades] = useState<any[]>([]);
  const [performanceTabTrades, setPerformanceTabTrades] = useState<any[]>([]);
  const [adminDepositHistory, setAdminDepositHistory] = useState<Record<string, DepositEvent[]>>({});
  const [adminUserEditRows, setAdminUserEditRows] = useState<Record<string, { invested: string; equity: string; profit: string }>>({});
  const [adminActionMsg, setAdminActionMsg] = useState<string>('');
  const impersonatedUser = isAdmin && impersonatedUserId ? adminUsers.find((u) => u.id === impersonatedUserId) : null;
  const isInvestorView = isInvestor || Boolean(impersonatedUser);
  const effectiveCurrentUserId = impersonatedUser?.id || currentUserId;
  const effectiveCurrentUserEmail = impersonatedUser?.email || currentUserEmail;
  const effectiveInvestorStats = impersonatedUser
    ? {
        q3Invested: Number(impersonatedUser.totalInvested || 0),
        pendingInvested: Number(impersonatedUser.pendingInvested || 0),
        q3CurrentRoi: 0,
        totalWithdrawn: 0
      }
    : investorStats;

  useEffect(() => {
    if (!isAdmin) return;
    if (typeof adminImpersonateUserId === 'string') {
      setImpersonatedUserId(adminImpersonateUserId);
      const pick = adminUsers.find((u) => u.id === adminImpersonateUserId);
      setManualUserInvested(pick ? String(pick.totalInvested) : '');
    }
  }, [isAdmin, adminImpersonateUserId, adminUsers]);

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
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
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
  const [userDepositConfirmedAt, setUserDepositConfirmedAt] = useState<number | null>(null);
  const [userLatestNetDeposit, setUserLatestNetDeposit] = useState<number | null>(null);
  const [userDepositEvents, setUserDepositEvents] = useState<DepositEvent[]>([]);
  const [isConvertingSol, setIsConvertingSol] = useState(false);
  const [isQuarterlyFeeDrawRunning, setIsQuarterlyFeeDrawRunning] = useState(false);
  const [solConversionLogs, setSolConversionLogs] = useState<string[]>([]);
  const [lastSolConversionRun, setLastSolConversionRun] = useState<string | null>(null);
  const [solConvertBaseAmount, setSolConvertBaseAmount] = useState<string>('');
  const [selectedFeePercent, setSelectedFeePercent] = useState<number>(10);
  const [quarterOverrides, setQuarterOverrides] = useState<Record<string, QuarterOverrideRow>>({});
  const [newQuarterLabel, setNewQuarterLabel] = useState('');
  const [newQuarterTradeRoi, setNewQuarterTradeRoi] = useState('');
  const [newQuarterAccountRaw, setNewQuarterAccountRaw] = useState('');

  useEffect(() => {
    if (!isAdmin) return;
    const qUsers = query(collection(db, 'users'));
    const unsubUsers = onSnapshot(qUsers, (snapshot) => {
      const rows: AdminUserSummary[] = snapshot.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          email: data.email || '',
          name: data.name || data.username || '',
          totalInvested: Number(data.totalInvested || 0),
          pendingInvested: Number(data.pendingInvested || 0),
          currentEquity: Number(data.currentEquity ?? data.totalInvested ?? 0),
          profitLoss: Number(data.profitLoss ?? 0)
        };
      });
      setAdminUsers(rows);
      setAdminUserEditRows((prev) => {
        const next = { ...prev };
        rows.forEach((u) => {
          if (!next[u.id]) {
            next[u.id] = {
              invested: String(u.totalInvested || 0),
              equity: String(u.currentEquity ?? u.totalInvested ?? 0),
              profit: String(u.profitLoss ?? 0)
            };
          }
        });
        return next;
      });
    });

    const qTrades = query(collection(db, 'trades'), where('status', '==', 'CLOSED'), orderBy('timestamp', 'desc'));
    const unsubTrades = onSnapshot(qTrades, (snapshot) => {
      setEditableTrades(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });

    const unsubDeposits = onSnapshot(collection(db, 'deposits'), (snapshot) => {
      const next: Record<string, DepositEvent[]> = {};
      snapshot.docs.forEach((d) => {
        const data = d.data() as any;
        const status = String(data.status || '').toUpperCase();
        if (!['COMPLETED', 'CONFIRMED', 'FINISHED'].includes(status)) return;
        const userId = String(data.userId || '').trim();
        if (!userId) return;
        const ts =
          data.completedAt?.toDate?.()?.getTime?.() ||
          data.createdAt?.toDate?.()?.getTime?.() ||
          (typeof data.completedAt === 'string' ? new Date(data.completedAt).getTime() : 0) ||
          (typeof data.createdAt === 'string' ? new Date(data.createdAt).getTime() : 0);
        const amount = Number(data.investedAmount ?? data.amount ?? 0);
        if (!Number.isFinite(ts) || ts <= 0 || !Number.isFinite(amount) || amount <= 0) return;
        if (!next[userId]) next[userId] = [];
        next[userId].push({ timestamp: ts, netAmount: amount });
      });
      Object.keys(next).forEach((userId) => {
        next[userId].sort((a, b) => b.timestamp - a.timestamp);
      });
      setAdminDepositHistory(next);
    });

    return () => {
      unsubUsers();
      unsubTrades();
      unsubDeposits();
    };
  }, [isAdmin]);

  const currentQuarterKey = getQuarterKeyFromDate(new Date());
  const configuredCurrentQuarterPercent = quarterOverrides[currentQuarterKey]?.accountRaw;
  const currentQuarterPerformanceRow = performanceByQuarter.find((row) => row.key === currentQuarterKey);
  const performanceTabQuarterPercent = currentQuarterPerformanceRow && totalPool > 0
    ? (currentQuarterPerformanceRow.gainLoss / totalPool) * 100
    : null;
  const effectiveQuarterPercent = configuredCurrentQuarterPercent ?? performanceTabQuarterPercent ?? manualPerformance?.currentQuarterROI ?? dashboardStats.currentQuarterAccountRaw;

  const totalQuarterGainUsd = Math.max(0, totalPool * (Math.max(0, effectiveQuarterPercent) / 100));
  const feeUsdtAmount = totalQuarterGainUsd * (selectedFeePercent / 100);

  useEffect(() => {
    if (effectiveQuarterPercent >= 100) setSelectedFeePercent(22);
    else if (effectiveQuarterPercent >= 75) setSelectedFeePercent(16);
    else if (effectiveQuarterPercent >= 50) setSelectedFeePercent(10);
    else setSelectedFeePercent(10);
  }, [effectiveQuarterPercent]);

  const appendSolConversionLog = useCallback((message: string) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    setSolConversionLogs((prev) => [line, ...prev].slice(0, 200));
  }, []);

  const handleConvertSolToUsdt = useCallback(async () => {
    if (!isAdmin || isConvertingSol) return;
    setIsConvertingSol(true);
    const runStartedAt = new Date().toISOString();
    setLastSolConversionRun(runStartedAt);

    const baseAmount = parseFloat(solConvertBaseAmount);
    const amountLogText = baseAmount > 0 ? `of ${baseAmount} SOL base` : 'of total SOL balance';

    appendSolConversionLog(`Starting manual SOL -> USDT conversion (84% ${amountLogText}).`);
    try {
      const response = await fetch('/api/bybit/convert-sol-to-usdt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetPercentage: 84,
          baseAmount: baseAmount > 0 ? baseAmount : undefined,
          address: '6ujTKvwE9Aa5oPKGTz174HJUa89uX13dWwMWUQ1257G6'
        })
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        appendSolConversionLog(`Conversion failed: ${data?.error || response.statusText}`);
        if (Array.isArray(data?.logs)) {
          data.logs.forEach((line: string) => appendSolConversionLog(line));
        }
        return;
      }
      appendSolConversionLog(`Converted ${Number(data.convertedSol || 0).toFixed(4)} SOL (${data.targetPercentage}%) to USDT.`);
      appendSolConversionLog(`Bybit order id: ${data?.order?.orderId || 'n/a'}`);
      if (Array.isArray(data?.logs)) {
        data.logs.forEach((line: string) => appendSolConversionLog(line));
      }
    } catch (error) {
      appendSolConversionLog(`Conversion request error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsConvertingSol(false);
    }
  }, [appendSolConversionLog, isAdmin, isConvertingSol, solConvertBaseAmount]);

  const handleQuarterlyFeeDraw = useCallback(async () => {
    if (!isAdmin || isQuarterlyFeeDrawRunning) return;
    if (feeUsdtAmount <= 0) {
      appendSolConversionLog('Quarterly Fee Draw skipped: Calculated fee amount is $0.');
      return;
    }
    setIsQuarterlyFeeDrawRunning(true);
    appendSolConversionLog(`Starting Quarterly Fee Draw ($${feeUsdtAmount.toFixed(2)} USDT -> SOL based on ${selectedFeePercent}% fee).`);
    try {
      const response = await fetch('/api/bybit/quarterly-fee-draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          exactUsdtAmount: feeUsdtAmount,
          usdtPercentage: selectedFeePercent, 
          address: '6ujTKvwE9Aa5oPKGTz174HJUa89uX13dWwMWUQ1257G6' 
        })
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        appendSolConversionLog(`Quarterly Fee Draw failed: ${data?.error || response.statusText}`);
        if (Array.isArray(data?.logs)) data.logs.forEach((line: string) => appendSolConversionLog(line));
        return;
      }
      appendSolConversionLog(`Quarterly Fee Draw success: ${Number(data.convertedUsdt || 0).toFixed(2)} USDT converted to SOL.`);
      appendSolConversionLog(`Bybit order id: ${data?.order?.orderId || 'n/a'}`);
      if (Array.isArray(data?.logs)) data.logs.forEach((line: string) => appendSolConversionLog(line));
    } catch (error) {
      appendSolConversionLog(`Quarterly Fee Draw error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsQuarterlyFeeDrawRunning(false);
    }
  }, [appendSolConversionLog, isAdmin, isQuarterlyFeeDrawRunning, feeUsdtAmount, selectedFeePercent]);

  useEffect(() => {
    if (!isAdmin) return;
    const loadQuarterOverrides = async () => {
      try {
        const snap = await getDoc(doc(db, 'settings', 'performanceQuarterOverrides'));
        if (snap.exists()) {
          const data = snap.data();
          setQuarterOverrides((data?.rows || {}) as Record<string, QuarterOverrideRow>);
        }
      } catch (error) {
        console.error('Failed to load quarter overrides', error);
      }
    };
    loadQuarterOverrides();
  }, [isAdmin]);

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

  useEffect(() => {
    if (!isInvestorView || !effectiveCurrentUserId) return;
    const byIdQuery = query(
      collection(db, 'deposits'),
      where('userId', '==', effectiveCurrentUserId)
    );
    const byEmailQuery = effectiveCurrentUserEmail
      ? query(collection(db, 'deposits'), where('userEmail', '==', effectiveCurrentUserEmail))
      : null;

    const recomputeLatestDeposit = (docs: any[]) => {
      let latest = 0;
      let latestNetAmount = 0;
      const events: DepositEvent[] = [];
      const seenEventKeys = new Set<string>();
      docs.forEach((depositDoc) => {
        const data = depositDoc.data() as any;
        const status = String(data.status || '').toUpperCase();
        if (!['COMPLETED', 'CONFIRMED', 'FINISHED'].includes(status)) return;
        const completedAt = data.completedAt;
        const createdAt = data.createdAt;
        const ts =
          completedAt?.toDate?.().getTime?.() ||
          createdAt?.toDate?.().getTime?.() ||
          (typeof completedAt === 'string' ? new Date(completedAt).getTime() : 0) ||
          (typeof createdAt === 'string' ? new Date(createdAt).getTime() : 0);
        if (!Number.isFinite(ts) || ts <= 0) return;
        const explicitNet = Number(data.investedAmount);
        const grossAmount = Number(data.amount);
        const netAmount = Number.isFinite(explicitNet) && explicitNet > 0
          ? explicitNet
          : (Number.isFinite(grossAmount) && grossAmount > 0 ? grossAmount * 0.84 : 0);
        if (netAmount > 0) {
          const key = `${Math.round(ts)}-${netAmount.toFixed(8)}`;
          if (!seenEventKeys.has(key)) {
            seenEventKeys.add(key);
            events.push({ timestamp: ts, netAmount });
          }
        }
        if (ts >= latest) {
          latest = ts;
          latestNetAmount = netAmount;
        }
      });
      setUserDepositConfirmedAt(latest > 0 ? latest : null);
      setUserLatestNetDeposit(latest > 0 && latestNetAmount > 0 ? latestNetAmount : null);
      setUserDepositEvents(events.sort((a, b) => a.timestamp - b.timestamp));
    };

    const depositDocsBySource = new Map<string, any>();
    const updateFromMaps = () => recomputeLatestDeposit([...depositDocsBySource.values()]);

    const unsubscribeById = onSnapshot(byIdQuery, (snapshot) => {
      snapshot.docs.forEach((docSnap) => depositDocsBySource.set(`id:${docSnap.id}`, docSnap));
      const liveIds = new Set(snapshot.docs.map((docSnap) => `id:${docSnap.id}`));
      [...depositDocsBySource.keys()].forEach((id) => {
        if (id.startsWith('id:') && !liveIds.has(id)) depositDocsBySource.delete(id);
      });
      updateFromMaps();
    }, (error) => {
      console.error('Failed to load user deposit confirmation time', error);
    });

    let unsubscribeByEmail: (() => void) | null = null;
    if (byEmailQuery) {
      unsubscribeByEmail = onSnapshot(byEmailQuery, (snapshot) => {
        snapshot.docs.forEach((docSnap) => depositDocsBySource.set(`email:${docSnap.id}`, docSnap));
        const liveIds = new Set(snapshot.docs.map((docSnap) => `email:${docSnap.id}`));
        [...depositDocsBySource.keys()].forEach((id) => {
          if (id.startsWith('email:') && !liveIds.has(id)) depositDocsBySource.delete(id);
        });
        updateFromMaps();
      }, (error) => {
        console.error('Failed to load user deposit confirmation time by email', error);
      });
    }

    return () => {
      unsubscribeById();
      unsubscribeByEmail?.();
    };
  }, [isInvestorView, effectiveCurrentUserId, effectiveCurrentUserEmail]);

  const handleRefreshPerformance = useCallback(async () => {
    setIsRefreshingPerformance(true);
    try {
        // 1. Fetch from Bybit API
        const now = Date.now();
        const lookbackDays = Math.max(1, Math.ceil((now - TRACK_FROM_DATE_UTC) / (24 * 60 * 60 * 1000)));
        const [closedTrades, walletBalance, solWalletBalance, recentExecs] = await Promise.all([
            fetchClosedPnL(undefined, lookbackDays),
            fetchWalletBalance(),
            fetchWalletBalance('SOL'),
            fetchRecentExecutions()
        ]);

        // Check for API errors
        const recentError = apiLogs.find(log => log.error && new Date().getTime() - new Date(log.timestamp).getTime() < 5000);
        if (recentError) {
            setApiError(recentError.error || "Failed to fetch data from Bybit API.");
        } else {
            setApiError(null);
        }

        const mergedTrackedTrades = (() => {
          const existing = [...trackedClosedTrades];
          const seenTradeIds = new Set(existing.map((trade: any) => `${trade.orderId}-${trade.updatedTime}`));
          closedTrades
            .filter((trade: any) => parseInt(trade.updatedTime) >= TRACK_FROM_DATE_UTC)
            .forEach((trade: any) => {
              const key = `${trade.orderId}-${trade.updatedTime}`;
              if (!seenTradeIds.has(key)) {
                seenTradeIds.add(key);
                existing.push(trade);
              }
            });
          return existing;
        })();

        setTrackedClosedTrades((prev) => {
          const merged = [...prev];
          const seenTradeIds = new Set(merged.map((trade: any) => `${trade.orderId}-${trade.updatedTime}`));
          closedTrades
            .filter((trade: any) => parseInt(trade.updatedTime) >= TRACK_FROM_DATE_UTC)
            .forEach((trade: any) => {
              const key = `${trade.orderId}-${trade.updatedTime}`;
              if (!seenTradeIds.has(key)) {
                seenTradeIds.add(key);
                merged.push(trade);
              }
            });
          setClosedTradesCache(merged);
          return merged;
        });
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
        setSolBalance(solWalletBalance);
        setLastSyncedAt(new Date().toISOString());

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
  }, [totalPool, performanceOverride]);

  useEffect(() => {
    if (!isInvestorView) return;
    const interval = setInterval(() => {
      handleRefreshPerformance();
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isInvestorView, handleRefreshPerformance]);

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
            const firestoreClosed = snapshot.docs.map((d) => {
              const data = d.data() as any;
              const rawTs = data.timestamp;
              const tsFromTimestamp =
                rawTs?.toMillis?.() ??
                (typeof rawTs?.seconds === 'number' ? rawTs.seconds * 1000 : undefined) ??
                (typeof rawTs === 'number' ? rawTs : undefined);
              const ts = Number(tsFromTimestamp ?? data.updatedTime ?? 0);
              return {
                id: d.id,
                ...data,
                updatedTime: String(ts || data.updatedTime || 0)
              };
            });
            setPerformanceTabTrades(firestoreClosed);
            if (!snapshot.metadata.hasPendingWrites) {
              handleRefreshPerformance();
            }
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

  // Equity Calculation based on account raw performance and user's own invested equity.
  const exchangeProfit = liveBalance ? liveBalance - totalPool : 0;
  const userProfit = Math.max(0, effectiveInvestorStats.q3Invested) * (effectiveQuarterPercent / 100);
  const currentQuarterEquity = Math.max(0, effectiveInvestorStats.q3Invested + userProfit);
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
  const popupSource = computePerformanceFromTrades(performanceTabTrades, liveBalance || totalPool || 1);
  const popupMonthlyBase = popupSource.months;
  const popupQuarterlyBase = popupSource.quarters;
  const investorModalMonthly = isInvestorView
    ? popupMonthlyBase.map((row) => {
        const invested = Math.min(row.invested, Math.max(0, effectiveInvestorStats.q3Invested));
        const accountRawPercent = totalPool > 0 ? (row.gainLoss / totalPool) * 100 : 0;
        const gainLoss = invested * (accountRawPercent / 100);
        const roi = row.roi;
        return { ...row, invested, gainLoss, roi, accountRawPercent };
      })
    : popupMonthlyBase;
  const investorModalQuarterly = isInvestorView
    ? popupQuarterlyBase.map((row) => {
        const invested = Math.min(row.invested, Math.max(0, effectiveInvestorStats.q3Invested));
        const accountRawPercent = totalPool > 0 ? (row.gainLoss / totalPool) * 100 : 0;
        const gainLoss = invested * (accountRawPercent / 100);
        const roi = row.roi;
        return { ...row, invested, gainLoss, roi, accountRawPercent };
      })
    : popupQuarterlyBase;
  const adminQuarterRows = Array.from(
    new Set([...performanceByQuarter.map((row) => row.key), ...Object.keys(quarterOverrides)])
  )
    .sort((a, b) => b.localeCompare(a))
    .map((quarterKey) => {
      const baseRow = performanceByQuarter.find((row) => row.key === quarterKey);
      const override = quarterOverrides[quarterKey];
      const defaultLabel = quarterKey.includes('-Q')
        ? `Q${quarterKey.split('-Q')[1]} ${quarterKey.split('-Q')[0]}`
        : quarterKey;
      return {
        key: quarterKey,
        label: baseRow?.label || defaultLabel,
        tradeRoi: override?.tradeRoi ?? baseRow?.roi ?? 0,
        accountRaw: override?.accountRaw ?? (baseRow ? (totalPool > 0 ? (baseRow.gainLoss / totalPool) * 100 : 0) : 0),
        usdt: override?.usdt ?? baseRow?.gainLoss ?? 0
      };
    });

  const handleQuarterOverrideChange = async (quarterKey: string, field: keyof QuarterOverrideRow, value: string) => {
    const numericValue = Number(value);
    setQuarterOverrides((prev) => {
      const next = {
        ...prev,
        [quarterKey]: {
          tradeRoi: prev[quarterKey]?.tradeRoi ?? 0,
          accountRaw: prev[quarterKey]?.accountRaw ?? 0,
          usdt: prev[quarterKey]?.usdt ?? 0,
          [field]: Number.isFinite(numericValue) ? numericValue : 0
        }
      };
      setDoc(doc(db, 'settings', 'performanceQuarterOverrides'), { rows: next, updatedAt: new Date() }, { merge: true }).catch((error) => {
        console.error('Failed to persist quarter override', error);
      });
      return next;
    });
  };

  const persistQuarterResult = (quarterKey: string, tradeRoi: number, accountRaw: number) => {
    const safeTradeRoi = Number.isFinite(tradeRoi) ? tradeRoi : 0;
    const safeAccountRaw = Number.isFinite(accountRaw) ? accountRaw : 0;
    const usdt = totalPool > 0 ? (safeAccountRaw / 100) * totalPool : 0;
    setQuarterOverrides((prev) => {
      const next = {
        ...prev,
        [quarterKey]: {
          tradeRoi: safeTradeRoi,
          accountRaw: safeAccountRaw,
          usdt
        }
      };
      setDoc(doc(db, 'settings', 'performanceQuarterOverrides'), { rows: next, updatedAt: new Date() }, { merge: true }).catch((error) => {
        console.error('Failed to persist quarter override', error);
      });
      return next;
    });
  };

  const handleAddQuarterResult = async () => {
    const normalizedLabel = newQuarterLabel.trim();
    if (!normalizedLabel) return;
    const quarterKey = normalizedLabel
      .replace(/\s+/g, '')
      .toUpperCase()
      .replace(/^Q([1-4])(\d{4})$/, '$2-Q$1')
      .replace(/^(\d{4})Q([1-4])$/, '$1-Q$2')
      .replace(/^Q([1-4])-?(\d{4})$/, '$2-Q$1');
    if (!/^\d{4}-Q[1-4]$/.test(quarterKey)) return;
    persistQuarterResult(quarterKey, Number(newQuarterTradeRoi), Number(newQuarterAccountRaw));
    setNewQuarterLabel('');
    setNewQuarterTradeRoi('');
    setNewQuarterAccountRaw('');
  };

  const handleAddQuarterFromPopup = useCallback((input: { quarterKey: string; tradeRoi: number; accountRaw: number }) => {
    persistQuarterResult(input.quarterKey, input.tradeRoi, input.accountRaw);
  }, [totalPool]);

  const handleAdminSetInvested = useCallback(async () => {
    if (!isAdmin || !impersonatedUserId) return;
    const value = Number(manualUserInvested);
    if (!Number.isFinite(value) || value < 0) return;
    await setDoc(doc(db, 'users', impersonatedUserId), { totalInvested: value }, { merge: true });
    setAdminActionMsg('Updated user invested amount.');
  }, [isAdmin, impersonatedUserId, manualUserInvested]);

  const handleAdminAddDepositEvent = useCallback(async () => {
    if (!isAdmin || !impersonatedUserId) return;
    const amount = Number(manualDepositAmount);
    const ts = new Date(manualDepositTimestamp).getTime();
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(ts)) return;
    const depositId = `manual_${impersonatedUserId}_${Date.now()}`;
    await setDoc(doc(db, 'deposits', depositId), {
      userId: impersonatedUserId,
      userEmail: impersonatedUser?.email || '',
      amount,
      investedAmount: amount,
      status: 'COMPLETED',
      createdAt: new Date(ts),
      completedAt: new Date(ts),
      source: 'ADMIN_MANUAL'
    }, { merge: true });
    setAdminActionMsg('Added manual deposit timestamp/amount.');
  }, [isAdmin, impersonatedUserId, manualDepositAmount, manualDepositTimestamp, impersonatedUser?.email]);

  const handleAdminOverrideTrade = useCallback(async () => {
    if (!isAdmin || !selectedTradeOverrideId) return;
    const updates: Record<string, any> = {};
    if (manualTradeRoi.trim() !== '') updates.trade_roi_percent = Number(manualTradeRoi);
    if (manualTradeAccountRaw.trim() !== '') updates.trade_account_raw_percent = Number(manualTradeAccountRaw);
    if (manualTradePnl.trim() !== '') updates.trade_pnl = Number(manualTradePnl);
    if (Object.keys(updates).length === 0) return;
    await setDoc(doc(db, 'trades', selectedTradeOverrideId), updates, { merge: true });
    setAdminActionMsg('Updated trade overrides.');
  }, [isAdmin, selectedTradeOverrideId, manualTradeRoi, manualTradeAccountRaw, manualTradePnl]);

  const handleAdminSaveUserRow = useCallback(async (userId: string) => {
    if (!isAdmin || !userId) return;
    const row = adminUserEditRows[userId];
    if (!row) return;
    const invested = Number(row.invested);
    const currentEquity = Number(row.equity);
    const profitLoss = Number(row.profit);
    if (![invested, currentEquity, profitLoss].every((n) => Number.isFinite(n))) return;
    await setDoc(doc(db, 'users', userId), {
      totalInvested: invested,
      currentEquity,
      profitLoss
    }, { merge: true });
    setAdminActionMsg(`Saved equity/PnL values for user ${userId}.`);
  }, [isAdmin, adminUserEditRows]);

  const handleAddManualTrade = useCallback((input: { symbol: string; closedPnl: number; updatedTime: number }) => {
    const manualTrade = {
      orderId: `manual-${input.updatedTime}-${Math.random().toString(36).slice(2, 8)}`,
      symbol: input.symbol,
      closedPnl: input.closedPnl.toString(),
      updatedTime: input.updatedTime.toString(),
      qty: '0',
      avgEntryPrice: '0',
      leverage: '1',
      cumEntryValue: '0',
      source: 'MANUAL'
    };
    setTrackedClosedTrades((prev) => {
      const merged = [manualTrade, ...prev].sort((a, b) => Number(b.updatedTime || 0) - Number(a.updatedTime || 0));
      setClosedTradesCache(merged);
      const walletBase = liveBalance || totalPool;
      const { stats, months, quarters } = computePerformanceFromTrades(merged, walletBase);
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
      return merged;
    });
  }, [liveBalance, totalPool, performanceOverride]);

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
      {showInvestModal && <InvestmentModal onClose={() => setShowInvestModal(false)} currentUserId={effectiveCurrentUserId} currentUserEmail={effectiveCurrentUserEmail} />}

      {/* Header & Tabs */}
      <div className="sticky top-0 bg-transparent z-30 pt-2 pb-2 -mx-4 px-4 md:static md:p-0 md:mx-0">
          <div className="flex items-center justify-between mb-4 md:mb-6">
            <div>
                <h2 className={`text-2xl font-bold tracking-tight ${'text-white'}`}>
                    {activeTab === 'OVERVIEW' ? (
                        isInvestorView ? `Investor - ${impersonatedUser?.name || username || 'Investor'}` : 'Admin Console'
                    ) : (
                        activeTab === 'PAYOUTS' ? 'Performance' : 'Live Terminal'
                    )}
                </h2>
                {isInvestorView && (
                    <p className="text-xs text-slate-500 font-medium">Portfolio Overview</p>
                )}
            </div>
            {(isAdmin && activeTab === 'PAYOUTS') && (
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
            {isInvestorView && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button 
                        onClick={() => setShowInvestModal(true)}
                        disabled={Boolean(impersonatedUser)}
                        className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold py-5 rounded-2xl shadow-lg shadow-emerald-500/30 active:scale-95 transition-all flex items-center justify-center gap-2 text-lg"
                    >
                        <DollarSign size={24} /> {impersonatedUser ? 'Impersonating' : 'Invest'}
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
            {isInvestorView ? (
                <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 mb-4">
                            <Briefcase className="text-emerald-400" size={20} />
                            <h3 className="font-bold text-slate-300 uppercase tracking-widest text-xs">Investor Portfolio</h3>
                        </div>
                        <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Current Equity</div>
                        <div className="text-4xl font-bold tracking-tight mb-6">
                            ${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            {isRefreshingPerformance ? (
                              <span className="ml-2 inline-flex text-xs text-sky-300 align-middle"><Loader2 size={12} className="animate-spin mr-1" /> Syncing</span>
                            ) : (
                              <span className="ml-2 inline-flex text-xs text-emerald-300 align-middle">Synced{lastSyncedAt ? ` • ${new Date(lastSyncedAt).toLocaleTimeString()}` : ''}</span>
                            )}
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => { setDetailsMetric('INVESTED'); setShowDetailsModal(true); }}
                                className="bg-white/10 px-4 py-3 rounded-2xl backdrop-blur-md text-left hover:bg-white/15 transition-colors"
                            >
                                <div className="text-[10px] text-slate-300 uppercase font-bold mb-1">Invested Amount</div>
                                <div className="font-mono font-bold text-lg">${Math.max(0, effectiveInvestorStats.q3Invested).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                <div className="mt-2 max-h-20 overflow-auto text-[10px] text-slate-300 space-y-1">
                                  {userDepositEvents.length === 0 && <div className="text-slate-500">No investment timestamps logged.</div>}
                                  {userDepositEvents.slice().reverse().map((log, idx) => (
                                    <div key={`inv-log-${idx}`} className="font-mono">
                                      {new Date(log.timestamp).toLocaleString()} • ${log.netAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                  ))}
                                </div>
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
                            {effectiveInvestorStats.pendingInvested > 0 && (
                                <div className="bg-sky-500/20 px-4 py-3 rounded-2xl backdrop-blur-md border border-sky-500/20 col-span-2 flex justify-between items-center animate-fade-in">
                                    <div className="text-[10px] text-sky-300 uppercase font-bold tracking-wider">Pending (Next Quarter)</div>
                                    <div className="font-mono font-bold text-lg text-sky-400">
                                        ${effectiveInvestorStats.pendingInvested.toLocaleString()}
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
                                        Account Raw: {effectiveQuarterPercent >= 0 ? '+' : ''}{effectiveQuarterPercent.toFixed(2)}% • User USD change: ${userProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                                <div className="flex items-center justify-between gap-3 mb-1">
                                  <div className="text-slate-400 text-xs font-bold uppercase tracking-wider">Live Exchange Equity</div>
                                  <div className="flex flex-col gap-1.5 mt-2">
                                    <div className="flex items-center gap-2">
                                      <input 
                                        type="number" 
                                        value={solConvertBaseAmount}
                                        onChange={(e) => setSolConvertBaseAmount(e.target.value)}
                                        placeholder="Base SOL qty"
                                        className="w-[100px] bg-slate-900 border border-amber-500/30 rounded-lg px-2 py-1.5 text-[10px] text-white outline-none focus:border-amber-500"
                                      />
                                      <button
                                        onClick={handleConvertSolToUsdt}
                                        disabled={isConvertingSol}
                                        className="px-2.5 py-1.5 rounded-lg bg-amber-600/80 hover:bg-amber-500 text-[10px] font-bold text-white disabled:opacity-60 flex-1"
                                      >
                                        {isConvertingSol ? 'Converting...' : 'Convert (84%)'}
                                      </button>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <select 
                                          value={selectedFeePercent}
                                          onChange={(e) => setSelectedFeePercent(Number(e.target.value))}
                                          className="w-[70px] bg-slate-900 border border-purple-500/30 rounded-lg px-1 py-1.5 text-[10px] text-white outline-none focus:border-purple-500"
                                      >
                                          <option value={10}>10%</option>
                                          <option value={16}>16%</option>
                                          <option value={22}>22%</option>
                                      </select>
                                      <button
                                        onClick={handleQuarterlyFeeDraw}
                                        disabled={isQuarterlyFeeDrawRunning || totalQuarterGainUsd <= 0}
                                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-purple-600/80 hover:bg-purple-500 text-[10px] font-bold text-white disabled:opacity-60 transition-colors"
                                      >
                                        {isQuarterlyFeeDrawRunning ? 'Running...' : `Fee Draw ($${feeUsdtAmount.toFixed(2)})`}
                                      </button>
                                    </div>
                                    <div className="text-[9px] text-purple-300/80 px-1 mt-[-2px]">
                                        Qtr Gross Profit: ${totalQuarterGainUsd.toFixed(2)}
                                    </div>
                                  </div>
                                </div>
                                <div className="text-3xl font-bold tracking-tight text-white">
                                    ${liveBalance !== null ? liveBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Loading...'}
                                </div>
                                <div className="text-sm text-slate-300 mt-1">
                                  Solana Amount: <span className="font-mono text-emerald-300">{solBalance !== null ? solBalance.toLocaleString(undefined, { maximumFractionDigits: 6 }) : 'Loading...'}</span>
                                </div>
                                <div className="text-[10px] text-slate-500 mt-1">
                                  Last convert run: {lastSolConversionRun ? new Date(lastSolConversionRun).toLocaleString() : 'Never'}
                                </div>
                             </div>
                             
                             <button
                                 onClick={() => { setDetailsMetric('INVESTED'); setShowDetailsModal(true); }}
                                 className="bg-white/5 p-3 rounded-xl backdrop-blur-md border border-white/10 text-left hover:bg-white/10 transition-colors"
                             >
                                 <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Total Pool Deposits</div>
                                 <div className="font-mono font-bold text-white">${totalPool.toLocaleString()}</div>
                             </button>
                             <button
                                 onClick={() => { setDetailsMetric('GAIN_LOSS'); setShowDetailsModal(true); }}
                                 className="bg-white/5 p-3 rounded-xl backdrop-blur-md border border-white/10 text-left hover:bg-white/10 transition-colors"
                             >
                                 <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Current PnL</div>
                                 <div className={`font-mono font-bold ${exchangeProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {exchangeProfit >= 0 ? '+' : ''}${exchangeProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                 </div>
                             </button>
                             
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

            {isAdmin && (
              <div className="bg-slate-900/70 border border-slate-700 rounded-2xl p-4 space-y-3">
                <div className="text-xs uppercase tracking-widest text-slate-400 font-bold">Admin Investor Controls</div>
                <div className="grid md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-[11px] text-slate-400 font-bold">Impersonate User</label>
                    <select
                      value={impersonatedUserId}
                      onChange={(e) => {
                        setImpersonatedUserId(e.target.value);
                        onAdminImpersonateUserIdChange?.(e.target.value);
                        const pick = adminUsers.find((u) => u.id === e.target.value);
                        setManualUserInvested(pick ? String(pick.totalInvested) : '');
                      }}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-2 text-xs text-white"
                    >
                      <option value="">None (Admin view)</option>
                      {adminUsers.map((u) => (
                        <option key={u.id} value={u.id}>{u.name || u.email || u.id}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={manualUserInvested}
                        onChange={(e) => setManualUserInvested(e.target.value)}
                        placeholder="User invested amount"
                        className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-2 text-xs text-white"
                      />
                      <button onClick={handleAdminSetInvested} className="px-3 py-2 rounded bg-emerald-600 text-white text-xs font-bold">Save</button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] text-slate-400 font-bold">Manual Equity Timestamp + Amount</label>
                    <div className="flex gap-2">
                      <input
                        type="datetime-local"
                        value={manualDepositTimestamp}
                        onChange={(e) => setManualDepositTimestamp(e.target.value)}
                        className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-2 text-xs text-white"
                      />
                      <input
                        type="number"
                        value={manualDepositAmount}
                        onChange={(e) => setManualDepositAmount(e.target.value)}
                        placeholder="Net amount"
                        className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-2 text-xs text-white"
                      />
                      <button onClick={handleAdminAddDepositEvent} className="px-3 py-2 rounded bg-sky-600 text-white text-xs font-bold">Add</button>
                    </div>
                  </div>
                </div>
                <div className="grid md:grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center">
                  <select
                    value={selectedTradeOverrideId}
                    onChange={(e) => setSelectedTradeOverrideId(e.target.value)}
                    className="bg-slate-950 border border-slate-700 rounded px-2 py-2 text-xs text-white"
                  >
                    <option value="">Select closed trade to override</option>
                    {editableTrades.map((t) => (
                      <option key={t.id} value={t.id}>
                        {(t.symbol || 'TRADE')} • {t.timestamp ? new Date(Number(t.timestamp)).toLocaleString() : t.id}
                      </option>
                    ))}
                  </select>
                  <input type="number" value={manualTradeRoi} onChange={(e) => setManualTradeRoi(e.target.value)} placeholder="Trade ROI %" className="bg-slate-950 border border-slate-700 rounded px-2 py-2 text-xs text-white" />
                  <input type="number" value={manualTradeAccountRaw} onChange={(e) => setManualTradeAccountRaw(e.target.value)} placeholder="Account Raw %" className="bg-slate-950 border border-slate-700 rounded px-2 py-2 text-xs text-white" />
                  <input type="number" value={manualTradePnl} onChange={(e) => setManualTradePnl(e.target.value)} placeholder="Trade PnL" className="bg-slate-950 border border-slate-700 rounded px-2 py-2 text-xs text-white" />
                  <button onClick={handleAdminOverrideTrade} className="px-3 py-2 rounded bg-purple-600 text-white text-xs font-bold">Update Trade</button>
                </div>
                <div className="rounded-xl border border-slate-700 overflow-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-800">
                      <tr>
                        <th className="px-2 py-2 text-left text-slate-300">User</th>
                        <th className="px-2 py-2 text-left text-slate-300">Invested Equity</th>
                        <th className="px-2 py-2 text-left text-slate-300">Current Equity</th>
                        <th className="px-2 py-2 text-left text-slate-300">Profit / Loss</th>
                        <th className="px-2 py-2 text-left text-slate-300">Investment Log (timestamp + amount)</th>
                        <th className="px-2 py-2 text-left text-slate-300">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminUsers.map((u) => {
                        const row = adminUserEditRows[u.id] || {
                          invested: String(u.totalInvested || 0),
                          equity: String(u.currentEquity ?? 0),
                          profit: String(u.profitLoss ?? 0)
                        };
                        const logs = adminDepositHistory[u.id] || [];
                        return (
                          <tr key={u.id} className="border-t border-slate-800 align-top">
                            <td className="px-2 py-2 text-white">
                              <div className="font-bold">{u.name || u.email || u.id}</div>
                              <div className="text-[10px] text-slate-500">{u.email || u.id}</div>
                            </td>
                            <td className="px-2 py-2">
                              <input value={row.invested} onChange={(e) => setAdminUserEditRows((prev) => ({ ...prev, [u.id]: { ...row, invested: e.target.value } }))} className="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white" />
                            </td>
                            <td className="px-2 py-2">
                              <input value={row.equity} onChange={(e) => setAdminUserEditRows((prev) => ({ ...prev, [u.id]: { ...row, equity: e.target.value } }))} className="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white" />
                            </td>
                            <td className="px-2 py-2">
                              <input value={row.profit} onChange={(e) => setAdminUserEditRows((prev) => ({ ...prev, [u.id]: { ...row, profit: e.target.value } }))} className="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-white" />
                            </td>
                            <td className="px-2 py-2 text-slate-300 max-w-[360px]">
                              <div className="space-y-1 max-h-28 overflow-auto">
                                {logs.length === 0 && <div className="text-slate-500">No investments logged</div>}
                                {logs.map((log, idx) => (
                                  <div key={`${u.id}-${idx}`} className="text-[10px]">
                                    {new Date(log.timestamp).toLocaleString()} • ${log.netAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              <button onClick={() => handleAdminSaveUserRow(u.id)} className="px-2 py-1 rounded bg-emerald-600 text-white text-[10px] font-bold">Save Row</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {adminActionMsg && <div className="text-[11px] text-emerald-400">{adminActionMsg}</div>}
              </div>
            )}

            <TradeStatusWidget isInvestor={isInvestorView} userShare={userShare} liveBalance={liveBalance} />

            {/* Live Logs */}
            {isAdmin && <LiveLogs executions={executions} />}
            {isInvestorView && <BotStatusCard />}
        </div>
      )}
      <PerformanceDetailsModal
        open={showDetailsModal}
        onClose={() => setShowDetailsModal(false)}
        metric={detailsMetric}
        monthly={investorModalMonthly}
        quarterly={investorModalQuarterly}
        isInvestor={isInvestorView}
        closedTrades={performanceTabTrades}
        userDepositEvents={userDepositEvents}
        totalPool={totalPool}
        currentEquityBase={totalBalance}
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
              <AdminTradePane
                trades={trackedClosedTrades}
                onAddManualTrade={handleAddManualTrade}
                onAddQuarterPerformance={handleAddQuarterFromPopup}
              />
              <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Quarter Pane (Editable Totals - Admin)</p>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <input
                    value={newQuarterLabel}
                    onChange={(e) => setNewQuarterLabel(e.target.value)}
                    placeholder="Quarter key (e.g. 2026-Q2 or Q22026)"
                    className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                  />
                  <input
                    value={newQuarterAccountRaw}
                    onChange={(e) => setNewQuarterAccountRaw(e.target.value)}
                    placeholder="Quarterly Account Raw %"
                    type="number"
                    className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                  />
                  <input
                    value={newQuarterTradeRoi}
                    onChange={(e) => setNewQuarterTradeRoi(e.target.value)}
                    placeholder="Quarterly Trade ROI %"
                    type="number"
                    className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-white"
                  />
                  <button
                    onClick={handleAddQuarterResult}
                    className="px-3 py-1.5 text-xs rounded bg-purple-700 text-white hover:bg-purple-600"
                  >
                    Add Quarterly Result
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">Monthly trade rows flow into quarterly buckets automatically; manual quarterly results here override payout calculations.</p>
                <div className="overflow-auto rounded-xl border border-slate-800">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-900">
                      <tr className="text-slate-400">
                        <th className="px-2 py-2 text-left">Quarter</th>
                        <th className="px-2 py-2 text-right">Trade ROI %</th>
                        <th className="px-2 py-2 text-right">Account Raw %</th>
                        <th className="px-2 py-2 text-right">USDT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminQuarterRows.map((row) => (
                        <tr key={row.key} className="border-t border-slate-800">
                          <td className="px-2 py-2 text-slate-200">{row.label}</td>
                          <td className="px-2 py-2">
                            <input type="number" value={row.tradeRoi} onChange={(e) => handleQuarterOverrideChange(row.key, 'tradeRoi', e.target.value)} className="w-28 ml-auto block text-right bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100" />
                          </td>
                          <td className="px-2 py-2">
                            <input type="number" value={row.accountRaw} onChange={(e) => handleQuarterOverrideChange(row.key, 'accountRaw', e.target.value)} className="w-28 ml-auto block text-right bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100" />
                          </td>
                          <td className="px-2 py-2">
                            <input type="number" value={row.usdt} onChange={(e) => handleQuarterOverrideChange(row.key, 'usdt', e.target.value)} className="w-36 ml-auto block text-right bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="mt-6 rounded-2xl border border-slate-700 bg-black/40 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-white">SOL Conversion Logs</h4>
                  <button
                    onClick={() => setSolConversionLogs([])}
                    className="px-2 py-1 text-[10px] rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
                  >
                    Clear
                  </button>
                </div>
                <div className="h-56 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] space-y-1">
                  {solConversionLogs.length === 0 ? (
                    <div className="text-slate-500">No conversion runs yet.</div>
                  ) : (
                    solConversionLogs.map((line, idx) => (
                      <div key={`${line}-${idx}`} className={`${line.toLowerCase().includes('failed') || line.toLowerCase().includes('error') ? 'text-rose-400' : 'text-slate-300'}`}>
                        {line}
                      </div>
                    ))
                  )}
                </div>
              </div>
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
