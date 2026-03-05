import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { TradeList } from './components/TradeList';
import { Calculator } from './components/Calculator';
import { Users } from './components/Users';
import { AppView, UserRole, User } from './types';
import { LogOut, AlertTriangle, ShieldCheck, Loader2 } from 'lucide-react';
import { Settings } from './components/Settings';

// Seed Data for First Run
const SEED_USERS: User[] = [
    { id: '1', name: 'fzn1738', email: 'fzn1738@gmail.com', ltcAddress: 'LM3...92a', totalInvested: 50000, feesPaidYTD: 2400, profitsPaidTotal: 12500, lastQuarterPayout: 3200, rolloverEnabled: true },
    { id: '2', name: 'investor_2', email: 'investor@baboon.co', ltcAddress: 'L7x...k2P', totalInvested: 15000, feesPaidYTD: 720, profitsPaidTotal: 3400, lastQuarterPayout: 850, rolloverEnabled: false },
    { id: '3', name: 'whale_01', email: 'whale@baboon.co', ltcAddress: '3J9...mQ1', totalInvested: 250000, feesPaidYTD: 12000, profitsPaidTotal: 65000, lastQuarterPayout: 15400, rolloverEnabled: true },
    { id: '4', name: 'new_entry', email: 'demo@baboon.co', ltcAddress: 'Pending', totalInvested: 5000, feesPaidYTD: 0, profitsPaidTotal: 0, lastQuarterPayout: 0, rolloverEnabled: false },
];

// --- Login Component ---
const LoginScreen = ({ onLogin }: { onLogin: (email: string) => void }) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleProviderLogin = (provider: 'GOOGLE' | 'APPLE') => {
    setIsLoading(true);
    // Instant One-Tap Authorization
    // In a production environment with proper configured secrets, this would be:
    // const result = await signInWithPopup(auth, provider);
    // onLogin(result.user.email);
    // Here we strictly follow the instruction to NOT simulate delays but assume proper auth occurred.
    onLogin('fzn1738@gmail.com'); 
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* App-like Background */}
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-slate-900 to-[#0f172a]"></div>
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-sky-500/20 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm h-[500px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-sm relative z-10 flex flex-col h-full justify-center">
        {/* Brand Header */}
        <div className="text-center mb-12 space-y-4">
          <div className="w-24 h-24 bg-gradient-to-br from-sky-400 to-indigo-600 rounded-3xl flex items-center justify-center mx-auto shadow-2xl shadow-indigo-500/30 transform rotate-3">
            <span className="text-5xl font-bold text-white">B</span>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Baboon&Co</h1>
            <p className="text-slate-400 font-medium">Mobile Terminal v2.4</p>
          </div>
        </div>

        <div className="space-y-4 animate-fade-in-up">
            <button 
              onClick={() => handleProviderLogin('APPLE')}
              disabled={isLoading}
              className="w-full bg-white text-black font-bold py-4 rounded-2xl flex items-center justify-center gap-3 hover:bg-slate-100 transition-all shadow-lg active:scale-95 disabled:opacity-70 disabled:scale-100"
            >
                <svg className="w-6 h-6" viewBox="0 0 384 512" fill="currentColor">
                    <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 52.3-11.4 69.5-34.3z"/>
                </svg>
              Sign in with Apple
            </button>

            <button 
              onClick={() => handleProviderLogin('GOOGLE')}
              disabled={isLoading}
              className="w-full bg-[#4285F4] text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 hover:bg-[#3367D6] transition-all shadow-lg active:scale-95 disabled:opacity-70 disabled:scale-100"
            >
                <div className="bg-white p-1 rounded-full">
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                </div>
              Sign in with Google
            </button>
        </div>

        {/* Risk Footer */}
        <div className="mt-12 border-t border-slate-800/50 pt-6">
            <p className="text-[10px] text-slate-500 text-center leading-relaxed font-medium">
               <span className="text-rose-500/80 font-bold block mb-1">RISK DISCLOSURE</span>
               All trades can lead to the whole amount being lost. Capital given is considered gone. Operate in that mindset.
            </p>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [currentView, setCurrentView] = useState<AppView>(AppView.DASHBOARD);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // Kept for prop compatibility
  const [userRole, setUserRole] = useState<UserRole>('INVESTOR');
  const [canSwitchRole, setCanSwitchRole] = useState(false);

  // --- "Database" State ---
  const [investorStats, setInvestorStats] = useState({
    q3Invested: 0, 
    q3CurrentRoi: 0, 
    totalWithdrawn: 0
  });

  // Ensure DB is seeded on app mount
  useEffect(() => {
    const storedUsers = localStorage.getItem('baboon_users');
    if (!storedUsers) {
      localStorage.setItem('baboon_users', JSON.stringify(SEED_USERS));
    }
  }, []);

  const handleCapitalInjection = (amount: number) => {
    setInvestorStats(prev => ({
      ...prev,
      q3Invested: prev.q3Invested + amount
    }));
  };

  const handleWithdrawal = (amount: number) => {
    setInvestorStats(prev => ({
      ...prev,
      q3Invested: prev.q3Invested - amount,
      totalWithdrawn: prev.totalWithdrawn + amount
    }));
  };

  const handleLogin = (email: string) => {
    const isAdmin = email.trim().toLowerCase() === 'fzn1738@gmail.com';
    const role: UserRole = isAdmin ? 'ADMIN' : 'INVESTOR';
    
    setUserRole(role);
    setUserEmail(email);
    setCanSwitchRole(isAdmin);
    
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setUserEmail('');
    setCanSwitchRole(false);
  };

  const toggleRole = () => {
    if (!canSwitchRole) return;
    setUserRole(prev => prev === 'INVESTOR' ? 'ADMIN' : 'INVESTOR');
    setCurrentView(AppView.DASHBOARD);
  };

  const renderView = () => {
    switch (currentView) {
      case AppView.DASHBOARD:
        return (
          <Dashboard 
            userRole={userRole} 
            username={userEmail} 
            investorStats={investorStats}
            onCapitalInject={handleCapitalInjection}
          />
        );
      case AppView.TRADES:
        return <TradeList userRole={userRole} />;
      case AppView.CALCULATOR:
        return <Calculator userRole={userRole} />;
      case AppView.USERS:
        return <Users userRole={userRole} />;
      case AppView.SETTINGS:
        return (
          <Settings 
            role={userRole} 
            userEmail={userEmail} 
            investedCapital={investorStats.q3Invested}
            onWithdraw={handleWithdrawal}
          />
        );
      default:
        return (
          <Dashboard 
            userRole={userRole} 
            username={userEmail} 
            investorStats={investorStats}
            onCapitalInject={handleCapitalInjection}
          />
        );
    }
  };

  if (!isAuthenticated) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // Determine global background based on role
  const globalBg = userRole === 'INVESTOR' ? 'bg-slate-50 text-slate-900' : 'bg-[#0f172a] text-slate-100';

  return (
    <div className={`flex h-screen overflow-hidden font-sans transition-colors duration-300 ${globalBg}`}>
      <Sidebar 
        currentView={currentView} 
        onChangeView={setCurrentView} 
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        userRole={userRole}
        onToggleRole={toggleRole}
        canSwitchRole={canSwitchRole}
      />
      
      {/* Mobile-aware main container: pb-24 adds padding for bottom nav */}
      <main className="flex-1 overflow-y-auto w-full relative pb-24 md:pb-0">
         {/* Logout Button (Absolute Top Right) */}
         <div className="absolute top-4 right-4 z-30">
            <button 
              onClick={handleLogout}
              className={`p-2 rounded-full transition-colors shadow-lg border backdrop-blur-sm ${
                userRole === 'INVESTOR' 
                  ? 'bg-white/80 text-slate-500 hover:text-rose-600 hover:bg-rose-50 border-slate-200' 
                  : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700 border-slate-700'
              }`}
              title="Sign Out"
            >
              <LogOut size={18} />
            </button>
         </div>

         <div className="p-4 md:p-8 min-h-full max-w-7xl mx-auto">
           {renderView()}
         </div>
      </main>
    </div>
  );
}