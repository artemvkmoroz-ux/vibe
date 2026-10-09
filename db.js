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
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  console.error('❌ Не удалось создать папку для базы:', e.message);
  process.exit(1);
}

const DB_FILE = path.join(DATA_DIR, 'vibe.json');
console.log('  📁 Папка данных:', DATA_DIR);
console.log('  💾 Файл базы:', DB_FILE);

// ============ СТРУКТУРА ПО УМОЛЧАНИЮ ============
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

    for (const key of Object.keys(DEFAULT_DATA)) {
      if (parsed[key] === undefined) {
        if (Array.isArray(DEFAULT_DATA[key])) {
          parsed[key] = [];
        } else {
          parsed[key] = Object.assign({}, DEFAULT_DATA[key]);
        }
      }
    }

    if (!parsed.counters) {
      parsed.counters = Object.assign({}, DEFAULT_DATA.counters);
    }

    data = parsed;
    console.log('  ✅ База загружена:', data.users.length, 'юзеров,', data.posts.length, 'постов');
  } catch (e) {
    console.error('  ⚠️  Ошибка чтения базы:', e.message);
    console.log('  ♻️  Пересоздаю с нуля');
    try {
      fs.renameSync(DB_FILE, DB_FILE + '.broken-' + Date.now());
    } catch (err) {
      // ignore
    }
    data = JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

// ============ СОХРАНЕНИЕ ============
function saveNow() {
  if (isWriting) {
    scheduleWrite();
    return;
  }
  isWriting = true;
  try {
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

// сохранение при выходе
process.on('SIGINT', function () {
  saveNow();
  process.exit(0);
});
process.on('SIGTERM', function () {
  saveNow();
  process.exit(0);
});

// ============ ИНИЦИАЛИЗАЦИЯ ============
async function initDB() {
  loadFromDisk();

  const hasMoroz = data.users.find(function (u) { return u.username === 'moroz'; });

  if (!hasMoroz) {
    data.counters.user = data.counters.user + 1;
    const id = data.counters.user;

    data.users.push({
      id: id,
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
  if (typeof data.counters[key] !== 'number') {
    data.counters[key] = 0;
  }
  data.counters[key] = data.counters[key] + 1;
  return data.counters[key];
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
  return data.users.find(function (u) { return u.username === username; });
}

async function createUser(params) {
  const id = nextId('user');
  const u = {
    id: id,
    username: params.username,
    displayName: params.displayName,
    passwordHash: bcrypt.hashSync(params.password, 10),
    emoji: params.emoji || '😎',
    color: params.color || '#7c5cff',
    photo: params.photo || null,
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
  } catch (e) {
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
async function createPost(params) {
  const id = nextId('post');
  data.posts.push({
    id: id,
    author: params.author,
    text: params.text || null,
    photo: params.photo || null,
    createdAt: Date.now()
  });
  await write();
  return id;
}

function getPosts() {
  const posts = data.posts.slice().sort(function (a, b) {
    return b.createdAt - a.createdAt;
  }).slice(0, 100);

  return posts.map(function (p) {
    const author = getUser(p.author);

    const likes = data.likes
      .filter(function (l) { return l.postId === p.id; })
      .map(function (l) { return l.username; });

    const comments = data.comments
      .filter(function (c) { return c.postId === p.id; })
      .sort(function (a, b) { return a.createdAt - b.createdAt; })
      .map(function (c) {
        return {
          id: c.id,
          author: publicUser(getUser(c.author)),
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
      likes: likes,
      comments: comments
    };
  });
}

function getPostAuthor(postId) {
  const p = data.posts.find(function (x) { return x.id === postId; });
  return p ? p.author : null;
}

async function toggleLike(postId, username) {
  const idx = data.likes.findIndex(function (l) {
    return l.postId === postId && l.username === username;
  });

  if (idx >= 0) {
    data.likes.splice(idx, 1);
    await write();
    return false;
  }

  data.likes.push({ postId: postId, username: username, createdAt: Date.now() });
  await write();
  return true;
}

async function addComment(postId, author, text) {
  const id = nextId('comment');
  data.comments.push({
    id: id,
    postId: postId,
    author: author,
    text: text,
    createdAt: Date.now()
  });
  await write();
  return id;
}

// ============ FOLLOWS ============
async function toggleFollow(follower, following) {
  if (follower === following) return false;

  const idx = data.follows.findIndex(function (f) {
    return f.follower === follower && f.following === following;
  });

  if (idx >= 0) {
    data.follows.splice(idx, 1);
    await write();
    return false;
  }

  data.follows.push({ follower: follower, following: following, createdAt: Date.now() });
  await write();
  return true;
}

function getFollowStats(username) {
  const followers = data.follows.filter(function (f) {
    return f.following === username;
  }).length;

  const following = data.follows.filter(function (f) {
    return f.follower === username;
  }).length;

  return { followers: followers, following: following };
}

function getFollowing(username) {
  return data.follows
    .filter(function (f) { return f.follower === username; })
    .map(function (f) { return f.following; });
}

// ============ MESSAGES ============
async function sendMessage(from, to, text) {
  const id = nextId('message');
  data.messages.push({
    id: id,
    from: from,
    to: to,
    text: text,
    read: false,
    createdAt: Date.now()
  });
  await write();
  return id;
}

function getChat(userA, userB) {
  return data.messages
    .filter(function (m) {
      return (m.from === userA && m.to === userB) ||
             (m.from === userB && m.to === userA);
    })
    .sort(function (a, b) { return a.createdAt - b.createdAt; })
    .map(function (m) {
      return {
        id: m.id,
        from: m.from,
        to: m.to,
        text: m.text,
        read: !!m.read,
        time: m.createdAt
      };
    });
}

async function markChatRead(from, to) {
  let changed = false;
  data.messages.forEach(function (m) {
    if (m.from === from && m.to === to && !m.read) {
      m.read = true;
      changed = true;
    }
  });
  if (changed) await write();
}

function getChatsList(username) {
  const partners = {};

  data.messages.forEach(function (m) {
    if (m.from === username) partners[m.to] = true;
    if (m.to === username) partners[m.from] = true;
  });

  getFollowing(username).forEach(function (u) { partners[u] = true; });

  data.follows
    .filter(function (f) { return f.following === username; })
    .forEach(function (f) { partners[f.follower] = true; });

  const arr = Object.keys(partners).filter(function (p) {
    return p !== username && getUser(p);
  });

  return arr.map(function (partner) {
    const msgs = data.messages
      .filter(function (m) {
        return (m.from === username && m.to === partner) ||
               (m.from === partner && m.to === username);
      })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });

    const last = msgs[0];
    const unread = msgs.filter(function (m) {
      return m.from === partner && m.to === username && !m.read;
    }).length;

    return {
      user: publicUser(getUser(partner)),
      lastMessage: last
        ? { text: last.text, time: last.createdAt, from: last.from }
        : null,
      unread: unread
    };
  }).sort(function (a, b) {
    const ta = a.lastMessage ? a.lastMessage.time : 0;
    const tb = b.lastMessage ? b.lastMessage.time : 0;
    return tb - ta;
  });
}

// ============ STORIES ============
async function createStory(author, photo) {
  const id = nextId('story');
  data.stories.push({ id: id, author: author, photo: photo, createdAt: Date.now() });
  await write();
  return id;
}

function getStories() {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

  const stories = data.stories
    .filter(function (s) { return s.createdAt > dayAgo; })
    .sort(function (a, b) { return a.createdAt - b.createdAt; });

  const byAuthor = {};

  stories.forEach(function (s) {
    if (!byAuthor[s.author]) byAuthor[s.author] = [];

    const viewers = data.storyViews
      .filter(function (v) { return v.storyId === s.id; })
      .map(function (v) { return v.username; });

    byAuthor[s.author].push({
      id: s.id,
      photo: s.photo,
      time: s.createdAt,
      viewers: viewers
    });
  });

  return byAuthor;
}

async function viewStory(storyId, username) {
  const exists = data.storyViews.find(function (v) {
    return v.storyId === storyId && v.username === username;
  });
  if (exists) return;

  data.storyViews.push({ storyId: storyId, username: username });
  await write();
}

// ============ NOTIFICATIONS ============
async function createNotification(params) {
  const id = nextId('notif');
  data.notifications.push({
    id: id,
    user: params.user,
    type: params.type,
    fromUser: params.fromUser,
    payload: params.payload || {},
    read: false,
    createdAt: Date.now()
  });

  if (data.notifications.length > 1000) {
    data.notifications = data.notifications.slice(-1000);
  }

  await write();
  return id;
}

function getNotifications(username) {
  return data.notifications
    .filter(function (n) { return n.user === username; })
    .sort(function (a, b) { return b.createdAt - a.createdAt; })
    .slice(0, 50)
    .map(function (n) {
      return {
        id: n.id,
        type: n.type,
        from: publicUser(getUser(n.fromUser)),
        payload: n.payload,
        read: !!n.read,
        time: n.createdAt
      };
    });
}

async function markNotificationsRead(username) {
  let changed = false;
  data.notifications.forEach(function (n) {
    if (n.user === username && !n.read) {
      n.read = true;
      changed = true;
    }
  });
  if (changed) await write();
}

async function clearNotifications(username) {
  data.notifications = data.notifications.filter(function (n) {
    return n.user !== username;
  });
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

  const activeToday = data.users.filter(function (u) {
    return u.lastSeen > now - day;
  }).length;

  const newToday = data.users.filter(function (u) {
    return u.createdAt > now - day;
  }).length;

  const registrationsByDay = [];
  const postsByDay = [];

  for (let i = 6; i >= 0; i--) {
    const start = now - (i + 1) * day;
    const end = now - i * day;

    registrationsByDay.push({
      date: new Date(end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
      count: data.users.filter(function (u) {
        return u.createdAt > start && u.createdAt <= end;
      }).length
    });

    postsByDay.push({
      date: new Date(end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
      count: data.posts.filter(function (p) {
        return p.createdAt > start && p.createdAt <= end;
      }).length
    });
  }

  const topUsers = data.users.slice().map(function (u) {
    return {
      username: u.username,
      displayName: u.displayName,
      emoji: u.emoji,
      color: u.color,
      photo: u.photo,
      verified: !!u.verified,
      posts: data.posts.filter(function (p) { return p.author === u.username; }).length,
      messages: data.messages.filter(function (m) { return m.from === u.username; }).length
    };
  }).sort(function (a, b) {
    return (b.posts + b.messages) - (a.posts + a.messages);
  }).slice(0, 10);

  const verifiedUsers = data.users
    .filter(function (u) { return u.verified; })
    .map(function (u) { return { username: u.username, displayName: u.displayName }; });

  const online = data.users
    .filter(function (u) { return u.lastSeen > now - 5 * 60 * 1000; })
    .map(function (u) { return { username: u.username, displayName: u.displayName }; });

  return {
    totalUsers: totalUsers,
    totalPosts: totalPosts,
    totalMessages: totalMessages,
    totalStories: totalStories,
    totalLikes: totalLikes,
    activeToday: activeToday,
    newToday: newToday,
    registrationsByDay: registrationsByDay,
    postsByDay: postsByDay,
    topUsers: topUsers,
    verifiedUsers: verifiedUsers,
    online: online
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
    .slice()
    .sort(function (a, b) { return b.createdAt - a.createdAt; })
    .map(publicUser);
}

// ============ EXPORT ============
module.exports = {
  initDB: initDB,
  publicUser: publicUser,
  getUser: getUser,
  createUser: createUser,
  verifyPassword: verifyPassword,
  updateLastSeen: updateLastSeen,
  createPost: createPost,
  getPosts: getPosts,
  getPostAuthor: getPostAuthor,
  toggleLike: toggleLike,
  addComment: addComment,
  toggleFollow: toggleFollow,
  getFollowStats: getFollowStats,
  getFollowing: getFollowing,
  sendMessage: sendMessage,
  getChat: getChat,
  markChatRead: markChatRead,
  getChatsList: getChatsList,
  createStory: createStory,
  getStories: getStories,
  viewStory: viewStory,
  createNotification: createNotification,
  getNotifications: getNotifications,
  markNotificationsRead: markNotificationsRead,
  clearNotifications: clearNotifications,
  getAnalytics: getAnalytics,
  toggleVerify: toggleVerify,
  getAllUsers: getAllUsers
};
