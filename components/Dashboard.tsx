import React, { useState, useEffect } from 'react';
import { UserRole, Asset } from '../types';
import { DollarSign, Activity, Calendar, Clock, Loader2, Signal, Copy, Check, Calculator, Wallet, Coins, ArrowUpRight } from 'lucide-react';
import { fetchBybitPositions, fetchRecentExecutions } from '../services/bybit';

interface DashboardProps {
  userRole: UserRole;
  username?: string;
  investorStats?: {
    q3Invested: number;
    q3CurrentRoi: number;
    totalWithdrawn: number;
  };
  onCapitalInject?: (amount: number) => void;
}

const ALL_ASSETS: Asset[] = [
  { symbol: 'BTCUSDT', name: 'Bitcoin', type: 'CRYPTO', price: 64230.50, change: 2.4 },
  { symbol: 'ETHUSDT', name: 'Ethereum', type: 'CRYPTO', price: 3450.20, change: 1.8 },
  { symbol: 'SOLUSDT', name: 'Solana', type: 'CRYPTO', price: 145.80, change: 5.2 },
  { symbol: 'BNBUSDT', name: 'Binance Coin', type: 'CRYPTO', price: 590.10, change: 0.5 },
];

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
      allowTransparency={true}
      frameBorder="0"
    />
  </div>
);

const StrategyMonitor = () => (
  <div className="bg-slate-900 rounded-2xl p-5 shadow-lg relative overflow-hidden">
    <div className="flex justify-between items-center mb-4">
      <h3 className="font-bold text-white text-sm flex items-center gap-2">
        <Activity className="text-emerald-400" size={16} />
        Strategy Signals
      </h3>
      <span className="text-[10px] uppercase font-bold bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 animate-pulse">
        Live
      </span>
    </div>
    <div className="grid grid-cols-2 gap-3">
      {[
        { label: 'Heikin Ashi', val: 'BULLISH', col: 'text-emerald-400' },
        { label: 'MACD', val: 'CONVERGING', col: 'text-emerald-400' },
        { label: 'Chop Index', val: '54.2', col: 'text-rose-400' },
        { label: 'RelVol', val: '1.2x', col: 'text-emerald-400' }
      ].map((item, i) => (
        <div key={i} className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50">
          <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">{item.label}</div>
          <div className={`font-mono text-xs font-bold ${item.col}`}>{item.val}</div>
        </div>
      ))}
    </div>
  </div>
);

const TradeStatusWidget = ({ isInvestor }: { isInvestor: boolean }) => {
  const [activeTrade, setActiveTrade] = useState<{
      isActive: boolean;
      pair: string;
      side: string;
      currentPnl: number;
      size: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchLivePosition = async () => {
        setIsLoading(true);
        const positions = await fetchBybitPositions();
        
        // Find active position (Size > 0)
        const active = positions.find(p => parseFloat(p.size) > 0);
        
        if (active) {
            setActiveTrade({
                isActive: true,
                pair: active.symbol,
                side: active.side,
                currentPnl: parseFloat(active.unrealisedPnl),
                size: active.size
            });
        } else {
            setActiveTrade({
                isActive: false,
                pair: 'BTCUSDT',
                side: 'NONE',
                currentPnl: 0,
                size: '0'
            });
        }
        setIsLoading(false);
    };

    fetchLivePosition();
    const interval = setInterval(fetchLivePosition, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  if (isLoading) return (
      <div className={`rounded-2xl p-6 flex items-center justify-center gap-2 ${isInvestor ? 'bg-white border border-slate-100' : 'bg-slate-900 border border-slate-800'}`}>
          <Loader2 className="animate-spin text-emerald-500" size={20} />
          <span className="text-xs text-slate-500 font-bold">Connecting to Exchange...</span>
      </div>
  );

  if (!activeTrade?.isActive) return (
      <div className={`rounded-2xl p-6 flex items-center gap-3 ${isInvestor ? 'bg-white border border-slate-100' : 'bg-slate-900 border border-slate-800'}`}>
           <div className="bg-slate-100 p-2 rounded-full text-slate-400">
               <Signal size={18} />
           </div>
           <div>
               <div className="text-sm font-bold text-slate-500">No Active Positions</div>
           </div>
      </div>
  );

  return (
      <div className={`
          rounded-2xl p-4 flex items-center justify-between gap-4 shadow-sm relative overflow-hidden
          ${isInvestor ? 'bg-white border border-slate-100' : 'bg-slate-900 border border-slate-800'}
      `}>
          <div className={`absolute left-0 top-0 bottom-0 w-1 ${activeTrade.side === 'Buy' ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
          
          <div className="flex items-center gap-3">
             <div className={`${activeTrade.side === 'Buy' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'} p-2 rounded-full`}>
                <Signal size={18} className="animate-pulse" />
             </div>
             <div>
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Active Position</div>
                <div className="flex items-center gap-1.5">
                   <span className={`font-bold ${isInvestor ? 'text-slate-800' : 'text-white'}`}>{activeTrade.pair}</span>
                   <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${activeTrade.side === 'Buy' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                       {activeTrade.side}
                   </span>
                </div>
             </div>
          </div>

          <div className="text-right">
             <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Unrealized PnL</div>
             <div className={`font-mono font-bold text-lg ${activeTrade.currentPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {activeTrade.currentPnl >= 0 ? '+' : ''}{activeTrade.currentPnl.toFixed(2)}
             </div>
          </div>
      </div>
  );
};

const LiveLogs = () => {
    const [logs, setLogs] = useState<any[]>([]);
    
    useEffect(() => {
        const fetchLogs = async () => {
            const executions = await fetchRecentExecutions();
            // Transform executions into log format
            const formattedLogs = executions.map(exec => ({
                time: new Date(parseInt(exec.execTime)).toLocaleTimeString(),
                msg: `${exec.side} ${exec.symbol} - Price: ${exec.execPrice} | Qty: ${exec.execQty}`,
                id: exec.execId
            }));
            setLogs(formattedLogs);
        };

        fetchLogs();
        const interval = setInterval(fetchLogs, 5000); // Poll every 5s
        return () => clearInterval(interval);
    }, []);

    return (
      <div className="bg-slate-950 rounded-2xl p-4 font-mono text-[10px] text-slate-400 h-40 overflow-hidden relative shadow-inner border border-slate-800">
         <div className="absolute top-2 right-3 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-emerald-500 font-bold text-[9px]">LIVE EXECUTIONS</span>
         </div>
         <div className="space-y-1 mt-6 h-full overflow-y-auto pb-4 custom-scrollbar">
            {logs.length === 0 && <span className="opacity-50">Syncing execution stream...</span>}
            {logs.map((log) => (
                <div key={log.id} className="truncate opacity-80 border-l-2 border-slate-800 pl-2 hover:bg-slate-900 transition-colors cursor-default">
                    <span className="text-slate-500 mr-2">[{log.time}]</span>
                    {log.msg}
                </div>
            ))}
         </div>
      </div>
    );
};

const AdminPayoutCalculator = () => {
    const [totalCapital, setTotalCapital] = useState<string>('500000');
    const [roiPercentage, setRoiPercentage] = useState<string>('15');
    
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
    const [copied, setCopied] = useState<string | null>(null);

    const amountNum = parseFloat(investAmount) || 0;
    const fee = amountNum * 0.12; // 12% Fee
    const netInvested = amountNum - fee;

    const handleCopy = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        setCopied(label);
        setTimeout(() => setCopied(null), 2000);
    };

    const handleConfirm = () => {
      setStatus('PROCESSING');
      setTimeout(() => {
        if (onCapitalInject) onCapitalInject(netInvested);
        setStatus('COMPLETED');
        setTimeout(onClose, 1500);
      }, 1500);
    };

    return (
      <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center p-4 sm:p-0">
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={onClose}></div>
        <div className="bg-white w-full max-w-md rounded-t-3xl md:rounded-3xl p-6 relative z-10 animate-fade-in-up shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto mb-6 md:hidden"></div>
            
            <h3 className="text-xl font-bold text-slate-900 mb-2">Invest Capital (Q3 2024)</h3>
            <p className="text-sm text-slate-500 mb-6">Send funds via the methods below to increase your allocation.</p>
            
            {/* Payment Details */}
            <div className="space-y-3 mb-6">
                <div className="bg-sky-50 p-4 rounded-xl border border-sky-100 flex items-center justify-between">
                    <div>
                        <span className="text-xs font-bold text-sky-600 uppercase block mb-0.5">Venmo</span>
                        <span className="text-slate-900 font-bold font-mono">@fzn1738</span>
                    </div>
                    <button 
                        onClick={() => handleCopy('fzn1738', 'Venmo')}
                        className="text-sky-600 hover:text-sky-700 p-2"
                    >
                        {copied === 'Venmo' ? <Check size={18} /> : <Copy size={18} />}
                    </button>
                </div>
                
                <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 flex items-center justify-between">
                    <div>
                        <span className="text-xs font-bold text-purple-600 uppercase block mb-0.5">Zelle</span>
                        <span className="text-slate-900 font-bold font-mono">(945) 465-5633</span>
                    </div>
                    <button 
                        onClick={() => handleCopy('9454655633', 'Zelle')}
                        className="text-purple-600 hover:text-purple-700 p-2"
                    >
                         {copied === 'Zelle' ? <Check size={18} /> : <Copy size={18} />}
                    </button>
                </div>

                <div className="bg-slate-100 p-3 rounded-xl border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Required Memo</span>
                    <span className="text-slate-900 font-bold text-sm block">Baboon Funds - Q3 2024</span>
                </div>
            </div>
            
            <div className="bg-slate-50 p-4 rounded-2xl mb-6 border border-slate-100">
                <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Notify Deposit Amount</label>
                <div className="flex items-center gap-2 mb-4">
                    <span className="text-slate-400 font-bold text-xl">$</span>
                    <input 
                        type="number" 
                        value={investAmount}
                        onChange={(e) => setInvestAmount(e.target.value)}
                        placeholder="0"
                        className="w-full bg-transparent text-3xl font-bold text-slate-900 outline-none placeholder-slate-300"
                    />
                </div>
                
                {amountNum > 0 && (
                    <div className="bg-white rounded-xl p-3 space-y-2 border border-slate-100">
                        <div className="flex justify-between text-xs text-slate-500">
                            <span>Upfront Fee (12%)</span>
                            <span className="text-rose-500 font-mono">-${fee.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                        <div className="flex justify-between text-sm font-bold text-slate-900 border-t border-slate-100 pt-2">
                            <span>Net Invested</span>
                            <span className="font-mono">${netInvested.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                    </div>
                )}
            </div>

            <button 
                onClick={handleConfirm}
                disabled={status !== 'IDLE' || !investAmount}
                className={`w-full py-4 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2 ${status === 'COMPLETED' ? 'bg-emerald-500' : 'bg-slate-900 hover:bg-slate-800'}`}
            >
                {status === 'PROCESSING' ? <Loader2 className="animate-spin" /> : status === 'COMPLETED' ? <Check /> : 'Confirm Deposit Notification'}
            </button>
        </div>
      </div>
    );
};

// --- Main Dashboard ---

export const Dashboard: React.FC<DashboardProps> = ({ 
  userRole, 
  username, 
  investorStats = { q3Invested: 0, q3CurrentRoi: 0, totalWithdrawn: 0 },
  onCapitalInject
}) => {
  const isInvestor = userRole === 'INVESTOR';
  const isAdmin = userRole === 'ADMIN';
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'PAYOUTS' | 'MARKET'>('OVERVIEW');
  const [showInvestModal, setShowInvestModal] = useState(false);
  
  // Quick Stats Calculation
  // Logic: ROI is based on USD growth comparison to invested amount
  const profit = investorStats.q3Invested * (investorStats.q3CurrentRoi / 100);
  const totalBalance = investorStats.q3Invested + profit;

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
                <h2 className={`text-2xl font-bold tracking-tight ${isInvestor ? 'text-slate-900' : 'text-white'}`}>
                    {activeTab === 'OVERVIEW' ? (isInvestor ? 'Portfolio' : 'Admin Console') : 
                     activeTab === 'PAYOUTS' ? 'Simulator' : 'Live Terminal'}
                </h2>
                {isInvestor && (
                    <p className="text-xs text-slate-500 font-medium">{username?.split('@')[0] || 'Investor'}</p>
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
                <div className="space-y-4">
                    <button 
                        onClick={() => setShowInvestModal(true)}
                        className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold py-5 rounded-2xl shadow-lg shadow-emerald-500/30 active:scale-95 transition-all flex items-center justify-center gap-2 text-lg"
                    >
                        <DollarSign size={24} /> Invest Capital (Q3 2024)
                    </button>
                    
                    <div className="flex justify-between gap-4 px-2">
                         <div className="text-center flex-1 bg-white border border-slate-100 p-3 rounded-xl shadow-sm">
                             <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Next Payout</div>
                             <div className="text-slate-900 font-bold flex items-center justify-center gap-1">
                                <Calendar size={14} className="text-purple-500" /> Oct 1st
                             </div>
                         </div>
                         <div className="text-center flex-1 bg-white border border-slate-100 p-3 rounded-xl shadow-sm">
                             <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Deadline</div>
                             <div className="text-slate-900 font-bold flex items-center justify-center gap-1">
                                <Clock size={14} className="text-amber-500" /> Sep 28th
                             </div>
                         </div>
                    </div>
                </div>
            )}
            
            {/* Main Balance Card (Divergent for Admin vs Investor) */}
            <div className={`rounded-3xl p-6 text-white shadow-xl relative overflow-hidden ${isInvestor ? 'bg-slate-900' : 'bg-slate-800 border border-slate-700'}`}>
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                
                <div className="relative z-10">
                    {isInvestor ? (
                        <>
                            <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Total Equity</div>
                            <div className="text-4xl font-bold tracking-tight mb-6">
                                ${totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-white/10 px-4 py-3 rounded-2xl backdrop-blur-md">
                                    <div className="text-[10px] text-slate-300 uppercase font-bold mb-1">Invested</div>
                                    <div className="font-mono font-bold text-lg">${investorStats.q3Invested.toLocaleString()}</div>
                                </div>
                                <div className="bg-emerald-500/20 px-4 py-3 rounded-2xl backdrop-blur-md border border-emerald-500/20">
                                    <div className="text-[10px] text-emerald-300 uppercase font-bold mb-1">Profit</div>
                                    <div className="font-mono font-bold text-lg text-emerald-400">+${profit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                                </div>
                            </div>
                        </>
                    ) : (
                        /* Admin Overview Stats */
                        <div className="grid grid-cols-2 gap-4">
                             <div className="col-span-2 mb-2">
                                <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Total Capital Invested</div>
                                <div className="text-3xl font-bold tracking-tight text-white">$1,245,000.00</div>
                             </div>
                             
                             <div className="bg-white/5 p-3 rounded-xl backdrop-blur-md border border-white/10">
                                 <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Paid Out (Q2)</div>
                                 <div className="font-mono font-bold text-white">$142,500</div>
                             </div>
                             <div className="bg-white/5 p-3 rounded-xl backdrop-blur-md border border-white/10">
                                 <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Collected (Q3)</div>
                                 <div className="font-mono font-bold text-emerald-400">$320,000</div>
                             </div>
                             
                             <div className="col-span-2 bg-purple-500/10 p-3 rounded-xl backdrop-blur-md border border-purple-500/20 mt-2 flex justify-between items-center">
                                 <div>
                                     <div className="text-[10px] text-purple-300 uppercase font-bold mb-1">Fees Collected (Q3)</div>
                                     <div className="font-mono font-bold text-purple-400 text-lg">$38,400</div>
                                 </div>
                                 <Wallet size={20} className="text-purple-400 opacity-50" />
                             </div>
                        </div>
                    )}
                </div>
            </div>

            <TradeStatusWidget isInvestor={isInvestor} />
        </div>
      )}

      {activeTab === 'PAYOUTS' && isAdmin && (
          <div className="animate-fade-in">
              <AdminPayoutCalculator />
          </div>
      )}

      {activeTab === 'MARKET' && isAdmin && (
         <div className="space-y-6 animate-fade-in">
            <TradingViewWidget selectedAsset={ALL_ASSETS[0]} selectedTimeframe={'4H'} />
            <StrategyMonitor />
            <LiveLogs />
         </div>
      )}
    </div>
  );
};