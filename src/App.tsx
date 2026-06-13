import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { 
  Shield, Key, Users, MessageSquare, Send, ArrowLeft, LogOut, Loader2, 
  Lock, Unlock, Trash2, Paperclip, Image as ImageIcon, Mic, Square, X, 
  FileText, Activity, Server as ServerIcon, RefreshCw, Settings, Camera
} from 'lucide-react';
import { encryptMessage, decryptMessage } from './crypto';
import type { User, Message, Attachment } from './types';

type View = 'login' | 'admin_login' | 'admin_panel' | 'contacts' | 'chat' | 'profile';

export default function App() {
  const [view, setView] = useState<View>('login');
  
  // Auth state
  const [token, setToken] = useState<string | null>(localStorage.getItem('fly_token'));
  const [user, setUser] = useState<User | null>(null);
  
  // Login form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Admin panel state
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [adminStats, setAdminStats] = useState({ totalUsers: 0, totalMessages: 0, activeConnections: 0 });

  // User chat state
  const [contacts, setContacts] = useState<User[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<number[]>([]);
  const [activeChat, setActiveChat] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [encryptionEnabled, setEncryptionEnabled] = useState(true);
  
  const [newMessage, setNewMessage] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  
  const [decryptedMessages, setDecryptedMessages] = useState<Record<number, string>>({});
  const [decryptedAttachments, setDecryptedAttachments] = useState<Record<number, Attachment>>({});
  
  // User profile state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileMsg, setProfileMsg] = useState('');
  
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  // Logout handler
  const logout = () => {
    localStorage.removeItem('fly_token');
    setToken(null);
    setUser(null);
    setView('login');
    if (socketRef.current) socketRef.current.disconnect();
  };

  // Initialize socket when token changes and it's a regular user
  useEffect(() => {
    if (token && view.includes('chat') || view === 'contacts') {
      const socket = io({
        auth: { token }
      });
      socketRef.current = socket;

      socket.on('users:online', (userIds: number[]) => setOnlineUsers(userIds));
      socket.on('user:status', ({ userId, status }) => {
        setOnlineUsers(prev => status === 'online' ? [...prev, userId] : prev.filter(id => id !== userId));
      });
      socket.on('message:receive', (msg: Message) => {
        setMessages(prev => [...prev, msg]);
      });
      socket.on('message:sent', (msg: Message) => {
        setMessages(prev => {
          // Remove any stray optimistic messages (negative IDs) just in case
          const clean = prev.filter(m => m.id > 0);
          return [...clean, msg];
        });
      });

      return () => { socket.disconnect(); };
    }
  }, [token, view]);

  // Load data depending on view
  const loadAdminData = () => {
    if (!token) return;
    fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(setAdminUsers).catch(() => logout());
      
    fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(setAdminStats).catch(console.error);
  };

  useEffect(() => {
    if (!token) return;

    if (view === 'admin_panel') {
      loadAdminData();
      const interval = setInterval(loadAdminData, 5000);
      return () => clearInterval(interval);
    } else if (view === 'contacts') {
      fetch('/api/users/contacts', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => setContacts(data))
        .catch(() => logout());
    }
  }, [token, view]);

  // Load chat messages when opening a chat
  useEffect(() => {
    if (view === 'chat' && activeChat && token) {
      setMessages([]);
      setDecryptedMessages({});
      setDecryptedAttachments({});
      fetch(`/api/users/messages/${activeChat.id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => setMessages(data))
        .catch(console.error);
      
      setAttachment(null);
      setNewMessage('');
    }
  }, [view, activeChat, token]);

  // Auto-decrypt messages using derived keys
  useEffect(() => {
    if (messages.length > 0 && activeChat && user) {
      const derivedSecret = `auto_secret_v1_${Math.min(user.id, activeChat.id)}_${Math.max(user.id, activeChat.id)}`;
      
      const processMessages = async () => {
        const newDecrypted: Record<number, string> = { ...decryptedMessages };
        const newAttachments: Record<number, Attachment> = { ...decryptedAttachments };
        let changed = false;
        
        for (const msg of messages) {
          if (newDecrypted[msg.id] !== undefined) continue;

          if (msg.isEncrypted) {
            newDecrypted[msg.id] = await decryptMessage(msg.content, derivedSecret);
            if (msg.attachment) {
               const decUrl = await decryptMessage(msg.attachment.url, derivedSecret);
               newAttachments[msg.id] = { ...msg.attachment, url: decUrl };
            }
          } else {
            newDecrypted[msg.id] = msg.content;
            if (msg.attachment) {
               newAttachments[msg.id] = msg.attachment;
            }
          }
          changed = true;
        }
        
        if (changed) {
          setDecryptedMessages(newDecrypted);
          setDecryptedAttachments(newAttachments);
        }
      };
      processMessages();
    }
  }, [messages, activeChat, user, decryptedMessages, decryptedAttachments]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, decryptedMessages]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true); setError('');
    try {
      const res = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      localStorage.setItem('fly_token', data.token);
      setToken(data.token); setUser(data.user); setView('contacts');
    } catch (err: any) { setError(err.message); } 
    finally { setIsLoading(false); }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true); setError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      localStorage.setItem('fly_token', data.token);
      setToken(data.token); setView('admin_panel');
    } catch (err: any) { setError(err.message); } 
    finally { setIsLoading(false); }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAdminUsers([...adminUsers, data]);
      setUsername(''); setPassword('');
      loadAdminData();
    } catch (err: any) { setError(err.message); }
  };

  const handleDeleteUser = async (id: number) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      await fetch(`/api/admin/users/${id}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
      });
      setAdminUsers(adminUsers.filter(u => u.id !== id));
      loadAdminData();
    } catch (e) {}
  };

  const handleClearMessages = async () => {
    if (!confirm('DANGER: Irreversibly wipe all messages from the server?')) return;
    try {
      await fetch(`/api/admin/messages`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
      });
      loadAdminData();
    } catch (e) {}
  };

  const handleChangeAdminPassword = async (e: React.FormEvent) => {
     e.preventDefault(); setError('');
     try {
       const res = await fetch('/api/admin/password', {
           method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
           body: JSON.stringify({ newPassword: adminPassword })
       });
       if (res.ok) { alert('Admin key updated successfully'); setAdminPassword(''); }
       else throw new Error(await res.text());
     } catch (err: any) { setError(err.message); }
  };
  
  const handleResetUserPassword = async (id: number) => {
      const newPass = prompt('Enter new password for user:');
      if (!newPass) return;
      try {
         const res = await fetch(`/api/admin/users/${id}/password`, {
             method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
             body: JSON.stringify({ newPassword: newPass })
         });
         if (res.ok) alert('User password reset successfully');
      } catch (e) {}
  };

  const handleUpdateProfilePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg('');
    try {
      const res = await fetch('/api/users/password', {
        method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setProfileMsg('Password updated successfully');
      setCurrentPassword(''); setNewPassword('');
    } catch (err: any) { setProfileMsg(err.message); }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert("Max size 2MB"); return; }
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      try {
        const res = await fetch('/api/users/profile', {
            method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ avatarUrl: base64 })
        });
        if (res.ok && user) {
           setUser({...user, avatarUrl: base64});
        }
      } catch (e) {}
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // File size limit (e.g. 5MB) since we transmit base64 inside memory
    if (file.size > 5 * 1024 * 1024) {
      alert("File is too large (max 5MB for preview).");
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      let type: Attachment['type'] = 'file';
      if (file.type.startsWith('image/')) type = 'image';
      else if (file.type.startsWith('video/')) type = 'video';
      else if (file.type.startsWith('audio/')) type = 'audio';
      
      setAttachment({ type, url: base64, name: file.name });
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];
        
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        
        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onload = (event) => {
            setAttachment({
              type: 'audio',
              url: event.target?.result as string,
              name: 'Voice_Message.webm'
            });
          };
          reader.readAsDataURL(audioBlob);
          stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        setIsRecording(true);
      } catch(e) {
        alert("Microphone access denied or unavailable.");
      }
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !attachment) || !activeChat || !socketRef.current || !user) return;
    
    const plainText = newMessage.trim();
    setNewMessage('');
    const currentAttachment = attachment;
    setAttachment(null);
    
    let finalContent = plainText;
    let finalAttachmentUrl = currentAttachment?.url;

    if (encryptionEnabled) {
      const derivedSecret = `auto_secret_v1_${Math.min(user.id, activeChat.id)}_${Math.max(user.id, activeChat.id)}`;
      finalContent = await encryptMessage(plainText || ' ', derivedSecret);
      if (currentAttachment) {
         finalAttachmentUrl = await encryptMessage(currentAttachment.url, derivedSecret);
      }
    }
    
    const attachmentPayload = currentAttachment ? { ...currentAttachment, url: finalAttachmentUrl! } : undefined;

    socketRef.current.emit('message:send', {
      receiverId: activeChat.id,
      content: finalContent,
      isEncrypted: encryptionEnabled,
      attachment: attachmentPayload
    });
  };

  // UI Renderers...
  if (view === 'login' || view === 'admin_login') {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="flex justify-center">
            <div className="h-16 w-16 bg-blue-600 rounded-full flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Shield className="h-8 w-8 text-white" />
            </div>
          </div>
          <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-white font-sans">Fly Messenger</h2>
          <p className="mt-2 text-center text-sm text-neutral-400">Secure Inter-Node Link</p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-neutral-900 py-8 px-4 shadow-xl shadow-neutral-950 sm:rounded-2xl sm:px-10 border border-neutral-800">
            {error && <div className="mb-4 bg-red-900/50 border border-red-500/50 p-3 rounded-lg text-sm text-red-200">{error}</div>}
            
            {view === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-neutral-300">User ID</label>
                  <input type="text" required value={username} onChange={e => setUsername(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-300">Password</label>
                  <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white focus:border-blue-500 focus:outline-none" />
                </div>
                <button type="submit" disabled={isLoading} className="w-full flex justify-center py-2.5 px-4 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none">
                  {isLoading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Connect Securely'}
                </button>
                <div className="text-center mt-4">
                  <button type="button" onClick={() => { setView('admin_login'); setError(''); }} className="text-xs text-neutral-500 hover:text-neutral-300">Admin Control Panel</button>
                </div>
              </form>
            ) : (
             <form onSubmit={handleAdminLogin} className="space-y-6">
                 <div>
                   <label className="block text-sm font-medium text-neutral-300">Admin Key</label>
                   <input type="password" required value={adminPassword} onChange={e => setAdminPassword(e.target.value)}
                     className="mt-1 block w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white focus:border-red-500 focus:outline-none" />
                 </div>
                 <button type="submit" disabled={isLoading} className="w-full flex justify-center py-2.5 px-4 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none">
                   {isLoading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Access Control Panel'}
                 </button>
                 <div className="text-center mt-4">
                   <button type="button" onClick={() => { setView('login'); setError(''); }} className="text-xs text-neutral-500 hover:text-neutral-300">Back to User Connection</button>
                 </div>
               </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'admin_panel') {
    return (
      <div className="min-h-screen bg-neutral-950 text-white pb-12">
        <header className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex justify-between items-center sticky top-0 z-10">
          <div className="flex items-center space-x-2 text-red-500">
            <Shield className="h-6 w-6" />
            <h1 className="text-xl font-medium tracking-tight">System Control Panel</h1>
          </div>
          <button onClick={logout} className="text-neutral-400 hover:text-white transition-colors flex items-center space-x-2 text-sm">
            <LogOut className="h-4 w-4" /> <span>Logout</span>
          </button>
        </header>

        <main className="max-w-5xl mx-auto py-8 px-4">
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 flex items-center space-x-4">
               <div className="h-10 w-10 bg-blue-500/10 text-blue-500 rounded-full flex items-center justify-center"><Users className="h-5 w-5" /></div>
               <div>
                 <div className="text-sm text-neutral-400">Total Users</div>
                 <div className="text-2xl font-bold">{adminStats.totalUsers}</div>
               </div>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 flex items-center space-x-4">
               <div className="h-10 w-10 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center"><Activity className="h-5 w-5" /></div>
               <div>
                 <div className="text-sm text-neutral-400">Active Connections</div>
                 <div className="text-2xl font-bold">{adminStats.activeConnections}</div>
               </div>
            </div>
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 flex items-center justify-between">
               <div className="flex items-center space-x-4">
                 <div className="h-10 w-10 bg-purple-500/10 text-purple-500 rounded-full flex items-center justify-center"><MessageSquare className="h-5 w-5" /></div>
                 <div>
                   <div className="text-sm text-neutral-400">Total Messages</div>
                   <div className="text-2xl font-bold">{adminStats.totalMessages}</div>
                 </div>
               </div>
               <button onClick={handleClearMessages} className="text-xs bg-red-500/10 text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-500/20 transition-colors">
                 Wipe DB
               </button>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="md:col-span-1">
              <div className="bg-neutral-900 rounded-2xl border border-neutral-800 p-6">
                <h2 className="text-lg font-medium mb-4 flex items-center space-x-2">
                  <Key className="h-5 w-5 text-neutral-400" /> <span>Provision Identity</span>
                </h2>
                {error && <div className="text-sm text-red-400 mb-4">{error}</div>}
                <form onSubmit={handleCreateUser} className="space-y-4">
                  <input type="text" required placeholder="User ID" value={username} onChange={e => setUsername(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:border-red-500 focus:outline-none" />
                  <input type="password" required placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:border-red-500 focus:outline-none" />
                  <button type="submit" className="w-full bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 text-sm font-medium transition-colors">
                    Generate Identity
                  </button>
                </form>
              </div>

              <div className="bg-neutral-900 rounded-2xl border border-neutral-800 p-6 mt-6">
                 <h2 className="text-lg font-medium mb-4 flex items-center space-x-2">
                   <Key className="h-5 w-5 text-neutral-400" /> <span>Change Admin Key</span>
                 </h2>
                 <form onSubmit={handleChangeAdminPassword} className="space-y-4">
                    <input type="password" required placeholder="New Admin Password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:border-red-500 focus:outline-none" />
                    <button type="submit" className="w-full bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg py-2 text-sm font-medium transition-colors">
                      Update Key
                    </button>
                 </form>
              </div>
            </div>

            <div className="md:col-span-2">
              <div className="bg-neutral-900 rounded-2xl border border-neutral-800 overflow-hidden">
                <div className="px-6 py-4 border-b border-neutral-800 bg-neutral-800/50 flex justify-between items-center">
                  <h2 className="text-lg font-medium">Active Identities</h2>
                  <button onClick={loadAdminData} className="text-neutral-400 hover:text-white p-1"><RefreshCw className="h-4 w-4" /></button>
                </div>
                <div className="divide-y divide-neutral-800/50">
                  {adminUsers.map(u => (
                    <div key={u.id} className="px-6 py-4 flex justify-between items-center hover:bg-neutral-800/30 transition-colors">
                      <div className="font-mono text-sm flex items-center space-x-3"><Users className="h-4 w-4 text-neutral-500" /><span>{u.username}</span></div>
                      <div className="flex space-x-2">
                        <button onClick={() => handleResetUserPassword(u.id)} className="text-neutral-500 hover:text-blue-500 transition-colors" title="Reset Password"><Key className="h-4 w-4" /></button>
                        <button onClick={() => handleDeleteUser(u.id)} className="text-neutral-500 hover:text-red-500 transition-colors" title="Delete User"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                  ))}
                  {adminUsers.length === 0 && <div className="px-6 py-8 text-center text-neutral-500 text-sm">No identities provisioned.</div>}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (view === 'contacts') {
    return (
      <div className="h-screen bg-neutral-950 flex overflow-hidden font-sans">
        <div className="w-full max-w-md mx-auto flex flex-col bg-neutral-900 border-x border-neutral-800 h-full shadow-2xl">
          <header className="px-6 py-6 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur sticky top-0 z-10 flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 bg-blue-600/20 text-blue-500 rounded-full flex items-center justify-center overflow-hidden border border-blue-500/20">
                {user?.avatarUrl ? <img src={user.avatarUrl} className="w-full h-full object-cover" /> : <Shield className="h-5 w-5" />}
              </div>
              <div>
                <h1 className="font-bold text-white tracking-tight">Fly Messenger</h1>
                <p className="text-xs text-neutral-400 font-mono mt-0.5">{user?.username}</p>
              </div>
            </div>
            <div className="flex items-center space-x-1">
              <button onClick={() => setView('profile')} className="p-2 text-neutral-500 hover:text-neutral-300 rounded-full hover:bg-neutral-800 transition-colors">
                <Settings className="h-5 w-5" />
              </button>
              <button onClick={logout} className="p-2 text-neutral-500 hover:text-neutral-300 rounded-full hover:bg-neutral-800 transition-colors">
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </header>
          
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
            <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-4 px-2">Network Contacts</h2>
            {contacts.map(c => {
              const isOnline = onlineUsers.includes(c.id);
              return (
                <button key={c.id} onClick={() => { setActiveChat(c); setView('chat'); }}
                  className="w-full flex items-center space-x-4 p-3 rounded-xl hover:bg-neutral-800/80 transition-all text-left group"
                >
                  <div className="relative">
                    {c.avatarUrl ? (
                      <div className="h-12 w-12 rounded-full overflow-hidden border border-neutral-800"><img src={c.avatarUrl} className="w-full h-full object-cover" /></div>
                    ) : (
                      <div className="h-12 w-12 bg-neutral-800 rounded-full flex items-center justify-center text-neutral-300 font-medium group-hover:bg-neutral-700 transition-colors">
                        {c.username.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-neutral-900 ${isOnline ? 'bg-green-500' : 'bg-neutral-600'}`}></div>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-neutral-200">{c.username}</div>
                  </div>
                </button>
              );
            })}
            {contacts.length === 0 && (
              <div className="text-center py-12 px-4 shadow-inner bg-neutral-900/50 rounded-2xl border border-neutral-800/50">
                <Users className="h-8 w-8 text-neutral-600 mx-auto mb-3" />
                <p className="text-sm text-neutral-400">Awaiting peer provisioning...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'chat' && activeChat) {
    return (
      <div className="h-screen bg-neutral-950 flex flex-col font-sans">
        <header className="bg-neutral-900 border-b border-neutral-800 px-4 py-3 flex items-center justify-between shadow-sm z-10 sticky top-0">
          <div className="flex items-center space-x-3">
            <button onClick={() => setView('contacts')} className="p-2 text-neutral-400 hover:text-white rounded-full hover:bg-neutral-800 transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center space-x-3">
              {activeChat.avatarUrl ? (
                 <div className="h-10 w-10 rounded-full overflow-hidden border border-neutral-800"><img src={activeChat.avatarUrl} className="w-full h-full object-cover" /></div>
              ) : (
                 <div className="h-10 w-10 bg-neutral-800 rounded-full flex items-center justify-center text-neutral-300 font-medium">
                   {activeChat.username.substring(0, 2).toUpperCase()}
                 </div>
              )}
              <div>
                <h2 className="font-medium text-white">{activeChat.username}</h2>
                <div className="text-xs text-neutral-400 flex items-center space-x-1.5 mt-0.5">
                  <div className={`h-2 w-2 rounded-full ${onlineUsers.includes(activeChat.id) ? 'bg-green-500' : 'bg-neutral-600'}`}></div>
                  <span>{onlineUsers.includes(activeChat.id) ? 'Online' : 'Offline'}</span>
                </div>
              </div>
            </div>
          </div>
          
          <button onClick={() => setEncryptionEnabled(!encryptionEnabled)}
            className={`flex items-center text-xs space-x-2 px-3 py-1.5 rounded-full border transition-colors ${
              encryptionEnabled ? 'text-blue-500 bg-blue-500/10 border-blue-500/20' : 'text-neutral-400 bg-neutral-800 border-neutral-700'
            }`}>
            {encryptionEnabled ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            <span className="font-medium hidden sm:inline">{encryptionEnabled ? 'E2E Active' : 'Unencrypted'}</span>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl mx-auto w-full relative">
            <div className="text-center my-6">
              <span className="bg-neutral-900 text-neutral-500 text-xs px-3 py-1.5 rounded-full border border-neutral-800">
                Channel formed. Encryption is {encryptionEnabled ? 'On' : 'Off'}.
              </span>
            </div>
            
            {messages.map(msg => {
              const isMine = msg.senderId === user?.id;
              const decrypted = decryptedMessages[msg.id];
              const att = decryptedAttachments[msg.id];
              const failed = decrypted === "[Encrypted Message - Invalid Secret]";

              return (
                <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-5 py-3 ${
                    isMine 
                      ? 'bg-blue-600 text-white rounded-br-none shadow-blue-900/20 shadow-lg' 
                      : 'bg-neutral-800 text-neutral-100 rounded-bl-none border border-neutral-700/50'
                  } ${failed ? 'bg-red-900/50 border-red-500/50 text-red-200' : ''}`}>
                    
                    {msg.isEncrypted && !failed && (
                       <Lock className={`h-3 w-3 mb-1.5 opacity-40 ${isMine ? 'text-blue-200' : 'text-neutral-400'}`} />
                    )}
                    
                    {att && !failed && (
                      <div className="mb-2">
                        {att.type === 'image' && <img src={att.url} alt="att" className="max-w-[240px] rounded-lg object-contain" />}
                        {att.type === 'video' && <video src={att.url} controls className="max-w-[240px] rounded-lg" />}
                        {att.type === 'audio' && <audio src={att.url} controls className="max-w-[240px]" />}
                        {att.type === 'file' && (
                          <a href={att.url} download={att.name} className="flex items-center space-x-2 text-sm underline opacity-90 hover:opacity-100 bg-black/20 p-2 rounded">
                            <FileText className="h-4 w-4 flex-shrink-0" /> <span className="truncate max-w-[180px]">{att.name}</span>
                          </a>
                        )}
                      </div>
                    )}
                    
                    <div className={`text-[15px] leading-relaxed break-words ${failed ? 'font-mono text-xs opacity-80' : ''}`}>
                      {decrypted || (msg.content === ' ' ? '' : <span className="flex items-center space-x-2 opacity-50"><Loader2 className="animate-spin h-3 w-3" /></span>)}
                    </div>
                    
                    <div className={`text-[10px] mt-1.5 text-right ${isMine ? 'text-blue-200' : 'text-neutral-500'}`}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
        </div>
        
        {attachment && (
            <div className="max-w-3xl mx-auto w-full px-4 pt-2">
              <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-3 flex items-center justify-between">
                <div className="flex items-center space-x-3 overflow-hidden">
                   {attachment.type === 'image' ? <ImageIcon className="h-5 w-5 text-blue-400" /> : 
                    attachment.type === 'audio' ? <Mic className="h-5 w-5 text-green-400" /> : <FileText className="h-5 w-5 text-neutral-400" />}
                   <span className="text-sm text-neutral-200 truncate">{attachment.name}</span>
                </div>
                <button onClick={() => setAttachment(null)} className="text-neutral-400 hover:text-white"><X className="h-4 w-4" /></button>
              </div>
            </div>
        )}

        <div className="bg-neutral-900 border-t border-neutral-800 p-4 sticky bottom-0">
            <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
            <form onSubmit={handleSendMessage} className="max-w-3xl mx-auto flex gap-2 relative items-center">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3 text-neutral-400 hover:text-white rounded-full hover:bg-neutral-800 transition-colors">
                <Paperclip className="h-5 w-5" />
              </button>
              <button type="button" onClick={toggleRecording} className={`p-3 rounded-full transition-colors ${isRecording ? 'text-red-500 bg-red-500/10 animate-pulse' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}>
                {isRecording ? <Square className="h-5 w-5 fill-current" /> : <Mic className="h-5 w-5" />}
              </button>
              <input
                autoFocus
                type="text"
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
                placeholder={isRecording ? "Recording audio..." : "Secure message..."}
                disabled={isRecording}
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-full px-5 py-3 text-[15px] text-white focus:border-neutral-600 focus:outline-none transition-colors shadow-inner"
              />
              <button 
                type="submit" 
                disabled={!newMessage.trim() && !attachment}
                className="bg-white text-black p-3.5 rounded-full hover:bg-neutral-200 disabled:opacity-50 disabled:hover:bg-white transition-all shadow-lg flex items-center justify-center flex-shrink-0 group"
              >
                <Send className="h-5 w-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </button>
            </form>
        </div>
      </div>
    );
  }

  if (view === 'profile') {
    return (
      <div className="h-screen bg-neutral-950 flex overflow-hidden font-sans">
        <div className="w-full max-w-md mx-auto flex flex-col bg-neutral-900 border-x border-neutral-800 h-full shadow-2xl">
          <header className="px-6 py-4 border-b border-neutral-800 bg-neutral-900 sticky top-0 z-10 flex items-center space-x-4 text-white">
            <button onClick={() => setView('contacts')} className="p-2 -ml-2 text-neutral-400 hover:text-white rounded-full hover:bg-neutral-800 transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-lg font-medium">Profile Settings</h1>
          </header>
          <div className="flex-1 overflow-y-auto p-6 space-y-8 text-white">
            <div className="flex flex-col items-center">
               <div className="relative group mb-4">
                  <div className="h-24 w-24 rounded-full overflow-hidden bg-neutral-800 border-2 border-neutral-700 flex items-center justify-center">
                     {user?.avatarUrl ? <img src={user.avatarUrl} className="w-full h-full object-cover" /> : <Users className="h-10 w-10 text-neutral-500" />}
                  </div>
                  <label className="absolute bottom-0 right-0 h-8 w-8 bg-blue-600 rounded-full flex items-center justify-center cursor-pointer hover:bg-blue-500 transition-colors shadow-lg border-2 border-neutral-900 text-white">
                     <Camera className="h-4 w-4" />
                     <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                  </label>
               </div>
               <h2 className="font-bold text-xl">{user?.username}</h2>
            </div>
            
            <div className="bg-neutral-950 rounded-2xl border border-neutral-800 p-5">
               <h3 className="font-medium mb-4 flex items-center space-x-2"><Key className="h-4 w-4 text-neutral-400" /><span>Change Password</span></h3>
               {profileMsg && <div className="text-sm bg-neutral-900 text-blue-400 p-2 rounded mb-4">{profileMsg}</div>}
               <form onSubmit={handleUpdateProfilePassword} className="space-y-3">
                 <input type="password" required placeholder="Current Password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
                   className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                 <input type="password" required placeholder="New Password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                   className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                 <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 text-sm font-medium transition-colors">
                   Update Password
                 </button>
               </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
