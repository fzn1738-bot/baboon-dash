import React, { useState, useEffect } from 'react';
import { UserRole, User, AccessRequest, WithdrawalRequest, FAQItem } from '../types';
import { Wallet, DollarSign, TrendingUp, CheckCircle, Download, Plus, X, UserPlus, Mail, Trash2, Edit2, HelpCircle } from 'lucide-react';
import { collection, doc, setDoc, deleteDoc, onSnapshot, addDoc, updateDoc } from 'firebase/firestore';
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
  const [faqs, setFaqs] = useState<FAQItem[]>([]);
  const [faqQuestion, setFaqQuestion] = useState('');
  const [faqAnswer, setFaqAnswer] = useState('');
  const [editingFaqId, setEditingFaqId] = useState<string | null>(null);
  
  // New User Form State
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newInvested, setNewInvested] = useState('');
  const [newRollover, setNewRollover] = useState(false);

  // Load users and requests from Firestore on mount
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

    const unsubscribeFaqs = onSnapshot(collection(db, 'faqs'), (snapshot) => {
      const faqData = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as FAQItem))
        .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
      setFaqs(faqData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'faqs');
    });

    return () => {
        unsubscribeUsers();
        unsubscribeRequests();
        unsubscribeWithdrawals();
        unsubscribeFaqs();
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
            `<p>Hi there,</p><p>We regret to inform you that your request to access the Baboon Dashboard has been declined at this time.</p><p>If you believe this is a mistake, please contact the administrator.</p>`
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
          const newTotal = currentTotal + acceptedPending;
          await setDoc(doc(db, 'users', user.id), { 
              totalInvested: newTotal,
              pendingInvested: Math.max(0, currentPending - acceptedPending)
          }, { merge: true });
      } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${user.id}`);
      }
  };

  const handleDenyDeposit = async (user: User) => {
      try {
          await setDoc(doc(db, 'users', user.id), { 
              pendingInvested: 0 
          }, { merge: true });
      } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${user.id}`);
      }
  };

  const handleConfirmWithdrawal = async (withdrawal: WithdrawalRequest) => {
      try {
          const user = users.find(u => u.id === withdrawal.userId);
          if (user) {
              const newTotal = (user.totalInvested || 0) - withdrawal.amount;
              await setDoc(doc(db, 'users', user.id), { 
                  totalInvested: newTotal 
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
    // Define CSV headers
    const headers = ['ID', 'Name', 'Email', 'LTC Address', 'Total Invested', 'Pending Invested', 'Fees Paid YTD', 'Profits Paid Total', 'Last Quarter Payout', 'Rollover Enabled'];
    
    // Map user data to CSV rows
    const rows = users.map(user => [
      user.id,
      user.name,
      user.email,
      user.ltcAddress,
      user.totalInvested,
      user.pendingInvested || 0,
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

  const handleAddUser = async () => {
    if (!newName || !newEmail) return;
    const safeInvested = Math.min(MAX_TOTAL_INVESTED, Math.max(0, parseFloat(newInvested) || 0));

    const newUser: User = {
      id: Date.now().toString(),
      name: newName,
      email: newEmail.trim().toLowerCase(),
      ltcAddress: 'Pending',
      totalInvested: safeInvested,
      pendingInvested: 0,
      feesPaidYTD: 0,
      profitsPaidTotal: 0,
      lastQuarterPayout: 0,
      rolloverEnabled: newRollover
    };

    try {
        await setDoc(doc(db, 'users', newUser.id), newUser);
        
        // If approving a request, mark it as approved
        if (approvingRequestId) {
            await setDoc(doc(db, 'access_requests', approvingRequestId), { status: 'APPROVED' }, { merge: true });
            
            await sendEmail(
              newUser.email,
              'Access Request Approved - Baboon Dashboard',
              `<p>Hi ${newUser.name},</p>
               <p>Great news! Your request to access the Baboon Dashboard has been approved.</p>
               <p>You can now log in using your Google account at: <a href="https://tinyurl.com/baboon-dash">https://tinyurl.com/baboon-dash</a></p>
               <p>Welcome aboard!</p>`
            ).catch(console.error);
        }
        
        // Reset and Close
        setNewName('');
        setNewEmail('');
        setNewInvested('');
        setNewRollover(false);
        setApprovingRequestId(null);
        setShowAddModal(false);
    } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'users');
    }
  };

  const closeAddModal = () => {
      setNewName('');
      setNewEmail('');
      setNewInvested('');
      setNewRollover(false);
      setApprovingRequestId(null);
      setShowAddModal(false);
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
              name: newName,
              email: newEmail.trim().toLowerCase(),
              totalInvested: Math.min(MAX_TOTAL_INVESTED, Math.max(0, parseFloat(newInvested) || 0)),
              rolloverEnabled: newRollover
          }, { merge: true });
          
          closeEditModal();
      } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${userToEdit.id}`);
      }
  };

  const closeEditModal = () => {
      setUserToEdit(null);
      setNewName('');
      setNewEmail('');
      setNewInvested('');
      setNewRollover(false);
      setShowEditModal(false);
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

  const resetFaqEditor = () => {
    setFaqQuestion('');
    setFaqAnswer('');
    setEditingFaqId(null);
  };

  const handleSaveFaq = async () => {
    const question = faqQuestion.trim();
    const answer = faqAnswer.trim();
    if (!question || !answer) return;

    try {
      if (editingFaqId) {
        await updateDoc(doc(db, 'faqs', editingFaqId), {
          question,
          answer,
          updatedAt: new Date().toISOString()
        });
      } else {
        await addDoc(collection(db, 'faqs'), {
          question,
          answer,
          order: faqs.length + 1,
          updatedAt: new Date().toISOString()
        });
      }
      resetFaqEditor();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'faqs');
    }
  };

  const handleEditFaq = (faq: FAQItem) => {
    setFaqQuestion(faq.question);
    setFaqAnswer(faq.answer);
    setEditingFaqId(faq.id);
  };

  const handleDeleteFaq = async (faqId: string) => {
    try {
      await deleteDoc(doc(db, 'faqs', faqId));
      if (editingFaqId === faqId) {
        resetFaqEditor();
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `faqs/${faqId}`);
    }
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

       {/* Pending Requests */}
       {pendingRequests.length > 0 && (
          <div className="mb-8 px-4 md:px-0">
             <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Pending Access Requests</h3>
             <div className="space-y-3">
                {pendingRequests.map(req => (
                    <div key={req.id} className="bg-slate-800/80 border border-sky-500/30 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 sm:gap-0 justify-between sm:items-center">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-sky-500/20 flex items-center justify-center shrink-0">
                                <Mail className="text-sky-400" size={18} />
                            </div>
                            <div>
                                <div className="text-white font-bold text-sm truncate max-w-[200px] sm:max-w-xs">{req.email}</div>
                                {(req.firstName || req.lastName) && (
                                  <div className="text-[10px] text-slate-400">{`${req.firstName || ''} ${req.lastName || ''}`.trim()}</div>
                                )}
                                <div className="text-[10px] text-slate-500">Requested: {new Date(req.requestDate).toLocaleDateString()}</div>
                            </div>
                        </div>
                        <div className="flex gap-2 self-end sm:self-auto">
                            <button 
                                onClick={() => handleDenyAccess(req)} 
                                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
                            >
                                Deny
                            </button>
                            <button 
                                onClick={() => handleGrantAccess(req)} 
                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white transition-colors shadow-lg shadow-sky-500/20"
                            >
                                Grant Access
                            </button>
                        </div>
                    </div>
                ))}
             </div>
          </div>
       )}

       {/* Pending Deposits */}
       {pendingDeposits.length > 0 && (
          <div className="mb-8 px-4 md:px-0">
             <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
                 Pending Deposits
             </h3>
             <div className="space-y-3">
                {pendingDeposits.map(user => (
                    <div key={`deposit-${user.id}`} className="bg-slate-800/80 border border-emerald-500/30 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 sm:gap-0 justify-between sm:items-center">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                                <DollarSign className="text-emerald-400" size={18} />
                            </div>
                            <div>
                                <div className="text-white font-bold text-sm truncate max-w-[200px] sm:max-w-xs">{user.name || 'Unknown User'} ({user.email})</div>
                                <div className="text-[10px] text-slate-500">Sent Capital: <span className="text-emerald-400 font-mono font-bold">${(user.pendingInvested || 0).toLocaleString()}</span></div>
                            </div>
                        </div>
                        <div className="flex gap-2 self-end sm:self-auto">
                            <button 
                                onClick={() => handleDenyDeposit(user)} 
                                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition-colors"
                            >
                                Reject
                            </button>
                            <button 
                                onClick={() => handleConfirmDeposit(user)} 
                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-lg shadow-emerald-500/20 flex items-center gap-1"
                            >
                                <CheckCircle size={14} /> Confirm
                            </button>
                        </div>
                    </div>
                ))}
             </div>
          </div>
       )}

       {/* Pending Withdrawals */}
       {pendingWithdrawals.length > 0 && (
          <div className="mb-8 px-4 md:px-0">
             <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></div>
                 Pending Withdrawals
             </h3>
             <div className="space-y-3">
                {pendingWithdrawals.map(withdrawal => (
                    <div key={`withdrawal-${withdrawal.id}`} className="bg-slate-800/80 border border-amber-500/30 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 sm:gap-0 justify-between sm:items-center">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                                <Wallet className="text-amber-400" size={18} />
                            </div>
                            <div>
                                <div className="text-white font-bold text-sm truncate max-w-[200px] sm:max-w-xs">{withdrawal.userEmail}</div>
                                <div className="text-[10px] text-slate-500">Requested: <span className="text-amber-400 font-mono font-bold">${(withdrawal.amount || 0).toLocaleString()}</span></div>
                            </div>
                        </div>
                        <div className="flex gap-2 self-end sm:self-auto">
                            <button 
                                onClick={() => handleDenyWithdrawal(withdrawal.id)} 
                                className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition-colors"
                            >
                                Reject
                            </button>
                            <button 
                                onClick={() => handleConfirmWithdrawal(withdrawal)} 
                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white transition-colors shadow-lg shadow-amber-500/20 flex items-center gap-1"
                            >
                                <CheckCircle size={14} /> Confirm
                            </button>
                        </div>
                    </div>
                ))}
             </div>
          </div>
       )}

       {/* FAQ Admin */}
       <div className="px-4 md:px-0">
          <div className="bg-slate-800/70 border border-slate-700 rounded-2xl p-4 md:p-5 space-y-4">
              <div className="flex items-center gap-2">
                  <HelpCircle className="text-sky-400" size={18} />
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">FAQ Content Manager</h3>
              </div>
              <div className="grid grid-cols-1 gap-3">
                  <input
                      type="text"
                      value={faqQuestion}
                      onChange={(e) => setFaqQuestion(e.target.value)}
                      placeholder="Question"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500"
                  />
                  <textarea
                      value={faqAnswer}
                      onChange={(e) => setFaqAnswer(e.target.value)}
                      placeholder="Answer"
                      rows={4}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500"
                  />
              </div>
              <div className="flex gap-2">
                  <button
                      onClick={handleSaveFaq}
                      disabled={!faqQuestion.trim() || !faqAnswer.trim()}
                      className="px-4 py-2 rounded-lg text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                      {editingFaqId ? 'Update FAQ' : 'Add FAQ'}
                  </button>
                  {editingFaqId && (
                      <button
                          onClick={resetFaqEditor}
                          className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-200"
                      >
                          Cancel Edit
                      </button>
                  )}
              </div>

              <div className="space-y-2 pt-2">
                  {faqs.length === 0 ? (
                      <p className="text-xs text-slate-500">No FAQ entries yet.</p>
                  ) : (
                      faqs.map((faq) => (
                          <div key={faq.id} className="bg-slate-900/60 border border-slate-700 rounded-xl p-3">
                              <div className="flex items-start justify-between gap-3">
                                  <div>
                                      <p className="text-sm font-bold text-white">{faq.question}</p>
                                      <p className="text-xs text-slate-300 mt-1 whitespace-pre-wrap">{faq.answer}</p>
                                  </div>
                                  <div className="flex gap-1">
                                      <button onClick={() => handleEditFaq(faq)} className="p-1.5 rounded text-slate-400 hover:text-sky-400 hover:bg-sky-500/10">
                                          <Edit2 size={13} />
                                      </button>
                                      <button onClick={() => handleDeleteFaq(faq.id)} className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10">
                                          <Trash2 size={13} />
                                      </button>
                                  </div>
                              </div>
                          </div>
                      ))
                  )}
              </div>
          </div>
       </div>

       {/* User List */}
       <div className="space-y-4 px-4 md:px-0">
           {users.map((user) => (
               <div key={user.id} className="bg-slate-800 border border-slate-700 rounded-2xl overflow-hidden shadow-sm">
                   {/* Header */}
                   <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
                       <div className="flex items-center gap-3">
                           <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-slate-300">
                               {(user.name || user.email || 'U').substring(0, 2).toUpperCase()}
                           </div>
                           <div>
                               <div className="text-sm font-bold text-white">{user.name || 'Unknown User'}</div>
                               <div className="text-[10px] text-slate-500">{user.email}</div>
                           </div>
                       </div>
                       <div className="flex items-center gap-2">
                           {user.rolloverEnabled ? (
                               <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20">
                                   <TrendingUp size={12} /> Rollover
                               </span>
                           ) : (
                               <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 bg-slate-700/50 px-2 py-1 rounded-lg border border-slate-600">
                                   <Wallet size={12} /> Payout
                               </span>
                           )}
                           <button
                               onClick={() => handleEditClick(user)}
                               className="p-1.5 text-slate-400 hover:text-sky-400 hover:bg-sky-500/10 rounded-lg transition-colors"
                               title="Edit User"
                           >
                               <Edit2 size={14} />
                           </button>
                           <button
                               onClick={() => setUserToDelete(user.id)}
                               className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                               title="Delete User"
                           >
                               <Trash2 size={14} />
                           </button>
                       </div>
                   </div>

                   {/* Stats Grid */}
                   <div className="grid grid-cols-2 gap-px bg-slate-700/50">
                       <div className="bg-slate-800 p-4">
                           <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Total Invested</div>
                           <div className="text-white font-mono font-bold">${(user.totalInvested || 0).toLocaleString()}</div>
                       </div>
                       <div className="bg-slate-800 p-4">
                           <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">LTC Address</div>
                           <div className="text-slate-300 font-mono text-xs truncate max-w-[100px]">{user.ltcAddress}</div>
                       </div>
                       <div className="bg-slate-800 p-4">
                           <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Fees Paid (YTD)</div>
                           <div className="text-purple-400 font-mono font-bold">${(user.feesPaidYTD || 0).toLocaleString()}</div>
                       </div>
                       <div className="bg-slate-800 p-4">
                           <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Total Profits</div>
                           <div className="text-emerald-400 font-mono font-bold">${(user.profitsPaidTotal || 0).toLocaleString()}</div>
                       </div>
                   </div>
                   
                   <div className="bg-slate-900/50 p-3 flex justify-between items-center text-xs border-b border-slate-700/50">
                        <span className="text-slate-500">Pending Capital (Next Quarter)</span>
                        <span className="font-mono font-bold text-sky-400">${(user.pendingInvested || 0).toLocaleString()}</span>
                   </div>
                   <div className="bg-slate-900/50 p-3 flex justify-between items-center text-xs">
                        <span className="text-slate-500">Last Payout</span>
                        <span className="font-mono font-bold text-white">${(user.lastQuarterPayout || 0).toLocaleString()}</span>
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
                        <UserPlus size={20} className="text-sky-400" /> {approvingRequestId ? 'Approve Access' : 'Add New User'}
                    </h3>
                    <button onClick={closeAddModal} className="text-slate-400 hover:text-white">
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
                            disabled={!!approvingRequestId} // Disable if approving an existing request
                            className={`w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500 ${approvingRequestId ? 'opacity-70 cursor-not-allowed' : ''}`}
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
                        <p className="text-[10px] text-slate-500 mt-1">Guardrail: max invested capital is ${MAX_TOTAL_INVESTED.toLocaleString()}.</p>
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
                        onClick={closeAddModal}
                        className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleAddUser}
                        disabled={!newName || !newEmail}
                        className="flex-1 py-3 rounded-xl font-bold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {approvingRequestId ? 'Grant & Create' : 'Create User'}
                    </button>
                </div>
            </div>
         </div>
       )}

       {/* Edit User Modal */}
       {showEditModal && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-800 w-full max-w-md rounded-2xl border border-slate-700 shadow-2xl overflow-hidden animate-fade-in-up">
                <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Edit2 size={20} className="text-sky-400" /> Edit User
                    </h3>
                    <button onClick={closeEditModal} className="text-slate-400 hover:text-white">
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
                        <label className="text-xs font-bold text-slate-400 uppercase mb-1.5 block">Total Invested ($)</label>
                        <input 
                            type="number"
                            value={newInvested}
                            onChange={(e) => setNewInvested(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-500 font-mono"
                            placeholder="0"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">Guardrail: max invested capital is ${MAX_TOTAL_INVESTED.toLocaleString()}.</p>
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
                        onClick={closeEditModal}
                        className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleUpdateUser}
                        disabled={!newName || !newEmail}
                        className="flex-1 py-3 rounded-xl font-bold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        Save Changes
                    </button>
                </div>
            </div>
         </div>
       )}

       {/* Delete Confirmation Modal */}
       {userToDelete && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-800 w-full max-w-sm rounded-2xl border border-slate-700 shadow-2xl overflow-hidden animate-fade-in-up">
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
