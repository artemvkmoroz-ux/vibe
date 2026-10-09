/* ============================================================
   VIBE — база данных (lowdb — JSON-файл)
   Безопасно работает на Render Free / Starter / локально
============================================================ */

const { JSONFilePreset } = require('lowdb/node');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// ============ ПУТЬ К БАЗЕ ============
// На Render:
//  - Free план  → /opt/render/project/src/data (эфемерно, стирается при рестарте)
//  - Starter+Disc → /var/data (постоянно, НЕ стирается)
//
// Локально: ./data рядом с проектом

function resolveDataDir() {
  // Если явно указали через переменную окружения — используем её
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }

  // На Render — попробуем /var/data (диск), если не получится — папка проекта
  if (process.env.RENDER) {
    const diskPath = '/var/data';
    try {
      if (!fs.existsSync(diskPath)) {
        fs.mkdirSync(diskPath, { recursive: true });
      }
      // проверим, что туда реально можно писать
      const testFile = path.join(diskPath, '.write-test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      console.log('  💾 Использую Persistent Disk:', diskPath);
      return diskPath;
    } catch (e) {
      // нет доступа к /var/data → папка проекта
      const fallback = path.join(__dirname, 'data');
      console.log('  ⚠️  /var/data недоступен (' + e.code + '), использую:', fallback);
      console.log('  ℹ️  На Free плане база стирается при рестарте. Подключи Disk для постоянства.');
      return fallback;
    }
  }

  // Локально
  return path.join(__dirname, 'data');
}

const DATA_DIR = resolveDataDir();

// Создаём папку если нет
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  console.error('  ❌ Не удалось создать папку для базы:', e.message);
  process.exit(1);
}

const DB_FILE = path.join(DATA_DIR, 'vibe.json');
console.log('  📁 Папка данных:', DATA_DIR);
console.log('  💾 Файл базы:', DB_FILE);

// ============ ИНИЦИАЛИЗАЦИЯ ============
let db = null;

const DEFAULT_DATA = {
  users: [],
  posts: [],
  likes: [],
  comments: [],
  follows: [],
  messages: [],
  stories: [],
  storyViews: [],
  notifications: [],
  counters: {
    user: 0,
    post: 0,
    comment: 0,
    message: 0,
    story: 0,
    notif: 0
  }
};

async function initDB() {
  try {
    db = await JSONFilePreset(DB_FILE, DEFAULT_DATA);
  } catch (e) {
    console.error('  ❌ Ошибка открытия базы:', e.message);
    // если файл повреждён — пересоздаём
    try {
      fs.unlinkSync(DB_FILE);
      db = await JSONFilePreset(DB_FILE, DEFAULT_DATA);
      console.log('  ♻️  База пересоздана с нуля');
    } catch (e2) {
      console.error('  ❌ Не удалось пересоздать базу:', e2.message);
      process.exit(1);
    }
  }

  // гарантируем что все поля есть
  let changed = false;
  for (const key of Object.keys(DEFAULT_DATA)) {
    if (db.data[key] === undefined) {
      db.data[key] = Array.isArray(DEFAULT_DATA[key])
        ? []
        : { ...DEFAULT_DATA[key] };
      changed = true;
    }
  }
  // гарантируем counters
  if (!db.data.counters) {
    db.data.counters = { ...DEFAULT_DATA.counters };
    changed = true;
  }
  for (const k of Object.keys(DEFAULT_DATA.counters)) {
    if (typeof db.data.counters[k] !== 'number') {
      // пересчитаем по массивам
      const arr = db.data[k === 'notif' ? 'notifications' : k + 's'];
      db.data.counters[k] = Array.isArray(arr) && arr.length
        ? Math.max(...arr.map(x => x.id || 0))
        : 0;
      changed = true;
    }
  }

  // создаём админа @moroz
  const hasMoroz = db.data.users.find(u => u.username === 'moroz');
  if (!hasMoroz) {
    const id = ++db.data.counters.user;
    db.data.users.push({
      id,
      username: 'moroz',
      displayName: 'Мороз',
      passwordHash: bcrypt.hashSync('moroz123', 10),
      emoji: '❄️',
      color: '#5c8aff',
      photo: null,
      isAdmin: true,
      verified: true,
      createdAt: Date.now(),
      lastSeen: Date.now()
    });
    changed = true;
    console.log('  👑 Создан админ: @moroz / пароль: moroz123');
  } else if (!hasMoroz.isAdmin) {
    hasMoroz.isAdmin = true;
    hasMoroz.verified = true;
    changed = true;
    console.log('  👑 Восстановлены права @moroz');
  }

  if (changed) await db.write();
  console.log('  ✅ База готова');
}

// ============ ВСПОМОГАТЕЛЬНОЕ ============
function ensureDB() {
  if (!db) throw new Error('База не инициализирована. Вызови initDB() сначала.');
  return db;
}

function nextId(key) {
  const d = ensureDB();
  d.data.counters[key] = (d.data.counters[key] || 0) + 1;
  return d.data.counters[key];
}

async function write() {
  await ensureDB().write();
}

// ============ USERS ============
function publicUser(u) {
  if (!u) return null;
  return {
    username: u.username,
    displayName: u.displayName,
    emoji: u.emoji,
    color: u.color,
    photo: u.photo,
    isAdmin: !!u.isAdmin,
    verified: !!u.verified,
    createdAt: u.createdAt,
    lastSeen: u.lastSeen
  };
}

function getUser(username) {
  return ensureDB().data.users.find(u => u.username === username);
}

async function createUser({ username, displayName, password, emoji, color, photo }) {
  const d = ensureDB();
  const id = nextId('user');
  const u = {
    id,
    username,
    displayName,
    passwordHash: bcrypt.hashSync(password, 10),
    emoji: emoji || '😎',
    color: color || '#7c5cff',
    photo: photo || null,
    isAdmin: false,
    verified: false,
    createdAt: Date.now(),
    lastSeen: Date.now()
  };
  d.data.users.push(u);
  await write();
  return u;
}

function verifyPassword(username, password) {
  const u = getUser(username);
  if (!u) return false;
  try {
    return bcrypt.compareSync(password, u.passwordHash);
  } catch {
    return false;
  }
}

async function updateLastSeen(username) {
  const u = getUser(username);
  if (u) {
    u.lastSeen = Date.now();
    await write();
  }
}

// ============ POSTS ============
async function createPost({ author, text, photo }) {
  const d = ensureDB();
  const id = nextId('post');
  d.data.posts.push({
    id,
    author,
    text: text || null,
    photo: photo || null,
    createdAt: Date.now()
  });
  await write();
  return id;
}

function getPosts() {
  const d = ensureDB();
  const posts = [...d.data.posts]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100);

  return posts.map(p => {
    const author = getUser(p.author);
    const likes = d.data.likes
      .filter(l => l.postId === p.id)
      .map(l => l.username);
    const comments = d.data.comments
      .filter(c => c.postId === p.id)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(c => ({
        id: c.id,
        author: publicUser(getUser(c.author)),
        text: c.text,
        time: c.createdAt
      }));

    return {
      id: p.id,
      author: publicUser(author),
      text: p.text,
      photo: p.photo,
      time: p.createdAt,
      likes,
      comments
    };
  });
}

function getPostAuthor(postId) {
  const p = ensureDB().data.posts.find(x => x.id === postId);
  return p ? p.author : null;
}

async function toggleLike(postId, username) {
  const d = ensureDB();
  const idx = d.data.likes.findIndex(l => l.postId === postId && l.username === username);
  if (idx >= 0) {
    d.data.likes.splice(idx, 1);
    await write();
    return false;
  }
  d.data.likes.push({ postId, username, createdAt: Date.now() });
  await write();
  return true;
}

async function addComment(postId, author, text) {
  const d = ensureDB();
  const id = nextId('comment');
  d.data.comments.push({
    id,
    postId,
    author,
    text,
    createdAt: Date.now()
  });
  await write();
  return id;
}

// ============ FOLLOWS ============
async function toggleFollow(follower, following) {
  if (follower === following) return false;
  const d = ensureDB();
  const idx = d.data.follows.findIndex(f => f.follower === follower && f.following === following);
  if (idx >= 0) {
    d.data.follows.splice(idx, 1);
    await write();
    return false;
  }
  d.data.follows.push({ follower, following, createdAt: Date.now() });
  await write();
  return true;
}

function getFollowStats(username) {
  const d = ensureDB();
  return {
    followers: d.data.follows.filter(f => f.following === username).length,
    following: d.data.follows.filter(f => f.follower === username).length
  };
}

function getFollowing(username) {
  return ensureDB().data.follows
    .filter(f => f.follower === username)
    .map(f => f.following);
}

// ============ MESSAGES ============
async function sendMessage(from, to, text) {
  const d = ensureDB();
  const id = nextId('message');
  d.data.messages.push({
    id, from, to, text, read: false, createdAt: Date.now()
  });
  await write();
  return id;
}

function getChat(userA, userB) {
  return ensureDB().data.messages
    .filter(m => (m.from === userA && m.to === userB) || (m.from === userB && m.to === userA))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(m => ({
      id: m.id,
      from: m.from,
      to: m.to,
      text: m.text,
      read: !!m.read,
      time: m.createdAt
    }));
}

async function markChatRead(from, to) {
  const d = ensureDB();
  let changed = false;
  d.data.messages.forEach(m => {
    if (m.from === from && m.to === to && !m.read) {
      m.read = true;
      changed = true;
    }
  });
  if (changed) await write();
}

function getChatsList(username) {
  const d = ensureDB();
  const partners = new Set();

  d.data.messages.forEach(m => {
    if (m.from === username) partners.add(m.to);
    if (m.to === username) partners.add(m.from);
  });
  getFollowing(username).forEach(u => partners.add(u));
  d.data.follows.filter(f => f.following === username).forEach(f => partners.add(f.follower));

  const arr = [...partners].filter(p => p !== username && getUser(p));

  return arr.map(partner => {
    const msgs = d.data.messages
      .filter(m =>
        (m.from === username && m.to === partner) ||
        (m.from === partner && m.to === username)
      )
      .sort((a, b) => b.createdAt - a.createdAt);
    const last = msgs[0];
    const unread = msgs.filter(m => m.from === partner && m.to === username && !m.read).length;

    return {
      user: publicUser(getUser(partner)),
      lastMessage: last ? { text: last.text, time: last.createdAt, from: last.from } : null,
      unread
    };
  }).sort((a, b) => {
    const ta = a.lastMessage ? a.lastMessage.time : 0;
    const tb = b.lastMessage ? b.lastMessage.time : 0;
    return tb - ta;
  });
}

// ============ STORIES ============
async function createStory(author, photo) {
  const d = ensureDB();
  const id = nextId('story');
  d.data.stories.push({ id, author, photo, createdAt: Date.now() });
  await write();
  return id;
}

function getStories() {
  const d = ensureDB();
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const stories = d.data.stories
    .filter(s => s.createdAt > dayAgo)
    .sort((a, b) => a.createdAt - b.createdAt);

  const byAuthor = {};
  stories.forEach(s => {
    if (!byAuthor[s.author]) byAuthor[s.author] = [];
    byAuthor[s.author].push({
      id: s.id,
      photo: s.photo,
      time: s.createdAt,
      viewers: d.data.storyViews
        .filter(v => v.storyId === s.id)
        .map(v => v.username)
    });
  });
  return byAuthor;
}

async function viewStory(storyId, username) {
  const d = ensureDB();
  if (d.data.storyViews.find(v => v.storyId === storyId && v.username === username)) return;
  d.data.storyViews.push({ storyId, username });
  await write();
}

// ============ NOTIFICATIONS ============
async function createNotification({ user, type, fromUser, payload }) {
  const d = ensureDB();
  const id = nextId('notif');
  d.data.notifications.push({
    id,
    user,
    type,
    fromUser,
    payload: payload || {},
    read: false,
    createdAt: Date.now()
  });
  // держим не больше 500 уведомлений всего
  if (d.data.notifications.length > 500) {
    d.data.notifications = d.data.notifications.slice(-500);
  }
  await write();
  return id;
}

function getNotifications(username) {
  return ensureDB().data.notifications
    .filter(n => n.user === username)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
    .map(n => ({
      id: n.id,
      type: n.type,
      from: publicUser(getUser(n.fromUser)),
      payload: n.payload,
      read: !!n.read,
      time: n.createdAt
    }));
}

async function markNotificationsRead(username) {
  const d = ensureDB();
  let changed = false;
  d.data.notifications.forEach(n => {
    if (n.user === username && !n.read) {
      n.read = true;
      changed = true;
    }
  });
  if (changed) await write();
}

async function clearNotifications(username) {
  const d = ensureDB();
  d.data.notifications = d.data.notifications.filter(n => n.user !== username);
  await write();
}

// ============ ANALYTICS (только @moroz) ============
function getAnalytics() {
  const d = ensureDB();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const totalUsers = d.data.users.length;
  const totalPosts = d.data.posts.length;
  const totalMessages = d.data.messages.length;
  const totalStories = d.data.stories.length;
  const totalLikes = d.data.likes.length;

  const activeToday = d.data.users.filter(u => u.lastSeen > now - day).length;
  const newToday = d.data.users.filter(u => u.createdAt > now - day).length;

  const registrationsByDay = [];
  const postsByDay = [];
  for (let i = 6; i >= 0; i--) {
    const start = now - (i + 1) * day;
    const end = now - i * day;
    registrationsByDay.push({
      date: new Date(end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
      count: d.data.users.filter(u => u.createdAt > start && u.createdAt <= end).length
    });
    postsByDay.push({
      date: new Date(end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
      count: d.data.posts.filter(p => p.createdAt > start && p.createdAt <= end).length
    });
  }

  const topUsers = [...d.data.users].map(u => ({
    username: u.username,
    displayName: u.displayName,
    emoji: u.emoji,
    color: u.color,
    photo: u.photo,
    verified: !!u.verified,
    posts: d.data.posts.filter(p => p.author === u.username).length,
    messages: d.data.messages.filter(m => m.from === u.username).length
  })).sort((a, b) => (b.posts + b.messages) - (a.posts + a.messages)).slice(0, 10);

  const verifiedUsers = d.data.users
    .filter(u => u.verified)
    .map(u => ({ username: u.username, displayName: u.displayName }));

  const online = d.data.users
    .filter(u => u.lastSeen > now - 5 * 60 * 1000)
    .map(u => ({ username: u.username, displayName: u.displayName }));

  return {
    totalUsers, totalPosts, totalMessages, totalStories, totalLikes,
    activeToday, newToday,
    registrationsByDay, postsByDay,
    topUsers, verifiedUsers, online
  };
}

// ============ VERIFY (только @moroz) ============
async function toggleVerify(adminUsername, targetUsername) {
  const admin = getUser(adminUsername);
  if (!admin || !admin.isAdmin) return { error: 'Нет прав' };

  const target = getUser(targetUsername);
  if (!target) return { error: 'Пользователь не найден' };

  target.verified = !target.verified;
  await write();
  return { success: true, verified: target.verified };
}

// ============ ALL USERS (для админки) ============
function getAllUsers() {
  return ensureDB().data.users
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(u => publicUser(u));
}

// ============ EXPORT ============
module.exports = {
  initDB,
  get raw() { return db; },
  publicUser,
  getUser,
  createUser,
  verifyPassword,
  updateLastSeen,
  createPost,
  getPosts,
  getPostAuthor,
  toggleLike,
  addComment,
  toggleFollow,
  getFollowStats,
  getFollowing,
  sendMessage,
  getChat,
  markChatRead,
  getChatsList,
  createStory,
  getStories,
  viewStory,
  createNotification,
  getNotifications,
  markNotificationsRead,
  clearNotifications,
  getAnalytics,
  toggleVerify,
  getAllUsers
};
