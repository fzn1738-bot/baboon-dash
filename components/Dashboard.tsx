import React, { useState, useEffect, useRef, useCallback } from 'react';
import { UserRole, Asset } from '../types';
import { DollarSign, Activity, Calendar, Clock, Loader2, Signal, Check, Calculator, Wallet, Coins, ExternalLink, Shield, Briefcase, RefreshCw, Terminal, Play, AlertCircle } from 'lucide-react';
import { collection, query, where, onSnapshot, getDocs, orderBy } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { fetchBybitPositions, fetchClosedPnL, fetchRecentExecutions, fetchWalletBalance } from '../services/bybit';

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
const PortfolioIntelligence = ({ stats, userRole, onRefresh, isRefreshing }: { stats: any, userRole: string, onRefresh?: () => void, isRefreshing?: boolean }) => {
  const [activeSubTab, setActiveSubTab] = useState<'GROWTH' | 'PAYOUTS' | 'ALLOCATION'>('GROWTH');

  return (
    <div className="bg-slate-800/40 rounded-3xl border border-slate-700/50 overflow-hidden backdrop-blur-md">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">Performance</h3>
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
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Current Month ROI</p>
                  <h4 className="text-3xl font-bold text-white">+{stats.currentMonthTradeRoi?.toFixed(2)}%</h4>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Account Growth</p>
                  <h4 className="text-xl font-bold text-emerald-400">+{stats.currentMonthAccountRaw?.toFixed(2)}%</h4>
                </div>
              </div>
            </div>
            <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all duration-1000"
                style={{ width: `${Math.min(100, (stats.currentMonthTradeRoi || 0) * 5)}%` }}
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
                <p className="text-lg font-bold text-white">${(stats.currentQuarterTradeRoi * 100).toLocaleString()}</p>
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
  const [activeTrade, setActiveTrade] = useState<{
      isActive: boolean;
      pair: string;
      side: string;
      currentPnl: number;
      entryPrice: number;
      size: string;
      tradePercent: number;
      accountPercent: number;
  } | null>(null);
  const [isTradeLoading, setIsTradeLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Use a ref for liveBalance so the polling interval doesn't constantly reset if balance changes slightly
  const liveBalanceRef = useRef(liveBalance);
  useEffect(() => {
      liveBalanceRef.current = liveBalance;
  }, [liveBalance]);

  const fetchActiveTrade = useCallback(async () => {
    try {
      const positions = await fetchBybitPositions();
      
      if (positions && positions.length > 0) {
        // Find the first non-zero position
        const activePos = positions.find(p => parseFloat(p.size) !== 0);
        
        if (activePos) {
          const pnl = parseFloat(activePos.unrealisedPnl) || 0;
          const proratedPnl = pnl * userShare;
          
          setActiveTrade({
              isActive: true,
              pair: activePos.symbol,
              side: activePos.side === 'Buy' ? 'LONG' : 'SHORT',
              currentPnl: proratedPnl,
              entryPrice: parseFloat(activePos.avgPrice),
              size: activePos.leverage ? `${activePos.leverage}x` : '1x',
              tradePercent: (pnl / (parseFloat(activePos.positionValue) / parseFloat(activePos.leverage))) * 100 || 0,
              accountPercent: liveBalanceRef.current ? (proratedPnl / liveBalanceRef.current) * 100 : 0
          });
        } else {
          setActiveTrade(null);
        }
      } else {
        setActiveTrade(null);
      }
    } catch (error) {
      console.error("Error fetching Bybit positions:", error);
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

  if (!activeTrade?.isActive) return (
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
      <div className={`
          rounded-2xl p-4 flex items-center justify-between gap-4 shadow-sm relative overflow-hidden
          ${'bg-slate-900 border border-slate-800'}
      `}>
          <div className={`absolute left-0 top-0 bottom-0 w-1 ${activeTrade.side === 'Buy' ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
          
          <div className="flex items-center gap-3">
             <div className={`${activeTrade.side === 'Buy' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'} p-2 rounded-full`}>
                <Signal size={18} className="animate-pulse" />
             </div>
             <div>
                <div className="flex items-center gap-2">
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Active Position</div>
                    <button 
                        onClick={handleManualRefresh}
                        disabled={isRefreshing}
                        className="text-slate-500 hover:text-sky-400 transition-colors"
                    >
                        <RefreshCw size={10} className={isRefreshing ? 'animate-spin' : ''} />
                    </button>
                </div>
                <div className="flex items-center gap-1.5">
                   <span className={`font-bold ${'text-white'}`}>{activeTrade.pair}</span>
                   <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${activeTrade.side === 'Buy' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
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
         <div className="absolute top-2 right-3 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-emerald-500 font-bold text-[9px]">LIVE EXECUTIONS</span>
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

const AdminPayoutCalculator = ({ poolCapital }: { poolCapital: number }) => {
    const [totalCapital, setTotalCapital] = useState<string>(poolCapital.toString());
    const [roiPercentage, setRoiPercentage] = useState<string>('15');
    
    useEffect(() => {
        setTotalCapital(poolCapital.toString());
    }, [poolCapital]);

    const capital = parseFloat(totalCapital) || 0;
    const roi = parseFloat(roiPercentage) || 0;
    
    // Logic: Payout based on USD return by trade in relation to overall capital
    const estimatedPayout = capital * (roi / 100);

    return (
        <div className="bg-slate-800 border border-slate-700 rounded-3xl p-5 shadow-lg mb-6 max-w-xl mx-auto">
            <div className="flex items-center gap-2 mb-6">
                <div className="bg-sky-500/20 p-3 rounded-xl text-sky-400">
                    <Calculator size={24} />
                </div>
                <div>
                    <h3 className="font-bold text-white text-lg">Profit Payout Simulator</h3>
                    <p className="text-xs text-slate-400">Calculate total distributions based on aggregate ROI.</p>
                </div>
            </div>
            
            <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Total Invested Capital</label>
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
                    <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-2 block">Avg Quarter ROI</label>
                        <div className="flex items-center gap-2">
                             <input 
                                type="number" 
                                value={roiPercentage}
                                onChange={e => setRoiPercentage(e.target.value)}
                                className="w-full bg-transparent text-xl text-white font-mono font-bold outline-none"
                            />
                            <span className="text-emerald-500 font-bold">%</span>
                        </div>
                    </div>
                </div>
                
                <div className="bg-gradient-to-r from-emerald-900/40 to-emerald-900/10 rounded-2xl p-6 border border-emerald-500/20">
                    <div className="flex justify-between items-center mb-1">
                         <span className="text-sm text-emerald-300 font-bold uppercase tracking-wide">Estimated Total Payout</span>
                         <Coins size={20} className="text-emerald-400 opacity-50" />
                    </div>
                    <div className="text-4xl font-mono font-bold text-emerald-400">
                        ${estimatedPayout.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                    <p className="text-xs text-emerald-500/50 mt-2">Distributable amount across all eligible users.</p>
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

const WebhookDebugger = () => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [testPayload, setTestPayload] = useState('LONG OPEN: BTCUSDT');
  const [lastMessage, setLastMessage] = useState<any>(null);
  const [isFetchingLast, setIsFetchingLast] = useState(false);

  const fetchLastMessage = async () => {
    setIsFetchingLast(true);
    try {
      const response = await fetch('/api/webhook/trades');
      const data = await response.json();
      setLastMessage(data.lastMessage);
    } catch (err) {
      console.error("Failed to fetch last message:", err);
    } finally {
      setIsFetchingLast(false);
    }
  };

  useEffect(() => {
    fetchLastMessage();
    const interval = setInterval(fetchLastMessage, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  const sendTestWebhook = async () => {
    setStatus('loading');
    try {
      const response = await fetch('/api/webhook/trades', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: testPayload,
          secret_key: 'YOUR_SECURE_PASSWORD'
        })
      });

      const data = await response.json();
      if (response.ok) {
        setStatus('success');
        setMessage(`Success: ${JSON.stringify(data)}`);
        fetchLastMessage();
      } else {
        setStatus('error');
        setMessage(`Error: ${data.error || response.statusText}`);
      }
    } catch (err) {
      setStatus('error');
      setMessage(`Network Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 backdrop-blur-xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-indigo-500/20 rounded-xl">
          <Terminal className="text-indigo-400" size={20} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Webhook Debugger</h3>
          <p className="text-xs text-slate-400">Test the Discord bot integration</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2 tracking-wider">Webhook URL (Production)</label>
          <div className="bg-black/40 border border-slate-800 rounded-xl p-3 font-mono text-xs text-indigo-300 break-all">
            https://ais-pre-ejtemfvkfa2yuwbxx3hjdo-196407806922.us-east1.run.app/api/webhook/trades
          </div>
        </div>

        <div>
          <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2 tracking-wider">Last Message Received</label>
          <div className="bg-black/40 border border-slate-800 rounded-xl p-3 font-mono text-xs text-indigo-300 break-all min-h-[60px] relative">
            {isFetchingLast && <RefreshCw className="animate-spin absolute top-2 right-2 text-indigo-500" size={12} />}
            {lastMessage ? (
              <pre className="whitespace-pre-wrap text-[10px]">
                {JSON.stringify(lastMessage, null, 2)}
              </pre>
            ) : (
              <span className="text-slate-600 italic">No messages received yet.</span>
            )}
          </div>
          <button 
            onClick={fetchLastMessage}
            className="mt-1 text-[9px] text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-widest"
          >
            Refresh Last Message
          </button>
        </div>

        <div>
          <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2 tracking-wider">Test Payload (Discord Message Format)</label>
          <textarea 
            className="w-full bg-black/40 border border-slate-800 rounded-xl p-3 font-mono text-xs text-white focus:outline-none focus:border-indigo-500/50 transition-colors"
            rows={3}
            value={testPayload}
            onChange={(e) => setTestPayload(e.target.value)}
            placeholder="e.g. LONG OPEN: BTCUSDT"
          />
        </div>

        <button
          onClick={sendTestWebhook}
          disabled={status === 'loading'}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
        >
          {status === 'loading' ? (
            <RefreshCw className="animate-spin" size={16} />
          ) : (
            <Play size={16} />
          )}
          Send Test Webhook
        </button>

        {status !== 'idle' && (
          <div className={`p-4 rounded-xl text-xs font-mono break-all ${
            status === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 
            status === 'error' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-slate-800 text-slate-300'
          }`}>
            {message}
          </div>
        )}

        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
          <div className="flex gap-3">
            <AlertCircle className="text-amber-400 shrink-0" size={16} />
            <div className="text-[11px] text-amber-200/80 leading-relaxed">
              <strong>Note:</strong> This uses the default secret <code className="bg-black/30 px-1 rounded text-amber-400">YOUR_SECURE_PASSWORD</code>. 
              If you have set a custom <code className="bg-black/30 px-1 rounded text-amber-400">WEBHOOK_SECRET</code> in environment variables, 
              this test might fail unless you update the code.
            </div>
          </div>
        </div>
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
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'PAYOUTS' | 'MARKET'>('OVERVIEW');
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
  const [isRefreshingPerformance, setIsRefreshingPerformance] = useState(false);

  const handleRefreshPerformance = useCallback(async () => {
    setIsRefreshingPerformance(true);
    try {
        // 1. Fetch from Bybit API
        const [closedTrades, walletBalance, recentExecs] = await Promise.all([
            fetchClosedPnL(),
            fetchWalletBalance(),
            fetchRecentExecutions()
        ]);

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

            // Calculate ROI based on position value
            const posValue = parseFloat(trade.qty) * parseFloat(trade.avgEntryPrice);
            const tradePercent = posValue > 0 ? (pnl / (posValue / parseFloat(trade.leverage))) * 100 : 0;
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

  // Equity Calculation Siloed to User Share (ONLY applies to active capital)
  const exchangeProfit = liveBalance ? liveBalance - totalPool : 0;
  const userProfit = exchangeProfit * userShare;
  const totalBalance = investorStats.q3Invested + userProfit;

  const tabs = [
      { id: 'OVERVIEW', label: 'Overview' },
      ...(isAdmin ? [
          { id: 'PAYOUTS', label: 'Payouts' },
          { id: 'MARKET', label: 'Market' }
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
                    userRole={userRole} 
                    onRefresh={handleRefreshPerformance}
                    isRefreshing={isRefreshingPerformance}
                />
            </div>

            <TradeStatusWidget isInvestor={isInvestor} userShare={userShare} liveBalance={liveBalance} />

            {/* Live Logs */}
            <LiveLogs executions={executions} />
        </div>
      )}

      {activeTab === 'PAYOUTS' && isAdmin && (
          <div className="animate-fade-in">
              <AdminPayoutCalculator poolCapital={totalPool} />
          </div>
      )}

      {activeTab === 'MARKET' && isAdmin && (
         <div className="space-y-6 animate-fade-in">
            <TradingViewWidget selectedAsset={ALL_ASSETS[0]} selectedTimeframe={'4H'} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <StrategyMonitor />
              <WebhookDebugger />
            </div>
            <LiveLogs executions={executions} />
         </div>
      )}
    </div>
  );
};