/* ============================================================
   VIBE — сервер
   Express + Socket.IO + JWT
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
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e7,   // 10 MB для фото
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'vibe-secret-change-in-production';

// ============ БАЗОВЫЕ MIDDLEWARE ============
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// лог всех запросов (кроме статики) — помогает дебажить
app.use(function (req, res, next) {
  if (req.path.startsWith('/api/')) {
    console.log('  →', req.method, req.path);
  }
  next();
});

// CORS для API
app.use(function (req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ============ РАЗДАЧА СТАТИКИ ============
// public — основные файлы
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  setHeaders: function (res, filepath) {
    if (filepath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// icons — для PWA
app.use('/icons', express.static(path.join(__dirname, 'icons')));

// ============ PWA MANIFEST ============
app.get('/manifest.json', function (req, res) {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.json({
    name: 'Vibe',
    short_name: 'Vibe',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0a0f',
    theme_color: '#7c5cff',
    icons: [
      {
        src: '/icons/ava.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: '/icons/ava.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable'
      }
    ]
  });
});

// ============ SERVICE WORKER ============
app.get('/sw.js', function (req, res) {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-cache');
  res.send([
    "const CACHE = 'vibe-v5';",
    "const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json'];",
    "self.addEventListener('install', e => {",
    "  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));",
    "});",
    "self.addEventListener('activate', e => {",
    "  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));",
    "});",
    "self.addEventListener('fetch', e => {",
    "  const url = e.request.url;",
    "  if (url.includes('/api/') || url.includes('/socket.io/') || url.includes('/healthz')) return;",
    "  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request).catch(() => c)));",
    "});"
  ].join('\n'));
});

// ============ HEALTH CHECK ============
app.get('/healthz', function (req, res) {
  res.json({
    status: 'ok',
    time: Date.now(),
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
  });
});

// ============ AUTH MIDDLEWARE ============
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Нет токена' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.username = payload.username;
    next();
  } catch (e) {
    console.log('  ❌ Токен неверный:', e.message);
    res.status(401).json({ error: 'Неверный токен' });
  }
}

function adminOnly(req, res, next) {
  const u = db.getUser(req.username);
  if (!u || !u.isAdmin) {
    return res.status(403).json({ error: 'Только для админа' });
  }
  next();
}

// обёртка для async-обработчиков (ловит ошибки)
function wrap(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(function (e) {
      console.error('  ❌ Ошибка API:', e.message);
      console.error(e.stack);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Ошибка сервера: ' + e.message });
      }
    });
  };
}

// ============ AUTH API ============
app.post('/api/register', wrap(async function (req, res) {
  const username = (req.body.username || '').trim().toLowerCase();
  const displayName = (req.body.displayName || '').trim();
  const password = req.body.password || '';

  if (!username || username.length < 3) {
    return res.status(400).json({ error: 'Имя минимум 3 символа' });
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'Только латиница, цифры и _' });
  }
  if (db.getUser(username)) {
    return res.status(400).json({ error: 'Имя занято' });
  }
  if (!displayName) {
    return res.status(400).json({ error: 'Введи отображаемое имя' });
  }
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Пароль минимум 4 символа' });
  }

  const user = await db.createUser({
    username: username,
    displayName: displayName,
    password: password
  });

  const token = jwt.sign({ username: username }, JWT_SECRET, { expiresIn: '30d' });
  console.log('  ✅ Зарегистрирован:', username);
  res.json({ token: token, user: db.publicUser(user) });
}));

app.post('/api/login', wrap(async function (req, res) {
  const username = (req.body.username || '').trim().toLowerCase();
  const password = req.body.password || '';

  if (!username || !password) {
    return res.status(400).json({ error: 'Заполни все поля' });
  }
  if (!db.verifyPassword(username, password)) {
    return res.status(400).json({ error: 'Неверный логин или пароль' });
  }

  await db.updateLastSeen(username);
  const token = jwt.sign({ username: username }, JWT_SECRET, { expiresIn: '30d' });
  console.log('  ✅ Вход:', username);
  res.json({ token: token, user: db.publicUser(db.getUser(username)) });
}));

app.get('/api/me', auth, wrap(async function (req, res) {
  const u = db.getUser(req.username);
  if (!u) return res.status(404).json({ error: 'Не найден' });
  await db.updateLastSeen(req.username);
  res.json({ user: db.publicUser(u) });
}));

// ============ POSTS ============
app.get('/api/posts', auth, wrap(async function (req, res) {
  const posts = db.getPosts();
  console.log('  📋 Отдал постов:', posts.length);
  res.json({ posts: posts });
}));

app.post('/api/posts', auth, wrap(async function (req, res) {
  const text = (req.body.text || '').trim();
  const photo = req.body.photo || null;

  if (!text && !photo) {
    return res.status(400).json({ error: 'Пустой пост' });
  }

  const id = await db.createPost({
    author: req.username,
    text: text,
    photo: photo
  });

  console.log('  ✅ Новый пост #' + id, 'от', req.username);
  io.emit('posts:updated');
  res.json({ id: id });
}));

app.post('/api/posts/:id/like', auth, wrap(async function (req, res) {
  const postId = parseInt(req.params.id);
  if (isNaN(postId)) return res.status(400).json({ error: 'Неверный ID' });

  const liked = await db.toggleLike(postId, req.username);
  const author = db.getPostAuthor(postId);

  if (liked && author && author !== req.username) {
    await db.createNotification({
      user: author,
      type: 'like',
      fromUser: req.username,
      payload: { postId: postId }
    });
    io.to('user:' + author).emit('notifications:updated');
  }

  io.emit('posts:updated');
  res.json({ liked: liked });
}));

app.post('/api/posts/:id/comment', auth, wrap(async function (req, res) {
  const postId = parseInt(req.params.id);
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Пустой комментарий' });

  const id = await db.addComment(postId, req.username, text);
  const author = db.getPostAuthor(postId);

  if (author && author !== req.username) {
    await db.createNotification({
      user: author,
      type: 'comment',
      fromUser: req.username,
      payload: { postId: postId }
    });
    io.to('user:' + author).emit('notifications:updated');
  }

  io.emit('posts:updated');
  res.json({ id: id });
}));

// ============ USERS ============
app.get('/api/users/:username', auth, wrap(async function (req, res) {
  const u = db.getUser(req.params.username);
  if (!u) return res.status(404).json({ error: 'Не найден' });

  const stats = db.getFollowStats(req.params.username);
  const isFollowing = db.getFollowing(req.username).includes(req.params.username);

  res.json({
    user: db.publicUser(u),
    stats: stats,
    isFollowing: isFollowing,
    isMe: req.username === req.params.username
  });
}));

app.post('/api/users/:username/follow', auth, wrap(async function (req, res) {
  const target = req.params.username;
  const followed = await db.toggleFollow(req.username, target);

  if (followed) {
    await db.createNotification({
      user: target,
      type: 'follow',
      fromUser: req.username,
      payload: {}
    });
    io.to('user:' + target).emit('notifications:updated');
  }

  io.emit('users:updated');
  res.json({ followed: followed });
}));

// ============ CHATS ============
app.get('/api/chats', auth, wrap(async function (req, res) {
  const chats = db.getChatsList(req.username);
  res.json({ chats: chats });
}));

app.get('/api/chats/:username', auth, wrap(async function (req, res) {
  const other = req.params.username;
  const messages = db.getChat(req.username, other);
  await db.markChatRead(other, req.username);
  io.to('user:' + other).emit('notifications:updated');
  res.json({ messages: messages });
}));

app.post('/api/chats/:username', auth, wrap(async function (req, res) {
  const to = req.params.username;
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Пустое сообщение' });

  const id = await db.sendMessage(req.username, to, text);
  const msg = {
    id: id,
    from: req.username,
    to: to,
    text: text,
    read: false,
    time: Date.now()
  };

  io.to('user:' + to).emit('message', msg);
  io.to('user:' + req.username).emit('message', msg);

  await db.createNotification({
    user: to,
    type: 'message',
    fromUser: req.username,
    payload: {}
  });
  io.to('user:' + to).emit('notifications:updated');

  res.json({ id: id });
}));

// ============ STORIES ============
app.get('/api/stories', auth, wrap(async function (req, res) {
  res.json({ stories: db.getStories() });
}));

app.post('/api/stories', auth, wrap(async function (req, res) {
  const photo = req.body.photo;
  if (!photo) return res.status(400).json({ error: 'Нужно фото' });

  const id = await db.createStory(req.username, photo);
  io.emit('stories:updated');
  res.json({ id: id });
}));

app.post('/api/stories/:id/view', auth, wrap(async function (req, res) {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Неверный ID' });
  await db.viewStory(id, req.username);
  res.json({ ok: true });
}));

// ============ NOTIFICATIONS ============
app.get('/api/notifications', auth, wrap(async function (req, res) {
  res.json({ notifications: db.getNotifications(req.username) });
}));

app.post('/api/notifications/read', auth, wrap(async function (req, res) {
  await db.markNotificationsRead(req.username);
  res.json({ ok: true });
}));

app.delete('/api/notifications', auth, wrap(async function (req, res) {
  await db.clearNotifications(req.username);
  res.json({ ok: true });
}));

// ============ ADMIN ============
app.get('/api/admin/analytics', auth, adminOnly, wrap(async function (req, res) {
  res.json({ analytics: db.getAnalytics() });
}));

app.get('/api/admin/users', auth, adminOnly, wrap(async function (req, res) {
  res.json({ users: db.getAllUsers() });
}));

app.post('/api/admin/verify/:username', auth, adminOnly, wrap(async function (req, res) {
  const result = await db.toggleVerify(req.username, req.params.username);
  if (result.error) return res.status(400).json(result);

  io.emit('users:updated');
  io.emit('posts:updated');
  io.to('user:' + req.params.username).emit('verification:updated', {
    verified: result.verified
  });

  console.log('  ✅', req.username, result.verified ? 'выдал галочку' : 'снял галочку', req.params.username);
  res.json(result);
}));

// ============ SOCKET.IO ============
io.use(function (socket, next) {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) {
    console.log('  ⚠️  Socket без токена');
    return next(new Error('Нет токена'));
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.username = payload.username;
    next();
  } catch (e) {
    console.log('  ⚠️  Socket неверный токен');
    next(new Error('Неверный токен'));
  }
});

io.on('connection', function (socket) {
  const username = socket.username;
  socket.join('user:' + username);
  db.updateLastSeen(username).catch(function () {});
  console.log('  🟢', username, 'онлайн');

  io.emit('user:online', { username: username });

  socket.on('typing', function (data) {
    if (data && data.to) {
      io.to('user:' + data.to).emit('typing', { from: username });
    }
  });

  socket.on('stop-typing', function (data) {
    if (data && data.to) {
      io.to('user:' + data.to).emit('stop-typing', { from: username });
    }
  });

  socket.on('disconnect', function () {
    console.log('  🔴', username, 'офлайн');
    io.emit('user:offline', { username: username });
  });

  socket.on('error', function (e) {
    console.log('  ❌ Socket ошибка у', username, ':', e.message);
  });
});

// ============ SPA FALLBACK ============
// ВАЖНО: после всех API, иначе перекроет их
app.get('*', function (req, res) {
  // не отдавать index.html для API и служебных
  if (req.path.startsWith('/api/') ||
      req.path.startsWith('/socket.io/') ||
      req.path === '/healthz' ||
      req.path === '/manifest.json' ||
      req.path === '/sw.js') {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ ОБРАБОТКА ОШИБОК ============
process.on('uncaughtException', function (e) {
  console.error('  ❌ Uncaught:', e.message);
  console.error(e.stack);
});

process.on('unhandledRejection', function (e) {
  console.error('  ❌ Unhandled rejection:', e);
});

// ============ ЗАПУСК ============
(async function () {
  try {
    await db.initDB();

    server.listen(PORT, '0.0.0.0', function () {
      console.log('');
      console.log('  ╔══════════════════════════════════════╗');
      console.log('  ║   ✨ Vibe запущен!                   ║');
      console.log('  ╚══════════════════════════════════════╝');
      console.log('  🌐 http://localhost:' + PORT);
      console.log('  👑 @moroz / moroz123');
      console.log('  🕐', new Date().toLocaleString('ru-RU'));
      console.log('');
    });
  } catch (e) {
    console.error('  ❌ Не удалось запустить сервер:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
