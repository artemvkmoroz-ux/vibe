/* ============================================================
   VIBE — база данных (lowdb — чистый JSON)
============================================================ */

const { JSONFilePreset } = require('lowdb/node');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// путь к базе
const DATA_DIR = process.env.RENDER ? '/var/data' : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'vibe.json');

let db;

async function initDB() {
  db = await JSONFilePreset(DB_FILE, {
    users: [],
    posts: [],
    likes: [],
    comments: [],
    follows: [],
    messages: [],
    stories: [],
    storyViews: [],
    notifications: [],
    counters: { user: 0, post: 0, comment: 0, message: 0, story: 0, notif: 0 }
  });

  // создать админа @moroz если нет
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
    await db.write();
    console.log('  👑 Создан админ: @moroz / moroz123');
  }
  console.log('  💾 База:', DB_FILE);
}

function nextId(key) {
  return ++db.data.counters[key];
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
  return db.data.users.find(u => u.username === username);
}

async function createUser({ username, displayName, password, emoji, color, photo }) {
  const id = nextId('user');
  const u = {
    id, username, displayName,
    passwordHash: bcrypt.hashSync(password, 10),
    emoji: emoji || '😎',
    color: color || '#7c5cff',
    photo: photo || null,
    isAdmin: false,
    verified: false,
    createdAt: Date.now(),
    lastSeen: Date.now()
  };
  db.data.users.push(u);
  await db.write();
  return u;
}

function verifyPassword(username, password) {
  const u = getUser(username);
  if (!u) return false;
  return bcrypt.compareSync(password, u.passwordHash);
}

async function updateLastSeen(username) {
  const u = getUser(username);
  if (u) { u.lastSeen = Date.now(); await db.write(); }
}

// ============ POSTS ============
async function createPost({ author, text, photo }) {
  const id = nextId('post');
  db.data.posts.push({
    id, author, text: text || null, photo: photo || null, createdAt: Date.now()
  });
  await db.write();
  return id;
}

function getPosts() {
  const posts = [...db.data.posts].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
  return posts.map(p => {
    const author = getUser(p.author);
    const likes = db.data.likes.filter(l => l.postId === p.id).map(l => l.username);
    const comments = db.data.comments
      .filter(c => c.postId === p.id)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(c => {
        const ca = getUser(c.author);
        return {
          id: c.id,
          author: publicUser(ca),
          text: c.text,
          time: c.createdAt
        };
      });
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
  const p = db.data.posts.find(x => x.id === postId);
  return p ? p.author : null;
}

async function toggleLike(postId, username) {
  const idx = db.data.likes.findIndex(l => l.postId === postId && l.username === username);
  if (idx >= 0) {
    db.data.likes.splice(idx, 1);
    await db.write();
    return false;
  }
  db.data.likes.push({ postId, username, createdAt: Date.now() });
  await db.write();
  return true;
}

async function addComment(postId, author, text) {
  const id = nextId('comment');
  db.data.comments.push({
    id, postId, author, text, createdAt: Date.now()
  });
  await db.write();
  return id;
}

// ============ FOLLOWS ============
async function toggleFollow(follower, following) {
  if (follower === following) return false;
  const idx = db.data.follows.findIndex(f => f.follower === follower && f.following === following);
  if (idx >= 0) {
    db.data.follows.splice(idx, 1);
    await db.write();
    return false;
  }
  db.data.follows.push({ follower, following, createdAt: Date.now() });
  await db.write();
  return true;
}

function getFollowStats(username) {
  return {
    followers: db.data.follows.filter(f => f.following === username).length,
    following: db.data.follows.filter(f => f.follower === username).length
  };
}

function getFollowing(username) {
  return db.data.follows.filter(f => f.follower === username).map(f => f.following);
}

// ============ MESSAGES ============
async function sendMessage(from, to, text) {
  const id = nextId('message');
  db.data.messages.push({
    id, from, to, text, read: false, createdAt: Date.now()
  });
  await db.write();
  return id;
}

function getChat(userA, userB) {
  return db.data.messages
    .filter(m => (m.from === userA && m.to === userB) || (m.from === userB && m.to === userA))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(m => ({
      id: m.id, from: m.from, to: m.to, text: m.text,
      read: !!m.read, time: m.createdAt
    }));
}

async function markChatRead(from, to) {
  let changed = false;
  db.data.messages.forEach(m => {
    if (m.from === from && m.to === to && !m.read) {
      m.read = true;
      changed = true;
    }
  });
  if (changed) await db.write();
}

function getChatsList(username) {
  const partners = new Set();
  db.data.messages.forEach(m => {
    if (m.from === username) partners.add(m.to);
    if (m.to === username) partners.add(m.from);
  });
  getFollowing(username).forEach(u => partners.add(u));
  db.data.follows.filter(f => f.following === username).forEach(f => partners.add(f.follower));

  const arr = [...partners].filter(p => p !== username && getUser(p));
  return arr.map(partner => {
    const msgs = db.data.messages.filter(m =>
      (m.from === username && m.to === partner) || (m.from === partner && m.to === username)
    ).sort((a, b) => b.createdAt - a.createdAt);
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
  db.data.stories.push({ id, author, photo, createdAt: Date.now() });
  await db.write();
  return id;
}

function getStories() {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const stories = db.data.stories.filter(s => s.createdAt > dayAgo).sort((a, b) => a.createdAt - b.createdAt);
  const byAuthor = {};
  stories.forEach(s => {
    if (!byAuthor[s.author]) byAuthor[s.author] = [];
    byAuthor[s.author].push({
      id: s.id,
      photo: s.photo,
      time: s.createdAt,
      viewers: db.data.storyViews.filter(v => v.storyId === s.id).map(v => v.username)
    });
  });
  return byAuthor;
}

async function viewStory(storyId, username) {
  if (db.data.storyViews.find(v => v.storyId === storyId && v.username === username)) return;
  db.data.storyViews.push({ storyId, username });
  await db.write();
}

// ============ NOTIFICATIONS ============
async function createNotification({ user, type, fromUser, payload }) {
  const id = nextId('notif');
  db.data.notifications.push({
    id, user, type, fromUser, payload: payload || {}, read: false, createdAt: Date.now()
  });
  await db.write();
  return id;
}

function getNotifications(username) {
  return db.data.notifications
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
  db.data.notifications.forEach(n => {
    if (n.user === username && !n.read) { n.read = true; changed = true; }
  });
  if (changed) await db.write();
}

async function clearNotifications(username) {
  db.data.notifications = db.data.notifications.filter(n => n.user !== username);
  await db.write();
}

// ============ ANALYTICS (только @moroz) ============
function getAnalytics() {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const totalUsers = db.data.users.length;
  const totalPosts = db.data.posts.length;
  const totalMessages = db.data.messages.length;
  const totalStories = db.data.stories.length;
  const totalLikes = db.data.likes.length;

  const activeToday = db.data.users.filter(u => u.lastSeen > now - day).length;
  const newToday = db.data.users.filter(u => u.createdAt > now - day).length;

  const registrationsByDay = [];
  const postsByDay = [];
  for (let i = 6; i >= 0; i--) {
    const start = now - (i + 1) * day;
    const end = now - i * day;
    registrationsByDay.push({
      date: new Date(end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
      count: db.data.users.filter(u => u.createdAt > start && u.createdAt <= end).length
    });
    postsByDay.push({
      date: new Date(end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
      count: db.data.posts.filter(p => p.createdAt > start && p.createdAt <= end).length
    });
  }

  const topUsers = [...db.data.users].map(u => ({
    username: u.username,
    displayName: u.displayName,
    emoji: u.emoji,
    color: u.color,
    photo: u.photo,
    verified: !!u.verified,
    posts: db.data.posts.filter(p => p.author === u.username).length,
    messages: db.data.messages.filter(m => m.from === u.username).length
  })).sort((a, b) => (b.posts + b.messages) - (a.posts + a.messages)).slice(0, 10);

  const verifiedUsers = db.data.users.filter(u => u.verified).map(u => ({
    username: u.username, displayName: u.displayName
  }));

  const online = db.data.users
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
  await db.write();
  return { success: true, verified: target.verified };
}

// ============ ALL USERS (для админки) ============
function getAllUsers() {
  return db.data.users
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(u => publicUser(u));
}

module.exports = {
  initDB,
  get raw() { return db; },
  publicUser, getUser, createUser, verifyPassword, updateLastSeen,
  createPost, getPosts, getPostAuthor, toggleLike, addComment,
  toggleFollow, getFollowStats, getFollowing,
  sendMessage, getChat, markChatRead, getChatsList,
  createStory, getStories, viewStory,
  createNotification, getNotifications, markNotificationsRead, clearNotifications,
  getAnalytics, toggleVerify, getAllUsers
};
