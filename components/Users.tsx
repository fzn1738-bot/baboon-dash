import React, { useState, useEffect } from 'react';
import { UserRole, User, AccessRequest, WithdrawalRequest } from '../types';
import { Wallet, DollarSign, TrendingUp, CheckCircle, Download, Plus, X, UserPlus, Mail, Trash2, Edit2 } from 'lucide-react';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { handleFirestoreError, OperationType } from '../utils/firestore-errors';
import { sendEmail } from '../utils/email';

interface UsersProps {
  userRole: UserRole;
}

const MAX_TOTAL_INVESTED = 10_000;

export const Users: React.FC<UsersProps> = ({ userRole }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [userToEdit, setUserToEdit] = useState<User | null>(null);
  
  // New User Form State
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newInvested, setNewInvested] = useState('');
  const [newRollover, setNewRollover] = useState(false);
  const [approvalEmailLog, setApprovalEmailLog] = useState<Record<string, string>>({});
  const [emailDebugLogs, setEmailDebugLogs] = useState<any[]>([]);

  useEffect(() => {
    if (userRole !== 'ADMIN') return;

    const unsubscribeUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
        const usersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
        setUsers(usersData);
    }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users');
    });

    const unsubscribeRequests = onSnapshot(collection(db, 'access_requests'), (snapshot) => {
        const requestsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AccessRequest));
        setRequests(requestsData);
    }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'access_requests');
    });

    const unsubscribeWithdrawals = onSnapshot(collection(db, 'withdrawals'), (snapshot) => {
        const withdrawalsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WithdrawalRequest));
        setWithdrawals(withdrawalsData);
    }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'withdrawals');
    });

    const emailLogsQuery = query(collection(db, 'email_logs'), orderBy('sentAt', 'desc'), limit(100));
    const unsubscribeEmailLogs = onSnapshot(emailLogsQuery, (snapshot) => {
      const logs = snapshot.docs.map((emailDoc) => ({ id: emailDoc.id, ...emailDoc.data() }));
      setEmailDebugLogs(logs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'email_logs');
    });

    return () => {
        unsubscribeUsers();
        unsubscribeRequests();
        unsubscribeWithdrawals();
        unsubscribeEmailLogs();
    };
  }, [userRole]);

  if (userRole !== 'ADMIN') return null;

  const pendingRequests = requests.filter(r => r.status === 'PENDING');
  const pendingDeposits = users.filter(u => (u.pendingInvested || 0) > 0);
  const pendingWithdrawals = withdrawals.filter(w => w.status === 'PENDING');

  const handleGrantAccess = (req: AccessRequest) => {
      setNewEmail(req.email);
      setApprovingRequestId(req.id);
      setShowAddModal(true);
  };

  const handleDenyAccess = async (req: AccessRequest) => {
      try {
          await setDoc(doc(db, 'access_requests', req.id), { status: 'DENIED' }, { merge: true });
          await sendEmail(
            req.email,
            'Access Request Update - Baboon Dashboard',
            `<p>Hi there,</p><p>We regret to inform you that your request to access the Baboon Dashboard has been declined at this time.</p>`
          ).catch(console.error);
      } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `access_requests/${req.id}`);
      }
  };

  const handleConfirmDeposit = async (user: User) => {
      try {
          const currentTotal = user.totalInvested || 0;
          const currentPending = user.pendingInvested || 0;
          const remainingCapacity = Math.max(0, MAX_TOTAL_INVESTED - currentTotal);
          const acceptedPending = Math.min(currentPending, remainingCapacity);
          await setDoc(doc(db, 'users', user.id), { 
              totalInvested: currentTotal + acceptedPending,
              pendingInvested: Math.max(0, currentPending - acceptedPending)
          }, { merge: true });
      } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${user.id}`);
      }
  };

  const handleDenyDeposit = async (user: User) => {
      try {
          await setDoc(doc(db, 'users', user.id), { pendingInvested: 0 }, { merge: true });
      } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${user.id}`);
      }
  };

  const handleConfirmWithdrawal = async (withdrawal: WithdrawalRequest) => {
      try {
          const user = users.find(u => u.id === withdrawal.userId);
          if (user) {
              await setDoc(doc(db, 'users', user.id), { 
                  totalInvested: (user.totalInvested || 0) - withdrawal.amount 
              }, { merge: true });
          }
          await setDoc(doc(db, 'withdrawals', withdrawal.id), { status: 'APPROVED' }, { merge: true });
      } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `withdrawals/${withdrawal.id}`);
      }
  };

  const handleDenyWithdrawal = async (withdrawalId: string) => {
      try {
          await setDoc(doc(db, 'withdrawals', withdrawalId), { status: 'DENIED' }, { merge: true });
      } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `withdrawals/${withdrawalId}`);
      }
  };

  const handleExport = () => {
    const headers = ['ID', 'Name', 'Email', 'Solana Address', 'Total Invested', 'Pending Invested', 'Fees Paid YTD', 'Profits Paid Total', 'Quarter Payout Due', 'Rollover Enabled'];
    const rows = users.map(user => [
      user.id, user.name, user.email, user.usdtSolAddress || user.ltcAddress || '', user.totalInvested,
      user.pendingInvested || 0, user.feesPaidYTD, user.profitsPaidTotal, user.lastQuarterPayout, user.rolloverEnabled ? 'Yes' : 'No'
    ]);
    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `baboon_users_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.click();
  };

  const handleAddUser = async () => {
    if (!newName || !newEmail) return;
    const safeInvested = Math.min(MAX_TOTAL_INVESTED, Math.max(0, parseFloat(newInvested) || 0));
    const newUser: User = {
      id: Date.now().toString(),
      name: newName,
      email: newEmail.trim().toLowerCase(),
      usdtSolAddress: 'Pending',
      totalInvested: safeInvested,
      pendingInvested: 0,
      feesPaidYTD: 0,
      profitsPaidTotal: 0,
      lastQuarterPayout: 0,
      rolloverEnabled: newRollover,
      accountConfirmed: false
    };

    try {
        await setDoc(doc(db, 'users', newUser.id), newUser);
        if (approvingRequestId) {
            await setDoc(doc(db, 'access_requests', approvingRequestId), { status: 'APPROVED' }, { merge: true });
            const sentAt = await sendApprovalEmail(newUser.email, newUser.name);
            setApprovalEmailLog((prev) => ({ ...prev, [newUser.id]: sentAt }));
        }
        closeAddModal();
    } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'users');
    }
  };

  const closeAddModal = () => {
      setNewName(''); setNewEmail(''); setNewInvested(''); setNewRollover(false);
      setApprovingRequestId(null); setShowAddModal(false);
  };

  const handleEditClick = (user: User) => {
      setUserToEdit(user);
      setNewName(user.name || '');
      setNewEmail(user.email || '');
      setNewInvested((user.totalInvested || 0).toString());
      setNewRollover(user.rolloverEnabled || false);
      setShowEditModal(true);
  };

  const handleUpdateUser = async () => {
      if (!userToEdit || !newName || !newEmail) return;
      try {
          await setDoc(doc(db, 'users', userToEdit.id), {
              name: newName, email: newEmail.trim().toLowerCase(),
              totalInvested: Math.min(MAX_TOTAL_INVESTED, Math.max(0, parseFloat(newInvested) || 0)),
              rolloverEnabled: newRollover
          }, { merge: true });
          closeEditModal();
      } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${userToEdit.id}`);
      }
  };

  const closeEditModal = () => {
      setUserToEdit(null); setNewName(''); setNewEmail(''); setNewInvested('');
      setNewRollover(false); setShowEditModal(false);
  };

  const confirmDeleteUser = async () => {
    if (userToDelete) {
      try {
          await deleteDoc(doc(db, 'users', userToDelete));
          setUserToDelete(null);
      } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `users/${userToDelete}`);
      }
    }
  };

  const handleResendApprovalEmail = async (user: User) => {
    try {
      const sentAt = await sendApprovalEmail(user.email, user.name);
      setApprovalEmailLog((prev) => ({ ...prev, [user.id]: sentAt }));
    } catch (error) {
      console.error('Failed to resend approval email:', error);
    }
  };

  const sendApprovalEmail = async (email: string, name?: string) => {
    await sendEmail(
      email,
      'Access Request Approved - Baboon Dashboard',
      `<p>Hi ${name || 'there'},</p><p>Great news! Your account has been approved.</p><p>You can now access the trading dashboard at: <a href="https://tinyurl.com/baboon-dash">https://tinyurl.com/baboon-dash</a></p>`
    );
    return new Date().toISOString();
  };

  const handleNotifyPayoutSent = async (user: User) => {
    const payoutAmount = Number(user.lastQuarterPayout || 0);
    try {
      await sendEmail(
        user.email,
        'Payout Sent - Baboon Dashboard',
        `<p>Hi ${user.name || 'there'},</p><p>Your quarterly payout has been sent.</p><p><strong>Payout amount:</strong> $${payoutAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>`
      );
    } catch (error) {
      console.error('Failed to send payout notification:', error);
    }
  };

  const handleNotifyAllPayoutsSent = async () => {
    const targets = users.filter((u) => Number(u.lastQuarterPayout || 0) > 0);
    for (const user of targets) {
      await handleNotifyPayoutSent(user);
    }
  };

  return (
    <div className="space-y-6 pb-20 animate-fade-in relative">
       {/* Debug Log Section */}
       <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
         <div className="flex items-center justify-between mb-2">
           <h3 className="text-sm font-bold text-white">Email Debugger</h3>
           <span className="text-[10px] text-slate-500">Last {emailDebugLogs.length} sent emails</span>
         </div>
         <div className="max-h-56 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-2">
           {emailDebugLogs.length === 0 ? (
             <div className="text-xs text-slate-500 p-2">No email logs yet.</div>
           ) : (
             <div className="space-y-1">
               {emailDebugLogs.map((log) => (
                 <div key={log.id} className="text-xs border-b border-slate-800/80 pb-1">
                   <div className="flex items-center justify-between">
                     <div className="text-slate-200 font-medium">{log.subject || '(No subject)'}</div>
                     <span className={`text-[10px] font-bold ${log.status === 'FAILED' ? 'text-rose-400' : 'text-emerald-400'}`}>{log.status || 'SENT'}</span>
                   </div>
                   <div className="text-slate-400">To: {log.to || '-'}</div>
                   <div className="text-slate-500">{log.sentAt ? new Date(log.sentAt).toLocaleString() : '-'}</div>
                 </div>
               ))}
             </div>
           )}
         </div>
       </div>

       <div className="flex items-center justify-between px-4 md:px-0">
           <div className="flex items-center gap-3">
               <h2 className="text-2xl font-bold text-white">User Registry</h2>
               <span className="bg-slate-800 text-slate-400 text-xs font-bold px-3 py-1 rounded-full border border-slate-700">{users.length} Active</span>
           </div>
           <div className="flex gap-2">
                <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-lg active:scale-95"><Plus size={14} /> Add User</button>
               <button onClick={handleExport} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold px-4 py-2 rounded-xl transition-all border border-slate-700 active:scale-95"><Download size={14} /></button>
               <button onClick={handleNotifyAllPayoutsSent} className="flex items-center gap-2 bg-emerald-700/30 hover:bg-emerald-700/50 text-emerald-200 text-xs font-bold px-4 py-2 rounded-xl transition-all border border-emerald-500/30 active:scale-95">Notify Payouts Sent</button>
           </div>
       </div>

       {pendingRequests.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                    <UserPlus className="text-amber-400" />
                    <h3 className="text-lg font-bold text-amber-400">Pending Access Requests</h3>
                </div>
                <div className="grid gap-4">
                    {pendingRequests.map(req => (
                        <div key={req.id} className="bg-slate-900/50 rounded-xl p-4 flex items-center justify-between border border-slate-800">
                            <div>
                                <p className="text-white font-bold">{req.email}</p>
                                <p className="text-xs text-slate-500">Requested: {new Date(req.requestedAt).toLocaleDateString()}</p>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => handleDenyAccess(req)} className="p-2 text-rose-400 hover:bg-rose-400/10 rounded-lg transition-colors"><X size={18} /></button>
                                <button onClick={() => handleGrantAccess(req)} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"><CheckCircle size={16} /> Grant Access</button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
       )}

       {pendingDeposits.length > 0 && (
           <div className="bg-sky-500/10 border border-sky-500/20 rounded-2xl p-6">
               <div className="flex items-center gap-3 mb-4">
                   <DollarSign className="text-sky-400" />
                   <h3 className="text-lg font-bold text-sky-400">Pending Deposits</h3>
               </div>
               <div className="grid gap-4">
                   {pendingDeposits.map(user => (
                       <div key={user.id} className="bg-slate-900/50 rounded-xl p-4 flex items-center justify-between border border-slate-800">
                           <div>
                               <p className="text-white font-bold">{user.name}</p>
                               <p className="text-emerald-400 font-mono font-bold">${(user.pendingInvested || 0).toLocaleString()}</p>
                           </div>
                           <div className="flex gap-2">
                               <button onClick={() => handleDenyDeposit(user)} className="p-2 text-rose-400 hover:bg-rose-400/10 rounded-lg transition-colors"><X size={18} /></button>
                               <button onClick={() => handleConfirmDeposit(user)} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"><CheckCircle size={16} /> Confirm Deposit</button>
                           </div>
                       </div>
                   ))}
               </div>
           </div>
       )}

       {pendingWithdrawals.length > 0 && (
           <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-6">
               <div className="flex items-center gap-3 mb-4">
                   <Wallet className="text-rose-400" />
                   <h3 className="text-lg font-bold text-rose-400">Pending Withdrawals</h3>
               </div>
               <div className="grid gap-4">
                   {pendingWithdrawals.map(w => {
                       const user = users.find(u => u.id === w.userId);
                       return (
                           <div key={w.id} className="bg-slate-900/50 rounded-xl p-4 flex items-center justify-between border border-slate-800">
                               <div>
                                   <p className="text-white font-bold">{user?.name || 'Unknown User'}</p>
                                   <p className="text-rose-400 font-mono font-bold">${w.amount.toLocaleString()}</p>
                               </div>
                               <div className="flex gap-2">
                                   <button onClick={() => handleDenyWithdrawal(w.id)} className="p-2 text-rose-400 hover:bg-rose-400/10 rounded-lg transition-colors"><X size={18} /></button>
                                   <button onClick={() => handleConfirmWithdrawal(w)} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors"><CheckCircle size={16} /> Approve Withdrawal</button>
                               </div>
                           </div>
                       );
                   })}
               </div>
           </div>
       )}

       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {users.map(user => (
               <div key={user.id} className="group bg-slate-900/40 border border-slate-800 rounded-2xl p-6 hover:border-slate-600 transition-all shadow-lg relative overflow-hidden">
                   <div className="absolute top-0 right-0 p-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                       <button onClick={() => handleEditClick(user)} className="p-2 bg-slate-800 text-slate-400 hover:text-sky-400 rounded-lg border border-slate-700 transition-colors"><Edit2 size={14} /></button>
                       <button onClick={() => setUserToDelete(user.id)} className="p-2 bg-slate-800 text-slate-400 hover:text-rose-400 rounded-lg border border-slate-700 transition-colors"><Trash2 size={14} /></button>
                   </div>
                   
                   <div className="flex items-start justify-between mb-6">
                       <div className="flex items-center gap-4">
                           <div className="w-12 h-12 bg-sky-500/10 rounded-2xl flex items-center justify-center border border-sky-500/20">
                               <span className="text-sky-400 font-bold text-lg">{user.name?.[0]}</span>
                           </div>
                           <div>
                               <h3 className="text-white font-bold text-lg leading-tight">{user.name}</h3>
                               <p className="text-slate-500 text-sm font-medium">{user.email}</p>
                           </div>
                       </div>
                   </div>

                   <div className="grid grid-cols-2 gap-4 mb-6">
                       <div className="bg-slate-950/50 rounded-xl p-3 border border-slate-800/50">
                           <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Portfolio Value</p>
                           <p className="text-emerald-400 font-mono font-bold text-lg">${(user.totalInvested || 0).toLocaleString()}</p>
                       </div>
                       <div className="bg-slate-950/50 rounded-xl p-3 border border-slate-800/50">
                           <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Last Payout</p>
                           <p className="text-sky-400 font-mono font-bold text-lg">${(user.lastQuarterPayout || 0).toLocaleString()}</p>
                       </div>
                   </div>

                   <div className="space-y-3">
                       <div className="flex justify-between items-center text-sm">
                           <span className="text-slate-400 flex items-center gap-2"><TrendingUp size={14} /> Total Profits</span>
                           <span className="text-slate-200 font-mono font-bold">${(user.profitsPaidTotal || 0).toLocaleString()}</span>
                       </div>
                       <div className="flex justify-between items-center text-sm">
                           <span className="text-slate-400 flex items-center gap-2"><DollarSign size={14} /> Fees (YTD)</span>
                           <span className="text-slate-200 font-mono font-bold">${(user.feesPaidYTD || 0).toLocaleString()}</span>
                       </div>
                   </div>

                   <div className="mt-6 pt-6 border-t border-slate-800 flex items-center justify-between">
                        <div className="flex flex-col gap-1">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-fit ${user.rolloverEnabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-500 border border-slate-700'}`}>
                                {user.rolloverEnabled ? 'Rollover Active' : 'Manual Payout'}
                            </span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-fit ${user.accountConfirmed ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                                {user.accountConfirmed ? 'Verified Account' : 'Awaiting Setup'}
                            </span>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleResendApprovalEmail(user)}
                            className="p-1.5 bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors border border-slate-700 group/btn"
                            title="Resend Approval Email"
                          >
                            <Mail size={14} className="group-hover/btn:scale-110 transition-transform" />
                          </button>
                          <button 
                            onClick={() => handleNotifyPayoutSent(user)}
                            className="p-1.5 bg-emerald-900/30 text-emerald-400 hover:bg-emerald-800/40 rounded-lg transition-colors border border-emerald-500/20 group/btn"
                            title="Notify Payout Sent"
                          >
                            <DollarSign size={14} className="group-hover/btn:scale-110 transition-transform" />
                          </button>
                        </div>
                   </div>
                   {approvalEmailLog[user.id] && (
                       <div className="mt-2 text-[9px] text-emerald-400 font-bold bg-emerald-500/5 px-2 py-1 rounded text-center">
                           Confirmation email sent at {new Date(approvalEmailLog[user.id]).toLocaleTimeString()}
                       </div>
                   )}
               </div>
           ))}
       </div>

       {showAddModal && (
           <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
               <div className="bg-slate-900 w-full max-w-md rounded-2xl border border-slate-700 shadow-2xl overflow-hidden animate-fade-in-up">
                   <div className="p-6 border-b border-slate-700 flex justify-between items-center">
                       <h3 className="text-xl font-bold text-white">Add New User</h3>
                       <button onClick={closeAddModal} className="text-slate-400 hover:text-white transition-colors"><X size={20} /></button>
                   </div>
                   <div className="p-6 space-y-4">
                       <div className="space-y-1.5">
                           <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Full Name</label>
                           <input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500 transition-colors" placeholder="e.g. John Doe" />
                       </div>
                       <div className="space-y-1.5">
                           <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Email Address</label>
                           <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500 transition-colors" placeholder="user@example.com" />
                       </div>
                       <div className="space-y-1.5">
                           <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Initial Investment ($)</label>
                           <input type="number" value={newInvested} onChange={e => setNewInvested(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500 transition-colors" placeholder="0.00" />
                       </div>
                       <div className="flex items-center gap-3 p-4 bg-slate-950/50 rounded-xl border border-slate-800">
                           <input type="checkbox" id="rollover" checked={newRollover} onChange={e => setNewRollover(e.target.checked)} className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500" />
                           <label htmlFor="rollover" className="text-sm font-bold text-slate-300">Enable Profit Rollover</label>
                       </div>
                   </div>
                   <div className="p-6 bg-slate-900/50 border-t border-slate-700">
                       <button onClick={handleAddUser} disabled={!newName || !newEmail} className="w-full py-4 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-sky-500/20 active:scale-95">Complete Setup & Notify User</button>
                   </div>
               </div>
           </div>
       )}

       {showEditModal && userToEdit && (
           <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
               <div className="bg-slate-900 w-full max-w-md rounded-2xl border border-slate-700 shadow-2xl overflow-hidden animate-fade-in-up">
                   <div className="p-6 border-b border-slate-700 flex justify-between items-center">
                       <h3 className="text-xl font-bold text-white">Edit User Profile</h3>
                       <button onClick={closeEditModal} className="text-slate-400 hover:text-white transition-colors"><X size={20} /></button>
                   </div>
                   <div className="p-6 space-y-4">
                       <div className="space-y-1.5">
                           <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Full Name</label>
                           <input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500 transition-colors" />
                       </div>
                       <div className="space-y-1.5">
                           <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Email Address</label>
                           <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500 transition-colors" />
                       </div>
                       <div className="space-y-1.5">
                           <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Invested ($)</label>
                           <input type="number" value={newInvested} onChange={e => setNewInvested(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500 transition-colors" />
                       </div>
                       <div className="flex items-center gap-3 p-4 bg-slate-950/50 rounded-xl border border-slate-800">
                           <input type="checkbox" id="editRollover" checked={newRollover} onChange={e => setNewRollover(e.target.checked)} className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500" />
                           <label htmlFor="editRollover" className="text-sm font-bold text-slate-300">Enable Profit Rollover</label>
                       </div>
                   </div>
                   <div className="p-6 bg-slate-900/50 border-t border-slate-700">
                       <button onClick={handleUpdateUser} className="w-full py-4 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-sky-500/20 active:scale-95">Update Profile</button>
                   </div>
               </div>
           </div>
       )}

       {userToDelete && (
         <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 w-full max-w-sm rounded-2xl border border-slate-700 shadow-2xl overflow-hidden animate-fade-in-up">
                <div className="p-6 text-center space-y-4">
                    <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-2">
                        <Trash2 size={32} className="text-rose-500" />
                    </div>
                    <h3 className="text-xl font-bold text-white">Delete User?</h3>
                    <p className="text-sm text-slate-400">
                        Are you sure you want to delete this user? This action cannot be undone and will remove all their data from the registry.
                    </p>
                </div>
                <div className="p-4 bg-slate-900/50 border-t border-slate-700 flex gap-3">
                    <button 
                        onClick={() => setUserToDelete(null)}
                        className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={confirmDeleteUser}
                        className="flex-1 py-3 rounded-xl font-bold text-white bg-rose-600 hover:bg-rose-500 transition-colors shadow-lg shadow-rose-500/20"
                    >
                        Delete
                    </button>
                </div>
            </div>
         </div>
       )}
    </div>
  );
};
