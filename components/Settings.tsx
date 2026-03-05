import React, { useState, useEffect } from 'react';
import { UserRole } from '../types';
import { Bell, ShieldCheck, Wallet, ChevronRight, LogOut, Moon, User, Check, AlertCircle, Calculator, Percent } from 'lucide-react';

interface SettingsProps {
  role: UserRole;
  userEmail: string;
  investedCapital: number;
  onWithdraw: (amount: number) => void;
}

export const Settings: React.FC<SettingsProps> = ({ role, userEmail, investedCapital, onWithdraw }) => {
  const isInvestor = role === 'INVESTOR';
  
  // Withdrawal State
  const [withdrawAmountInput, setWithdrawAmountInput] = useState<string>('');
  const [withdrawStatus, setWithdrawStatus] = useState<'IDLE' | 'PROCESSING' | 'SUCCESS'>('IDLE');

  // LTC Address State
  const [ltcAddress, setLtcAddress] = useState('');
  const [isLtcValid, setIsLtcValid] = useState(true);
  const [ltcSaved, setLtcSaved] = useState(false);

  // Rollover State
  const [isRollover, setIsRollover] = useState(false);

  // Admin Fee State
  const [showFeeCalc, setShowFeeCalc] = useState(false);
  const [calculatedFee, setCalculatedFee] = useState(0);

  // Derived state for withdrawal validation
  const withdrawAmount = parseFloat(withdrawAmountInput) || 0;
  const isOverBalance = withdrawAmount > investedCapital;
  const canWithdraw = withdrawAmount > 0 && !isOverBalance && withdrawStatus === 'IDLE';

  useEffect(() => {
    // Simulate loading saved address
    const saved = localStorage.getItem('user_ltc_address');
    if (saved) setLtcAddress(saved);
  }, []);

  const handleLtcChange = (val: string) => {
    setLtcAddress(val);
    setLtcSaved(false);
    // Basic regex for LTC address (starts with L, M, or 3, length 26-35)
    const regex = /^[LM3][a-km-zA-HJ-NP-Z1-9]{26,33}$/;
    setIsLtcValid(regex.test(val) || val === '');
  };

  const saveLtc = () => {
    if (isLtcValid && ltcAddress) {
        localStorage.setItem('user_ltc_address', ltcAddress);
        setLtcSaved(true);
        setTimeout(() => setLtcSaved(false), 2000);
    }
  };

  const handleWithdraw = () => {
    if (!canWithdraw) return;

    setWithdrawStatus('PROCESSING');
    setTimeout(() => {
        onWithdraw(withdrawAmount);
        setWithdrawAmountInput('');
        setWithdrawStatus('SUCCESS');
        setTimeout(() => setWithdrawStatus('IDLE'), 3000);
    }, 1500);
  };

  const calculateMaintenanceFee = () => {
      // 12% of Invested Capital
      setCalculatedFee(investedCapital * 0.12);
      setShowFeeCalc(true);
  };

  const SectionHeader = ({ title }: { title: string }) => (
    <h3 className={`text-xs font-bold uppercase tracking-wider mb-2 ml-4 ${isInvestor ? 'text-slate-400' : 'text-slate-500'}`}>
        {title}
    </h3>
  );

  const ListItem = ({ icon: Icon, label, value, onClick, isDestructive = false, rightElement }: any) => (
    <button 
        onClick={onClick}
        className={`w-full flex items-center justify-between p-4 border-b last:border-0 transition-colors
        ${isInvestor 
            ? 'bg-white text-slate-900 border-slate-100 active:bg-slate-50' 
            : 'bg-slate-800 text-white border-slate-700 active:bg-slate-700'}`}
    >
        <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded-md ${isDestructive ? 'bg-rose-100 text-rose-600' : isInvestor ? 'bg-slate-100 text-slate-600' : 'bg-slate-700 text-slate-400'}`}>
                <Icon size={16} />
            </div>
            <span className={`text-sm font-medium ${isDestructive ? 'text-rose-600' : ''}`}>{label}</span>
        </div>
        <div className="flex items-center gap-2">
            {rightElement ? rightElement : (
                <>
                    {value && <span className="text-xs text-slate-400">{value}</span>}
                    {onClick && <ChevronRight size={16} className="text-slate-300" />}
                </>
            )}
        </div>
    </button>
  );

  return (
    <div className="max-w-xl mx-auto py-6 space-y-6 pb-24 animate-fade-in">
        <h2 className={`text-2xl font-bold px-4 ${isInvestor ? 'text-slate-900' : 'text-white'}`}>Settings</h2>

        {/* Profile Section */}
        <div>
            <SectionHeader title="Account" />
            <div className={`rounded-xl overflow-hidden shadow-sm ${isInvestor ? 'bg-white' : 'bg-slate-800'}`}>
                <ListItem icon={User} label="Email" value={userEmail} />
                <ListItem icon={ShieldCheck} label="Status" value="Verified" />
            </div>
        </div>

        {/* Admin Maintenance Section */}
        {!isInvestor && (
             <div>
                <SectionHeader title="Maintenance" />
                <div className="bg-slate-800 rounded-xl overflow-hidden shadow-sm p-4 border border-slate-700">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="bg-purple-500/20 text-purple-400 p-2 rounded-lg">
                                <Percent size={18} />
                            </div>
                            <div>
                                <h4 className="text-sm font-bold text-white">Quarterly Fee</h4>
                                <p className="text-[10px] text-slate-400">12% of Total Invested Capital</p>
                            </div>
                        </div>
                        <button 
                            onClick={calculateMaintenanceFee}
                            className="bg-purple-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-purple-500"
                        >
                            Calculate
                        </button>
                    </div>
                    {showFeeCalc && (
                        <div className="bg-slate-900/50 rounded-lg p-3 flex justify-between items-center border border-slate-700 animate-fade-in">
                             <span className="text-xs text-slate-400 font-medium">Fee Deduction</span>
                             <span className="text-lg font-mono font-bold text-rose-400">-${calculatedFee.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                        </div>
                    )}
                </div>
             </div>
        )}

        {/* Financial Section (Investor) */}
        {isInvestor && (
            <div>
                <SectionHeader title="Finance" />
                <div className="rounded-xl overflow-hidden shadow-sm bg-white mb-4">
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center">
                        <span className="text-sm font-medium">Invested Capital</span>
                        <span className="font-bold font-mono">${investedCapital.toLocaleString()}</span>
                    </div>
                    
                    {/* LTC Address Config */}
                    <div className="p-4 border-b border-slate-100">
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">LTC Payout Address</label>
                        <div className="flex gap-2 relative">
                            <div className="absolute left-3 top-3 text-slate-400">
                                <Wallet size={16} />
                            </div>
                            <input 
                                type="text"
                                value={ltcAddress}
                                onChange={(e) => handleLtcChange(e.target.value)}
                                placeholder="L..."
                                className={`flex-1 bg-slate-50 rounded-lg pl-9 pr-4 py-2.5 text-xs font-mono outline-none border ${!isLtcValid && ltcAddress ? 'border-rose-400 text-rose-600' : 'border-transparent focus:border-emerald-400'}`}
                            />
                            <button 
                                onClick={saveLtc}
                                disabled={!isLtcValid || !ltcAddress}
                                className={`px-4 rounded-lg text-xs font-bold transition-all ${ltcSaved ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white disabled:opacity-50'}`}
                            >
                                {ltcSaved ? <Check size={16} /> : 'Save'}
                            </button>
                        </div>
                        {!isLtcValid && ltcAddress && (
                            <div className="flex items-center gap-1 mt-1 text-[10px] text-rose-500 font-medium">
                                <AlertCircle size={10} /> Invalid LTC address format
                            </div>
                        )}
                    </div>

                    {/* Rollover Toggle */}
                    <div className="p-4 flex items-center justify-between">
                        <div>
                            <div className="text-sm font-medium text-slate-900">Rollover Profits</div>
                            <div className="text-[10px] text-slate-500">Reinvest quarterly profits automatically</div>
                        </div>
                        <button 
                            onClick={() => setIsRollover(!isRollover)}
                            className={`w-12 h-6 rounded-full transition-colors relative ${isRollover ? 'bg-emerald-500' : 'bg-slate-200'}`}
                        >
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isRollover ? 'left-7' : 'left-1'}`}></div>
                        </button>
                    </div>
                </div>

                <div className="bg-white rounded-xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-bold text-slate-400 uppercase">Request Withdrawal</label>
                        <span className={`text-[10px] font-bold font-mono ${isOverBalance ? 'text-rose-500' : 'text-emerald-600'}`}>
                            Available: ${investedCapital.toLocaleString()}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <input 
                            type="number"
                            value={withdrawAmountInput}
                            onChange={(e) => setWithdrawAmountInput(e.target.value)}
                            placeholder="Amount"
                            className={`flex-1 bg-slate-50 rounded-lg px-4 py-3 text-sm font-bold outline-none border ${isOverBalance ? 'border-rose-400 bg-rose-50' : 'border-transparent focus:border-emerald-400'}`}
                        />
                        <button 
                            onClick={handleWithdraw}
                            disabled={!canWithdraw}
                            className={`px-6 rounded-lg text-sm font-bold disabled:opacity-50 transition-colors ${isOverBalance ? 'bg-rose-500 text-white' : 'bg-slate-900 text-white'}`}
                        >
                            {isOverBalance ? 'Exceeds' : withdrawStatus === 'PROCESSING' ? '...' : withdrawStatus === 'SUCCESS' ? 'Sent' : 'Withdraw'}
                        </button>
                    </div>
                    {isOverBalance && (
                         <p className="text-[10px] text-rose-500 mt-2 font-medium">Amount exceeds available invested balance.</p>
                    )}
                    {!isOverBalance && (
                         <p className="text-[10px] text-slate-400 mt-2">Withdrawals processed within 3-5 business days via LTC.</p>
                    )}
                </div>
            </div>
        )}

        {/* App Settings */}
        <div>
            <SectionHeader title="Preferences" />
            <div className={`rounded-xl overflow-hidden shadow-sm ${isInvestor ? 'bg-white' : 'bg-slate-800'}`}>
                <ListItem icon={Bell} label="Notifications" value="On" onClick={() => {}} />
                <ListItem icon={Moon} label="Dark Mode" value="Auto" onClick={() => {}} />
            </div>
        </div>

        {/* Danger Zone */}
        <div>
            <div className={`rounded-xl overflow-hidden shadow-sm ${isInvestor ? 'bg-white' : 'bg-slate-800'}`}>
                <ListItem icon={LogOut} label="Log Out" isDestructive onClick={() => window.location.reload()} />
            </div>
        </div>
        
        <p className="text-center text-[10px] text-slate-400 mt-8">Baboon&Co Mobile v2.5.0</p>
    </div>
  );
};