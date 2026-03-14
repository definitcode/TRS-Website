import './style.css';
import { marked } from 'marked';
import type { NewsPost, ForumThread, ShopItem, UpdateItem, WikiArticle, AuthUser } from './types';

// Use relative /api so Vite's built-in proxy handles cross-port routing automatically.
// VITE_API_URL can override this for production deployments pointing at a different host.
const API = import.meta.env.VITE_API_URL || '/api';

const COIN_ICON = `
<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-right: 2px;">
    <circle cx="12" cy="12" r="11" fill="#c8a840" stroke="#8a6d1a" stroke-width="2"/>
    <circle cx="12" cy="12" r="8" fill="#FFE139"/>
    <text x="12" y="17" text-anchor="middle" fill="#5c430d" font-family="Arial" font-weight="bold" font-size="14">T</text>
</svg>
`;

// ─── State ─────────────────────────────────────────────────────────────────
let currentUser: AuthUser | null = null;
let authToken: string | null = localStorage.getItem('trs_token');

let newsPosts: NewsPost[] = [];
let recentUpdates: UpdateItem[] = [];
let wikiArticles: WikiArticle[] = [];
let slideshowImages: string[] = [];
let adImages: string[] = [];

const CATEGORIES = ['Announcements', 'General', 'Market', 'Guides', 'Off-Topic', 'Bug Reports'];

const shopItems: ShopItem[] = [
  { id: 1, name: '5 Temple Coins', price: 5.00, description: 'Starter pack for a minor boost.' },
  { id: 2, name: '10 Temple Coins', price: 10.00, description: 'Small supporter pack.' },
  { id: 3, name: '20 Temple Coins', price: 20.00, description: 'Bonus pack! Excellent value.' },
  { id: 4, name: '50 Temple Coins', price: 50.00, description: 'The absolute best value.' },
  { id: 5, name: '100 Temple Coins', price: 100.00, description: 'Generous supporter pack.' },
];

async function fetchData() {
  try {
    const [nRes, uRes, wRes, sRes, aRes] = await Promise.all([
      fetch(`${API}/news`).catch(() => null),
      fetch(`${API}/updates`).catch(() => null),
      fetch(`${API}/wiki`).catch(() => null),
      fetch(`${API}/slideshow`).catch(() => null),
      fetch(`${API}/ads`).catch(() => null)
    ]);
    if (nRes && nRes.ok) newsPosts = await nRes.json();
    if (uRes && uRes.ok) recentUpdates = await uRes.json();
    if (wRes && wRes.ok) wikiArticles = await wRes.json();
    if (sRes && sRes.ok) slideshowImages = await sRes.json();
    if (aRes && aRes.ok) adImages = await aRes.json();
  } catch (e) { console.error('Error fetching data', e); }
}

async function fetchMe() {
  if (!authToken) return;
  try {
    const res = await fetch(`${API}/me`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (!res.ok) { authToken = null; localStorage.removeItem('trs_token'); return; }
    currentUser = await res.json();
  } catch { authToken = null; localStorage.removeItem('trs_token'); }
}

async function apiPost(endpoint: string, body: object, auth = false) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth && authToken) headers['Authorization'] = `Bearer ${authToken}`;
  return await fetch(`${API}${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

// ─── Router ────────────────────────────────────────────────────────────────
async function renderPage() {
  const hash = window.location.hash || '#home';
  const content = document.getElementById('page-content')!;
  const mw = document.getElementById('main-wrap')!;
  const ftr = document.getElementById('footer')!;

  document.querySelectorAll('.nav-cell').forEach(a => {
    a.classList.remove('active');
    if (a.getAttribute('href') === hash || (hash === '#home' && a.getAttribute('href') === '#home')) {
      a.classList.add('active');
    }
  });

  updateUserPanel();
  const topNav = document.getElementById('top-nav')!;

  if (hash === '#play') {
    mw.style.maxWidth = 'none';
    mw.style.width = '100%';
    mw.style.padding = '0';
    ftr.style.display = 'none';
    topNav.style.display = 'none';
    document.body.style.overflow = 'hidden';
  } else {
    mw.style.maxWidth = '820px';
    mw.style.width = 'auto';
    mw.style.padding = '0 8px 20px 8px';
    ftr.style.display = 'block';
    topNav.style.display = 'block';
    document.body.style.overflow = 'auto';
  }


  if (hash === '#home') content.innerHTML = renderHome();
  else if (hash === '#news') content.innerHTML = renderNews();
  else if (hash.startsWith('#wiki')) renderWiki(content, hash);
  else if (hash === '#forum') { renderForumIndex(content); return; }
  else if (hash.startsWith('#thread-')) { renderThread(content, Number(hash.replace('#thread-', ''))); return; }
  else if (hash === '#shop') { renderShopPage(content); return; }
  else if (hash === '#play') { renderPlayPage(content); return; }
  else if (hash === '#disclaimer') content.innerHTML = renderDisclaimerPage();
  else if (hash === '#rules') content.innerHTML = renderRulesPage();
  else if (hash === '#discord') content.innerHTML = renderDiscordPage();
  else if (hash === '#privacy') content.innerHTML = renderPrivacyPage();
  else content.innerHTML = renderHome();

  setupGlobalListeners();
}

function updateUserPanel() {
  const panel = document.getElementById('user-area')!;
  if (!panel) return;
  if (currentUser) {
    let adminBtn = currentUser.role === 'admin' ? `<button class="btn-stone mt-6" id="btn-admin-dash" style="font-size:11px;padding:2px 6px">Admin panel</button>` : '';
    panel.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="width:32px; height:32px; border:1px solid #c8a840; background:#000; overflow:hidden; cursor:pointer;" id="btn-my-profile">
            <img src="/avatars/${currentUser.pfp || 'default.png'}" style="width:100%; height:100%; object-fit:cover;">
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-start;">
            <span style="font-weight:bold;color:#90c040;font-size:12px">Signed in as: <span style="color:#fff">${currentUser.username}</span></span>
            <div style="display:flex; gap:8px; align-items:center; margin-top:2px;">
                <span style="color:#FFE139;font-weight:bold;font-size:11px">${COIN_ICON} ${currentUser.templeCoins.toLocaleString()} TC</span>
                <span style="color:#888; text-decoration:underline; font-size:10px; cursor:pointer;" id="btn-edit-profile">Edit Profile</span>
                <span style="color:#888; text-decoration:underline; font-size:10px; cursor:pointer;" id="btn-logout">Logout</span>
            </div>
        </div>
        ${adminBtn}
      </div>
    `;
    document.getElementById('btn-logout')?.addEventListener('click', async () => {
      if (authToken) {
        try {
          const res = await apiPost('/logout', {}, true);
          if (res.status === 429) {
            alert('Too many logout attempts. Please try again later.');
            return;
          }
        } catch (e) { }
      }
      authToken = null; currentUser = null; localStorage.removeItem('trs_token'); window.location.hash = '#home'; renderPage();
    });
    document.getElementById('btn-admin-dash')?.addEventListener('click', openAdminModal);
    document.getElementById('btn-edit-profile')?.addEventListener('click', openProfileModal);
    document.getElementById('btn-my-profile')?.addEventListener('click', openProfileModal);
  } else {
    panel.innerHTML = `<button class="btn-stone" style="font-size:12px;padding:4px 10px" id="btn-open-auth">Login / Register</button>`;
    document.getElementById('btn-open-auth')?.addEventListener('click', () => openAuthModal('login'));
  }
}

// ─── Home ──────────────────────────────────────────────────────────────────
function renderHome() {
  const ad1 = adImages.length > 0 ? `<img src="/ads/${adImages[0]}" style="height:100%; width:auto; display:block; margin:0 auto; object-fit:contain;">` : '<div>Ad Space</div>';
  const ad2 = adImages.length > 1 ? `<img src="/ads/${adImages[1]}" style="height:100%; width:auto; display:block; margin:0 auto; object-fit:contain;">` : (adImages.length > 0 ? ad1 : '<div>Ad Space</div>');

  return `
    <div id="logo-bar">
      <h1>TempleRS</h1>
    </div>

    <!-- Image Slideshow and Banners Concept -->
    <div style="display:flex; justify-content:center; margin-bottom: 12px; align-items:stretch;">
        <!-- Ad banners hidden for now
        <div class="ad-banner" style="width:120px; background:#111; border:1px solid #333; text-align:center; display:flex; flex-direction:column; justify-content:center; color:#555; font-size:11px; overflow:hidden;">
            ${ad1}
        </div>
        -->

        <div style="flex:1; max-width:820px; display:flex; flex-direction:column;">
            <div id="slideshow" style="width:100%; height:300px; background:#000; border:2px solid #2a1800; position:relative; overflow:hidden;">
                ${slideshowImages.length > 0 ? slideshowImages.map((src, i) => `
                    <div class="slide ${i === 0 ? 'slide-active' : ''}" style="position:absolute; inset:0; background:url('/slideshow/${src}') center/contain no-repeat; opacity:${i === 0 ? '1' : '0'}; transition:opacity 0.5s;"></div>
                `).join('') : '<div style="color:#666;text-align:center;padding-top:100px;">No slideshow images found.</div>'}

                ${slideshowImages.length > 0 ? `
                <div style="position:absolute; bottom:0; left:0; right:0; background:rgba(0,0,0,0.7); padding:8px; display:flex; justify-content:center; gap:8px;" id="slide-dots">
                    ${slideshowImages.map((_, i) => `
                        <div class="dot ${i === 0 ? 'active' : ''}" style="width:8px; height:8px; border-radius:50%; background:${i === 0 ? '#c8a840' : '#555'}; cursor:pointer;" onclick="changeSlide(${i})"></div>
                    `).join('')}
                </div>` : ''}
            </div>

             <div class="panel" style="width:100%; margin-top:12px; box-sizing:border-box;">
                <div class="panel-header">Welcome to TempleRS</div>
                <div class="panel-body" style="text-align:center">
                <div style="margin-bottom:12px;font-size:13px;color:#ccc">Experience the classic MMORPG adventure from 2004.<br>A real adventure awaits you.</div>
                
                <div class="feat-item" style="text-align:center; width: auto; margin: 0 10px;">
                    <a href="#play" class="btn-red" style="width:160px; padding: 10px 0;">
                        <span style="font-size:14px;display:block;color:#fff;margin-bottom:2px;">Play Game</span>
                        <span style="font-size:11px;font-weight:normal;color:#90c040;">(Existing User)</span>
                    </a>
                </div>
                <div class="feat-item" style="text-align:center; width: auto; margin: 0 10px;">
                    <a href="#" class="btn-red" id="hm-register" style="width:160px; padding: 10px 0; background-color:#373737; border-color:#5a5a5a;">
                        <span style="font-size:14px;display:block;color:#fff;margin-bottom:2px;">Create Account</span>
                        <span style="font-size:11px;font-weight:normal;color:#88c0ff;">(New User)</span>
                    </a>
                </div>
                </div>
            </div>
        </div>

        <!-- Ad banners hidden for now
        <div class="ad-banner" style="width:120px; background:#111; border:1px solid #333; text-align:center; display:flex; flex-direction:column; justify-content:center; color:#555; font-size:11px; overflow:hidden;">
            ${ad2}
        </div>
        -->
    </div>

    <!-- Top Columns -->
    <div style="display:flex; justify-content:space-between; flex-wrap:wrap; margin-bottom: 24px;">
      
      <div class="panel" style="width:100%; margin-bottom:24px;">
        <div class="panel-header">Latest News & Updates</div>
        <div class="panel-body">
          ${newsPosts.slice(0, 3).map(p => `
            <div style="border:1px solid #2a2c2e;background:#131415;margin-bottom:12px;">
              <div class="news-head" style="padding:8px 12px;background:#1a1c1e;display:flex;justify-content:space-between;align-items:center;">
                <span style="color:#FFE139;font-weight:bold;font-size:14px;">${p.title} <span class="thread-cat-tag" style="font-size:10px;margin-left:8px;padding:2px 6px;border-radius:3px;background:#000;border:1px solid #333;color:#ccc;">${p.category || 'General'}</span></span>
                <span style="font-size:11px;color:#888;">${p.date}</span>
              </div>
              <div class="news-body" style="padding:12px;color:#ccc;line-height:1.5;border-top:1px solid #2a2c2e;white-space:pre-wrap;font-size:13px;">${p.content}</div>
            </div>
          `).join('')}
          ${newsPosts.length === 0 ? '<div style="color:#888;text-align:center;padding:10px">No news stories found.</div>' : ''}
          <div style="text-align:center;margin-top:10px;">
            To view a full list of news, <a href="#news" class="lnk-green">Click Here</a>.
          </div>
        </div>
      </div>

      <div class="panel" style="width:100%;">
        <div class="panel-header">Secondary Features</div>
        <div class="panel-body ta-c">
          
          <div class="svc-item w100" style="margin:0 0 10px 0;">
            <div class="btn-stone" style="width:100%;margin-bottom:6px" id="lnk-acc">Account Services</div>
            <div style="font-size:11px;color:#888">Manage your characters and memberships.</div>
          </div>

          <div class="svc-item w100" style="margin:0 0 10px 0;">
            <div class="btn-stone" style="width:100%;margin-bottom:6px" onclick="window.location.hash='#forum'">Community Forums</div>
            <div style="font-size:11px;color:#888">Discuss the game with fellow players.</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Global script for sliding
(window as any).changeSlide = function (idx: number) {
  const slides = document.querySelectorAll('.slide');
  const dots = document.querySelectorAll('.dot');
  if (!slides.length) return;
  slides.forEach(s => (s as HTMLElement).style.opacity = '0');
  dots.forEach(d => d.classList.remove('active'));
  dots.forEach(d => (d as HTMLElement).style.background = '#555');

  (slides[idx] as HTMLElement).style.opacity = '1';
  dots[idx].classList.add('active');
  (dots[idx] as HTMLElement).style.background = '#c8a840';
};
(window as any).slideInterval = setInterval(() => {
  const slides = document.querySelectorAll('.slide');
  if (!slides.length) return;
  let act = -1;
  slides.forEach((s, i) => { if ((s as HTMLElement).style.opacity === '1' || s.classList.contains('slide-active')) act = i; });
  let next = act + 1;
  if (next >= slides.length) next = 0;
  (window as any).changeSlide(next);
}, 5000);

// ─── News ──────────────────────────────────────────────────────────────────
function renderNews() {
  const grp: Record<string, NewsPost[]> = {};
  newsPosts.forEach(p => { const c = p.category || 'General'; if (!grp[c]) grp[c] = []; grp[c].push(p); });

  const cats = Object.entries(grp).map(([cat, list]) => `
    <div style="margin-bottom:16px;">
      <div style="font-weight:bold;color:#c8a840;border-bottom:1px solid #302000;padding-bottom:4px;margin-bottom:8px;">${cat}</div>
      ${list.map(p => `
        <div style="border:1px solid #2a2c2e;background:#131415;margin-bottom:8px;">
          <div class="news-head" style="padding:8px 12px;background:#1a1c1e;cursor:pointer;display:flex;justify-content:space-between;align-items:center;" onclick="const c=this.nextElementSibling; c.style.display=c.style.display==='none'?'block':'none';">
            <span style="color:#90c040;font-weight:bold;font-size:14px;">${p.title} <span style="font-size:10px;color:#888;">(Click to View)</span></span>
            <span style="font-size:11px;color:#888;">${p.date}</span>
          </div>
          <div class="news-body" style="padding:12px;display:none;color:#ccc;line-height:1.5;border-top:1px solid #2a2c2e;white-space:pre-wrap;">${p.content}</div>
        </div>
      `).join('')}
    </div>
  `).join('');

  return `
    <div style="padding-top:10px">
      <div class="breadcrumb"><a href="#home">Home</a><span class="bc-sep">&gt;</span><span>News</span></div>
      
      <div class="panel w100">
        <div class="panel-header">News Archive</div>
        <div class="panel-body">
          ${newsPosts.length === 0 ? '<div style="text-align:center;padding:20px;color:#666">No news available.</div>' : cats}
        </div>
      </div>
    </div>
  `;
}

// ─── Wiki ──────────────────────────────────────────────────────────────────
async function renderWiki(container: HTMLElement, hash: string) {
  const parts = hash.split('/');
  const id = parts[1] ? Number(parts[1]) : null;

  if (id) {
    const article = wikiArticles.find(a => a.id === id);
    if (!article) { container.innerHTML = '<div class="ta-c" style="padding:40px">Article not found.</div>'; return; }

    // Parse markdown (async resolution might occur depending on extensions, standard marked usually resolves sync but await is safer with recent versions)
    const contentHtml = await marked.parse(article.content);

    container.innerHTML = `
      <div style="padding-top:10px">
        <div class="breadcrumb"><a href="#home">Home</a><span class="bc-sep">&gt;</span><a href="#wiki">Wiki</a><span class="bc-sep">&gt;</span><span>${article.category}</span></div>
        <div class="panel w100">
          <div class="panel-header" style="text-align:left">${article.title} <span class="thread-cat-tag">${article.category}</span></div>
          <div class="panel-body">
            <div style="font-size:11px;color:#888;margin-bottom:12px;border-bottom:1px solid #333;padding-bottom:6px;">Created on: ${new Date(article.createdAt || '').toLocaleDateString()}</div>
            <div class="wiki-content">${contentHtml}</div>
          </div>
        </div>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div style="padding-top:10px">
        <div class="breadcrumb"><a href="#home">Home</a><span class="bc-sep">&gt;</span><span>Wiki Hub</span></div>
        <div class="panel w100">
          <div class="panel-header" style="display:flex;justify-content:space-between;align-items:center;">
             <span>TempleRS Knowledge Base</span>
             <input type="text" id="wiki-search" placeholder="Search wiki..." class="form-inp" style="width:200px;font-size:11px;padding:3px 6px;">
          </div>
          <div class="panel-body">
            <div style="margin-bottom:16px;font-style:italic;color:#ccc">Explore our official documentation, quest guides, and mechanic breakdowns.</div>
            <div id="wiki-list-container"></div>
          </div>
        </div>
      </div>
    `;

    const renderList = (query: string) => {
      const filtered = wikiArticles.filter(a =>
        !query || a.title.toLowerCase().includes(query) || a.content.toLowerCase().includes(query) || a.category.toLowerCase().includes(query)
      );
      const grp: Record<string, WikiArticle[]> = {};
      filtered.forEach(a => { if (!grp[a.category]) grp[a.category] = []; grp[a.category].push(a); });

      const contentBox = Object.entries(grp).map(([cat, list]) => `
        <div style="margin-bottom:16px">
          <div style="font-weight:bold;color:#c8a840;margin-bottom:6px;border-bottom:1px solid #302000;padding-bottom:4px">${cat}</div>
          <ul style="margin:0;padding-left:20px;list-style:square;color:#90c040">
            ${list.map((a: any) => `
              <li style="margin-bottom:4px">
                <a href="#wiki/${a.id}" class="lnk-green" style="font-size:13px">${a.title}</a>
              </li>
            `).join('')}
          </ul>
        </div>
      `).join('');

      const listContainer = document.getElementById('wiki-list-container');
      if (listContainer) {
        listContainer.innerHTML = filtered.length === 0 ? '<div class="ta-c text-muted">No articles found matching your query.</div>' : contentBox;
      }
    };

    renderList('');
    document.getElementById('wiki-search')?.addEventListener('input', (e) => {
      renderList((e.target as HTMLInputElement).value.toLowerCase());
    });
  }
}

// ─── Forums ────────────────────────────────────────────────────────────────
async function renderForumIndex(container: HTMLElement) {
  container.innerHTML = `
    <div style="padding-top:10px">
      <div class="breadcrumb"><a href="#home">Home</a><span class="bc-sep">&gt;</span><span>Forums</span></div>
      <div class="panel w100">
        <div class="panel-header" style="display:flex;justify-content:space-between;align-items:center">
          <span>Community Forums</span>
          ${currentUser ? `<button class="btn-stone" id="btn-new-thread" style="padding:2px 8px;font-size:11px">New Thread</button>` : `<button class="btn-stone" id="btn-auth-forum" style="padding:2px 8px;font-size:11px">Login to Post</button>`}
        </div>
        <div class="panel-body" id="forum-content" style="padding:0">
          <div class="ta-c" style="padding:20px"><div class="spinner"></div><br><br>Loading threads...</div>
        </div>
      </div>
    </div>
  `;
  setupGlobalListeners();

  try {
    const res = await fetch(`${API}/threads`);
    const threads: ForumThread[] = await res.json();
    const grp: Record<string, ForumThread[]> = {};
    threads.forEach(t => { if (!grp[t.category]) grp[t.category] = []; grp[t.category].push(t); });

    const content = Object.entries(grp).map(([cat, list]: [string, any]) => `
      <div class="forum-section" style="margin-bottom:20px;border:1px solid #333;">
        <div style="background:#222527;color:#c8a840;font-weight:bold;padding:6px 12px;font-size:13px;border-bottom:1px solid #333;">${cat}</div>
        <table width="100%" cellspacing="0" cellpadding="0" class="forum-table">
          <thead>
            <tr>
              <th width="50%" align="left">Thread Title</th>
              <th width="15%" align="center">Replies</th>
              <th width="20%" align="center">Author</th>
              <th width="15%" align="right">Date</th>
            </tr>
          </thead>
          <tbody>
          ${list.map((t: any) => `
            <tr class="forum-thread-row" data-id="${t.id}">
              <td class="thread-title"><b>${t.title}</b></td>
              <td class="thread-stat" align="center">${t.replies}</td>
              <td class="thread-author" align="center">${t.author}</td>
              <td class="thread-stat" align="right">${t.createdAt ? t.createdAt.split('T')[0] : 'N/A'}</td>
            </tr>
          `).join('')}
          </tbody>
        </table>
      </div>
    `).join('');

    document.getElementById('forum-content')!.innerHTML = content || '<div class="ta-c" style="padding:20px;color:#666">No threads yet.</div>';

    document.querySelectorAll('.forum-thread-row').forEach(row => {
      row.addEventListener('click', () => { window.location.hash = `#thread-${row.getAttribute('data-id')}`; });
    });
  } catch {
    document.getElementById('forum-content')!.innerHTML = `<div class="ta-c col-red" style="padding:20px">Failed to load threads.</div>`;
  }
}

async function renderThread(container: HTMLElement, threadId: number) {
  container.innerHTML = `<div class="ta-c" style="padding:40px"><div class="spinner"></div></div>`;
  try {
    const res = await fetch(`${API}/threads/${threadId}/posts`);
    const { thread, posts } = await res.json();

    const pHTML = posts.map((p: any) => `
      <div class="post-box">
        <div class="post-author-panel">
          <div class="post-avatar" style="border:1px solid #c8a840; overflow:hidden; background:#000;">
            <img src="/avatars/${p.authorPfp || 'default.png'}" style="width:100%; height:100%; object-fit:cover;">
          </div>
          <div class="post-author-name">${p.author}</div>
          <div class="post-role">Member</div>
          ${p.authorBio ? `<div style="font-size:9px; color:#888; margin-top:8px; font-style:italic; padding:0 4px; border-top:1px solid #222; width:100%; text-align:center; padding-top:4px;">${p.authorBio}</div>` : ''}
        </div>
        <div class="post-content-panel">
          <div class="post-date text-muted">${new Date(p.createdAt).toLocaleString()}</div>
          <div class="post-text">${p.content}</div>
        </div>
      </div>
    `).join('');

    container.innerHTML = `
      <div style="padding-top:10px">
        <div class="breadcrumb">
          <a href="#home">Home</a><span class="bc-sep">&gt;</span><a href="#forum">Forums</a><span class="bc-sep">&gt;</span><span>${thread.title}</span>
        </div>
        <div class="panel w100">
          <div class="panel-header" style="text-align:left">${thread.title} <span class="thread-cat-tag">${thread.category}</span></div>
          <div style="background:#0a0500">${pHTML}</div>
        </div>
        
        ${currentUser ? `
          <div class="panel w100 mt-10">
            <div class="panel-header">Post a Reply</div>
            <div class="panel-body">
              <div id="re-err" class="err-msg"></div>
              <textarea id="re-body" class="form-textarea mb-6"></textarea>
              <button id="btn-re-sub" class="btn-stone" data-id="${thread.id}">Submit Reply</button>
            </div>
          </div>
        ` : `
          <div class="panel w100 mt-10">
            <div class="panel-body ta-c text-muted">You must be logged in to reply.<br><button class="btn-stone mt-6" id="btn-auth-reply">Login</button></div>
          </div>
        `}
      </div>
    `;

    document.getElementById('btn-re-sub')?.addEventListener('click', async (e) => {
      const btn = e.target as HTMLButtonElement;
      const content = (document.getElementById('re-body') as HTMLInputElement).value.trim();
      const err = document.getElementById('re-err')!;
      if (!content) { err.textContent = 'Reply cannot be empty'; err.classList.add('show'); return; }
      btn.disabled = true;
      const res = await apiPost(`/threads/${btn.dataset.id}/posts`, { content }, true);
      if (res.ok) renderThread(document.getElementById('page-content')!, threadId);
      else { err.textContent = (await res.json()).error; err.classList.add('show'); btn.disabled = false; }
    });
    document.getElementById('btn-auth-reply')?.addEventListener('click', () => openAuthModal('login'));

  } catch {
    container.innerHTML = `<div class="ta-c col-red" style="padding:40px">Could not load thread.</div>`;
  }
}

// ─── Shop ─────────────────────────────────────────────────────────────────
function renderShopPage(container: HTMLElement) {
  container.innerHTML = `
    <div style="padding-top:10px">
      <div class="breadcrumb"><a href="#home">Home</a><span class="bc-sep">&gt;</span><span>Store</span></div>
      <div class="panel w100">
        <div class="panel-header">Premium Emporium</div>
        <div class="panel-body ta-c">
          <div style="color:#FFE139; font-weight:bold; margin-bottom:12px">${COIN_ICON} Support TempleRS!</div>
          <div style="font-size:12px;color:#ccc;margin-bottom:16px">Temple Coins (TC) can be used in-game to access cosmetic overrides and pets.</div>
          
          ${shopItems.map(i => `
            <div class="shop-item">
              <div class="shop-name">${i.name}</div>
              <div class="shop-desc">${i.description}</div>
              <div class="shop-price">$${i.price.toFixed(2)}</div>
              <button class="btn-stone shop-buy-btn">Purchase</button>
            </div>
          `).join('')}

          ${currentUser ? '' : '<div style="margin-top:20px;color:#888;font-size:11px">Want to see your balance? <a href="#" class="lnk-green" id="btn-shop-auth">Login to your account</a></div>'}
        </div>
      </div>
    </div>
  `;
  container.querySelectorAll('.shop-buy-btn').forEach(b => b.addEventListener('click', () => alert('Payment integration pending.')));
  document.getElementById('btn-shop-auth')?.addEventListener('click', () => openAuthModal('login'));
}

// ─── Footer Pages ────────────────────────────────────────────────────────
function renderDisclaimerPage() {
  return `
    <div style="padding-top:10px; text-align:left;">
      <div class="breadcrumb"><a href="#home">Home</a><span class="bc-sep">&gt;</span><span>Disclaimer</span></div>
      <div class="panel w100">
        <div class="panel-header">Non-affiliation Disclaimer</div>
        <div class="panel-body" style="line-height:1.8; color:#ccc; padding: 16px 20px;">
          <p style="margin-bottom:14px;">TempleRS is an <b>independent, community-driven</b> project. It exists purely as an exercise in nostalgia and game preservation. We are in no way affiliated, associated, authorized, endorsed by, or in any way officially connected with <b>Jagex Ltd</b>, or any of its subsidiaries or affiliates.</p>
          <p style="margin-bottom:14px;">The official RuneScape website can be found at <a href="https://www.runescape.com" target="_blank" class="lnk-green">runescape.com</a>. The official Old School RuneScape website can be found at <a href="https://oldschool.runescape.com" target="_blank" class="lnk-green">oldschool.runescape.com</a>.</p>
          <p style="margin-bottom:14px;">The names <b>RuneScape</b> and <b>Old School RuneScape</b>, as well as related names, marks, emblems, and images, are registered trademarks of Jagex Ltd. Use of these trademarks within TempleRS does not imply any affiliation with or endorsement by Jagex Ltd.</p>
          <div style="background:#0a0500; border:1px solid #2a1800; padding:12px 16px; margin-top:16px; color:#888; font-size:12px;">
            If you are a representative of Jagex Ltd and have a concern, please contact us via our Discord server.
          </div>
        </div>
      </div>
    </div>
    `;
}

function renderRulesPage() {
  return `
    <div style="padding-top:10px; text-align:left;">
      <div class="breadcrumb"><a href="#home">Home</a><span class="bc-sep">&gt;</span><span>Rules</span></div>
      <div class="panel w100">
        <div class="panel-header">Community Rules &amp; Guidelines</div>
        <div class="panel-body" style="line-height:1.7; color:#ccc; padding: 16px 20px;">
          <p style="margin-bottom:16px; color:#aaa;">By playing on TempleRS you agree to abide by the following rules. Violations may result in warnings, temporary mutes, or permanent bans depending on severity.</p>

          <div style="display:flex; flex-direction:column; gap:12px;">
            <div style="background:#0a0600; border-left:3px solid #c8a840; padding:10px 14px;">
              <div style="font-weight:bold; color:#FFE139; margin-bottom:4px;">1. Respect Staff</div>
              <div style="color:#aaa; font-size:12px;">Treat our staff with respect.</div>
            </div>
            <div style="background:#0a0600; border-left:3px solid #c8a840; padding:10px 14px;">
              <div style="font-weight:bold; color:#FFE139; margin-bottom:4px;">2. No Cheating or Macroing</div>
              <div style="color:#aaa; font-size:12px;">The use of bots, auto-clickers, macro software, or any third-party tool that automates gameplay is strictly prohibited. Play fairly.</div>
            </div>
            <div style="background:#0a0600; border-left:3px solid #c8a840; padding:10px 14px;">
              <div style="font-weight:bold; color:#FFE139; margin-bottom:4px;">3. No Bug Abuse</div>
              <div style="color:#aaa; font-size:12px;">Intentionally exploiting bugs or glitches for personal gain is a bannable offence. If you discover a bug, report it to staff immediately through the Forums or Discord.</div>
            </div>
            <div style="background:#0a0600; border-left:3px solid #c8a840; padding:10px 14px;">
              <div style="font-weight:bold; color:#FFE139; margin-bottom:4px;">4. Account Security</div>
              <div style="color:#aaa; font-size:12px;">You are solely responsible for your account. Never share your login credentials. Staff members will <b>never</b> ask for your password. Account sharing is done at your own risk.</div>
            </div>
            <div style="background:#0a0600; border-left:3px solid #c8a840; padding:10px 14px;">
              <div style="font-weight:bold; color:#FFE139; margin-bottom:4px;">5. No Real-World Trading (RWT)</div>
              <div style="color:#aaa; font-size:12px;">Buying, selling, or trading in-game items or currency for real money is strictly prohibited and will result in a permanent ban without appeal.</div>
            </div>
            <div style="background:#0a0600; border-left:3px solid #c8a840; padding:10px 14px;">
              <div style="font-weight:bold; color:#FFE139; margin-bottom:4px;">6. Keep it Clean</div>
              <div style="color:#aaa; font-size:12px;">Excessive profanity, spamming, or posting NSFW content in public channels is not permitted. Keep chat accessible and welcoming for all ages.</div>
            </div>
          </div>

          <div style="border-top:1px solid #222; padding-top:14px; margin-top:20px; font-size:12px; color:#666;">
            Rules are subject to change at any time. Staff decisions are final. If you wish to appeal a punishment, contact a staff member via Discord.
          </div>
        </div>
      </div>
    </div>
    `;
}

function renderDiscordPage() {
  return `
    <div style="padding-top:10px; text-align:left;">
      <div class="breadcrumb"><a href="#home">Home</a><span class="bc-sep">&gt;</span><span>Discord</span></div>
      <div class="panel w100">
        <div class="panel-header">Join Our Community</div>
        <div class="panel-body" style="padding: 20px;">
          <div style="display:flex; align-items:flex-start; gap:20px; flex-wrap:wrap;">
            <div style="flex:2; min-width:280px;">
              <h2 style="color:#fff; margin:0 0 8px 0; font-size:18px;">TempleRS Official Discord</h2>
              <p style="color:#aaa; margin-bottom:16px; line-height:1.7;">Join over a thousand adventurers on the official TempleRS Discord server. Get real-time updates, participate in community events, get help from veteran players, and chat directly with the development team.</p>
              <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:20px;">
                <div style="display:flex; align-items:center; gap:10px;"><span style="color:#c8a840; font-size:14px;">📢</span> <span style="color:#ccc; font-size:13px;">Instant patch notes and announcements</span></div>
                <div style="display:flex; align-items:center; gap:10px;"><span style="color:#c8a840; font-size:14px;">🎪</span> <span style="color:#ccc; font-size:13px;">Community events and competitions</span></div>
                <div style="display:flex; align-items:center; gap:10px;"><span style="color:#c8a840; font-size:14px;">🛠️</span> <span style="color:#ccc; font-size:13px;">Bug reports and player suggestions</span></div>
                <div style="display:flex; align-items:center; gap:10px;"><span style="color:#c8a840; font-size:14px;">💬</span> <span style="color:#ccc; font-size:13px;">General chat and trading channels</span></div>
              </div>
              <a href="https://discord.gg/qpcenn4W6P" target="_blank" class="btn-stone" style="background:#5865F2; border-color:#4752C4; display:inline-block; padding:12px 24px; font-size:14px;">Join Discord Server</a>
            </div>
            <div style="flex:1; min-width:200px; background:#0a0600; border:1px solid #2a1800; padding:16px; text-align:center;">
              <div style="font-size:48px; margin-bottom:12px;">💬</div>
              <div style="color:#90c040; font-weight:bold; font-size:16px; margin-bottom:6px;">Already a member?</div>
              <div style="color:#666; font-size:12px;">Open Discord and search for <b style="color:#aaa;">TempleRS</b> or use the invite link.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    `;
}

function renderPrivacyPage() {
  return `
    <div style="padding-top:10px; text-align:left;">
      <div class="breadcrumb"><a href="#home">Home</a><span class="bc-sep">&gt;</span><span>Privacy Policy</span></div>
      <div class="panel w100">
        <div class="panel-header">Privacy Policy</div>
        <div class="panel-body" style="line-height:1.8; color:#ccc; padding: 16px 20px;">
          <p style="color:#888; font-size:12px; margin-bottom:16px;">Last Updated: March 2026</p>
          <p style="margin-bottom:16px;">At TempleRS, we are committed to protecting your privacy. This policy outlines what data we collect, why we collect it, and how it is used.</p>

          <div style="font-weight:bold; color:#FFE139; margin-bottom:8px; border-bottom:1px solid #222; padding-bottom:4px;">What We Collect</div>
          <ul style="margin: 0 0 16px 20px; color:#aaa;">
            <li style="margin-bottom:6px;"><b style="color:#eee;">Account Information:</b> Your username, email address, and securely hashed password (we never store plain-text passwords).</li>
            <li style="margin-bottom:6px;"><b style="color:#eee;">Game Data:</b> Your character stats, inventory, quest progress, and in-game interactions.</li>
            <li style="margin-bottom:6px;"><b style="color:#eee;">Connection Logs:</b> Basic IP and timestamp logs for security monitoring and abuse prevention.</li>
          </ul>

          <div style="font-weight:bold; color:#FFE139; margin-bottom:8px; border-bottom:1px solid #222; padding-bottom:4px;">How We Use It</div>
          <ul style="margin: 0 0 16px 20px; color:#aaa;">
            <li style="margin-bottom:6px;">To provide and maintain the game service.</li>
            <li style="margin-bottom:6px;">To identify and prevent cheating, abuse, or unauthorized access.</li>
            <li style="margin-bottom:6px;">To send important service or account-related communications.</li>
          </ul>

          <div style="font-weight:bold; color:#FFE139; margin-bottom:8px; border-bottom:1px solid #222; padding-bottom:4px;">What We Don&apos;t Do</div>
          <ul style="margin: 0 0 16px 20px; color:#aaa;">
            <li style="margin-bottom:6px;">We do <b>not</b> sell, trade, or share your personal data with any third parties.</li>
            <li style="margin-bottom:6px;">We do <b>not</b> use your data for advertising or marketing to outside companies.</li>
            <li style="margin-bottom:6px;">We do <b>not</b> store payment information. All donations are processed externally.</li>
          </ul>

          <div style="background:#0a0500; border:1px solid #2a1800; padding:12px 16px; margin-top:4px; font-size:12px; color:#888;">
            For any privacy-related concerns, reach out to staff via our <a href="#discord" class="lnk-green">Discord server</a>.
          </div>
        </div>
      </div>
    </div>
    `;
}

// ─── Play Now ──────────────────────────────────────────────────────────────
function renderPlayPage(container: HTMLElement) {
  container.innerHTML = `
      <div class="play-container">
        <!-- Navigation bar -->
        <div class="play-nav-bar">
            <a href="#home" class="play-nav-btn">Main Menu</a>
            <a href="https://discord.gg/sCnvbXVnMf" target="_blank" class="play-nav-btn">Discord</a>
            <a href="#" onclick="window.open('https://mejrs.github.io/historical?era=rs2_2004_07_13&p=0&x=2944&y=3411&z=-1&m=-1&layer=grid', 'WorldMap', 'width=600,height=450,menubar=no,toolbar=no,location=no,status=no'); return false;" class="play-nav-btn">World Map</a>
            <a href="#" class="play-nav-btn" id="toggleChatLink">Show Tools</a>
            <a href="javascript:location.reload()" class="play-nav-btn">Refresh</a>
        </div>

        <!-- Main content area -->
        <div class="main-content-play chat-hidden" id="play-main-content">
            <div style="flex-grow:1; display:flex; justify-content:center; align-items:flex-start; height:100%; overflow:hidden; width:100%;">
                <iframe src="https://play.tsunscape.cloud/rs2.cgi" class="gameframe-iframe" allowfullscreen></iframe>
            </div>

            <!-- Sidebar tools -->
            <div class="play-sidebar">
                <div class="sidebar-tabs">
                    <button class="tab-button active" data-tab="chat">Chat</button>
                    <button class="tab-button" data-tab="specialguides">Special Guides</button>
                    <button class="tab-button" data-tab="droptables">Drop Tables</button>
                    <button class="tab-button" data-tab="itemdb">Item DB</button>
                    <button class="tab-button" data-tab="calculators">Calculators</button>
                    <button class="tab-button" data-tab="skillguides">Skill Guides</button>
                    <button class="tab-button" data-tab="questguides">Quest Guides</button>
                    <button class="tab-button" data-tab="resources">Resources</button>
                </div>

                <div class="tab-content active" id="tab-chat">
                    <iframe class="iframe-tool" src="https://app.2004.chat" allowfullscreen></iframe>
                </div>
                <div class="tab-content" id="tab-specialguides">
                    <iframe class="iframe-tool" src="https://2004.losthq.rs/?p=specialguides" allowfullscreen></iframe>
                </div>
                 <div class="tab-content" id="tab-droptables">
                    <iframe class="iframe-tool" src="https://2004.losthq.rs/?p=droptables" allowfullscreen></iframe>
                </div>
                <div class="tab-content" id="tab-itemdb">
                    <iframe class="iframe-tool" src="https://2004.losthq.rs/?p=itemdb" allowfullscreen></iframe>
                </div>
                <div class="tab-content" id="tab-calculators">
                    <iframe class="iframe-tool" src="https://2004.losthq.rs/?p=calculators" allowfullscreen></iframe>
                </div>
                <div class="tab-content" id="tab-skillguides">
                    <iframe class="iframe-tool" src="https://2004.losthq.rs/?p=skillguides" allowfullscreen></iframe>
                </div>
                <div class="tab-content" id="tab-questguides">
                    <iframe class="iframe-tool" src="https://2004.losthq.rs/?p=questguides" allowfullscreen></iframe>
                </div>

                <div class="tab-content" id="tab-resources">
                  <div style="padding: 10px; overflow-y: auto;">
                    <details open>
                      <summary>Communication Servers</summary>
                      <a href="https://discord.gg/sCnvbXVnMf target="_blank">Discord (main)</a>
                    </details>
                    <details>
                      <summary>Community Forum</summary>
                      <a href="#forum" target="_blank">Forum</a>
                    </details>
                    <details>
                      <summary>Browser Extension</summary>
                      <a href="https://2004.chat" target="_blank">2004.chat</a>
                      <p style="color:#FFE139; font-size:11px; margin-left:12px;">Join <code>TempleRS</code> channel</p>
                    </details>
                    <details>
                      <summary>Game Resources</summary>
                      <a href="https://2004.losthq.rs" target="_blank">LostHQ</a>
                    </details>
                    <details>
                      <summary>GitHub Repos</summary>
                      <a href="#" target="_blank">Project Repos</a>
                      <a href="#" target="_blank">Commits</a>
                    </details>
                  </div>
                </div>
            </div>
        </div>
      </div>
    `;

  // Sidebar toggle
  const toggleLink = container.querySelector('#toggleChatLink')!;
  const playMain = container.querySelector('#play-main-content')!;
  toggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    const isHidden = playMain.classList.toggle('chat-hidden');
    toggleLink.textContent = isHidden ? 'Show Tools' : 'Hide Tools';
  });

  // Tab switching
  const tabButtons = container.querySelectorAll('.tab-button');
  const tabContents = container.querySelectorAll('.tab-content');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tabId = 'tab-' + (btn as HTMLElement).dataset.tab;
      container.querySelector(`#${tabId}`)?.classList.add('active');
    });
  });
}


// ─── Modals ───────────────────────────────────────────────────────────────
function openAuthModal(tab: 'login' | 'register' = 'login') {
  document.getElementById('modal-ov')?.remove();
  const raw = `
    <div class="modal-overlay" id="modal-ov">
      <div class="modal-box">
        <div class="modal-title-bar">
          <span class="modal-title">Account Area</span>
          <button class="modal-close" id="mc-close">x</button>
        </div>
        <div class="modal-tabs">
          <button class="m-tab ${tab === 'login' ? 'active' : ''}" id="mt-login">Login</button>
          <button class="m-tab ${tab === 'register' ? 'active' : ''}" id="mt-register">New User</button>
        </div>
        <div class="modal-body">
          <div id="m-err" class="err-msg"></div>
          <div id="m-ok" class="ok-msg"></div>

          <form id="f-login" style="${tab === 'login' ? '' : 'display:none'}">
            <div class="form-row"><span class="form-lbl">Username</span><input type="text" id="l-usr" class="form-inp"></div>
            <div class="form-row"><span class="form-lbl">Password</span><input type="password" id="l-pwd" class="form-inp"></div>
            <button class="btn-red w100 mt-10" id="btn-ls">Login</button>
          </form>

          <form id="f-register" style="${tab === 'register' ? '' : 'display:none'}">
            <div class="form-row"><span class="form-lbl">Username</span><input type="text" id="r-usr" class="form-inp"></div>
            <div class="form-row"><span class="form-lbl">Email</span><input type="email" id="r-eml" class="form-inp"></div>
            <div class="form-row"><span class="form-lbl">Password</span><input type="password" id="r-pwd" class="form-inp"></div>
            <button class="btn-red w100 mt-10" id="btn-rs">Create Account</button>
          </form>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', raw);
  const mov = document.getElementById('modal-ov')!;
  requestAnimationFrame(() => mov.classList.add('open'));

  const closeM = () => { mov.classList.remove('open'); setTimeout(() => mov.remove(), 250); };
  document.getElementById('mc-close')?.addEventListener('click', closeM);
  mov.addEventListener('click', e => { if (e.target === mov) closeM(); });

  const fl = document.getElementById('f-login')!, fr = document.getElementById('f-register')!;
  const mtL = document.getElementById('mt-login')!, mtR = document.getElementById('mt-register')!;
  const err = document.getElementById('m-err')!, ok = document.getElementById('m-ok')!;

  mtL.addEventListener('click', () => { fl.style.display = 'block'; fr.style.display = 'none'; mtL.classList.add('active'); mtR.classList.remove('active'); err.classList.remove('show'); });
  mtR.addEventListener('click', () => { fr.style.display = 'block'; fl.style.display = 'none'; mtR.classList.add('active'); mtL.classList.remove('active'); err.classList.remove('show'); });

  fl.addEventListener('submit', async e => {
    e.preventDefault();
    const [u, p] = [(document.getElementById('l-usr') as HTMLInputElement).value, (document.getElementById('l-pwd') as HTMLInputElement).value];
    if (!u || !p) { err.textContent = 'Fill all fields'; err.classList.add('show'); return; }
    document.getElementById('btn-ls')!.innerHTML = '<span class="spinner"></span>';
    const res = await apiPost('/login', { username: u, password: p });
    if (!res.ok) { err.textContent = (await res.json()).error; err.classList.add('show'); document.getElementById('btn-ls')!.textContent = 'Login'; return; }
    const { token, user } = await res.json();
    authToken = token; currentUser = user; localStorage.setItem('trs_token', token);
    closeM(); renderPage();
  });

  fr.addEventListener('submit', async e => {
    e.preventDefault();
    const [u, em, p] = [(document.getElementById('r-usr') as HTMLInputElement).value, (document.getElementById('r-eml') as HTMLInputElement).value, (document.getElementById('r-pwd') as HTMLInputElement).value];
    if (!u || !em || !p) { err.textContent = 'Fill all fields'; err.classList.add('show'); return; }
    document.getElementById('btn-rs')!.innerHTML = '<span class="spinner"></span>';
    const res = await apiPost('/register', { username: u, email: em, password: p });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; err.classList.add('show'); document.getElementById('btn-rs')!.textContent = 'Create Account'; return; }
    authToken = data.token; currentUser = data.user; localStorage.setItem('trs_token', data.token);
    err.classList.remove('show'); ok.textContent = 'Account created successfully!'; ok.classList.add('show');
    setTimeout(() => { closeM(); renderPage(); }, 1000);
  });
}

function openAdminModal() {
  document.getElementById('modal-admin')?.remove();
  const raw = `
    <div class="modal-overlay" id="modal-admin">
      <div class="modal-box" style="width:500px">
        <div class="modal-title-bar">
          <span class="modal-title">Admin Dashboard</span>
          <button class="modal-close" id="ma-close">x</button>
        </div>
        <div class="modal-tabs">
          <button class="m-tab active" id="mat-news">Add News</button>
          <button class="m-tab" id="mat-update">Add Update</button>
          <button class="m-tab" id="mat-wiki">Add Wiki</button>
        </div>
        <div class="modal-body">
          <div id="ma-err" class="err-msg"></div>
          <div id="ma-ok" class="ok-msg"></div>

          <form id="f-news">
            <div class="form-row"><span class="form-lbl">News Title</span><input type="text" id="an-title" class="form-inp"></div>
            <div class="form-row"><span class="form-lbl">Category</span><input type="text" id="an-cat" class="form-inp" placeholder="e.g. Game Update"></div>
            <div class="form-row"><span class="form-lbl">Content</span><textarea id="an-content" class="form-textarea" style="height:120px"></textarea></div>
            <button class="btn-red w100 mt-10">Post News</button>
          </form>

          <form id="f-update" style="display:none">
            <div class="form-row"><span class="form-lbl">Update Title (Short)</span><input type="text" id="au-title" class="form-inp" placeholder="(e.g. Bugfixes #42)"></div>
            <button class="btn-red w100 mt-10">Post Update</button>
          </form>

          <form id="f-wiki" style="display:none">
            <div class="form-row"><span class="form-lbl">Wiki Title</span><input type="text" id="aw-title" class="form-inp"></div>
            <div class="form-row"><span class="form-lbl">Category</span><input type="text" id="aw-cat" class="form-inp" placeholder="e.g. Guides"></div>
            <div class="form-row"><span class="form-lbl">Content</span><textarea id="aw-content" class="form-textarea" style="height:120px"></textarea></div>
            <button class="btn-red w100 mt-10">Add Wiki Article</button>
          </form>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', raw);
  const mov = document.getElementById('modal-admin')!;
  requestAnimationFrame(() => mov.classList.add('open'));

  const closeM = () => { mov.classList.remove('open'); setTimeout(() => mov.remove(), 250); };
  document.getElementById('ma-close')?.addEventListener('click', closeM);

  const fn = document.getElementById('f-news')!, fu = document.getElementById('f-update')!, fw = document.getElementById('f-wiki')!;
  const mtN = document.getElementById('mat-news')!, mtU = document.getElementById('mat-update')!, mtW = document.getElementById('mat-wiki')!;
  const err = document.getElementById('ma-err')!, ok = document.getElementById('ma-ok')!;

  mtN.addEventListener('click', () => { fn.style.display = 'block'; fu.style.display = 'none'; fw.style.display = 'none'; mtN.classList.add('active'); mtU.classList.remove('active'); mtW.classList.remove('active'); err.classList.remove('show'); ok.classList.remove('show'); });
  mtU.addEventListener('click', () => { fu.style.display = 'block'; fn.style.display = 'none'; fw.style.display = 'none'; mtU.classList.add('active'); mtN.classList.remove('active'); mtW.classList.remove('active'); err.classList.remove('show'); ok.classList.remove('show'); });
  mtW.addEventListener('click', () => { fw.style.display = 'block'; fn.style.display = 'none'; fu.style.display = 'none'; mtW.classList.add('active'); mtN.classList.remove('active'); mtU.classList.remove('active'); err.classList.remove('show'); ok.classList.remove('show'); });

  fn.addEventListener('submit', async e => {
    e.preventDefault();
    const title = (document.getElementById('an-title') as HTMLInputElement).value.trim();
    const category = (document.getElementById('an-cat') as HTMLInputElement).value.trim() || 'General';
    const content = (document.getElementById('an-content') as HTMLInputElement).value.trim();
    if (!title || !content) { err.textContent = 'Fill fields'; err.classList.add('show'); return; }
    const res = await apiPost('/news', { title, category, content }, true);
    if (!res.ok) { err.textContent = 'Failed to post'; err.classList.add('show'); return; }
    const news = await res.json();
    newsPosts.unshift(news);
    ok.textContent = 'News Posted!'; ok.classList.add('show'); err.classList.remove('show');
    (document.getElementById('an-title') as HTMLInputElement).value = '';
    (document.getElementById('an-content') as HTMLInputElement).value = '';
    setTimeout(() => { if (window.location.hash === '#home' || window.location.hash === '#news') renderPage(); }, 500);
  });

  fu.addEventListener('submit', async e => {
    e.preventDefault();
    const title = (document.getElementById('au-title') as HTMLInputElement).value.trim();
    if (!title) { err.textContent = 'Fill title'; err.classList.add('show'); return; }
    const res = await apiPost('/updates', { title }, true);
    if (!res.ok) { err.textContent = 'Failed to post'; err.classList.add('show'); return; }
    const upd = await res.json();
    recentUpdates.unshift(upd);
    ok.textContent = 'Update Posted!'; ok.classList.add('show'); err.classList.remove('show');
    (document.getElementById('au-title') as HTMLInputElement).value = '';
    setTimeout(() => { if (window.location.hash === '#home') renderPage(); }, 500);
  });

  fw.addEventListener('submit', async e => {
    e.preventDefault();
    const title = (document.getElementById('aw-title') as HTMLInputElement).value.trim();
    const category = (document.getElementById('aw-cat') as HTMLInputElement).value.trim();
    const content = (document.getElementById('aw-content') as HTMLInputElement).value.trim();
    if (!title || !category || !content) { err.textContent = 'Fill all fields'; err.classList.add('show'); return; }
    const res = await apiPost('/wiki', { title, category, content }, true);
    if (!res.ok) { err.textContent = 'Failed to post'; err.classList.add('show'); return; }
    const article = await res.json();
    wikiArticles.push(article);
    ok.textContent = 'Wiki Article Added!'; ok.classList.add('show'); err.classList.remove('show');
    (document.getElementById('aw-title') as HTMLInputElement).value = '';
    (document.getElementById('aw-cat') as HTMLInputElement).value = '';
    (document.getElementById('aw-content') as HTMLInputElement).value = '';
    setTimeout(() => { if (window.location.hash === '#wiki') renderPage(); }, 500);
  });
}

function openNewThreadModal() {
  const c = CATEGORIES;
  document.getElementById('modal-nt')?.remove();
  const raw = `
    <div class="modal-overlay" id="modal-nt">
      <div class="modal-box">
        <div class="modal-title-bar"><span class="modal-title">New Thread</span><button class="modal-close" id="mnt-close">x</button></div>
        <div class="modal-body">
          <div id="mnt-err" class="err-msg"></div>
          <form id="f-nt">
            <div class="form-row"><span class="form-lbl">Title</span><input type="text" id="nt-tit" class="form-inp"></div>
            <div class="form-row">
              <span class="form-lbl">Category</span>
              <select id="nt-cat" class="form-select">${c.map(x => `<option value="${x}">${x}</option>`).join('')}</select>
            </div>
            <div class="form-row"><span class="form-lbl">Content</span><textarea id="nt-con" class="form-textarea"></textarea></div>
            <button class="btn-red w100" id="btn-nts">Post Thread</button>
          </form>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', raw);
  const mov = document.getElementById('modal-nt')!;
  requestAnimationFrame(() => mov.classList.add('open'));
  mov.querySelector('#mnt-close')?.addEventListener('click', () => { mov.classList.remove('open'); setTimeout(() => mov.remove(), 250); });
  mov.querySelector('#f-nt')?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('btn-nts') as HTMLButtonElement;
    const err = document.getElementById('mnt-err')!;
    const [t, c, b] = [(document.getElementById('nt-tit') as HTMLInputElement).value, (document.getElementById('nt-cat') as HTMLSelectElement).value, (document.getElementById('nt-con') as HTMLInputElement).value];
    if (!t || !b) { err.textContent = 'Fill all fields'; err.classList.add('show'); return; }
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    const res = await apiPost('/threads', { title: t, category: c, content: b }, true);
    if (res.ok) {
      const data = await res.json();
      mov.classList.remove('open'); setTimeout(() => mov.remove(), 250);
      window.location.hash = `#thread-${data.id}`;
      renderPage();
    } else {
      err.textContent = (await res.json()).error; err.classList.add('show'); btn.disabled = false; btn.textContent = 'Post Thread';
    }
  });
}

function openProfileModal() {
  if (!currentUser) return;
  document.getElementById('modal-profile')?.remove();

  const raw = `
    <div class="modal-overlay" id="modal-profile">
      <div class="modal-box" style="width:450px">
        <div class="modal-title-bar"><span class="modal-title">Edit Your Profile</span><button class="modal-close" id="mp-close">x</button></div>
        <div class="modal-body">
            <div id="mp-err" class="err-msg"></div>
            <div id="mp-ok" class="ok-msg"></div>

            <div style="margin-bottom:16px;">
                <span class="form-lbl">Select Avatar</span>
                <div id="avatar-grid" style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin-top:8px;">
                    <div class="ta-c" style="grid-column: span 4; padding:10px;">Loading avatars...</div>
                </div>
            </div>

            <div class="form-row" style="flex-direction:column; align-items:flex-start;">
                <span class="form-lbl">Your Bio</span>
                <textarea id="up-bio" class="form-textarea" style="height:80px; width:100%; margin-top:4px;" placeholder="Tell us about yourself...">${currentUser.bio || ''}</textarea>
            </div>

            <button class="btn-red w100 mt-10" id="btn-save-profile">Save Changes</button>
        </div>
      </div>
    </div>
    `;

  document.body.insertAdjacentHTML('beforeend', raw);
  const mov = document.getElementById('modal-profile')!;
  requestAnimationFrame(() => mov.classList.add('open'));
  document.getElementById('mp-close')?.addEventListener('click', () => { mov.classList.remove('open'); setTimeout(() => mov.remove(), 250); });

  let selectedPfp = currentUser.pfp || 'default.png';

  const renderAvatars = async () => {
    try {
      const res = await fetch(`${API}/avatars`);
      const files: string[] = await res.json();
      const grid = document.getElementById('avatar-grid')!;
      grid.innerHTML = files.map(f => `
                <div class="avatar-opt ${f === selectedPfp ? 'selected' : ''}" data-pfp="${f}" style="width:100%; aspect-ratio:1; border:2px solid ${f === selectedPfp ? '#c8a840' : '#333'}; background:#000; cursor:pointer; overflow:hidden;">
                    <img src="/avatars/${f}" style="width:100%; height:100%; object-fit:cover;">
                </div>
            `).join('');

      grid.querySelectorAll('.avatar-opt').forEach(opt => opt.addEventListener('click', (e) => {
        grid.querySelectorAll('.avatar-opt').forEach(o => (o as HTMLElement).style.borderColor = '#333');
        const target = e.currentTarget as HTMLElement;
        target.style.borderColor = '#c8a840';
        selectedPfp = target.dataset.pfp!;
      }));
    } catch { console.error('Failed to load avatars'); }
  };
  renderAvatars();

  document.getElementById('btn-save-profile')?.addEventListener('click', async () => {
    const bio = (document.getElementById('up-bio') as HTMLInputElement).value.trim();
    const btn = document.getElementById('btn-save-profile') as HTMLButtonElement;
    const err = document.getElementById('mp-err')!;
    const ok = document.getElementById('mp-ok')!;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const res = await apiPost('/profile', { pfp: selectedPfp, bio }, true);
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      ok.textContent = 'Profile updated!';
      ok.classList.add('show');
      setTimeout(() => { mov.classList.remove('open'); setTimeout(() => { mov.remove(); renderPage(); }, 250); }, 1000);
    } else {
      err.textContent = 'Failed to update profile';
      err.classList.add('show');
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  });
}

// ─── Utilities & Boot ──────────────────────────────────────────────────────
function setupGlobalListeners() {
  document.getElementById('hm-register')?.addEventListener('click', e => { e.preventDefault(); openAuthModal('register'); });
  document.getElementById('lnk-acc')?.addEventListener('click', e => { e.preventDefault(); openAuthModal('login'); });
  document.getElementById('btn-auth-forum')?.addEventListener('click', () => openAuthModal('login'));
  document.getElementById('btn-new-thread')?.addEventListener('click', () => openNewThreadModal());
}

async function boot() {
  await Promise.all([fetchMe(), fetchData()]);
  renderPage();
}

window.addEventListener('hashchange', () => renderPage());
boot();
