import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const THREADS_FILE = path.join(DATA_DIR, 'threads.json');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const NEWS_FILE = path.join(DATA_DIR, 'news.json');
const UPDATES_FILE = path.join(DATA_DIR, 'updates.json');
const WIKI_FILE = path.join(DATA_DIR, 'wiki.json');
const JWT_SECRET = 'temple_rs_secret_change_in_prod';

// Ensure data directory and files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(THREADS_FILE)) fs.writeFileSync(THREADS_FILE, '[]');
if (!fs.existsSync(POSTS_FILE)) fs.writeFileSync(POSTS_FILE, '[]');
if (!fs.existsSync(NEWS_FILE)) fs.writeFileSync(NEWS_FILE, '[]');
if (!fs.existsSync(UPDATES_FILE)) fs.writeFileSync(UPDATES_FILE, '[]');
if (!fs.existsSync(WIKI_FILE)) fs.writeFileSync(WIKI_FILE, '[]');

function readJson<T>(file: string): T { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
function writeJson(file: string, data: unknown) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

interface User { id: number; username: string; email: string; passwordHash: string; role: 'user'|'mod'|'admin'; templeCoins: number; createdAt: string; pfp?: string; bio?: string; ip?: string; }
interface Thread { id: number; title: string; author: string; authorId: number; category: string; replies: number; views: number; createdAt: string; }
interface Post { id: number; threadId: number; author: string; authorId: number; content: string; createdAt: string; }
interface News { id: number; title: string; category: string; date: string; content: string; }
interface Update { id: number; title: string; date: string; }
interface WikiArticle { id: number; title: string; category: string; content: string; createdAt: string; }

const app = express();
app.set('trust proxy', 1); // Trust first proxy for accurate client IPs
app.use(cors());
app.use(express.json());

// Prevent the website from being embedded in iframes (stops recursive iframe bug)
app.use((_req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    next();
});

// Auth Middleware
function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
        (req as any).user = jwt.verify(token, JWT_SECRET);
        next();
    } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function authAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    auth(req, res, () => {
        if ((req as any).user.role !== 'admin') { res.status(403).json({ error: 'Forbidden' }); return; }
        next();
    });
}

// Rate Limiter for DDoS prevention
const rateLimits = new Map<string, { count: number; resetTime: number }>();

// Cleanup stale rate limit records every minute
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimits.entries()) {
        if (record.resetTime < now) {
            rateLimits.delete(key);
        }
    }
}, 60000);

function rateLimiter(limit: number, windowMs: number) {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const key = `${req.path}:${ip}`;
        const now = Date.now();

        let record = rateLimits.get(key);
        if (!record || record.resetTime < now) {
            record = { count: 0, resetTime: now + windowMs };
        }

        record.count++;
        rateLimits.set(key, record);

        if (record.count > limit) {
            res.status(429).json({ error: 'Too many requests, please try again later.' });
            return;
        }

        next();
    };
}

// Auth Routes
app.post('/api/register', rateLimiter(5, 60 * 60 * 1000), async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) { res.status(400).json({ error: 'All fields required' }); return; }
    if (username.length < 3 || username.length > 12) { res.status(400).json({ error: 'Username must be 3-12 characters' }); return; }
    
    const users = readJson<User[]>(USERS_FILE);
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    
    // Check max accounts per IP (limit to 3)
    if (ip !== 'unknown' && ip !== '::1' && ip !== '127.0.0.1') {
        const accountsWithIp = users.filter(u => u.ip === ip);
        if (accountsWithIp.length >= 3) {
            res.status(403).json({ error: 'Maximum number of accounts reached for this IP address (3).' });
            return;
        }
    }

    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) { res.status(409).json({ error: 'Username already taken' }); return; }

    const passwordHash = await bcrypt.hash(password, 12);
    const newUser: User = {
        id: Date.now(),
        username,
        email,
        passwordHash,
        role: users.length === 0 ? 'admin' : 'user', // First user is admin
        templeCoins: 0,
        createdAt: new Date().toISOString(),
        ip
    };
    users.push(newUser);
    writeJson(USERS_FILE, users);

    const token = jwt.sign({ id: newUser.id, username: newUser.username, role: newUser.role }, JWT_SECRET);
    res.json({ token, user: { id: newUser.id, username: newUser.username, role: newUser.role, templeCoins: newUser.templeCoins, pfp: newUser.pfp || 'default.png', bio: newUser.bio || '' } });
});

app.post('/api/login', rateLimiter(10, 15 * 60 * 1000), async (req, res) => {
    const { username, password } = req.body;
    const users = readJson<User[]>(USERS_FILE);
    const user = users.find(u => u.username.toLowerCase() === username?.toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        res.status(401).json({ error: 'Invalid username or password' }); return;
    }
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, templeCoins: user.templeCoins, pfp: user.pfp || 'default.png', bio: user.bio || '' } });
});

app.post('/api/logout', rateLimiter(10, 15 * 60 * 1000), (_req, res) => {
    // Dummy endpoint to handle logout rate limiting and logging
    res.json({ success: true });
});

app.get('/api/me', auth, (req, res) => {
    const { id } = (req as any).user;
    const user = readJson<User[]>(USERS_FILE).find(u => u.id === id);
    if (!user) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ id: user.id, username: user.username, role: user.role, templeCoins: user.templeCoins, pfp: user.pfp || 'default.png', bio: user.bio || '' });
});

// Content Routes (News & Updates)
app.get('/api/news', (_req, res) => res.json(readJson<News[]>(NEWS_FILE)));
app.get('/api/updates', (_req, res) => res.json(readJson<Update[]>(UPDATES_FILE)));

app.post('/api/news', authAdmin, (req, res) => {
    const { title, category, content } = req.body;
    const newsList = readJson<News[]>(NEWS_FILE);
    
    const today = new Date();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dateStr = `${today.getDate()}-${months[today.getMonth()]}-${today.getFullYear()}`;

    const newItem: News = { id: Date.now(), title, category: category || 'Update', date: dateStr, content };
    newsList.unshift(newItem); // Add to top
    writeJson(NEWS_FILE, newsList);
    res.json(newItem);
});

app.post('/api/updates', authAdmin, (req, res) => {
    const { title } = req.body;
    const updateList = readJson<Update[]>(UPDATES_FILE);
    
    const today = new Date();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dateStr = `${today.getDate()}-${months[today.getMonth()]}-${today.getFullYear()}`;

    const newItem: Update = { id: Date.now(), title, date: dateStr };
    updateList.unshift(newItem); // Add to top
    writeJson(UPDATES_FILE, updateList);
    res.json(newItem);
});

// Wiki Routes
app.get('/api/wiki', (_req, res) => res.json(readJson<WikiArticle[]>(WIKI_FILE)));

app.post('/api/wiki', authAdmin, (req, res) => {
    const { title, category, content } = req.body;
    if (!title || !category || !content) { res.status(400).json({ error: 'All fields required' }); return; }
    
    const wikiList = readJson<WikiArticle[]>(WIKI_FILE);
    const newItem: WikiArticle = { id: Date.now(), title, category, content, createdAt: new Date().toISOString() };
    wikiList.push(newItem);
    writeJson(WIKI_FILE, wikiList);
    res.json(newItem);
});

// Forum Routes
app.get('/api/threads', (_req, res) => res.json(readJson<Thread[]>(THREADS_FILE)));

app.post('/api/threads', auth, (req, res) => {
    const { title, category, content } = req.body;
    const { id: authorId, username: author } = (req as any).user;
    
    const threads = readJson<Thread[]>(THREADS_FILE);
    const newThread: Thread = { id: Date.now(), title, author, authorId, category, replies: 0, views: 0, createdAt: new Date().toISOString() };
    threads.push(newThread);
    writeJson(THREADS_FILE, threads);

    const posts = readJson<Post[]>(POSTS_FILE);
    const newPost: Post = { id: Date.now() + 1, threadId: newThread.id, author, authorId, content, createdAt: new Date().toISOString() };
    posts.push(newPost);
    writeJson(POSTS_FILE, posts);
    res.json(newThread);
});

app.get('/api/threads/:id/posts', (req, res) => {
    const threadId = Number(req.params.id);
    const threads = readJson<Thread[]>(THREADS_FILE);
    const thread = threads.find(t => t.id === threadId);
    if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }

    thread.views++;
    writeJson(THREADS_FILE, threads);

    const allUsers = readJson<User[]>(USERS_FILE);
    const posts = readJson<Post[]>(POSTS_FILE)
        .filter(p => p.threadId === threadId)
        .map(p => {
            const author = allUsers.find(u => u.id === p.authorId);
            return {
                ...p,
                authorPfp: author?.pfp || 'default.png',
                authorBio: author?.bio || ''
            };
        });
    res.json({ thread, posts });
});

app.post('/api/threads/:id/posts', auth, (req, res) => {
    const threadId = Number(req.params.id);
    const { content } = req.body;
    const { id: authorId, username: author } = (req as any).user;
    
    const threads = readJson<Thread[]>(THREADS_FILE);
    const thread = threads.find(t => t.id === threadId);
    if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }
    thread.replies++;
    writeJson(THREADS_FILE, threads);

    const posts = readJson<Post[]>(POSTS_FILE);
    const newPost: Post = { id: Date.now(), threadId, author, authorId, content, createdAt: new Date().toISOString() };
    posts.push(newPost);
    writeJson(POSTS_FILE, posts);
    res.json(newPost);
});

app.get('/api/users/count', (_req, res) => res.json({ count: readJson<User[]>(USERS_FILE).length }));

app.get('/api/ads', (_req, res) => {
    const adDir = path.join(__dirname, '../public/addons/img/ads');
    if (!fs.existsSync(adDir)) return res.json([]);
    const files = fs.readdirSync(adDir).filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f));
    res.json(files);
});

app.get('/api/slideshow', (_req, res) => {
    const slideDir = path.join(__dirname, '../public/slideshow');
    if (!fs.existsSync(slideDir)) return res.json([]);
    const files = fs.readdirSync(slideDir).filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f));
    res.json(files);
});

app.get('/api/avatars', (_req, res) => {
    const avatarDir = path.join(__dirname, '../public/avatars');
    if (!fs.existsSync(avatarDir)) return res.json([]);
    const files = fs.readdirSync(avatarDir).filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f));
    res.json(files);
});

app.post('/api/profile', auth, (req, res) => {
    const { id } = (req as any).user;
    const { pfp, bio } = req.body;
    const users = readJson<User[]>(USERS_FILE);
    const userIdx = users.findIndex(u => u.id === id);
    if (userIdx === -1) { res.status(404).json({ error: 'User not found' }); return; }
    
    if (pfp !== undefined) users[userIdx].pfp = pfp;
    if (bio !== undefined) users[userIdx].bio = bio.substring(0, 500); // Limit bio length
    
    writeJson(USERS_FILE, users);
    res.json({ success: true, user: { id: users[userIdx].id, username: users[userIdx].username, role: users[userIdx].role, templeCoins: users[userIdx].templeCoins, pfp: users[userIdx].pfp || 'default.png', bio: users[userIdx].bio || '' } });
});

// In production, Express also serves the Vite-built frontend.
// Nginx can proxy all traffic to this single port, or serve the dist/ folder itself.
const DIST_DIR = path.join(__dirname, '../dist');
if (fs.existsSync(DIST_DIR)) {
    // Serve static assets (JS, CSS, images, etc.)
    app.use(express.static(DIST_DIR));
    // Serve public folder (avatars, slideshow, ads, etc.)
    app.use(express.static(path.join(__dirname, '../public')));
    // SPA fallback: any non-API route returns index.html
    app.get('/{*path}', (_req, res) => {
        res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
    console.log(`Serving frontend from ${DIST_DIR}`);
}

// Listen on one or two ports.
// PORT  = primary  (default 3001) — set in .env
// PORT2 = secondary (default 8080) — set in .env, leave blank to disable
const PORT  = process.env.PORT  || 3001;
const PORT2 = process.env.PORT2;

http.createServer(app).listen(PORT,  () => console.log(`TempleRS running on port ${PORT}`));
if (PORT2) {
    http.createServer(app).listen(PORT2, () => console.log(`TempleRS also running on port ${PORT2}`));
}
