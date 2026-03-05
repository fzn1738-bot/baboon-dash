import React, { useState, useEffect } from 'react';
import { UserRole, User } from '../types';
import { Wallet, DollarSign, TrendingUp, CheckCircle, Clock, Download, Plus, X, UserPlus } from 'lucide-react';

interface UsersProps {
  userRole: UserRole;
}

export const Users: React.FC<UsersProps> = ({ userRole }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  
  // New User Form State
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newInvested, setNewInvested] = useState('');
  const [newRollover, setNewRollover] = useState(false);

  // Load users from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('baboon_users');
    if (stored) {
      setUsers(JSON.parse(stored));
    }
  }, []);

  if (userRole !== 'ADMIN') return null;

  const handleExport = () => {
    // Define CSV headers
    const headers = ['ID', 'Name', 'Email', 'LTC Address', 'Total Invested', 'Fees Paid YTD', 'Profits Paid Total', 'Last Quarter Payout', 'Rollover Enabled'];
    
    // Map user data to CSV rows
    const rows = users.map(user => [
      user.id,
      user.name,
      user.email,
      user.ltcAddress,
      user.totalInvested,
      user.feesPaidYTD,
      user.profitsPaidTotal,
      user.lastQuarterPayout,
      user.rolloverEnabled ? 'Yes' : 'No'
    ]);

    // Combine headers and rows
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `baboon_users_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleAddUser = () => {
    if (!newName || !newEmail) return;

    const newUser: User = {
      id: Date.now().toString(),
      name: newName,
      email: newEmail.trim().toLowerCase(),
      ltcAddress: 'Pending',
      totalInvested: parseFloat(newInvested) || 0,
      feesPaidYTD: 0,
      profitsPaidTotal: 0,
      lastQuarterPayout: 0,
      rolloverEnabled: newRollover
    };

    const updatedUsers = [...users, newUser];
    setUsers(updatedUsers);
    localStorage.setItem('baboon_users', JSON.stringify(updatedUsers));
    
    // Reset and Close
    setNewName('');
    setNewEmail('');
    setNewInvested('');
    setNewRollover(false);
    setShowAddModal(false);
  };

  return (
    <div className="space-y-6 pb-20 animate-fade-in relative">
       {/* Header Actions */}
       <div className="flex items-center justify-between px-4 md:px-0">
           <div className="flex items-center gap-3">
               <h2 className="text-2xl font-bold text-white">User Registry</h2>
               <span className="bg-slate-800 text-slate-400 text-xs font-bold px-3 py-1 rounded-full border border-slate-700">
                 {users.length} Active
               </span>
           </div>
           
           <div className="flex gap-2">
                <button 
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-lg shadow-sky-500/20 active:scale-95"
                >
                    <Plus size={14} />
                    Add User
                </button>
               <button 
                 onClick={handleExport}
                 className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold px-4 py-2 rounded-xl transition-all border border-slate-700 active:scale-95"
               >
                 <Download size={14} />
               </button>
           </div>
       </div>

       {/* User List */}
       <div className="space-y-4">
           {users.map((user) => (
               <div key={user.id} className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden shadow-sm">
                   {/* Header */}
                   <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
                       <div className="flex items-center gap-3">
                           <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-slate-300">
                               {user.name.substring(0, 2).toUpperCase()}
                           </div>
                           <div>
                               <div className="text-sm font-bold text-white">{user.name}</div>
                               <div className="text-[10px] text-slate-500">{user.email}</div>
                           </div>
                       </div>
                       {user.rolloverEnabled ? (
                           <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20">
                               <TrendingUp size={12} /> Rollover
                           </span>
                       ) : (
                           <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-700/50 px-2 py-1 rounded-lg border border-slate-600">
                               <Wallet size={12} /> Payout
                           </span>
                       )}
                   </div>

                   {/* Stats Grid */}
                   <div className="grid grid-cols-2 gap-px bg-slate-700/50">
                       <div className="bg-slate-800 p-4">
                           <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Total Invested</div>
                           <div className="text-white font-mono font-bold">${user.totalInvested.toLocaleString()}</div>
                       </div>
                       <div className="bg-slate-800 p-4">
                           <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">LTC Address</div>
                           <div className="text-slate-300 font-mono text-xs truncate max-w-[100px]">{user.ltcAddress}</div>
                       </div>
                       <div className="bg-slate-800 p-4">
                           <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Fees Paid (YTD)</div>
                           <div className="text-purple-400 font-mono font-bold">${user.feesPaidYTD.toLocaleString()}</div>
                       </div>
                       <div className="bg-slate-800 p-4">
                           <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Total Profits</div>
                           <div className="text-emerald-400 font-mono font-bold">${user.profitsPaidTotal.toLocaleString()}</div>
                       </div>
                   </div>
                   
                   <div className="bg-slate-900/50 p-3 flex justify-between items-center text-xs">
                        <span className="text-slate-500">Last Payout (Q2)</span>
                        <span className="font-mono font-bold text-white">${user.lastQuarterPayout.toLocaleString()}</span>
                   </div>
               </div>
           ))}
       </div>

       {/* Add User Modal */}
       {showAddModal && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-800 w-full max-w-md rounded-2xl border border-slate-700 shadow-2xl overflow-hidden animate-fade-in-up">
                <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <UserPlus size={20} className="text-sky-400" /> Add New User
                    </h3>
                    <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white">
                        <X size={20} />
                    </button>
                </div>
                
                <div className="p-6 space-y-4">
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-1.5 block">Full Name</label>
                        <input 
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500"
                            placeholder="e.g. John Doe"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-1.5 block">Email Address (Login ID)</label>
                        <input 
                            type="email"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500"
                            placeholder="e.g. john@example.com"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-1.5 block">Initial Investment ($)</label>
                        <input 
                            type="number"
                            value={newInvested}
                            onChange={(e) => setNewInvested(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500 font-mono"
                            placeholder="0"
                        />
                    </div>
                    <div className="flex items-center gap-3 pt-2">
                        <button 
                            onClick={() => setNewRollover(!newRollover)}
                            className={`w-12 h-6 rounded-full transition-colors relative ${newRollover ? 'bg-emerald-500' : 'bg-slate-600'}`}
                        >
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${newRollover ? 'left-7' : 'left-1'}`}></div>
                        </button>
                        <span className="text-sm font-medium text-slate-300">Enable Profit Rollover</span>
                    </div>
                </div>

                <div className="p-4 bg-slate-900/50 border-t border-slate-700 flex gap-3">
                    <button 
                        onClick={() => setShowAddModal(false)}
                        className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleAddUser}
                        disabled={!newName || !newEmail}
                        className="flex-1 py-3 rounded-xl font-bold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        Create User
                    </button>
                </div>
            </div>
         </div>
       )}
    </div>
  );
};