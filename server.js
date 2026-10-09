/* ============================================================
   VIBE — сервер
   Express + Socket.IO + lowdb
============================================================ */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e7
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'vibe-secret-change-in-production';

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: (res, filepath) => {
    if (filepath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// ============ AUTH MIDDLEWARE ============
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Нет токена' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.username = payload.username;
    next();
  } catch {
    res.status(401).json({ error: 'Неверный токен' });
  }
}

function adminOnly(req, res, next) {
  const u = db.getUser(req.username);
  if (!u || !u.isAdmin) return res.status(403).json({ error: 'Только для админа' });
  next();
}

// ============ HEALTH CHECK ============
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// ============ AUTH API ============
app.post('/api/register', async (req, res) => {
  try {
    const { username, displayName, password, emoji, color, photo } = req.body;
    if (!username || username.length < 3) return res.status(400).json({ error: 'Имя минимум 3 символа' });
    if (!/^[a-z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Только латиница, цифры и _' });
    if (db.getUser(username)) return res.status(400).json({ error: 'Имя занято' });
    if (!displayName) return res.status(400).json({ error: 'Введи отображаемое имя' });
    if (!password || password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });

    const user = await db.createUser({ username, displayName, password, emoji, color, photo });
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: db.publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!db.verifyPassword(username, password)) {
    return res.status(400).json({ error: 'Неверный логин или пароль' });
  }
  await db.updateLastSeen(username);
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: db.publicUser(db.getUser(username)) });
});

app.get('/api/me', auth, async (req, res) => {
  const u = db.getUser(req.username);
  if (!u) return res.status(404).json({ error: 'Не найден' });
  await db.updateLastSeen(req.username);
  res.json({ user: db.publicUser(u) });
});

// ============ POSTS ============
app.get('/api/posts', auth, (req, res) => {
  res.json({ posts: db.getPosts() });
});

app.post('/api/posts', auth, async (req, res) => {
  const { text, photo } = req.body;
  if (!text && !photo) return res.status(400).json({ error: 'Пустой пост' });
  const id = await db.createPost({ author: req.username, text, photo });
  io.emit('posts:updated');
  res.json({ id });
});

app.post('/api/posts/:id/like', auth, async (req, res) => {
  const postId = parseInt(req.params.id);
  const liked = await db.toggleLike(postId, req.username);
  const author = db.getPostAuthor(postId);
  if (liked && author && author !== req.username) {
    await db.createNotification({
      user: author, type: 'like', fromUser: req.username, payload: { postId }
    });
    io.to(`user:${author}`).emit('notifications:updated');
  }
  io.emit('posts:updated');
  res.json({ liked });
});

app.post('/api/posts/:id/comment', auth, async (req, res) => {
  const postId = parseInt(req.params.id);
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Пустой комментарий' });
  const id = await db.addComment(postId, req.username, text);
  const author = db.getPostAuthor(postId);
  if (author && author !== req.username) {
    await db.createNotification({
      user: author, type: 'comment', fromUser: req.username, payload: { postId }
    });
    io.to(`user:${author}`).emit('notifications:updated');
  }
  io.emit('posts:updated');
  res.json({ id });
});

// ============ USERS ============
app.get('/api/users/:username', auth, (req, res) => {
  const u = db.getUser(req.params.username);
  if (!u) return res.status(404).json({ error: 'Не найден' });
  res.json({
    user: db.publicUser(u),
    stats: db.getFollowStats(req.params.username),
    isFollowing: db.getFollowing(req.username).includes(req.params.username),
    isMe: req.username === req.params.username
  });
});

app.post('/api/users/:username/follow', auth, async (req, res) => {
  const target = req.params.username;
  const followed = await db.toggleFollow(req.username, target);
  if (followed) {
    await db.createNotification({
      user: target, type: 'follow', fromUser: req.username, payload: {}
    });
    io.to(`user:${target}`).emit('notifications:updated');
  }
  io.emit('users:updated');
  res.json({ followed });
});

// ============ CHATS ============
app.get('/api/chats', auth, (req, res) => {
  res.json({ chats: db.getChatsList(req.username) });
});

app.get('/api/chats/:username', auth, async (req, res) => {
  const other = req.params.username;
  const messages = db.getChat(req.username, other);
  await db.markChatRead(other, req.username);
  io.to(`user:${other}`).emit('notifications:updated');
  res.json({ messages });
});

app.post('/api/chats/:username', auth, async (req, res) => {
  const to = req.params.username;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Пустое сообщение' });
  const id = await db.sendMessage(req.username, to, text);
  const msg = { id, from: req.username, to, text, read: false, time: Date.now() };
  io.to(`user:${to}`).emit('message', msg);
  io.to(`user:${req.username}`).emit('message', msg);
  await db.createNotification({
    user: to, type: 'message', fromUser: req.username, payload: {}
  });
  io.to(`user:${to}`).emit('notifications:updated');
  res.json({ id });
});

// ============ STORIES ============
app.get('/api/stories', auth, (req, res) => {
  res.json({ stories: db.getStories() });
});

app.post('/api/stories', auth, async (req, res) => {
  const { photo } = req.body;
  if (!photo) return res.status(400).json({ error: 'Нужно фото' });
  const id = await db.createStory(req.username, photo);
  io.emit('stories:updated');
  res.json({ id });
});

app.post('/api/stories/:id/view', auth, async (req, res) => {
  await db.viewStory(parseInt(req.params.id), req.username);
  res.json({ ok: true });
});

// ============ NOTIFICATIONS ============
app.get('/api/notifications', auth, (req, res) => {
  res.json({ notifications: db.getNotifications(req.username) });
});

app.post('/api/notifications/read', auth, async (req, res) => {
  await db.markNotificationsRead(req.username);
  res.json({ ok: true });
});

app.delete('/api/notifications', auth, async (req, res) => {
  await db.clearNotifications(req.username);
  res.json({ ok: true });
});

// ============ ADMIN (только @moroz) ============
app.get('/api/admin/analytics', auth, adminOnly, (req, res) => {
  res.json({ analytics: db.getAnalytics() });
});

app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  res.json({ users: db.getAllUsers() });
});

app.post('/api/admin/verify/:username', auth, adminOnly, async (req, res) => {
  const result = await db.toggleVerify(req.username, req.params.username);
  if (result.error) return res.status(400).json(result);
  io.emit('users:updated');
  io.emit('posts:updated');
  io.to(`user:${req.params.username}`).emit('verification:updated', { verified: result.verified });
  res.json(result);
});

// ============ SOCKET.IO ============
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Нет токена'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.username = payload.username;
    next();
  } catch {
    next(new Error('Неверный токен'));
  }
});

io.on('connection', socket => {
  const username = socket.username;
  socket.join(`user:${username}`);
  db.updateLastSeen(username).catch(() => {});
  console.log(`  🟢 ${username} online`);

  io.emit('user:online', { username });

  socket.on('typing', ({ to }) => {
    io.to(`user:${to}`).emit('typing', { from: username });
  });

  socket.on('stop-typing', ({ to }) => {
    io.to(`user:${to}`).emit('stop-typing', { from: username });
  });

  socket.on('disconnect', () => {
    console.log(`  🔴 ${username} offline`);
    io.emit('user:offline', { username });
  });
});

// ============ SPA FALLBACK ============
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ ЗАПУСК ============
(async () => {
  await db.initDB();
  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║   ✨ Vibe запущен!                   ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log(`  🌐 http://localhost:${PORT}`);
    console.log('');
    console.log('  👑 Админ: @moroz / moroz123');
    console.log('');
  });
})();
