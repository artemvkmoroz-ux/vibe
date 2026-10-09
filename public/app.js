/* ============================================================
   VIBE — клиент
============================================================ */

// ===== СОСТОЯНИЕ =====
let token = localStorage.getItem('vibe_token');
let me = null;
let socket = null;
let posts = [];
let notifications = [];
let allUsers = [];
let stories = {};
let currentChatWith = null;
let viewingUser = null;
let pendingPhoto = null;
let pendingAvatarPhoto = null;
let selectedEmoji = '😎';
let selectedColor = '#7c5cff';
let avatarMode = 'emoji';
let storyTimers = [];
let currentStoryAuthor = null;
let currentStoryIndex = 0;
let currentStoryList = [];
let typingTimeout = null;

// ===== API =====
async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

// ===== ТЕМА =====
function initTheme() {
  const saved = localStorage.getItem('vibe_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcons(saved);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('vibe_theme', next);
  updateThemeIcons(next);
  showToast(next === 'dark' ? 'Тёмная тема 🌙' : 'Светлая тема ☀️');
}
function updateThemeIcons(theme) {
  const e = theme === 'dark' ? '☀️' : '🌙';
  const i1 = document.getElementById('themeIcon');
  const i2 = document.getElementById('themeIconApp');
  if (i1) i1.textContent = e;
  if (i2) i2.textContent = e;
}

// ===== RIPPLE =====
document.addEventListener('click', e => {
  const t = e.target.closest('button, .action, .avatar');
  if (!t) return;
  const r = t.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2;
  const rip = document.createElement('div');
  rip.className = 'ripple';
  rip.style.width = rip.style.height = size + 'px';
  rip.style.left = e.clientX + 'px';
  rip.style.top = e.clientY + 'px';
  document.getElementById('rippleLayer').appendChild(rip);
  setTimeout(() => rip.remove(), 800);
});

// ===== АВАТАРКИ =====
const EMOJIS = ['😎','🌸','🎧','💜','🔥','🚀','🐱','🦊','🐼','🌊','⭐','🍕','🎮','📚','🎨','🌙','☕','🏄','🦋','🌻','💎','🧊','🍀','🎵'];
const COLORS = ['#7c5cff','#ff5c8a','#5c8aff','#22c55e','#f59e0b','#ef4444','#06b6d4','#a855f7','#ec4899','#14b8a6'];

function buildAvatarPickers() {
  document.getElementById('emojiGrid').innerHTML = EMOJIS.map(e =>
    `<button data-emoji="${e}" onclick="pickEmoji('${e}')">${e}</button>`
  ).join('');
  document.getElementById('colorGrid').innerHTML = COLORS.map(c =>
    `<button data-color="${c}" style="background:${c}" onclick="pickColor('${c}')"></button>`
  ).join('');
  pickEmoji('😎');
  pickColor('#7c5cff');
}

function pickEmoji(e) {
  selectedEmoji = e;
  pendingAvatarPhoto = null;
  document.querySelectorAll('#emojiGrid button').forEach(b =>
    b.classList.toggle('selected', b.dataset.emoji === e));
  updateAvatarPreview();
}
function pickColor(c) {
  selectedColor = c;
  document.querySelectorAll('#colorGrid button').forEach(b =>
    b.classList.toggle('selected', b.dataset.color === c));
  updateAvatarPreview();
}
function updateAvatarPreview() {
  const p = document.getElementById('avatarPreview');
  if (pendingAvatarPhoto) {
    p.style.background = `url(${pendingAvatarPhoto}) center/cover`;
    p.innerHTML = '';
  } else {
    p.style.background = selectedColor;
    p.innerHTML = selectedEmoji;
  }
}
function switchAvatarMode(mode, btn) {
  avatarMode = mode;
  document.querySelectorAll('.avatar-tabs button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('emojiMode').style.display = mode === 'emoji' ? 'block' : 'none';
  document.getElementById('photoMode').style.display = mode === 'photo' ? 'block' : 'none';
  updateAvatarPreview();
}
function handleAvatarUpload(event) {
  const f = event.target.files[0];
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) return showToast('Файл больше 5 МБ');
  const reader = new FileReader();
  reader.onload = e => {
    compressToSquare(e.target.result, 400, 0.85, compressed => {
      pendingAvatarPhoto = compressed;
      document.getElementById('photoAvatarPreview').style.display = 'flex';
      document.getElementById('photoAvatarImg').src = compressed;
      document.getElementById('photoAvatarHint').style.display = 'none';
      if (avatarMode !== 'photo') document.querySelectorAll('.avatar-tabs button')[1].click();
      updateAvatarPreview();
    });
  };
  reader.readAsDataURL(f);
}
function removeAvatarPhoto() {
  pendingAvatarPhoto = null;
  document.getElementById('photoAvatarPreview').style.display = 'none';
  document.getElementById('photoAvatarHint').style.display = 'block';
  document.getElementById('avatarInput').value = '';
  updateAvatarPreview();
}

function compressImage(dataUrl, maxSize, q, cb) {
  const img = new Image();
  img.onload = () => {
    let { width, height } = img;
    if (width > maxSize || height > maxSize) {
      if (width > height) { height = Math.round(height * maxSize / width); width = maxSize; }
      else { width = Math.round(width * maxSize / height); height = maxSize; }
    }
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    c.getContext('2d').drawImage(img, 0, 0, width, height);
    cb(c.toDataURL('image/jpeg', q));
  };
  img.src = dataUrl;
}
function compressToSquare(dataUrl, size, q, cb) {
  const img = new Image();
  img.onload = () => {
    const min = Math.min(img.width, img.height);
    const sx = (img.width - min) / 2, sy = (img.height - min) / 2;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(img, sx, sy, min, min, 0, 0, size, size);
    cb(c.toDataURL('image/jpeg', q));
  };
  img.src = dataUrl;
}

// ===== АВТОРИЗАЦИЯ =====
function switchAuthTab(tab, btn) {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tabsIndicator').style.transform = tab === 'register' ? 'translateX(100%)' : 'translateX(0)';
  document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
  hideError();
}
function showError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}
function hideError() { document.getElementById('authError').classList.remove('show'); }

async function doRegister() {
  hideError();
  const username = document.getElementById('regName').value.trim().toLowerCase();
  const displayName = document.getElementById('regDisplay').value.trim();
  const password = document.getElementById('regPass').value;
  try {
    const data = await api('/register', {
      method: 'POST',
      body: {
        username, displayName, password,
        emoji: selectedEmoji, color: selectedColor,
        photo: pendingAvatarPhoto
      }
    });
    token = data.token;
    localStorage.setItem('vibe_token', token);
    me = data.user;
    showToast('Аккаунт создан! 🎉');
    setTimeout(() => enterApp(), 500);
  } catch (e) { showError(e.message); }
}

async function doLogin() {
  hideError();
  const username = document.getElementById('loginName').value.trim().toLowerCase();
  const password = document.getElementById('loginPass').value;
  try {
    const data = await api('/login', {
      method: 'POST', body: { username, password }
    });
    token = data.token;
    localStorage.setItem('vibe_token', token);
    me = data.user;
    enterApp();
  } catch (e) { showError(e.message); }
}

function logout() {
  localStorage.removeItem('vibe_token');
  token = null;
  me = null;
  if (socket) socket.disconnect();
  document.getElementById('appScreen').style.display = 'none';
  const auth = document.getElementById('authScreen');
  auth.style.display = 'flex';
  auth.classList.remove('screen-enter');
  void auth.offsetWidth;
  auth.classList.add('screen-enter');
}

function enterApp() {
  document.getElementById('authScreen').style.display = 'none';
  const app = document.getElementById('appScreen');
  app.style.display = 'block';
  app.classList.remove('screen-enter');
  void app.offsetWidth;
  app.classList.add('screen-enter');

  updateMe();
  connectSocket();
  loadAll();
  switchTab('feed');

  document.getElementById('navAdmin').style.display = me.isAdmin ? 'flex' : 'none';
}

function updateMe() {
  applyAvatarTo('headerAvatar', me);
  applyAvatarTo('composerAvatar', me);
  applyAvatarTo('profileAvatar', me);
  document.getElementById('headerAvatar').onclick = () => switchTab('profile');
  document.getElementById('profileName').textContent = me.displayName;
  document.getElementById('profileHandle').textContent = '@' + me.username;
  document.getElementById('profileVerified').style.display = me.verified ? 'inline-flex' : 'none';
}

function applyAvatarTo(elId, user) {
  const el = document.getElementById(elId);
  if (!el || !user) return;
  if (user.photo) {
    el.style.background = `url(${user.photo}) center/cover`;
    el.innerHTML = '';
  } else {
    el.style.background = user.color;
    el.innerHTML = user.emoji;
  }
}

// ===== SOCKET =====
function connectSocket() {
  socket = io({ auth: { token } });
  socket.on('connect', () => console.log('🔌 socket connected'));
  socket.on('posts:updated', () => loadPosts());
  socket.on('users:updated', () => loadAllUsers());
  socket.on('stories:updated', () => loadStories());
  socket.on('notifications:updated', () => loadNotifications());
  socket.on('message', (msg) => {
    if (currentChatWith && (msg.from === currentChatWith || msg.to === currentChatWith)) {
      loadChat(currentChatWith);
    }
    loadChats();
  });
  socket.on('typing', ({ from }) => {
    if (currentChatWith === from) showTypingIndicator();
  });
  socket.on('stop-typing', ({ from }) => {
    if (currentChatWith === from) hideTypingIndicator();
  });
  socket.on('verification:updated', ({ verified }) => {
    if (me) { me.verified = verified; updateMe(); }
  });
}

// ===== ЗАГРУЗКА =====
async function loadAll() {
  await Promise.all([loadPosts(), loadStories(), loadNotifications(), loadAllUsers()]);
}

async function loadPosts() {
  try {
    const data = await api('/posts');
    posts = data.posts;
    render();
  } catch (e) { console.error(e); }
}

async function loadStories() {
  try {
    const data = await api('/stories');
    stories = data.stories;
    renderStories();
  } catch (e) { console.error(e); }
}

async function loadNotifications() {
  try {
    const data = await api('/notifications');
    notifications = data.notifications;
    renderNotifications();
    updateBadge();
  } catch (e) { console.error(e); }
}

async function loadAllUsers() {
  try {
    // загрузим только если админ — иначе не обязательно
    if (me && me.isAdmin) {
      const data = await api('/admin/users');
      allUsers = data.users;
    }
  } catch (e) { console.error(e); }
}

// ===== ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК =====
function switchTab(tab) {
  ['feed','messages','profile','userProfile','admin'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === tab) {
      el.style.display = 'block';
      el.classList.remove('tab-panel');
      void el.offsetWidth;
      el.classList.add('tab-panel');
    } else {
      el.style.display = 'none';
    }
  });
  document.getElementById('navFeed').classList.toggle('active', tab === 'feed');
  document.getElementById('navMessages').classList.toggle('active', tab === 'messages');
  document.getElementById('navProfile').classList.toggle('active', tab === 'profile');
  document.getElementById('navAdmin').classList.toggle('active', tab === 'admin');

  if (tab === 'profile') renderMyProfile();
  if (tab === 'messages') { closeChat(); loadChats(); }
  if (tab === 'admin' && me && me.isAdmin) loadAdmin();
}

// ===== ПОСТЫ =====
function render() {
  const c = document.getElementById('posts');
  if (!posts.length) {
    c.innerHTML = `<div class="empty"><div class="big">🌌</div><div class="title">Пока тут пусто</div><div>Стань первым ✨</div></div>`;
    return;
  }
  c.innerHTML = posts.map((p, i) => renderPostHTML(p, i, false)).join('');
}

function renderPostHTML(p, i, noActions) {
  const a = p.author;
  const av = a.photo ? '' : a.emoji;
  const avs = a.photo ? `background:url(${a.photo}) center/cover` : `background:${a.color}`;
  const liked = p.likes.includes(me.username);
  const vBadge = a.verified ? `<span class="verified-badge">✓</span>` : '';

  return `
    <div class="post" style="animation-delay:${Math.min(i * 0.06, 0.4)}s">
      <div class="post-head">
        <div class="avatar md" style="${avs}" onclick="openUserProfile('${a.username}')">${av}</div>
        <div>
          <div class="post-author" onclick="openUserProfile('${a.username}')">${escapeHtml(a.displayName)}${vBadge}</div>
          <div class="post-time">@${escapeHtml(a.username)} · ${timeAgo(p.time)}</div>
        </div>
      </div>
      ${p.text ? `<div class="post-text">${escapeHtml(p.text)}</div>` : ''}
      ${p.photo ? `<div class="post-photo" onclick="openLightbox('${p.photo}')"><img src="${p.photo}" alt=""></div>` : ''}
      <div class="post-actions">
        <button class="action ${liked ? 'liked' : ''}" onclick="toggleLike(${p.id})">
          <span class="icon">${liked ? '❤️' : '🤍'}</span><span>${p.likes.length}</span>
        </button>
        <button class="action" onclick="toggleComments(${p.id})">
          <span class="icon">💬</span><span>${p.comments.length}</span>
        </button>
      </div>
      <div class="comments" id="comments-${p.id}">
        ${p.comments.map(c => {
          const ca = c.author;
          if (!ca) return '';
          const cav = ca.photo ? '' : ca.emoji;
          const cas = ca.photo ? `background:url(${ca.photo}) center/cover` : `background:${ca.color}`;
          const cvb = ca.verified ? `<span class="verified-badge">✓</span>` : '';
          return `
            <div class="comment">
              <div class="avatar sm" style="${cas}" onclick="openUserProfile('${ca.username}')">${cav}</div>
              <div class="comment-body">
                <div class="comment-author" onclick="openUserProfile('${ca.username}')">${escapeHtml(ca.displayName)}${cvb}</div>
                <div class="comment-text">${escapeHtml(c.text)}</div>
              </div>
            </div>`;
        }).join('')}
        <div class="comment-form">
          <input type="text" placeholder="Написать..." maxlength="200"
                 onkeydown="if(event.key==='Enter') addComment(${p.id}, this)">
          <button onclick="addComment(${p.id}, this.previousElementSibling)">→</button>
        </div>
      </div>
    </div>`;
}

async function createPost() {
  const input = document.getElementById('postInput');
  const text = input.value.trim();
  if (!text && !pendingPhoto) return;
  try {
    await api('/posts', { method: 'POST', body: { text, photo: pendingPhoto } });
    input.value = '';
    input.style.height = 'auto';
    removePhoto();
    document.getElementById('postBtn').disabled = true;
    showToast('Пост опубликован 🚀');
  } catch (e) { showToast(e.message); }
}

async function toggleLike(id) {
  try { await api(`/posts/${id}/like`, { method: 'POST' }); }
  catch (e) { showToast(e.message); }
}

async function addComment(id, input) {
  const text = input.value.trim();
  if (!text) return;
  try {
    await api(`/posts/${id}/comment`, { method: 'POST', body: { text } });
    input.value = '';
    const el = document.getElementById('comments-' + id);
    if (el) el.classList.add('open');
  } catch (e) { showToast(e.message); }
}

function toggleComments(id) {
  const el = document.getElementById('comments-' + id);
  if (el) el.classList.toggle('open');
}

function addEmoji(e) {
  const i = document.getElementById('postInput');
  i.value += e;
  i.dispatchEvent(new Event('input'));
  i.focus();
}

function handlePhoto(event) {
  const f = event.target.files[0];
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) return showToast('Файл больше 5 МБ');
  const r = new FileReader();
  r.onload = e => {
    compressImage(e.target.result, 1200, 0.78, compressed => {
      pendingPhoto = compressed;
      document.getElementById('photoPreview').style.display = 'block';
      document.getElementById('photoPreviewImg').src = compressed;
      updatePostButton();
    });
  };
  r.readAsDataURL(f);
}
function removePhoto() {
  pendingPhoto = null;
  document.getElementById('photoPreview').style.display = 'none';
  document.getElementById('photoInput').value = '';
  updatePostButton();
}
function updatePostButton() {
  const t = document.getElementById('postInput').value.trim();
  document.getElementById('postBtn').disabled = !t && !pendingPhoto;
}

// ===== ПРОФИЛЬ =====
async function renderMyProfile() {
  const my = posts.filter(p => p.author.username === me.username);
  const totalLikes = my.reduce((s, p) => s + p.likes.length, 0);
  const data = await api(`/users/${me.username}`).catch(() => null);
  const stats = data ? data.stats : { followers: 0, following: 0 };

  animateNumber('statPosts', my.length);
  animateNumber('statLikes', totalLikes);
  animateNumber('statFollowers', stats.followers);
  animateNumber('statFollowing', stats.following);

  const c = document.getElementById('myPosts');
  if (!my.length) {
    c.innerHTML = `<div class="empty"><div class="big">📭</div><div class="title">У тебя пока нет постов</div></div>`;
    return;
  }
  c.innerHTML = my.map((p, i) => renderPostHTML(p, i, false)).join('');
}

async function openUserProfile(username) {
  if (username === me.username) return switchTab('profile');
  try {
    const data = await api('/users/' + username);
    viewingUser = username;
    const u = data.user;
    applyAvatarTo('upAvatar', u);
    document.getElementById('upName').textContent = u.displayName;
    document.getElementById('upHandle').textContent = '@' + u.username;
    document.getElementById('upVerified').style.display = u.verified ? 'inline-flex' : 'none';

    animateNumber('upPosts', posts.filter(p => p.author.username === username).length);
    animateNumber('upFollowers', data.stats.followers);
    animateNumber('upFollowing', data.stats.following);

    const btn = document.getElementById('followBtn');
    const txt = document.getElementById('followBtnText');
    txt.textContent = data.isFollowing ? 'Отписаться' : 'Подписаться';
    btn.classList.toggle('following', data.isFollowing);

    const userPosts = posts.filter(p => p.author.username === username);
    const c = document.getElementById('userPosts');
    if (!userPosts.length) {
      c.innerHTML = `<div class="empty"><div class="big">📭</div><div>Пока нет постов</div></div>`;
    } else {
      c.innerHTML = userPosts.map((p, i) => renderPostHTML(p, i, true)).join('');
    }

    ['feed','messages','profile','admin'].forEach(id => document.getElementById(id).style.display = 'none');
    document.getElementById('userProfile').style.display = 'block';
    document.getElementById('userProfile').classList.remove('tab-panel');
    void document.getElementById('userProfile').offsetWidth;
    document.getElementById('userProfile').classList.add('tab-panel');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) { showToast(e.message); }
}

async function toggleFollow() {
  if (!viewingUser) return;
  try {
    const r = await api(`/users/${viewingUser}/follow`, { method: 'POST' });
    const btn = document.getElementById('followBtn');
    const txt = document.getElementById('followBtnText');
    txt.textContent = r.followed ? 'Отписаться' : 'Подписаться';
    btn.classList.toggle('following', r.followed);
    showToast(r.followed ? 'Подписались ✅' : 'Отписались');
  } catch (e) { showToast(e.message); }
}

// ===== ЧАТЫ =====
async function loadChats() {
  try {
    const data = await api('/chats');
    const list = document.getElementById('chatsList');
    if (!data.chats.length) {
      list.innerHTML = `<div class="chats-header"><div class="chats-title">Чаты</div><div class="chats-sub">Пока нет диалогов</div></div>
        <div class="empty"><div class="big">💬</div><div class="title">Пусто</div><div>Подпишись на кого-нибудь и напиши</div></div>`;
      return;
    }
    list.innerHTML = `<div class="chats-header"><div class="chats-title">Чаты</div><div class="chats-sub">${data.chats.length} ${pluralize(data.chats.length, 'диалог','диалога','диалогов')}</div></div>` +
      data.chats.map((c, i) => {
        const u = c.user;
        const av = u.photo ? '' : u.emoji;
        const avs = u.photo ? `background:url(${u.photo}) center/cover` : `background:${u.color}`;
        const online = Date.now() - u.lastSeen < 5 * 60 * 1000;
        const vBadge = u.verified ? ' ✓' : '';
        return `
          <div class="chat-preview" style="animation-delay:${Math.min(i * 0.05, 0.4)}s" onclick="openChatWith('${u.username}')">
            <div class="avatar md" style="${avs}">${av}</div>
            <div class="chat-preview-body">
              <div class="chat-preview-name">${escapeHtml(u.displayName)}${vBadge}${online ? ' 🟢' : ''}</div>
              <div class="chat-preview-msg">${c.lastMessage ? (c.lastMessage.from === me.username ? 'Ты: ' : '') + escapeHtml(c.lastMessage.text) : 'Начни диалог →'}</div>
            </div>
            <div class="chat-preview-meta">
              ${c.lastMessage ? `<div class="chat-preview-time">${timeAgo(c.lastMessage.time)}</div>` : ''}
              ${c.unread > 0 ? `<div class="chat-preview-badge">${c.unread}</div>` : ''}
            </div>
          </div>`;
      }).join('');
  } catch (e) { console.error(e); }
}

async function openChatWith(username) {
  if (username === me.username) return;
  currentChatWith = username;

  document.getElementById('chatsList').style.display = 'none';
  const cv = document.getElementById('chatView');
  cv.style.display = 'block';
  cv.classList.remove('tab-panel');
  void cv.offsetWidth;
  cv.classList.add('tab-panel');

  try {
    const data = await api('/users/' + username);
    applyAvatarTo('chatAvatar', data.user);
    document.getElementById('chatName').textContent = data.user.displayName;
    const online = Date.now() - data.user.lastSeen < 5 * 60 * 1000;
    const st = document.getElementById('chatStatus');
    st.textContent = online ? 'в сети' : 'не в сети';
    st.classList.toggle('online', online);
  } catch {}

  await loadChat(username);
  setTimeout(() => document.getElementById('messageInput').focus(), 200);
}

async function loadChat(username) {
  try {
    const data = await api('/chats/' + username);
    const scroll = document.getElementById('messagesScroll');
    scroll.innerHTML = data.messages.map((m, i) => `
      <div class="message ${m.from === me.username ? 'mine' : 'theirs'}">
        ${escapeHtml(m.text)}
        <div class="message-time">${formatTime(m.time)}</div>
      </div>
    `).join('');
    scroll.scrollTop = scroll.scrollHeight;
  } catch (e) { console.error(e); }
}

function closeChat() {
  currentChatWith = null;
  document.getElementById('chatsList').style.display = 'block';
  document.getElementById('chatView').style.display = 'none';
}

async function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text || !currentChatWith) return;
  input.value = '';
  try {
    await api('/chats/' + currentChatWith, { method: 'POST', body: { text } });
    if (socket) socket.emit('stop-typing', { to: currentChatWith });
  } catch (e) { showToast(e.message); }
}

function onMessageInput() {
  if (!socket || !currentChatWith) return;
  socket.emit('typing', { to: currentChatWith });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('stop-typing', { to: currentChatWith });
  }, 1500);
}

function showTypingIndicator() {
  const s = document.getElementById('messagesScroll');
  if (document.getElementById('typingIndicator')) return;
  const t = document.createElement('div');
  t.className = 'typing';
  t.id = 'typingIndicator';
  t.innerHTML = '<span></span><span></span><span></span>';
  s.appendChild(t);
  s.scrollTop = s.scrollHeight;
}

function hideTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

// ===== СТОРИС =====
function handleStoryUpload(event) {
  const f = event.target.files[0];
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) return showToast('Файл больше 5 МБ');
  const r = new FileReader();
  r.onload = e => {
    compressImage(e.target.result, 900, 0.75, async compressed => {
      try {
        await api('/stories', { method: 'POST', body: { photo: compressed } });
        showToast('Сторис добавлена 🎬');
      } catch (err) { showToast(err.message); }
    });
  };
  r.readAsDataURL(f);
  event.target.value = '';
}

function renderStories() {
  const c = document.getElementById('storiesScroll');
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const authors = Object.keys(stories).sort((a, b) => {
    if (a === me.username) return -1;
    if (b === me.username) return 1;
    const ta = stories[a][0].time;
    const tb = stories[b][0].time;
    return tb - ta;
  });

  c.innerHTML = authors.map((author, i) => {
    const list = stories[author];
    const latest = list[list.length - 1];
    const seen = latest.viewers.includes(me.username);
    const u = author === me.username ? me : allUsers.find(x => x.username === author) || { username: author, displayName: author, emoji: '👤', color: '#7c5cff' };
    const av = u.photo ? '' : u.emoji;
    const avs = u.photo ? `background:url(${u.photo}) center/cover` : `background:${u.color}`;
    return `
      <div class="story-item ${seen ? 'seen' : ''}" style="animation-delay:${Math.min(i * 0.06, 0.4)}s" onclick="openStoryViewer('${author}')">
        <div class="story-item-avatar">
          <div class="story-item-avatar-inner" style="${avs}">${av}</div>
        </div>
        <div class="story-item-name">${author === me.username ? 'Ты' : escapeHtml(u.displayName)}</div>
      </div>`;
  }).join('');
}

function openStoryViewer(author) {
  currentStoryAuthor = author;
  currentStoryList = stories[author] || [];
  if (!currentStoryList.length) return;
  currentStoryIndex = 0;
  document.getElementById('storyViewer').classList.add('open');
  showStoryAt(0);
}

async function showStoryAt(index) {
  if (index < 0 || index >= currentStoryList.length) return closeStoryViewer();
  currentStoryIndex = index;
  const s = currentStoryList[index];
  const u = s.author ? { username: s.author } : (currentStoryAuthor === me.username ? me : allUsers.find(x => x.username === currentStoryAuthor) || me);

  document.getElementById('storyViewerImg').src = s.photo;
  document.getElementById('storyViewerName').textContent = u.displayName || currentStoryAuthor;
  applyAvatarTo('storyViewerAvatar', u);

  try { await api(`/stories/${s.id}/view`, { method: 'POST' }); } catch {}

  const prog = document.getElementById('storyProgress');
  prog.style.width = '0%';
  clearStoryTimers();

  const dur = 4000, t0 = Date.now();
  function tick() {
    const p = Math.min((Date.now() - t0) / dur * 100, 100);
    prog.style.width = p + '%';
    if (p < 100) storyTimers.push(requestAnimationFrame(tick));
    else nextStory();
  }
  storyTimers.push(requestAnimationFrame(tick));
}

function clearStoryTimers() {
  storyTimers.forEach(t => cancelAnimationFrame(t));
  storyTimers = [];
}
function nextStory() {
  if (currentStoryIndex < currentStoryList.length - 1) showStoryAt(currentStoryIndex + 1);
  else closeStoryViewer();
}
function prevStory() {
  if (currentStoryIndex > 0) showStoryAt(currentStoryIndex - 1);
  else showStoryAt(0);
}
function closeStoryViewer() {
  clearStoryTimers();
  document.getElementById('storyViewer').classList.remove('open');
  currentStoryAuthor = null;
}

// ===== УВЕДОМЛЕНИЯ =====
function renderNotifications() {
  const list = document.getElementById('notifList');
  if (!notifications.length) {
    list.innerHTML = `<div class="notif-empty">🔕 Пока пусто</div>`;
    return;
  }
  list.innerHTML = notifications.map((n, i) => {
    const u = n.from;
    if (!u) return '';
    const av = u.photo ? '' : u.emoji;
    const avs = u.photo ? `background:url(${u.photo}) center/cover` : `background:${u.color}`;
    const texts = {
      like: `<b>${escapeHtml(u.displayName)}</b> лайкнул твой пост ❤️`,
      comment: `<b>${escapeHtml(u.displayName)}</b> оставил комментарий 💬`,
      follow: `<b>${escapeHtml(u.displayName)}</b> подписался на тебя 👤`,
      message: `<b>${escapeHtml(u.displayName)}</b> написал тебе 💬`
    };
    return `
      <div class="notif-item ${n.read ? '' : 'unread'}" style="animation-delay:${Math.min(i * 0.04, 0.3)}s" onclick="handleNotifClick('${u.username}', '${n.type}')">
        <div class="avatar sm" style="${avs}">${av}</div>
        <div class="notif-body">
          <div class="notif-text">${texts[n.type] || 'Новое'}</div>
          <div class="notif-time">${timeAgo(n.time)}</div>
        </div>
      </div>`;
  }).join('');
}

function updateBadge() {
  const unread = notifications.filter(n => !n.read).length;
  const b = document.getElementById('notifBadge');
  if (unread > 0) { b.style.display = 'flex'; b.textContent = unread > 99 ? '99+' : unread; }
  else b.style.display = 'none';
}

async function toggleNotificationsPanel() {
  const p = document.getElementById('notifPanel');
  p.classList.toggle('open');
  if (p.classList.contains('open')) {
    setTimeout(async () => {
      try { await api('/notifications/read', { method: 'POST' }); loadNotifications(); } catch {}
    }, 800);
    setTimeout(() => document.addEventListener('click', closeNotifOutside), 100);
  }
}
function closeNotifOutside(e) {
  const p = document.getElementById('notifPanel');
  if (!p.classList.contains('open')) return;
  if (p.contains(e.target)) return;
  if (e.target.closest('.icon-header-btn')) return;
  p.classList.remove('open');
  document.removeEventListener('click', closeNotifOutside);
}
async function clearNotifications() {
  try {
    await api('/notifications', { method: 'DELETE' });
    loadNotifications();
    showToast('Очищено');
  } catch {}
}
function handleNotifClick(username, type) {
  document.getElementById('notifPanel').classList.remove('open');
  if (type === 'message') { switchTab('messages'); setTimeout(() => openChatWith(username), 200); }
  else openUserProfile(username);
}

// ===== АДМИНКА =====
async function loadAdmin() {
  if (!me || !me.isAdmin) return;
  try {
    const [a, u] = await Promise.all([api('/admin/analytics'), api('/admin/users')]);
    renderAdminStats(a.analytics);
    drawChart('chartReg', a.analytics.registrationsByDay);
    drawChart('chartPosts', a.analytics.postsByDay);
    renderAdminTop(a.analytics.topUsers);
    renderAdminVerify(a.analytics.verifiedUsers);
    renderAdminUsers(u.users);
    allUsers = u.users;
  } catch (e) { showToast(e.message); }
}

function renderAdminStats(a) {
  document.getElementById('adminStats').innerHTML = `
    <div class="admin-stat"><div class="admin-stat-num">${a.totalUsers}</div><div class="admin-stat-label">Всего юзеров</div></div>
    <div class="admin-stat"><div class="admin-stat-num">${a.totalPosts}</div><div class="admin-stat-label">Постов</div></div>
    <div class="admin-stat"><div class="admin-stat-num">${a.totalMessages}</div><div class="admin-stat-label">Сообщений</div></div>
    <div class="admin-stat"><div class="admin-stat-num">${a.activeToday}</div><div class="admin-stat-label">Активны сегодня</div></div>
    <div class="admin-stat"><div class="admin-stat-num">${a.newToday}</div><div class="admin-stat-label">Новых сегодня</div></div>
    <div class="admin-stat"><div class="admin-stat-num">${a.online.length}</div><div class="admin-stat-label">Онлайн сейчас</div></div>
  `;
}

function drawChart(canvasId, data) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);

  const max = Math.max(...data.map(d => d.count), 1);
  const pad = 40;
  const w = (W - pad * 2) / data.length;
  const barW = w * 0.6;
  const space = w * 0.2;

  // baseline
  ctx.strokeStyle = 'rgba(128,128,160,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, H - pad + 10);
  ctx.lineTo(W - pad, H - pad + 10);
  ctx.stroke();

  data.forEach((d, i) => {
    const h = (d.count / max) * (H - pad * 2);
    const x = pad + i * w + space;
    const y = H - pad + 10 - h;

    const grad = ctx.createLinearGradient(0, y, 0, H - pad + 10);
    grad.addColorStop(0, '#7c5cff');
    grad.addColorStop(1, '#ff5c8a');
    ctx.fillStyle = grad;

    // animation
    const startTime = performance.now();
    function anim(now) {
      const p = Math.min((now - startTime) / 600, 1);
      const e = 1 - Math.pow(1 - p, 3);
      ctx.clearRect(x - 2, 0, barW + 4, H);
      const hh = h * e;
      const yy = H - pad + 10 - hh;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(x, yy, barW, hh, 6);
      ctx.fill();
      if (p < 1) requestAnimationFrame(anim);
    }
    requestAnimationFrame(anim);

    // label
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#8a8a9a';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.date, x + barW / 2, H - 12);
    ctx.fillText(d.count, x + barW / 2, y - 6);
  });
}

function renderAdminTop(top) {
  document.getElementById('adminTop').innerHTML = top.map((u, i) => {
    const av = u.photo ? '' : u.emoji;
    const avs = u.photo ? `background:url(${u.photo}) center/cover` : `background:${u.color}`;
    return `
      <div class="admin-user-row" style="animation-delay:${i * 0.05}s">
        <div class="avatar md" style="${avs}" onclick="openUserProfile('${u.username}')">${av}</div>
        <div class="admin-user-info">
          <div class="admin-user-name">${i + 1}. ${escapeHtml(u.displayName)}${u.verified ? ' ✓' : ''}</div>
          <div class="admin-user-handle">@${escapeHtml(u.username)}</div>
        </div>
        <div class="admin-user-meta">${u.posts} 📝 · ${u.messages} 💬</div>
      </div>`;
  }).join('');
}

function renderAdminVerify(verified) {
  const c = document.getElementById('verifyList');
  if (!verified.length) {
    c.innerHTML = `<div style="color:var(--muted);text-align:center;padding:20px;">Пока никого не верифицировано</div>`;
    return;
  }
  c.innerHTML = verified.map(v => `
    <div class="verify-row">
      <span>✅ <b>@${v.username}</b> — ${escapeHtml(v.displayName)}</span>
      <button class="btn-verify-toggle verified" style="margin-left:auto;" onclick="verifyUser('${v.username}')">Снять</button>
    </div>
  `).join('');
}

function renderAdminUsers(users) {
  document.getElementById('adminUsers').innerHTML = users.map((u, i) => {
    const av = u.photo ? '' : u.emoji;
    const avs = u.photo ? `background:url(${u.photo}) center/cover` : `background:${u.color}`;
    return `
      <div class="admin-user-row" style="animation-delay:${Math.min(i * 0.03, 0.4)}s">
        <div class="avatar sm" style="${avs}" onclick="openUserProfile('${u.username}')">${av}</div>
        <div class="admin-user-info">
          <div class="admin-user-name">${escapeHtml(u.displayName)}${u.verified ? ' ✓' : ''}${u.isAdmin ? ' 👑' : ''}</div>
          <div class="admin-user-handle">@${escapeHtml(u.username)} · ${timeAgo(u.createdAt)}</div>
        </div>
        <button class="btn-verify-toggle ${u.verified ? 'verified' : ''}" onclick="verifyUser('${u.username}')">
          ${u.verified ? '✓' : '✅'}
        </button>
      </div>`;
  }).join('');
}

async function verifyUser(usernameFromBtn) {
  let username = usernameFromBtn;
  if (!username) {
    const inp = document.getElementById('verifyInput');
    username = inp.value.trim().toLowerCase().replace(/^@/, '');
    if (!username) return showToast('Введи ник');
    inp.value = '';
  }
  try {
    const r = await api('/admin/verify/' + username, { method: 'POST' });
    showToast(r.verified ? '✅ Галочка выдана' : '❌ Галочка снята');
    loadAdmin();
  } catch (e) { showToast(e.message); }
}

// ===== УТИЛИТЫ =====
function timeAgo(ts) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return 'только что';
  if (d < 3600) return Math.floor(d / 60) + ' мин';
  if (d < 86400) return Math.floor(d / 3600) + ' ч';
  if (d < 2592000) return Math.floor(d / 86400) + ' дн';
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
function pluralize(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
let toastTimer;
function showToast(m) {
  const t = document.getElementById('toast');
  t.textContent = m;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function animateNumber(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  if (start === target) return;
  const t0 = performance.now();
  function u(now) {
    const p = Math.min((now - t0) / 500, 1);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(start + (target - start) * e);
    if (p < 1) requestAnimationFrame(u);
  }
  requestAnimationFrame(u);
}

function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeLightbox(); closeStoryViewer(); document.getElementById('notifPanel').classList.remove('open'); }
  if (e.key === 'ArrowRight' && currentStoryAuthor) nextStory();
  if (e.key === 'ArrowLeft' && currentStoryAuthor) prevStory();
});

// ===== ИНИЦИАЛИЗАЦИЯ =====
async function init() {
  initTheme();
  buildAvatarPickers();

  const ta = document.getElementById('postInput');
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
    updatePostButton();
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); createPost(); }
  });
  document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('regPass').addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });

  if (token) {
    try {
      const data = await api('/me');
      me = data.user;
      enterApp();
    } catch {
      localStorage.removeItem('vibe_token');
      token = null;
    }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

init();
