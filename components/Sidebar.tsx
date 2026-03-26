import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Settings, LineChart, ShieldCheck, Briefcase, Calculator, Users } from 'lucide-react';
import { AppView, NavItem, UserRole } from '../types';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

interface SidebarProps {
  currentView: AppView;
  onChangeView: (view: AppView) => void;
  isOpen: boolean; 
  setIsOpen: (isOpen: boolean) => void; 
  userRole: UserRole;
  onToggleRole: () => void;
  canSwitchRole: boolean;
}

// --- Mobile Bottom Navigation ---
const MobileNav = ({ navItems, currentView, onChangeView, canSwitchRole, onToggleRole, userRole }: any) => (
  <div className={`md:hidden fixed bottom-0 left-0 right-0 z-50 px-6 py-3 border-t flex justify-between items-end pb-safe transition-all duration-300 ${'bg-slate-900/90 backdrop-blur-lg border-slate-800 shadow-[0_-4px_20px_rgba(0,0,0,0.2)]'}`}>
    {navItems.map((item: any) => (
      <button
        key={item.id}
        onClick={() => onChangeView(item.id)}
        className={`flex flex-col items-center gap-1.5 transition-all duration-300 ${
          currentView === item.id 
            ? ('text-sky-400 -translate-y-1') 
            : 'text-slate-400 hover:text-slate-500'
        }`}
      >
        {/* Clone icon to adjust size/stroke if needed */}
        <div className="relative">
          {React.cloneElement(item.icon as any, { 
            size: 24, 
            strokeWidth: currentView === item.id ? 2.5 : 2,
            className: currentView === item.id ? 'animate-pulse-once' : ''
          })}
          {item.badge && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-slate-900"></span>}
        </div>
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
const DesktopSidebar = ({ navItems, currentView, onChangeView, userRole, canSwitchRole, onToggleRole }: any) => (
  <div className={`
    hidden md:flex w-64 border-r h-full flex-col
    ${'bg-slate-900 border-slate-800'}
  `}>
    <div className={`p-8 border-b ${'border-slate-800'}`}>
      <div className="flex items-center gap-3 mb-1">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xl text-slate-900 shadow-lg ${'bg-gradient-to-br from-sky-400 to-sky-600 shadow-sky-500/20'}`}>
          B
        </div>
        <div>
          <h1 className={`text-xl font-bold tracking-tight ${'text-white'}`}>Baboon Dash</h1>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
            {userRole === 'ADMIN' ? 'Admin Console' : 'Investor View'}
          </p>
        </div>
      </div>
    </div>

    <nav className="flex-1 p-4 space-y-2 mt-4">
      {navItems.map((item: any) => (
        <button
          key={item.id}
          onClick={() => onChangeView(item.id)}
          className={`
            w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all duration-200 group
            ${currentView === item.id 
              ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20 shadow-sm'
              : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }
          `}
        >
          <span className={`relative ${currentView === item.id ? 'scale-110 transition-transform' : ''}`}>
             {item.icon}
             {item.badge && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-slate-900"></span>}
          </span>
          <span className="flex-1 text-left font-bold">{item.label}</span>
        </button>
      ))}
    </nav>

    {canSwitchRole && (
      <div className={`p-6 border-t ${'border-slate-800'}`}>
        <div className={`${'bg-slate-800'} rounded-2xl p-4 shadow-inner`}>
          <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-3 text-center">Admin Controls</p>
          <div className={`flex rounded-xl p-1 border ${'bg-slate-900 border-slate-700'}`}>
            <button
              onClick={userRole === 'ADMIN' ? onToggleRole : undefined}
              className={`flex-1 flex items-center justify-center py-2.5 rounded-lg text-xs font-bold transition-all ${
                userRole === 'INVESTOR'
                  ? 'bg-emerald-400 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Briefcase size={14} className="mr-1.5" /> Investor
            </button>
            <button
              onClick={userRole === 'INVESTOR' ? onToggleRole : undefined}
              className={`flex-1 flex items-center justify-center py-2.5 rounded-lg text-xs font-bold transition-all ${
                userRole === 'ADMIN'
                  ? 'bg-sky-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShieldCheck size={14} className="mr-1.5" /> Admin
            </button>
          </div>
        </div>
      </div>
    )}
    
    {!canSwitchRole && (
        <div className={`p-6 border-t ${'border-slate-800'}`}>
          <p className="text-[10px] text-slate-400 text-center font-mono">v2.4.0 (Mobile Build)</p>
        </div>
    )}
  </div>
);

export const Sidebar: React.FC<SidebarProps> = ({ 
  currentView, 
  onChangeView, 
  userRole,
  onToggleRole,
  canSwitchRole
}) => {
  const isInvestor = userRole === 'INVESTOR';
  const [alertsCount, setAlertsCount] = useState(0);
  const displayAlertsCount = userRole === 'ADMIN' ? alertsCount : 0;

  useEffect(() => {
    if (userRole !== 'ADMIN') {
      return;
    }

    let pendingDeposits = 0;
    let pendingRequests = 0;

    const updateCount = () => setAlertsCount(pendingDeposits + pendingRequests);

    const usersUnsub = onSnapshot(collection(db, 'users'), (snapshot) => {
      pendingDeposits = snapshot.docs.filter(doc => (doc.data().pendingInvested || 0) > 0).length;
      updateCount();
    }, (error) => {
      console.error("Sidebar users listener error:", error);
    });

    const requestsUnsub = onSnapshot(collection(db, 'access_requests'), (snapshot) => {
      pendingRequests = snapshot.docs.filter(doc => doc.data().status === 'PENDING').length;
      updateCount();
    }, (error) => {
      console.error("Sidebar requests listener error:", error);
    });

    return () => {
      if (usersUnsub) usersUnsub();
      if (requestsUnsub) requestsUnsub();
    };
  }, [userRole]);

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
        { id: AppView.USERS, label: 'Users', icon: <Users size={24} />, badge: displayAlertsCount > 0 },
        { id: AppView.SETTINGS, label: 'Settings', icon: <Settings size={24} /> },
      ];

  return (
    <>
      <MobileNav 
        navItems={navItems} 
        currentView={currentView} 
        onChangeView={onChangeView} 
        canSwitchRole={canSwitchRole} 
        onToggleRole={onToggleRole} 
        userRole={userRole} 
      />
      <DesktopSidebar 
        navItems={navItems} 
        currentView={currentView} 
        onChangeView={onChangeView} 
        userRole={userRole} 
        canSwitchRole={canSwitchRole} 
        onToggleRole={onToggleRole} 
      />
    </>
  );
};