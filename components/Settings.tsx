import React, { useState, useEffect } from 'react';
import { UserRole } from '../types';
import { Bell, ShieldCheck, Wallet, ChevronRight, LogOut, Moon, User, Check, AlertCircle, Calculator, Percent } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { db, auth } from '../firebase';

interface SettingsProps {
  role: UserRole;
  userEmail: string;
  investedCapital: number;
  onWithdraw: (amount: number) => void;
}

const SectionHeader = ({ title }: { title: string }) => (
  <h3 className={`text-xs font-bold uppercase tracking-wider mb-2 ml-4 ${'text-slate-500'}`}>
      {title}
  </h3>
);

const ListItem = ({ icon: Icon, label, value, onClick, isDestructive = false, rightElement }: any) => {
  return (
  <div 
      onClick={onClick}
      className={`w-full flex items-center justify-between p-4 border-b last:border-0 transition-colors bg-slate-800 text-white border-slate-700 ${onClick ? 'active:bg-slate-700 cursor-pointer' : ''}`}
  >
      <div className="flex items-center gap-3">
          <div className={`p-1.5 rounded-md ${isDestructive ? 'bg-rose-100 text-rose-600' : 'bg-slate-700 text-slate-400'}`}>
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
  </div>
)};

export const Settings: React.FC<SettingsProps> = ({ role, userEmail, investedCapital, onWithdraw }) => {
  const isInvestor = role === 'INVESTOR';
  
  // Withdrawal State
  const [withdrawAmountInput, setWithdrawAmountInput] = useState<string>('');
  const [withdrawStatus, setWithdrawStatus] = useState<'IDLE' | 'PROCESSING' | 'SUCCESS'>('IDLE');

  // USDT (SOL) Address State
  const [usdtSolAddress, setUsdtSolAddress] = useState('');
  const [isUsdtSolValid, setIsUsdtSolValid] = useState(true);
  const [usdtSolSaved, setUsdtSolSaved] = useState(false);
  const [isEditingUsdtSol, setIsEditingUsdtSol] = useState(true);

  // Rollover State
  const [isRollover, setIsRollover] = useState(false);

  // Admin Fee State
  const [showFeeCalc, setShowFeeCalc] = useState(false);
  const [calculatedFee, setCalculatedFee] = useState(0);

  // Derived state for withdrawal validation
  const withdrawAmount = parseFloat(withdrawAmountInput) || 0;
  const isOverBalance = withdrawAmount > investedCapital;
  const canWithdraw = withdrawAmount > 0 && !isOverBalance && withdrawStatus === 'IDLE';

  // Preferences State
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkModeEnabled, setDarkModeEnabled] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      if (!auth.currentUser) return;
      try {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          const savedAddress = data.usdtSolAddress || data.ltcAddress;
          if (savedAddress && savedAddress !== 'Pending') {
            setUsdtSolAddress(savedAddress);
            setIsEditingUsdtSol(false);
          }
          if (data.rolloverEnabled !== undefined) setIsRollover(data.rolloverEnabled);
          if (data.notificationsEnabled !== undefined) setNotificationsEnabled(data.notificationsEnabled);
          if (data.darkModeEnabled !== undefined) setDarkModeEnabled(data.darkModeEnabled);
        }
      } catch (error) {
        console.error("Error loading settings:", error);
      }
    };
    loadSettings();
  }, []);

  const toggleNotifications = async () => {
      const newVal = !notificationsEnabled;
      setNotificationsEnabled(newVal);
      if (auth.currentUser) {
          try {
              await setDoc(doc(db, 'users', auth.currentUser.uid), { notificationsEnabled: newVal }, { merge: true });
          } catch (error) {
              console.error("Error saving notifications setting:", error);
              setNotificationsEnabled(!newVal);
          }
      }
  };

  const toggleDarkMode = async () => {
      const newVal = !darkModeEnabled;
      setDarkModeEnabled(newVal);
      if (auth.currentUser) {
          try {
              await setDoc(doc(db, 'users', auth.currentUser.uid), { darkModeEnabled: newVal }, { merge: true });
          } catch (error) {
              console.error("Error saving dark mode setting:", error);
              setDarkModeEnabled(!newVal);
          }
      }
  };

  const validateSolanaAddress = (value: string) => {
    if (!value) return false;
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58Regex.test(value);
  };

  const handleUsdtSolChange = (val: string) => {
    const trimmed = val.trim();
    setUsdtSolAddress(trimmed);
    setUsdtSolSaved(false);
    setIsUsdtSolValid(trimmed === '' || validateSolanaAddress(trimmed));
  };

  const saveUsdtSolAddress = async () => {
    if (isUsdtSolValid && usdtSolAddress && auth.currentUser) {
        try {
            await setDoc(doc(db, 'users', auth.currentUser.uid), { usdtSolAddress }, { merge: true });
            setUsdtSolSaved(true);
            setIsEditingUsdtSol(false);
            setTimeout(() => setUsdtSolSaved(false), 2000);
        } catch (error) {
            console.error("Error saving USDT (SOL) address:", error);
        }
    }
  };

  const clearUsdtSolAddress = async () => {
    if (!auth.currentUser) return;
    try {
      await setDoc(doc(db, 'users', auth.currentUser.uid), { usdtSolAddress: 'Pending' }, { merge: true });
      setUsdtSolAddress('');
      setIsUsdtSolValid(true);
      setUsdtSolSaved(false);
      setIsEditingUsdtSol(true);
    } catch (error) {
      console.error('Error clearing USDT (SOL) address:', error);
    }
  };

  const toggleRollover = async () => {
    const newVal = !isRollover;
    setIsRollover(newVal);
    if (auth.currentUser) {
        try {
            await setDoc(doc(db, 'users', auth.currentUser.uid), { rolloverEnabled: newVal }, { merge: true });
        } catch (error) {
            console.error("Error saving rollover setting:", error);
            setIsRollover(!newVal); // Revert on error
        }
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

  return (
    <div className="max-w-xl mx-auto py-6 space-y-6 pb-24 animate-fade-in">
        <h2 className={`text-2xl font-bold px-4 ${'text-white'}`}>Settings</h2>

        {/* Profile Section */}
        <div>
            <SectionHeader title="Account" />
            <div className={`rounded-xl overflow-hidden shadow-sm ${'bg-slate-800'}`}>
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
                <div className="rounded-xl overflow-hidden shadow-sm bg-slate-800 border border-slate-700 mb-4">
                    <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                        <span className="text-sm font-medium text-white">Invested Capital</span>
                        <span className="font-bold font-mono text-white">${investedCapital.toLocaleString()}</span>
                    </div>
                    
                    {/* USDT (SOL) Address Config */}
                    <div className="p-4 border-b border-slate-700">
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">USDT (SOL) Payout Address</label>
                        <div className="flex gap-2 relative">
                            <div className="absolute left-3 top-3 text-slate-400">
                                <Wallet size={16} />
                            </div>
                            <input 
                                type="text"
                                value={usdtSolAddress}
                                onChange={(e) => handleUsdtSolChange(e.target.value)}
                                placeholder="Solana wallet address"
                                disabled={!isEditingUsdtSol}
                                className={`flex-1 bg-slate-900 text-white rounded-lg pl-9 pr-4 py-2.5 text-xs font-mono outline-none border ${!isEditingUsdtSol ? 'opacity-50 cursor-not-allowed' : ''} ${!isUsdtSolValid && usdtSolAddress ? 'border-rose-400 text-rose-400' : 'border-transparent focus:border-emerald-400'}`}
                            />
                            {!isEditingUsdtSol ? (
                              <button
                                onClick={clearUsdtSolAddress}
                                className="px-4 rounded-lg text-xs font-bold transition-all bg-rose-600 hover:bg-rose-500 text-white"
                              >
                                Delete
                              </button>
                            ) : (
                                <button 
                                    onClick={saveUsdtSolAddress}
                                    disabled={!isUsdtSolValid || !usdtSolAddress}
                                    className={`px-4 rounded-lg text-xs font-bold transition-all ${usdtSolSaved ? 'bg-emerald-500 text-white' : 'bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 disabled:bg-slate-700'}`}
                                >
                                    {usdtSolSaved ? <Check size={16} /> : 'Save'}
                                </button>
                            )}
                        </div>
                        {!isUsdtSolValid && usdtSolAddress && isEditingUsdtSol && (
                            <div className="flex items-center gap-1 mt-1 text-[10px] text-rose-400 font-medium">
                                <AlertCircle size={10} /> Invalid Solana address format
                            </div>
                        )}
                    </div>

                    {/* Rollover Toggle */}
                    <div className="p-4 flex items-center justify-between">
                        <div>
                            <div className="text-sm font-medium text-white">Rollover Profits</div>
                            <div className="text-[10px] text-slate-400">Reinvest quarterly profits automatically</div>
                        </div>
                        <button 
                            onClick={toggleRollover}
                            className={`w-12 h-6 rounded-full transition-colors relative ${isRollover ? 'bg-emerald-500' : 'bg-slate-600'}`}
                        >
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isRollover ? 'left-7' : 'left-1'}`}></div>
                        </button>
                    </div>
                </div>

                <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-bold text-slate-400 uppercase">Request Withdrawal</label>
                        <span className={`text-[10px] font-bold font-mono ${isOverBalance ? 'text-rose-400' : 'text-emerald-400'}`}>
                            Available: ${investedCapital.toLocaleString()}
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <input 
                            type="number"
                            value={withdrawAmountInput}
                            onChange={(e) => setWithdrawAmountInput(e.target.value)}
                            placeholder="Amount"
                            className={`flex-1 bg-slate-900 text-white rounded-lg px-4 py-3 text-sm font-bold outline-none border ${isOverBalance ? 'border-rose-400 bg-rose-900/20' : 'border-transparent focus:border-emerald-400'}`}
                        />
                        <button 
                            onClick={handleWithdraw}
                            disabled={!canWithdraw}
                            className={`px-6 rounded-lg text-sm font-bold disabled:opacity-50 transition-colors ${isOverBalance ? 'bg-rose-500 text-white' : 'bg-sky-600 hover:bg-sky-500 text-white disabled:bg-slate-700'}`}
                        >
                            {isOverBalance ? 'Exceeds' : withdrawStatus === 'PROCESSING' ? '...' : withdrawStatus === 'SUCCESS' ? 'Sent' : 'Withdraw'}
                        </button>
                    </div>
                    {isOverBalance && (
                         <p className="text-[10px] text-rose-400 mt-2 font-medium">Amount exceeds available invested balance.</p>
                    )}
                    {!isOverBalance && (
                         <p className="text-[10px] text-slate-400 mt-2">Withdrawals processed within 3-5 business days via USDT (SOL).</p>
                    )}
                </div>
            </div>
        )}

        {/* App Settings */}
        <div>
            <SectionHeader title="Preferences" />
            <div className={`rounded-xl overflow-hidden shadow-sm ${'bg-slate-800'}`}>
                <ListItem 
                    icon={Bell} 
                    label="Notifications" 
                    rightElement={
                        <button 
                            onClick={toggleNotifications}
                            className={`w-10 h-5 rounded-full transition-colors relative ${notificationsEnabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
                        >
                            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${notificationsEnabled ? 'left-5' : 'left-1'}`}></div>
                        </button>
                    }
                />
                <ListItem 
                    icon={Moon} 
                    label="Dark Mode" 
                    rightElement={
                        <button 
                            onClick={toggleDarkMode}
                            className={`w-10 h-5 rounded-full transition-colors relative ${darkModeEnabled ? 'bg-emerald-500' : 'bg-slate-600'}`}
                        >
                            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${darkModeEnabled ? 'left-5' : 'left-1'}`}></div>
                        </button>
                    }
                />
            </div>
        </div>

        {/* Danger Zone */}
        <div>
            <div className={`rounded-xl overflow-hidden shadow-sm ${'bg-slate-800'}`}>
                <ListItem icon={LogOut} label="Log Out" isDestructive onClick={() => signOut(auth)} />
            </div>
        </div>
        
        <p className="text-center text-[10px] text-slate-400 mt-8">Baboon Dash Mobile v2.5.0</p>
    </div>
  );
};
