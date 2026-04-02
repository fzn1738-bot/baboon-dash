import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { TradeList } from './components/TradeList';
import { Calculator } from './components/Calculator';
import { Users } from './components/Users';
import { AppView, UserRole, User } from './types';
import { LogOut, AlertTriangle, ShieldCheck, Loader2, Mail, ArrowLeft, CheckCircle } from 'lucide-react';
import { Settings } from './components/Settings';
import { FAQ } from './components/FAQ';
import { ErrorBoundary } from './components/ErrorBoundary';
import { auth, db } from './firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut, 
  setPersistence, 
  browserLocalPersistence, 
  signInWithRedirect,
  getRedirectResult 
} from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, serverTimestamp, query, where, getDocs, limit, deleteDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from './utils/firestore-errors';
import { sendEmail } from './utils/email';

// Use local persistence so user stays logged in
setPersistence(auth, browserLocalPersistence).catch(console.error);

// --- Login Component ---
const LoginScreen = ({ initialError = null }: { initialError?: string | null }) => {
  const [isLoading, setIsLoading] = useState(true); // Default to true while we check redirect
  const [view, setView] = useState<'LOGIN' | 'REQUEST'>('LOGIN');
  const [error, setError] = useState<string | null>(initialError);
  const [showAccessPopup, setShowAccessPopup] = useState(false);
  
  // Request Access State
  const [requestFirstName, setRequestFirstName] = useState('');
  const [requestLastName, setRequestLastName] = useState('');
  const [requestEmail, setRequestEmail] = useState('');
  const [requestStatus, setRequestStatus] = useState<'IDLE' | 'LOADING' | 'SUCCESS'>('IDLE');

  useEffect(() => {
    if (initialError) {
      setError(initialError);
      setShowAccessPopup(true);
    }
  }, [initialError]);

  // Handle the return from a mobile Redirect Login
  useEffect(() => {
    const checkRedirect = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result) {
          // If we have a result, the user successfully logged in via redirect.
          // The onAuthStateChanged listener in App will handle the rest.
        } else {
          // If no result, we just loaded the page normally. Turn off spinner.
          setIsLoading(false);
        }
      } catch (err: any) {
        console.error("Redirect Login failed", err);
        let msg = `Login failed: ${err.message}`;
        if (err.code === 'auth/unauthorized-domain') {
            msg = "Unauthorized Domain. Please add this URL to your Firebase Console > Authentication > Settings > Authorized Domains.";
        }
        setError(msg);
        setIsLoading(false);
      }
    };
    
    checkRedirect();
  }, []);

  const handleProviderLogin = async (providerType: 'GOOGLE') => {
    setIsLoading(true);
    setError(null);
    try {
        const provider = new GoogleAuthProvider();
        const userAgent = navigator.userAgent.toLowerCase();
        
        // Check for Mobile Devices (iOS or Android)
        const isMobile = /iphone|ipad|ipod|android/.test(userAgent);
        const isSafari = /safari/.test(userAgent) && !/crios|fxios|chrome/.test(userAgent);
        
        if (isMobile || isSafari) {
            // Mobile devices MUST use redirect to bypass aggressive popup blockers
            await signInWithRedirect(auth, provider);
            return; // Stop execution here, page will redirect
        }
        
        // Desktop can use Popup
        await signInWithPopup(auth, provider);
    } catch (err: any) {
        console.error("Login failed", err);
        
        // Fallback to Redirect if Popup fails for any reason
        if (
          err?.code === 'auth/popup-blocked' ||
          err?.code === 'auth/popup-closed-by-user' ||
          err?.code === 'auth/cancelled-popup-request' ||
          err?.code === 'auth/operation-not-supported-in-this-environment'
        ) {
          try {
            const provider = new GoogleAuthProvider();
            await signInWithRedirect(auth, provider);
            return;
          } catch (redirectErr: any) {
            console.error('Redirect login failed', redirectErr);
          }
        }
        
        let msg = `Login failed: ${err.message}`;
        if (err.code === 'auth/unauthorized-domain') {
            msg = "Unauthorized Domain. Please add this URL to your Firebase Console > Authentication > Settings > Authorized Domains.";
        }
        setError(msg);
        setIsLoading(false);
    }
  };

  const handleRequestAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestEmail.includes('@') || !requestFirstName.trim() || !requestLastName.trim()) return;
    
    setRequestStatus('LOADING');
    try {
        const newReq = { 
            id: Date.now().toString(), 
            firstName: requestFirstName.trim(),
            lastName: requestLastName.trim(),
            email: requestEmail.trim().toLowerCase(), 
            status: 'PENDING', 
            requestDate: new Date().toISOString() 
        };
        await setDoc(doc(db, 'access_requests', newReq.id), newReq);
        
        // Send email to admin
        const adminEmail = 'fnazir1989@gmail.com';
        await sendEmail(
          adminEmail,
          'New Access Request - Baboon Dashboard',
          `<p>A new user has requested access to the Baboon Dashboard.</p><p><strong>Name:</strong> ${newReq.firstName} ${newReq.lastName}</p><p><strong>Email:</strong> ${newReq.email}</p><p>Please log in to the admin portal to accept or decline the request.</p>`
        ).catch(console.error);

        // Send email to user
        await sendEmail(
          newReq.email,
          'Access Request Received - Baboon Dashboard',
          `<p>Hi ${newReq.firstName},</p><p>We have received your request to access the Baboon Dashboard.</p><p>An admin will review your request shortly. You will receive another email once your request has been processed.</p><p>Thank you!</p>`
        ).catch(console.error);

        setRequestStatus('SUCCESS');
        setTimeout(() => {
            setView('LOGIN');
            setRequestStatus('IDLE');
            setRequestFirstName('');
            setRequestLastName('');
            setRequestEmail('');
        }, 3000);
    } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'access_requests');
        setRequestStatus('IDLE');
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* App-like Background */}
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-slate-900 to-[#0f172a]"></div>
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-sky-500/20 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm h-[500px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-sm relative z-10 flex flex-col h-full justify-center">
        {showAccessPopup && (
          <div className="mb-4 bg-amber-500/10 border border-amber-500/30 p-4 rounded-2xl text-amber-200 text-xs">
            <div className="font-bold mb-1">Access Required</div>
            <p>Your account is not approved yet. Please use the <strong>Request Access</strong> link below.</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  setView('REQUEST');
                  setShowAccessPopup(false);
                }}
                className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-900 font-bold"
              >
                Go to Request Access
              </button>
              <button
                onClick={() => setShowAccessPopup(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 font-bold"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Brand Header */}
        <div className="text-center mb-12 space-y-4">
          <div className="w-24 h-24 bg-gradient-to-br from-sky-400 to-indigo-600 rounded-3xl flex items-center justify-center mx-auto shadow-2xl shadow-indigo-500/30 transform rotate-3">
            <span className="text-5xl font-bold text-white">B</span>
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Baboon Dash</h1>
            <p className="text-slate-400 font-medium">Mobile Terminal v2.4</p>
          </div>
        </div>

        {view === 'LOGIN' ? (
            <div className="space-y-4 animate-fade-in-up">
                {error && (
                    <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-2xl flex items-center gap-3 text-rose-400 text-xs font-bold mb-4">
                        <AlertTriangle size={18} className="shrink-0" />
                        <span>{error}</span>
                    </div>
                )}
                <button 
                  onClick={() => handleProviderLogin('GOOGLE')}
                  disabled={isLoading}
                  className="w-full bg-[#4285F4] text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 hover:bg-[#3367D6] transition-all shadow-lg active:scale-95 disabled:opacity-70 disabled:scale-100"
                >
                    {isLoading ? (
                      <Loader2 className="animate-spin" size={24} color="white" />
                    ) : (
                      <>
                        <div className="bg-white p-1 rounded-full">
                            <svg className="w-4 h-4" viewBox="0 0 24 24">
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                            </svg>
                        </div>
                        Sign in with Google
                      </>
                    )}
                </button>
                
                {!isLoading && (
                  <div className="pt-6 text-center">
                      <button 
                          onClick={() => setView('REQUEST')}
                          className="text-sm text-slate-400 hover:text-white transition-colors"
                      >
                          Need an account? <span className="font-bold text-sky-400">Request Access</span>
                      </button>
                  </div>
                )}
            </div>
        ) : (
            <div className="space-y-6 animate-fade-in-up bg-slate-800/50 p-6 rounded-3xl border border-slate-700/50 backdrop-blur-md">
                <button 
                    onClick={() => setView('LOGIN')}
                    className="text-slate-400 hover:text-white flex items-center gap-2 text-sm font-bold transition-colors mb-4"
                >
                    <ArrowLeft size={16} /> Back to Login
                </button>
                
                <div>
                    <h3 className="text-xl font-bold text-white mb-2">Request Access</h3>
                    <p className="text-sm text-slate-400">Enter your email to join the waitlist. Admins will review your request.</p>
                </div>
                
                {requestStatus === 'SUCCESS' ? (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 p-6 rounded-2xl flex flex-col items-center justify-center text-center space-y-3 animate-fade-in">
                        <CheckCircle className="text-emerald-500" size={32} />
                        <div>
                            <div className="font-bold text-emerald-400">Request Sent!</div>
                            <div className="text-xs text-slate-400 mt-1">You will be notified once an admin grants access.</div>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleRequestAccess} className="space-y-4">
                        <input 
                            type="text" 
                            required
                            value={requestFirstName}
                            onChange={(e) => setRequestFirstName(e.target.value)}
                            placeholder="First Name"
                            className="w-full bg-slate-900/80 border border-slate-700 rounded-xl py-4 px-4 text-white focus:outline-none focus:border-sky-500 transition-colors"
                        />
                        <input 
                            type="text" 
                            required
                            value={requestLastName}
                            onChange={(e) => setRequestLastName(e.target.value)}
                            placeholder="Last Name"
                            className="w-full bg-slate-900/80 border border-slate-700 rounded-xl py-4 px-4 text-white focus:outline-none focus:border-sky-500 transition-colors"
                        />
                        <div className="relative">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">
                                <Mail size={18} />
                            </div>
                            <input 
                                type="email" 
                                required
                                value={requestEmail}
                                onChange={(e) => setRequestEmail(e.target.value)}
                                placeholder="Email Address"
                                className="w-full bg-slate-900/80 border border-slate-700 rounded-xl py-4 pl-12 pr-4 text-white focus:outline-none focus:border-sky-500 transition-colors"
                            />
                        </div>
                        <button 
                            type="submit"
                            disabled={!requestEmail.includes('@') || !requestFirstName.trim() || !requestLastName.trim() || requestStatus === 'LOADING'}
                            className="w-full bg-sky-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-sky-500 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                        >
                            {requestStatus === 'LOADING' ? <Loader2 className="animate-spin" size={20} /> : 'Submit Request'}
                        </button>
                    </form>
                )}
            </div>
        )}

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
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [userEmail, setUserEmail] = useState('');
  const [userDisplayName, setUserDisplayName] = useState('');
  const [userId, setUserId] = useState('');
  const [currentView, setCurrentView] = useState<AppView>(AppView.DASHBOARD);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); 
  const [userRole, setUserRole] = useState<UserRole>('INVESTOR');
  const [canSwitchRole, setCanSwitchRole] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // --- Siloed User Data State ---
  const [totalPool, setTotalPool] = useState<number>(0);
  const [investorStats, setInvestorStats] = useState({
    q3Invested: 0,
    pendingInvested: 0,
    q3CurrentRoi: 0, 
    totalWithdrawn: 0
  });

  const userShare = (totalPool > 0 && investorStats.q3Invested > 0) 
    ? investorStats.q3Invested / totalPool 
    : 0;

  useEffect(() => {
    // Only sign out on mount if they aren't already returning from a redirect
    // Removing the forced signOut(auth) here ensures we don't kill the redirect login loop

    let unsubscribeUsers: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const email = firebaseUser.email || '';
        const normalizedEmail = email.trim().toLowerCase();
        setUserEmail(email);
        setUserId(firebaseUser.uid);
        
        // Is Admin?
        const adminEmails = ['fzn1738@gmail.com', 'fnazir1989@gmail.com'];
        const isAdmin = adminEmails.includes(email.toLowerCase());
        setCanSwitchRole(isAdmin);
        setUserRole(isAdmin ? 'ADMIN' : 'INVESTOR');

        try {
          // Enforce allow-list: email must be pre-added in users collection before login is allowed.
          const usersRef = collection(db, 'users');
          const matchingUserQuery = query(usersRef, where('email', '==', normalizedEmail), limit(1));
          const matchingUsers = await getDocs(matchingUserQuery);

          if (matchingUsers.empty) {
            setAuthError('Access is limited to approved users. Please request access first.');
            await signOut(auth);
            setIsAuthenticated(false);
            setIsAuthLoading(false);
            return;
          }

          const approvedDoc = matchingUsers.docs[0];
          const approvedData = approvedDoc.data();
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const userSnap = await getDoc(userDocRef);

          if (!userSnap.exists()) {
            await setDoc(userDocRef, {
              name: approvedData.name || firebaseUser.displayName || normalizedEmail.split('@')[0],
              email: normalizedEmail,
              totalInvested: approvedData.totalInvested || 0,
              pendingInvested: approvedData.pendingInvested || 0,
              feesPaidYTD: approvedData.feesPaidYTD || 0,
              profitsPaidTotal: approvedData.profitsPaidTotal || 0,
              lastQuarterPayout: approvedData.lastQuarterPayout || 0,
              rolloverEnabled: approvedData.rolloverEnabled || false,
              usdtSolAddress: approvedData.usdtSolAddress || approvedData.ltcAddress || 'Pending',
              role: approvedData.role || (isAdmin ? 'admin' : 'investor')
            }, { merge: true });
          }

          if (approvedDoc.id !== firebaseUser.uid) {
            await deleteDoc(doc(db, 'users', approvedDoc.id)).catch(console.error);
          }

          // Listen to all users to calculate total pool
          if (isAdmin) {
              unsubscribeUsers = onSnapshot(collection(db, 'users'), (snapshot: any) => {
                let total = 0;
                let currentUserInvested = 0;
                let currentUserPending = 0;
                
                snapshot.docs.forEach((doc: any) => {
                  const data = doc.data();
                  total += (data.totalInvested || 0);
                  if (doc.id === firebaseUser.uid) {
                    currentUserInvested = data.totalInvested || 0;
                    currentUserPending = data.pendingInvested || 0;
                    const firstName = String(data.firstName || '').trim();
                    const lastName = String(data.lastName || '').trim();
                    const fullName = `${firstName} ${lastName}`.trim();
                    setUserDisplayName(fullName || data.name || normalizedEmail.split('@')[0] || 'Investor');
                    if (data.darkModeEnabled !== undefined) {
                        setIsDarkMode(data.darkModeEnabled);
                    }
                  }
                });
                
                setTotalPool(total);
                
                // Update system stats so investors can read it
                setDoc(doc(db, 'system', 'stats'), { totalPool: total }, { merge: true }).catch(console.error);
                
                setInvestorStats(prev => ({
                    ...prev,
                    q3Invested: currentUserInvested,
                    pendingInvested: currentUserPending
                }));
              }, (error) => {
                  handleFirestoreError(error, OperationType.LIST, 'users');
              });
          } else {
              // For investors, listen to system stats and their own doc
              const unsubStats = onSnapshot(doc(db, 'system', 'stats'), (docSnap: any) => {
                   if (docSnap.exists()) {
                      setTotalPool(docSnap.data().totalPool || 0);
                  }
              }, (error) => {
                  handleFirestoreError(error, OperationType.GET, 'system/stats');
              });
              
              const unsubUser = onSnapshot(doc(db, 'users', firebaseUser.uid), (docSnap: any) => {
                  if (docSnap.exists()) {
                      const data = docSnap.data();
                      const currentUserInvested = data.totalInvested || 0;
                      const currentUserPending = data.pendingInvested || 0;
                      const firstName = String(data.firstName || '').trim();
                      const lastName = String(data.lastName || '').trim();
                      const fullName = `${firstName} ${lastName}`.trim();
                      setUserDisplayName(fullName || data.name || normalizedEmail.split('@')[0] || 'Investor');
                      if (data.darkModeEnabled !== undefined) {
                          setIsDarkMode(data.darkModeEnabled);
                      }
                      
                      setInvestorStats(prev => ({
                          ...prev,
                          q3Invested: currentUserInvested,
                          pendingInvested: currentUserPending
                      }));
                  }
              }, (error) => {
                  handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
              });
              
              unsubscribeUsers = () => {
                  unsubStats();
                  unsubUser();
              };
          }

          await setDoc(doc(db, 'users', firebaseUser.uid), {
            accountConfirmed: true,
            lastLoginAt: new Date().toISOString()
          }, { merge: true });

          setIsAuthenticated(true);
          setAuthError(null);
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'users');
          setIsAuthenticated(false);
        }
      } else {
        setIsAuthenticated(false);
        setUserId('');
        setUserDisplayName('');
        if (unsubscribeUsers) {
            unsubscribeUsers();
            unsubscribeUsers = undefined;
        }
      }
      setIsAuthLoading(false);
    });

    return () => {
        unsubscribeAuth();
        if (unsubscribeUsers) {
            unsubscribeUsers();
        }
    };
  }, []);

  const handleCapitalInjection = async (amount: number) => {
    const MAX_TOTAL_INVESTED = 10_000;
    const currentCommitted = investorStats.q3Invested + investorStats.pendingInvested;
    const allowedAmount = Math.max(0, Math.min(amount, MAX_TOTAL_INVESTED - currentCommitted));
    if (allowedAmount <= 0) {
      return;
    }

    setInvestorStats(prev => ({
      ...prev,
      pendingInvested: prev.pendingInvested + allowedAmount
    }));
    
    if (auth.currentUser) {
       const userDocRef = doc(db, 'users', auth.currentUser.uid);
       await setDoc(userDocRef, { pendingInvested: investorStats.pendingInvested + allowedAmount }, { merge: true });
    }
  };

  const handleWithdrawal = async (amount: number) => {
    if (auth.currentUser) {
       const withdrawalRef = doc(collection(db, 'withdrawals'));
       await setDoc(withdrawalRef, {
         userId: auth.currentUser.uid,
         userEmail: auth.currentUser.email,
         amount: amount,
         status: 'PENDING',
         createdAt: serverTimestamp()
       });
    }
  };

  useEffect(() => {
      if (isDarkMode) {
          document.documentElement.classList.remove('light-theme');
      } else {
          document.documentElement.classList.add('light-theme');
      }
  }, [isDarkMode]);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <Loader2 className="animate-spin text-sky-500" size={48} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen initialError={authError} />;
  }

  return (
    <div className="flex h-screen bg-[#0f172a] overflow-hidden selection:bg-sky-500/30">
      <Sidebar 
        currentView={currentView} 
        onChangeView={setCurrentView} 
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        userRole={userRole}
        onToggleRole={() => setUserRole(prev => prev === 'ADMIN' ? 'INVESTOR' : 'ADMIN')}
        canSwitchRole={canSwitchRole}
      />

      <main className={`flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-[#0f172a] relative transition-all duration-500 ${canSwitchRole && userRole === 'INVESTOR' ? 'invert hue-rotate-180' : ''}`}>
        <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-b from-sky-900/20 to-transparent pointer-events-none"></div>
        <div className="max-w-7xl mx-auto p-4 md:p-8 pt-8 md:pt-12 min-h-screen relative z-10">
          <ErrorBoundary>
            {currentView === AppView.DASHBOARD && (
              <Dashboard 
                 userRole={userRole} 
                 username={userDisplayName || userEmail} 
                 currentUserId={userId}
                 currentUserEmail={userEmail}
                 investorStats={investorStats} 
                 onCapitalInject={handleCapitalInjection}
                 userShare={userShare}
                 totalPool={totalPool}
              />
            )}
            
            {currentView === AppView.TRADES && (
               <TradeList userRole={userRole} userShare={userShare} />
            )}

            {currentView === AppView.CALCULATOR && userRole === 'INVESTOR' && (
               <Calculator userRole={userRole} />
            )}

            {currentView === AppView.USERS && userRole === 'ADMIN' && (
               <Users userRole={userRole} />
            )}

            {currentView === AppView.SETTINGS && (
              <Settings 
                  role={userRole} 
                  userEmail={userEmail} 
                  investedCapital={investorStats.q3Invested} 
                  onWithdraw={handleWithdrawal}
              />
            )}

            {currentView === AppView.FAQ && (
              <FAQ userRole={userRole} />
            )}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
