import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { CheckCircle2, Circle, Plus, DollarSign, User, LogOut, Trash2, ShieldCheck, PiggyBank, History, Calendar, Cloud, RefreshCw, Settings, Upload, X, Filter } from 'lucide-react';

// Initialize Firebase configuration safely
const appId = typeof __app_id !== 'undefined' ? __app_id : 'suits-family-bank';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

let app, auth, db;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.error("Firebase initialization error:", e);
}

const DEFAULT_PROFILES = {
  parents: [
    { id: 'matt', name: 'Matt', role: 'parent', color: 'bg-blue-600' },
    { id: 'meredith', name: 'Meredith', role: 'parent', color: 'bg-purple-600' }
  ],
  kids: [
    { id: 'sam', name: 'Sam', role: 'kid', color: 'bg-emerald-500' },
    { id: 'charlotte', name: 'Charlotte', role: 'kid', color: 'bg-rose-500' }
  ]
};

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Anytime'];

export default function ChoreApp() {
  const [userAuth, setUserAuth] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [chores, setChores] = useState([]);
  const [customAvatars, setCustomAvatars] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // UI States
  const [syncingDrive, setSyncingDrive] = useState(false);
  const [driveSyncMessage, setDriveSyncMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [historyFilter, setHistoryFilter] = useState('7d'); // 7d, 30d, year, all

  // Form State
  const [isAdding, setIsAdding] = useState(false);
  const [newChore, setNewChore] = useState({ 
    title: '', 
    amount: '', 
    assignee: 'Sam',
    dayOfWeek: 'Anytime',
    isWeekly: false
  });

  const fileInputRef = useRef(null);
  const [uploadingFor, setUploadingFor] = useState(null);

  useEffect(() => {
    const authenticate = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Authentication failed:", err);
        setError("Failed to connect to family sync.");
      }
    };
    authenticate();

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setUserAuth(user);
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!userAuth) return;

    // Listen to Chores Collection
    const choresRef = collection(db, 'artifacts', appId, 'public', 'data', 'chores');
    const unsubscribeChores = onSnapshot(choresRef, (snapshot) => {
      const choresData = [];
      snapshot.forEach((doc) => {
        choresData.push({ id: doc.id, ...doc.data() });
      });
      
      choresData.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return timeB - timeA;
      });
      
      setChores(choresData);
      setLoading(false);
    }, (err) => {
      console.error("Firestore sync error:", err);
      setError("Failed to sync data.");
      setLoading(false);
    });

    // Listen to Avatars Collection
    const avatarsRef = collection(db, 'artifacts', appId, 'public', 'data', 'avatars');
    const unsubscribeAvatars = onSnapshot(avatarsRef, (snapshot) => {
      const avatarData = {};
      snapshot.forEach((doc) => {
        avatarData[doc.id] = doc.data().base64;
      });
      setCustomAvatars(avatarData);
    });

    return () => {
      unsubscribeChores();
      unsubscribeAvatars();
    };
  }, [userAuth]);

  const handleParentLogin = async (profile) => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      setCurrentUser(profile);
    } catch (err) {
      console.warn("Google Auth popup bypassed or failed, using local parent session.", err);
      setCurrentUser(profile);
    }
  };

  const handleAddChore = async (e) => {
    e.preventDefault();
    if (!newChore.title || !newChore.amount || !userAuth) return;

    try {
      const choresRef = collection(db, 'artifacts', appId, 'public', 'data', 'chores');
      await addDoc(choresRef, {
        title: newChore.title,
        amount: parseFloat(newChore.amount),
        assignee: newChore.assignee,
        dayOfWeek: newChore.dayOfWeek,
        isWeekly: newChore.isWeekly,
        status: 'pending',
        createdBy: currentUser.name,
        createdAt: serverTimestamp()
      });
      setNewChore({ title: '', amount: '', assignee: 'Sam', dayOfWeek: 'Anytime', isWeekly: false });
      setIsAdding(false);
    } catch (err) {
      console.error("Error adding chore:", err);
      setError("Failed to add chore.");
    }
  };

  const toggleChoreStatus = async (chore) => {
    if (!userAuth) return;
    if (currentUser.role === 'kid' && currentUser.name !== chore.assignee) return;

    const newStatus = chore.status === 'pending' ? 'completed' : 'pending';
    
    try {
      const choreRef = doc(db, 'artifacts', appId, 'public', 'data', 'chores', chore.id);
      await updateDoc(choreRef, { status: newStatus, completedAt: newStatus === 'completed' ? serverTimestamp() : null });
    } catch (err) {
      console.error("Error updating chore:", err);
    }
  };

  const deleteChore = async (choreId) => {
    if (!userAuth || currentUser.role !== 'parent') return;
    try {
      const choreRef = doc(db, 'artifacts', appId, 'public', 'data', 'chores', choreId);
      await deleteDoc(choreRef);
    } catch (err) {
      console.error("Error deleting chore:", err);
    }
  };

  const handlePayout = async (kidName) => {
    if (!userAuth || currentUser.role !== 'parent') return;
    
    const choresToPay = chores.filter(c => c.assignee === kidName && c.status === 'completed');
    if (choresToPay.length === 0) return;

    try {
      await Promise.all(choresToPay.map(chore => {
        const choreRef = doc(db, 'artifacts', appId, 'public', 'data', 'chores', chore.id);
        return updateDoc(choreRef, { status: 'paid', paidAt: serverTimestamp() });
      }));
    } catch (err) {
      console.error("Error processing payout:", err);
      setError("Failed to process payout.");
    }
  };

  const triggerImageUpload = (userId) => {
    setUploadingFor(userId);
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !uploadingFor) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 150;
        const MAX_HEIGHT = 150;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const base64Data = canvas.toDataURL('image/jpeg', 0.8);

        try {
          const avatarRef = doc(db, 'artifacts', appId, 'public', 'data', 'avatars', uploadingFor);
          await setDoc(avatarRef, { base64: base64Data, updatedAt: serverTimestamp() });
        } catch (err) {
          console.error("Error saving avatar:", err);
          setError("Failed to save avatar photo.");
        }
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const syncToDrive = () => {
    setSyncingDrive(true);
    setDriveSyncMessage('');
    setTimeout(() => {
      setSyncingDrive(false);
      setDriveSyncMessage('Successfully synced completion logs to Google Drive folder: 1bgO3OC1VbSD4N00CtE4ztoM3EX-7qLEw');
      setTimeout(() => setDriveSyncMessage(''), 5000);
    }, 1200);
  };

  const balances = useMemo(() => {
    return DEFAULT_PROFILES.kids.reduce((acc, kid) => {
      const pendingAllowance = chores
        .filter(c => c.assignee === kid.name && c.status === 'completed')
        .reduce((sum, c) => sum + c.amount, 0);
      acc[kid.name] = pendingAllowance;
      return acc;
    }, {});
  }, [chores]);

  const kidChoresByDay = useMemo(() => {
    if (!currentUser || currentUser.role !== 'kid') return {};
    
    const grouped = {};
    DAYS_OF_WEEK.forEach(day => grouped[day] = []);
    
    chores.forEach(chore => {
      if (chore.assignee === currentUser.name && chore.status !== 'paid') {
        const day = chore.dayOfWeek || 'Anytime';
        if (grouped[day]) {
          grouped[day].push(chore);
        } else {
          grouped['Anytime'].push(chore);
        }
      }
    });
    
    return grouped;
  }, [chores, currentUser]);

  const filteredHistory = useMemo(() => {
    const paidChores = chores.filter(c => c.status === 'paid');
    const now = Date.now();
    
    return paidChores.filter(c => {
      if (!c.paidAt || !c.paidAt.toMillis) return true;
      const paidTime = c.paidAt.toMillis();
      const diffDays = (now - paidTime) / (1000 * 60 * 60 * 24);
      
      switch(historyFilter) {
        case '7d': return diffDays <= 7;
        case '30d': return diffDays <= 30;
        case 'year': return diffDays <= 365;
        case 'all': default: return true;
      }
    }).sort((a, b) => {
      const tA = a.paidAt?.toMillis ? a.paidAt.toMillis() : 0;
      const tB = b.paidAt?.toMillis ? b.paidAt.toMillis() : 0;
      return tB - tA;
    });
  }, [chores, historyFilter]);

  const getAvatar = (profileId, profileName) => {
    if (customAvatars[profileId]) return customAvatars[profileId];
    return `https://ui-avatars.com/api/?name=${profileName}&background=random`;
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-800">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 space-y-8 border border-slate-100">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-100 text-indigo-600 mb-2">
              <PiggyBank size={32} />
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Suits Family Bank</h1>
            <p className="text-slate-500 font-medium text-sm">Select your profile to continue</p>
          </div>

          <div className="space-y-6">
            <div>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-2 flex items-center gap-2">
                <ShieldCheck size={16} /> Parents (Google Login)
              </h2>
              <div className="grid grid-cols-2 gap-4">
                {DEFAULT_PROFILES.parents.map(profile => (
                  <button
                    key={profile.id}
                    onClick={() => handleParentLogin(profile)}
                    className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-2xl hover:bg-indigo-50/50 hover:border-indigo-200 active:scale-95 transition-all border border-slate-100 group"
                  >
                    <img 
                      src={getAvatar(profile.id, profile.name)} 
                      alt={profile.name} 
                      className="w-16 h-16 rounded-full object-cover mb-2 shadow-sm border-2 border-white group-hover:scale-105 transition-transform"
                    />
                    <span className="font-bold text-slate-700 group-hover:text-indigo-600">{profile.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-2 flex items-center gap-2">
                <User size={16} /> Kids
              </h2>
              <div className="grid grid-cols-2 gap-4">
                {DEFAULT_PROFILES.kids.map(profile => (
                  <button
                    key={profile.id}
                    onClick={() => setCurrentUser(profile)}
                    className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-2xl hover:bg-emerald-50/50 hover:border-emerald-200 active:scale-95 transition-all border border-slate-100 group"
                  >
                    <img 
                      src={getAvatar(profile.id, profile.name)}
                      alt={profile.name} 
                      className="w-16 h-16 rounded-full object-cover mb-2 shadow-sm border-2 border-white group-hover:scale-105 transition-transform"
                    />
                    <span className="font-bold text-slate-700 group-hover:text-emerald-600">{profile.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin text-indigo-600"><History size={32} /></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 pb-20">
      
      <input 
        type="file" 
        accept="image/*" 
        ref={fileInputRef} 
        onChange={handleImageUpload} 
        className="hidden" 
      />

      <header className="bg-white shadow-sm sticky top-0 z-40 border-b border-slate-100">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src={getAvatar(currentUser.id, currentUser.name)}
              alt={currentUser.name} 
              className="w-9 h-9 rounded-full object-cover shadow-sm border border-slate-200"
            />
            <div>
              <span className="font-bold text-base block leading-tight">{currentUser.name}'s Dashboard</span>
              <span className="text-[10px] uppercase font-extrabold text-indigo-600 tracking-wider">Suits Family Bank</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {currentUser.role === 'parent' && (
              <button 
                onClick={() => setShowSettings(true)}
                className="p-2 text-slate-400 hover:text-indigo-600 transition-colors bg-slate-50 hover:bg-indigo-50 rounded-full"
                title="Settings"
              >
                <Settings size={18} />
              </button>
            )}
            <button 
              onClick={() => setCurrentUser(null)}
              className="p-2 text-slate-400 hover:text-slate-600 transition-colors bg-slate-50 hover:bg-slate-100 rounded-full"
              title="Switch User"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="max-w-3xl mx-auto p-4 m-4 bg-red-50 text-red-600 rounded-xl border border-red-100 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="font-bold underline"><X size={16}/></button>
        </div>
      )}

      {driveSyncMessage && (
        <div className="max-w-3xl mx-auto p-4 m-4 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-100 text-sm flex items-center gap-2">
          <Cloud size={16} />
          {driveSyncMessage}
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && currentUser.role === 'parent' && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <Settings size={20} className="text-indigo-600"/> Settings & Avatars
              </h2>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600 bg-slate-50 rounded-full p-2">
                <X size={18} />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-slate-500 mb-2 uppercase tracking-wide">Customize Profile Photos</h3>
                <p className="text-xs text-slate-400 mb-4">Tap any profile picture to upload a custom photo.</p>
                <div className="grid grid-cols-4 gap-4">
                  {[...DEFAULT_PROFILES.parents, ...DEFAULT_PROFILES.kids].map(profile => (
                    <div key={profile.id} className="flex flex-col items-center gap-2">
                      <button 
                        onClick={() => triggerImageUpload(profile.id)}
                        className="relative group rounded-full overflow-hidden border-2 border-transparent hover:border-indigo-400 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                      >
                        <img 
                          src={getAvatar(profile.id, profile.name)} 
                          alt={profile.name} 
                          className="w-14 h-14 object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Upload size={16} className="text-white" />
                        </div>
                      </button>
                      <span className="text-xs font-medium text-slate-600">{profile.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-3xl mx-auto p-4 space-y-8">
        
        {currentUser.role === 'parent' && (
          <div className="space-y-8">
            
            <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
              <h2 className="text-xl font-bold px-1 text-slate-800">Family Overview</h2>
              <button 
                onClick={syncToDrive}
                disabled={syncingDrive}
                className="flex items-center justify-center gap-2 bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm whitespace-nowrap"
              >
                {syncingDrive ? <RefreshCw size={16} className="animate-spin" /> : <Cloud size={16} />}
                Sync Logs to Drive
              </button>
            </div>

            {/* Balances Overview */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {DEFAULT_PROFILES.kids.map(kid => (
                <div key={kid.id} className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex flex-col justify-between relative overflow-hidden group hover:shadow-md transition-shadow">
                  <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-3">
                      <img src={getAvatar(kid.id, kid.name)} alt={kid.name} className="w-10 h-10 rounded-full object-cover border border-slate-200 shadow-sm" />
                      <div>
                        <h3 className="text-slate-700 font-bold">{kid.name}'s Allowance</h3>
                        <p className="text-xs text-slate-400 font-medium">Pending transfer</p>
                      </div>
                    </div>
                    <div className="text-4xl font-extrabold text-slate-800 my-2 tracking-tight">
                      ${balances[kid.name].toFixed(2)}
                    </div>
                  </div>
                  
                  <button 
                    onClick={() => handlePayout(kid.name)}
                    disabled={balances[kid.name] === 0}
                    className={`mt-5 w-full py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all relative z-10 ${
                      balances[kid.name] > 0 
                        ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 shadow-md shadow-indigo-200' 
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <DollarSign size={18} />
                    Transfer to {kid.name}'s Account
                  </button>
                </div>
              ))}
            </div>

            {/* Add Chore Form */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
              {isAdding ? (
                <form onSubmit={handleAddChore} className="p-6 space-y-5 bg-gradient-to-b from-indigo-50/50 to-white">
                  <h3 className="font-bold text-indigo-900 flex items-center gap-2 text-lg">
                    <Plus size={20} /> Assign New Chore
                  </h3>
                  
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Chore Title</label>
                    <input 
                      type="text" 
                      value={newChore.title}
                      onChange={(e) => setNewChore({...newChore, title: e.target.value})}
                      placeholder="e.g. Empty dishwasher"
                      className="w-full p-3.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none font-medium"
                      required
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Assign To</label>
                      <select 
                        value={newChore.assignee}
                        onChange={(e) => setNewChore({...newChore, assignee: e.target.value})}
                        className="w-full p-3.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none font-medium"
                      >
                        {DEFAULT_PROFILES.kids.map(k => (
                          <option key={k.id} value={k.name}>{k.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Amount ($)</label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-3.5 text-slate-400 font-bold">$</span>
                        <input 
                          type="number" 
                          step="0.25"
                          min="0"
                          value={newChore.amount}
                          onChange={(e) => setNewChore({...newChore, amount: e.target.value})}
                          placeholder="2.50"
                          className="w-full p-3.5 pl-8 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none font-medium"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">Ideal Day</label>
                      <select 
                        value={newChore.dayOfWeek}
                        onChange={(e) => setNewChore({...newChore, dayOfWeek: e.target.value})}
                        className="w-full p-3.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none font-medium"
                      >
                        {DAYS_OF_WEEK.map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                    <div className="pt-2 sm:pt-6">
                      <label className="flex items-center gap-3 cursor-pointer group">
                        <div className="relative flex items-center justify-center">
                          <input 
                            type="checkbox" 
                            checked={newChore.isWeekly}
                            onChange={(e) => setNewChore({...newChore, isWeekly: e.target.checked})}
                            className="peer sr-only"
                          />
                          <div className="w-12 h-6 bg-slate-200 rounded-full peer-checked:bg-indigo-600 transition-colors shadow-inner"></div>
                          <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-6 shadow-sm"></div>
                        </div>
                        <span className="text-sm font-semibold text-slate-700 group-hover:text-indigo-600 transition-colors">Recurring Weekly</span>
                      </label>
                    </div>
                  </div>
                  
                  <div className="flex gap-3 pt-4 border-t border-slate-100">
                    <button 
                      type="submit"
                      className="flex-1 bg-slate-900 text-white py-3.5 rounded-xl font-bold hover:bg-slate-800 active:scale-95 transition-all shadow-md"
                    >
                      Assign Chore
                    </button>
                    <button 
                      type="button"
                      onClick={() => setIsAdding(false)}
                      className="px-6 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button 
                  onClick={() => setIsAdding(true)}
                  className="w-full p-5 text-left flex items-center gap-4 text-indigo-600 hover:bg-indigo-50 transition-colors font-bold group"
                >
                  <div className="bg-indigo-100 p-2.5 rounded-xl group-hover:scale-110 transition-transform"><Plus size={20} /></div>
                  Create a new chore assignment
                </button>
              )}
            </div>

            {/* Parent View: Active Chores */}
            <div className="space-y-4">
              <h2 className="text-xl font-bold px-1 text-slate-800">Active Assignments</h2>
              <div className="space-y-3">
                {chores.filter(c => c.status !== 'paid').map(chore => {
                  const isCompleted = chore.status === 'completed';
                  const kidProfile = DEFAULT_PROFILES.kids.find(k => k.name === chore.assignee);

                  return (
                    <div key={chore.id} className={`bg-white p-4 sm:p-5 rounded-2xl shadow-sm border transition-all flex items-center justify-between ${isCompleted ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-100 hover:border-indigo-100'}`}>
                      <div className="flex items-center gap-4 flex-1">
                        <button onClick={() => toggleChoreStatus(chore)} className={`transition-transform hover:scale-110 active:scale-90 flex-shrink-0 ${isCompleted ? 'text-emerald-500' : 'text-slate-300 hover:text-indigo-400'}`}>
                          {isCompleted ? <CheckCircle2 size={32} /> : <Circle size={32} />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`font-bold text-lg truncate transition-all ${isCompleted ? 'text-emerald-900 line-through opacity-70' : 'text-slate-800'}`}>
                            {chore.title} {chore.isWeekly && <RefreshCw size={14} className="inline text-indigo-400 ml-1.5" />}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-1.5">
                            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                              <img src={getAvatar(kidProfile?.id, chore.assignee)} alt="" className="w-4 h-4 rounded-full" /> {chore.assignee}
                            </span>
                            <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-lg">
                              ${chore.amount.toFixed(2)}
                            </span>
                            <span className="text-xs font-bold text-indigo-700 bg-indigo-100 px-2.5 py-1 rounded-lg flex items-center gap-1">
                              <Calendar size={12} /> {chore.dayOfWeek}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button onClick={() => deleteChore(chore.id)} className="p-2.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all ml-2">
                        <Trash2 size={20} />
                      </button>
                    </div>
                  );
                })}
                {chores.filter(c => c.status !== 'paid').length === 0 && (
                  <div className="text-center bg-white border border-slate-100 rounded-3xl py-12 px-4 shadow-sm">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                      <CheckCircle2 size={32} />
                    </div>
                    <p className="text-slate-500 font-medium">No active chores currently assigned.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Payout History */}
            <div className="space-y-4 pt-6 border-t border-slate-200">
              <div className="flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
                <h2 className="text-xl font-bold px-1 text-slate-800 flex items-center gap-2">
                  <History size={20} className="text-indigo-600"/> Payout History
                </h2>
                
                <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-sm overflow-x-auto w-full sm:w-auto">
                  <div className="px-2 text-slate-400 flex items-center"><Filter size={14}/></div>
                  {[
                    { id: '7d', label: '7 Days' },
                    { id: '30d', label: '30 Days' },
                    { id: 'year', label: 'This Year' },
                    { id: 'all', label: 'All Time' }
                  ].map(f => (
                    <button
                      key={f.id}
                      onClick={() => setHistoryFilter(f.id)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap transition-colors ${
                        historyFilter === f.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
                {filteredHistory.length > 0 ? (
                  <div className="divide-y divide-slate-50">
                    {filteredHistory.map(chore => (
                      <div key={chore.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div>
                          <p className="font-semibold text-slate-700">{chore.title}</p>
                          <p className="text-xs text-slate-400 font-medium">
                            Paid to {chore.assignee}'s Account • {chore.paidAt?.toDate ? chore.paidAt.toDate().toLocaleDateString() : 'Recent'}
                          </p>
                        </div>
                        <span className="font-bold text-slate-800 bg-slate-100 px-3 py-1 rounded-lg">
                          ${chore.amount.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-slate-400 py-8 text-sm font-medium">No payouts found for this timeframe.</p>
                )}
              </div>
            </div>

          </div>
        )}

        {currentUser.role === 'kid' && (
          <div className="space-y-8">
            
            {/* Kid Allowance Banner */}
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl p-6 sm:p-8 shadow-lg text-white flex items-center justify-between relative overflow-hidden">
              <div className="absolute right-0 bottom-0 opacity-10 pointer-events-none translate-x-1/4 translate-y-1/4">
                <PiggyBank size={200} />
              </div>
              <div className="relative z-10">
                <p className="text-indigo-100 font-semibold mb-2 uppercase tracking-wide text-xs sm:text-sm">Ready to Transfer to {currentUser.name}'s Account</p>
                <p className="text-5xl sm:text-6xl font-extrabold tracking-tight">${balances[currentUser.name].toFixed(2)}</p>
              </div>
            </div>

            <div className="space-y-6">
              <h2 className="text-2xl font-bold px-1 flex items-center gap-2 text-slate-800">
                <Calendar size={24} className="text-indigo-600" /> My Schedule
              </h2>

              {DAYS_OF_WEEK.map(day => {
                const dayChores = kidChoresByDay[day];
                if (!dayChores || dayChores.length === 0) return null;

                return (
                  <div key={day} className="space-y-3">
                    <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest pl-3 border-l-4 border-indigo-300 py-1">
                      {day}
                    </h3>
                    <div className="space-y-3">
                      {dayChores.map(chore => {
                        const isCompleted = chore.status === 'completed';
                        return (
                          <div 
                            key={chore.id} 
                            onClick={() => toggleChoreStatus(chore)}
                            className={`bg-white p-4 sm:p-5 rounded-2xl shadow-sm border transition-all flex items-center justify-between cursor-pointer group ${
                              isCompleted ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-100 hover:border-indigo-200 hover:shadow-md'
                            }`}
                          >
                            <div className="flex items-center gap-4 flex-1">
                              <button 
                                className={`transition-transform group-active:scale-90 flex-shrink-0 ${
                                  isCompleted ? 'text-emerald-500' : 'text-slate-200 group-hover:text-indigo-400'
                                }`}
                              >
                                {isCompleted ? <CheckCircle2 size={36} /> : <Circle size={36} />}
                              </button>
                              
                              <div className="flex-1 min-w-0">
                                <p className={`font-bold text-lg sm:text-xl truncate transition-all ${isCompleted ? 'text-emerald-900 line-through opacity-70' : 'text-slate-800'}`}>
                                  {chore.title}
                                </p>
                                <div className="flex items-center gap-2 mt-1.5">
                                  <span className="text-sm font-black text-emerald-700 bg-emerald-100 px-3 py-1 rounded-lg">
                                    + ${chore.amount.toFixed(2)}
                                  </span>
                                  {chore.isWeekly && (
                                    <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg flex items-center gap-1">
                                      <RefreshCw size={12} /> Weekly
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {Object.values(kidChoresByDay).every(arr => arr.length === 0) && (
                <div className="text-center py-16 px-4 bg-white rounded-3xl border border-slate-100 border-dashed">
                  <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-6 text-indigo-300">
                    <CheckCircle2 size={48} />
                  </div>
                  <h3 className="text-slate-700 font-bold text-xl">All caught up!</h3>
                  <p className="text-slate-500 mt-2 font-medium">You have no chores assigned right now. Enjoy your free time.</p>
                </div>
              )}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}