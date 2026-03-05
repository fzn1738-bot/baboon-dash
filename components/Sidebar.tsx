import React from 'react';
import { LayoutDashboard, Settings, LineChart, ShieldCheck, Briefcase, Calculator, Users } from 'lucide-react';
import { AppView, NavItem, UserRole } from '../types';

interface SidebarProps {
  currentView: AppView;
  onChangeView: (view: AppView) => void;
  isOpen: boolean; 
  setIsOpen: (isOpen: boolean) => void; 
  userRole: UserRole;
  onToggleRole: () => void;
  canSwitchRole: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  currentView, 
  onChangeView, 
  userRole,
  onToggleRole,
  canSwitchRole
}) => {
  const isInvestor = userRole === 'INVESTOR';

  // Dynamic Nav Items based on Role
  const navItems: NavItem[] = isInvestor 
    ? [
        { id: AppView.DASHBOARD, label: 'Overview', icon: <LayoutDashboard size={24} /> },
        { id: AppView.TRADES, label: 'Performance', icon: <LineChart size={24} /> },
        { id: AppView.CALCULATOR, label: 'Calculator', icon: <Calculator size={24} /> },
        { id: AppView.SETTINGS, label: 'Settings', icon: <Settings size={24} /> },
      ]
    : [
        { id: AppView.DASHBOARD, label: 'Overview', icon: <LayoutDashboard size={24} /> },
        { id: AppView.TRADES, label: 'Performance', icon: <LineChart size={24} /> },
        { id: AppView.USERS, label: 'Users', icon: <Users size={24} /> },
        { id: AppView.SETTINGS, label: 'Settings', icon: <Settings size={24} /> },
      ];

  // --- Mobile Bottom Navigation ---
  const MobileNav = () => (
    <div className={`md:hidden fixed bottom-0 left-0 right-0 z-50 px-6 py-3 border-t flex justify-between items-end pb-safe transition-all duration-300 ${isInvestor ? 'bg-white/90 backdrop-blur-lg border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]' : 'bg-slate-900/90 backdrop-blur-lg border-slate-800 shadow-[0_-4px_20px_rgba(0,0,0,0.2)]'}`}>
      {navItems.map((item) => (
        <button
          key={item.id}
          onClick={() => onChangeView(item.id)}
          className={`flex flex-col items-center gap-1.5 transition-all duration-300 ${
            currentView === item.id 
              ? (isInvestor ? 'text-emerald-600 -translate-y-1' : 'text-sky-400 -translate-y-1') 
              : 'text-slate-400 hover:text-slate-500'
          }`}
        >
          {/* Clone icon to adjust size/stroke if needed */}
          {React.cloneElement(item.icon as any, { 
            size: 24, 
            strokeWidth: currentView === item.id ? 2.5 : 2,
            className: currentView === item.id ? 'animate-pulse-once' : ''
          })}
          <span className={`text-[10px] font-bold tracking-wide ${currentView === item.id ? 'opacity-100' : 'opacity-70'}`}>
            {item.label}
          </span>
        </button>
      ))}
      
      {/* Role Switcher in Mobile Nav if Admin */}
      {canSwitchRole && (
         <button
            onClick={onToggleRole}
            className={`flex flex-col items-center gap-1.5 transition-all duration-300 ${userRole === 'ADMIN' ? 'text-purple-400 -translate-y-1' : 'text-slate-400'}`}
         >
            {userRole === 'ADMIN' ? <ShieldCheck size={24} strokeWidth={2.5} /> : <Briefcase size={24} />}
            <span className="text-[10px] font-bold tracking-wide">{userRole === 'ADMIN' ? 'Admin' : 'Inv'}</span>
         </button>
      )}
    </div>
  );

  // --- Desktop Sidebar ---
  const DesktopSidebar = () => (
    <div className={`
      hidden md:flex w-64 border-r h-full flex-col
      ${isInvestor ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'}
    `}>
      <div className={`p-8 border-b ${isInvestor ? 'border-slate-100' : 'border-slate-800'}`}>
        <div className="flex items-center gap-3 mb-1">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xl text-slate-900 shadow-lg ${isInvestor ? 'bg-gradient-to-br from-emerald-300 to-emerald-500 shadow-emerald-500/20' : 'bg-gradient-to-br from-sky-400 to-sky-600 shadow-sky-500/20'}`}>
            B
          </div>
          <div>
            <h1 className={`text-xl font-bold tracking-tight ${isInvestor ? 'text-slate-900' : 'text-white'}`}>Baboon</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
              {isInvestor ? 'Investor Portal' : 'Admin Console'}
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2 mt-4">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onChangeView(item.id)}
            className={`
              w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all duration-200 group
              ${currentView === item.id 
                ? (isInvestor 
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm' 
                    : 'bg-sky-500/10 text-sky-400 border border-sky-500/20 shadow-sm')
                : (isInvestor 
                    ? 'text-slate-500 hover:bg-slate-50 hover:text-slate-900' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white')
              }
            `}
          >
            <span className={currentView === item.id ? 'scale-110 transition-transform' : ''}>{item.icon}</span>
            <span className="flex-1 text-left font-bold">{item.label}</span>
          </button>
        ))}
      </nav>

      {canSwitchRole && (
        <div className={`p-6 border-t ${isInvestor ? 'border-slate-200' : 'border-slate-800'}`}>
          <div className={`${isInvestor ? 'bg-slate-100' : 'bg-slate-800'} rounded-2xl p-4 shadow-inner`}>
            <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-3 text-center">Admin Controls</p>
            <div className={`flex rounded-xl p-1 border ${isInvestor ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-700'}`}>
              <button
                onClick={userRole === 'ADMIN' ? onToggleRole : undefined}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-lg text-xs font-bold transition-all ${
                  isInvestor 
                    ? 'bg-emerald-400 text-white shadow-md' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Briefcase size={14} className="mr-1.5" /> Investor
              </button>
              <button
                onClick={userRole === 'INVESTOR' ? onToggleRole : undefined}
                className={`flex-1 flex items-center justify-center py-2.5 rounded-lg text-xs font-bold transition-all ${
                  !isInvestor 
                    ? 'bg-sky-600 text-white shadow-md' 
                    : 'text-slate-400 hover:text-slate-800'
                }`}
              >
                <ShieldCheck size={14} className="mr-1.5" /> Admin
              </button>
            </div>
          </div>
        </div>
      )}
      
      {!canSwitchRole && (
          <div className={`p-6 border-t ${isInvestor ? 'border-slate-200' : 'border-slate-800'}`}>
            <p className="text-[10px] text-slate-400 text-center font-mono">v2.4.0 (Mobile Build)</p>
          </div>
      )}
    </div>
  );

  return (
    <>
      <MobileNav />
      <DesktopSidebar />
    </>
  );
};