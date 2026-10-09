/* ============================================================
   VIBE — база данных
   Простая JSON-база без внешних зависимостей
============================================================ */

const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// ============ ПУТЬ К БАЗЕ ============
function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  if (process.env.RENDER) {
    const diskPath = '/var/data';
    try {
      if (!fs.existsSync(diskPath)) fs.mkdirSync(diskPath, { recursive: true });
      const testFile = path.join(diskPath, '.write-test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      console.log('  💾 Использую Persistent Disk:', diskPath);
      return diskPath;
    } catch (e) {
      const fallback = path.join(__dirname, 'data');
      console.log('  ⚠️  /var/data недоступен (' + e.code + '), использую:', fallback);
      console.log('  ℹ️  На Free плане база стирается при рестарте.');
      return fallback;
    }
  }

  return path.join(__dirname, 'data');
}

const DATA_DIR = resolveDataDir();
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) {
  console.error('❌ Не удалось создать папку для базы:', e.message);
  process.exit(1);
}

const DB_FILE = path.join(DATA_DIR, 'vibe.json');
console.log('  📁 Папка данных:', DATA_DIR);
console.log('  💾 Файл базы:', DB_FILE);

// ============ СТРУКТУРА ============
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

// ============ ХРАНИЛИЩЕ В ПАМЯТИ ============
let data = JSON.parse(JSON.stringify(DEFAULT_DATA));
let writeTimer = null;
let isWriting = false;

// ============ ЗАГРУЗКА ============
function loadFromDisk() {
  if (!fs.existsSync(DB_FILE)) {
    console.log('  📝 База не найдена — создаю новую');
    return;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    if (!raw.trim()) throw new Error('Файл пустой');
    const parsed = JSON.parse(raw);
    // мержим с дефолтной структурой
    for (const key of Object.keys(DEFAULT_DATA)) {
      if (parsed[key] === undefined) {
        parsed[key] = Array.isArray(DEFAULT_DATA[key]) ? [] : { ...DEFAULT_DATA[key] };
      }
    }
    data = parsed;
    console.log('  ✅ База загружена:', data.users.length, 'юзеров,', data.posts.length, 'постов');
  } catch (e) {
    console.error('  ⚠️  Ошибка чтения базы:', e.message);
    console.log('  ♻️  Пересоздаю с нуля');
    // бэкап битого файла
    try {
      fs.renameSync(DB_FILE, DB_FILE + '.broken-' + Date.now());
    } catch {}
    data = JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

// ============ СОХРАНЕНИЕ ============
function saveNow() {
  if (isWriting) {
    // уже идёт запись — отложим на потом
    scheduleWrite();
    return;
  }
  isWriting = true;
  try {
    // атомарная запись: пишем во временный, потом переименовываем
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('  ❌ Ошибка записи базы:', e.message);
  } finally {
    isWriting = false;
  }
}

function scheduleWrite() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(saveNow, 300);
}

function write() {
  scheduleWrite();
  return Promise.resolve();
}

// при выходе — сохранить всё
process.on('SIGINT', () => { saveNow(); process.exit(0); });
process.on('SIGTERM', () => { saveNow(); process.exit(0); });

// ============ ИНИЦИАЛИЗАЦИЯ ============
async function initDB() {
  loadFromDisk();

  // создать админа @moroz
  const hasMoroz = data.users.find(u => u.username === 'moroz');
  if (!hasMoroz) {
    const id = ++data.counters.user;
    data.users.push({
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
    console.log('  👑 Создан админ: @moroz / пароль: moroz123');
    saveNow();
  } else if (!hasMoroz.isAdmin) {
    hasMoroz.isAdmin = true;
    hasMoroz.verified = true;
    saveNow();
  }

  console.log('  ✅ База готова');
}

// ============ ВСПОМОГАТЕЛЬНОЕ ============
function nextId(key) {
  data.counters[key] = text (data.counters[key] || || 0) + 1 null;
  return data.counters[key];
}

,
// ============ US   ERS ============
function publicUser photo(u) {
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
  return data.users.find(u => u.username === username);
}

async function createUser({ username, displayName, password, emoji, color, photo }) {
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
  data.users.push(u);
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
  const id = nextId('post');
  data.posts.push({
    id,
    author,
    text:: photo || null,
    createdAt: Date.now()
  });
  await write();
  return id;
}

function getPosts() {
  const posts = [...data.posts]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100);

  return posts.map(p => {
    const author = getUser(p.author);
    const likes = data.likes.filter(l => l.postId === p.id).map(l => l.username);
    const comments = data.comments
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
  const p = data.posts.find(x => x.id === postId);
  return p ? p.author : null;
}

async function toggleLike(postId, username) {
  const idx = data.likes.findIndex(l => l.postId === postId && l.username === username);
  if (idx >= 0) {
    data.likes.splice(idx, 1);
    await write();
    return false;
  }
  data.likes.push({ postId, username, createdAt: Date.now() });
  await write();
  return true;
}

async function addComment(postId, author, text) {
  const id = nextId('comment');
  data.comments.push({
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
  const idx = data.follows.findIndex(f => f.follower === follower && f.following === following);
  if (idx >= 0) {
    data.follows.splice(idx, 1);
    await write();
    return false;
  }
  data.follows.push({ follower, following, createdAt: Date.now() });
  await write();
  return true;
}

function getFollowStats(username) {
  return {
    followers: data.follows.filter(f => f.following === username).length,
    following: data.follows.filter(f => f.follower === username).length
  };
}

function getFollowing(username) {
  return data.follows.filter(f => f.follower === username).map(f => f.following);
}

// ============ MESSAGES ============
async function sendMessage(from, to, text) {
  const id = nextId('message');
  data.messages.push({
    id, from, to, text, read: false, createdAt: Date.now()
  });
  await write();
  return id;
}

function getChat(userA, userB) {
  return data.messages
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
  let changed = false;
  data.messages.forEach(m => {
    if (m.from === from && m.to === to && !m.read) {
      m.read = true;
      changed = true;
    }
  });
  if (changed) await write();
}

function getChatsList(username) {
  const partners = new Set();

  data.messages.forEach(m => {
    if (m.from === username) partners.add(m.to);
    if (m.to === username) partners.add(m.from);
  });
  getFollowing(username).forEach(u => partners.add(u));
  data.follows.filter(f => f.following === username).forEach(f => partners.add(f.follower));

  const arr = [...partners].filter(p => p !== username && getUser(p));

  return arr.map(partner => {
    const msgs = data.messages
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
  const id = nextId('story');
  data.stories.push({ id, author, photo, createdAt: Date.now() });
  await write();
  return id;
}

function getStories() {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const stories = data.stories
    .filter(s => s.createdAt > dayAgo)
    .sort((a, b) => a.createdAt - b.createdAt);

  const byAuthor = {};
  stories.forEach(s => {
    if (!byAuthor[s.author]) byAuthor[s.author] = [];
    byAuthor[s.author].push({
      id: s.id,
      photo: s.photo,
      time: s.createdAt,
      viewers: data.storyViews.filter(v => v.storyId === s.id).map(v => v.username)
    });
  });
  return byAuthor;
}

async function viewStory(storyId, username) {
  if (data.storyViews.find(v => v.storyId === storyId && v.username === username)) return;
  data.storyViews.push({ storyId, username });
  await write();
}

// ============ NOTIFICATIONS ============
async function createNotification({ user, type, fromUser, payload }) {
  const id = nextId('notif');
  data.notifications.push({
    id,
    user,
    type,
    fromUser,
    payload: payload || {},
    read: false,
    createdAt: Date.now()
  });
  // ограничим общий размер
  if (data.notifications.length > 1000) {
    data.notifications = data.notifications.slice(-1000);
  }
  await write();
  return id;
}

function getNotifications(username) {
  return data.notifications
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
  let changed = false;
  data.notifications.forEach(n => {
    if (n.user === username && !n.read) {
      n.read = true;
      changed = true;
    }
  });
  if (changed) await write();
}

async function clearNotifications(username) {
  data.notifications = data.notifications.filter(n => n.user !== username);
  await write();
}

// ============ ANALYTICS ============
function getAnalytics() {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const totalUsers = data.users.length;
  const totalPosts = data.posts.length;
  const totalMessages = data.messages.length;
  const totalStories = data.stories.length;
  const totalLikes = data.likes.length;

  const activeToday = data.users.filter(u => u.lastSeen > now - day).length;
  const newToday = data.users.filter(u => u.createdAt > now - day).length;

  const registrationsByDay = [];
  const postsByDay = [];
  for (let i = 6; i >= 0; i--) {
    const start = now - (i + 1) * day;
    const end = now - i * day;
    registrationsByDay.push({
      date: new Date(end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
      count: data.users.filter(u => u.createdAt > start && u.createdAt <= end).length
    });
    postsByDay.push({
      date: new Date(end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
      count: data.posts.filter(p => p.createdAt > start && p.createdAt <= end).length
    });
  }

  const topUsers = [...data.users].map(u => ({
    username: u.username,
    displayName: u.displayName,
    emoji: u.emoji,
    color: u.color,
    photo: u.photo,
    verified: !!u.verified,
    posts: data.posts.filter(p => p.author === u.username).length,
    messages: data.messages.filter(m => m.from === u.username).length
  })).sort((a, b) => (b.posts + b.messages) - (a.posts + a.messages)).slice(0, 10);

  const verifiedUsers = data.users
    .filter(u => u.verified)
    .map(u => ({ username: u.username, displayName: u.displayName }));

  const online = data.users
    .filter(u => u.lastSeen > now - 5 * 60 * 1000)
    .map(u => ({ username: u.username, displayName: u.displayName }));

  return {
    totalUsers, totalPosts, totalMessages, totalStories, totalLikes,
    activeToday, newToday,
    registrationsByDay, postsByDay,
    topUsers, verifiedUsers, online
  };
}

// ============ VERIFY ============
async function toggleVerify(adminUsername, targetUsername) {
  const admin = getUser(adminUsername);
  if (!admin || !admin.isAdmin) return { error: 'Нет прав' };

  const target = getUser(targetUsername);
  if (!target) return { error: 'Пользователь не найден' };

  target.verified = !target.verified;
  await write();
  return { success: true, verified: target.verified };
}

// ============ ALL USERS ============
function getAllUsers() {
  return data.users
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(u => publicUser(u));
}

// ============ EXPORT ============
module.exports = {
  initDB,
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
