import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';

const JWT_SECRET = process.env.JWT_SECRET || 'fly-messenger-secret-key-super-secure';
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; 

// Persistent data store
let users: any[] = [];
let messages: any[] = [];
let nextUserId = 1;
let nextMessageId = 1;

const DATA_FILE = path.join(process.cwd(), 'data.json');

const loadData = () => {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      users = data.users || [];
      messages = data.messages || [];
      nextUserId = data.nextUserId || 1;
      nextMessageId = data.nextMessageId || 1;
      ADMIN_PASSWORD = data.adminPassword || ADMIN_PASSWORD;
    } catch(e) {
      console.error('Error loading data', e);
    }
  } else {
    // If no data exists, we can start fresh
    saveData();
  }
};

const saveData = () => {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ 
    users, 
    messages, 
    nextUserId, 
    nextMessageId,
    adminPassword: ADMIN_PASSWORD 
  }));
};

loadData();

async function startServer() {
  const app = express();
  const PORT = 3000;
  const httpServer = createHttpServer(app);
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  app.use(express.json());

  app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
      const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1d' });
      res.json({ token });
    } else {
      res.status(401).json({ error: 'Invalid admin password' });
    }
  });

  const adminMiddleware = (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      if (decoded.role === 'admin') next();
      else res.status(403).json({ error: 'Forbidden' });
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  app.post('/api/admin/users', adminMiddleware, async (req, res) => {
    const { username, password } = req.body;
    try {
      if (users.find(u => u.username === username)) {
         return res.status(400).json({ error: 'Username already exists' });
      }
      const hash = await bcrypt.hash(password, 10);
      const newUser = { id: nextUserId++, username, password: hash, publicKey: null, avatarUrl: null, contacts: [], lastSeen: null };
      users.push(newUser);
      saveData();
      res.json({ id: newUser.id, username });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/admin/stats', adminMiddleware, (req, res) => {
    res.json({
      totalUsers: users.length,
      totalMessages: messages.length,
      activeConnections: connectedUsers.size
    });
  });

  app.delete('/api/admin/messages', adminMiddleware, (req, res) => {
    messages = [];
    saveData();
    res.json({ success: true });
  });

  app.get('/api/admin/users', adminMiddleware, async (req, res) => {
    res.json(users.map(u => ({ id: u.id, username: u.username })));
  });

  app.delete('/api/admin/users/:id', adminMiddleware, async (req, res) => {
    users = users.filter(u => u.id !== parseInt(req.params.id));
    saveData();
    res.json({ success: true });
  });

  app.put('/api/admin/password', adminMiddleware, (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'Password required' });
    ADMIN_PASSWORD = newPassword;
    saveData();
    res.json({ success: true });
  });

  app.put('/api/admin/users/:id/password', adminMiddleware, async (req, res) => {
    const { newPassword } = req.body;
    const user = users.find(u => u.id === parseInt(req.params.id));
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.password = await bcrypt.hash(newPassword, 10);
    saveData();
    res.json({ success: true });
  });

  app.get('/api/admin/chats/:userId1/:userId2', adminMiddleware, (req, res) => {
    const u1 = parseInt(req.params.userId1);
    const u2 = parseInt(req.params.userId2);
    const userMessages = messages.filter(m => 
      (m.senderId === u1 && m.receiverId === u2) || 
      (m.senderId === u2 && m.receiverId === u1)
    ).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    res.json(userMessages);
  });

  app.delete('/api/admin/chats/:userId1/:userId2', adminMiddleware, (req, res) => {
    const u1 = parseInt(req.params.userId1);
    const u2 = parseInt(req.params.userId2);
    messages = messages.filter(m => 
      !((m.senderId === u1 && m.receiverId === u2) || 
        (m.senderId === u2 && m.receiverId === u1))
    );
    saveData();
    res.json({ success: true });
  });

  app.get('/api/users/login', async (req, res) => {
    res.status(405).json({error: 'Use POST'});
  });

  app.post('/api/users/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, publicKey: user.publicKey, avatarUrl: user.avatarUrl } });
  });

  const userMiddleware = (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      if (decoded.id) {
        req.user = decoded;
        next();
      } else {
        res.status(403).json({ error: 'Forbidden' });
      }
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  };

  app.get('/api/users/contacts', userMiddleware, async (req: any, res) => {
    const me = users.find(u => u.id === req.user.id);
    const contactIds = me?.contacts || [];
    const contactUsers = users.filter(u => contactIds.includes(u.id)).map(u => ({ id: u.id, username: u.username, publicKey: u.publicKey, avatarUrl: u.avatarUrl, lastSeen: u.lastSeen }));
    res.json(contactUsers);
  });

  app.get('/api/users/search', userMiddleware, (req: any, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    const me = users.find(u => u.id === req.user.id);
    const searchStr = String(q).toLowerCase();
    const results = users
       .filter(u => u.id !== req.user.id && !(me?.contacts || []).includes(u.id) && u.username.toLowerCase().includes(searchStr))
       .map(u => ({ id: u.id, username: u.username, avatarUrl: u.avatarUrl, lastSeen: u.lastSeen }));
    res.json(results);
  });

  app.post('/api/users/contacts', userMiddleware, (req: any, res) => {
    const { contactId } = req.body;
    const me = users.find(u => u.id === req.user.id);
    if (!me) return res.status(404).json({error: 'user not found'});
    if (!me.contacts) me.contacts = [];
    if (!me.contacts.includes(contactId)) {
        me.contacts.push(contactId);
        saveData();
    }
    
    // Auto-add myself to their contacts so they can chat back
    const them = users.find(u => u.id === contactId);
    if (them) {
        if (!them.contacts) them.contacts = [];
        if (!them.contacts.includes(me.id)) {
            them.contacts.push(me.id);
        }
        saveData();
    }
    res.json({ success: true });
  });

  app.delete('/api/users/contacts/:id', userMiddleware, (req: any, res) => {
    const contactId = parseInt(req.params.id);
    const me = users.find(u => u.id === req.user.id);
    if (me && me.contacts) {
        me.contacts = me.contacts.filter((id: number) => id !== contactId);
        saveData();
    }
    res.json({ success: true });
  });

  app.put('/api/users/profile', userMiddleware, (req: any, res) => {
    const { avatarUrl } = req.body;
    const user = users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.avatarUrl = avatarUrl;
    saveData();
    res.json({ success: true, avatarUrl });
  });

  app.put('/api/users/password', userMiddleware, async (req: any, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = users.find(u => u.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) return res.status(401).json({ error: 'Invalid current password' });
    
    user.password = await bcrypt.hash(newPassword, 10);
    saveData();
    res.json({ success: true });
  });

  app.get('/api/users/messages/:contactId', userMiddleware, async (req: any, res) => {
    const contactId = parseInt(req.params.contactId);
    const myId = req.user.id;
    const userMessages = messages.filter(m => 
      (m.senderId === myId && m.receiverId === contactId) || 
      (m.senderId === contactId && m.receiverId === myId)
    ).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    res.json(userMessages);
  });

  app.delete('/api/users/messages/:id', userMiddleware, (req: any, res) => {
    const msgId = parseInt(req.params.id);
    const msgIndex = messages.findIndex(m => m.id === msgId);
    if (msgIndex !== -1) {
       const msg = messages[msgIndex];
       if (msg.senderId === req.user.id) {
           messages.splice(msgIndex, 1);
           saveData();
           io.emit('message:deleted', msgId);
           return res.json({ success: true });
       }
    }
    res.status(403).json({ error: 'Cannot delete' });
  });

  app.post('/api/users/public-key', userMiddleware, async (req: any, res) => {
    const { publicKey } = req.body;
    const user = users.find(u => u.id === req.user.id);
    if (user) {
      user.publicKey = publicKey;
      saveData();
    }
    res.json({ success: true });
  });

  // WebSocket Authentication
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      socket.data.user = decoded;
      next();
    } catch {
      next(new Error('Authentication error'));
    }
  });

  const connectedUsers = new Map<number, string>(); // userId -> socketId

  io.on('connection', (socket) => {
    const userId = socket.data.user.id;
    connectedUsers.set(userId, socket.id);
    
    socket.broadcast.emit('user:status', { userId, status: 'online' });

    socket.on('disconnect', () => {
      connectedUsers.delete(userId);
      const user = users.find(u => u.id === userId);
      const lastSeen = new Date().toISOString();
      if (user) {
         user.lastSeen = lastSeen;
         saveData();
      }
      socket.broadcast.emit('user:status', { userId, status: 'offline', lastSeen });
    });

    socket.on('message:send', async (data) => {
      const { receiverId, content, isEncrypted, attachment, replyToId } = data;
      try {
        const newMessage = {
            id: nextMessageId++,
            senderId: userId,
            receiverId,
            content,
            isEncrypted,
            attachment,
            replyToId,
            timestamp: new Date().toISOString()
        };
        messages.push(newMessage);
        saveData();
        
        const receiverSocketId = connectedUsers.get(receiverId);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('message:receive', newMessage);
        }
        
        socket.emit('message:sent', newMessage);
      } catch (e) {
        console.error('Error saving message', e);
      }
    });

    socket.emit('users:online', Array.from(connectedUsers.keys()));
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
