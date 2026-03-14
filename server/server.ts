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

function readJson<T>(file: string): T {
    try {
        const raw = fs.readFileSync(file, 'utf-8').trim();
        if (!raw) {
            console.warn(`Warning: ${file} is empty. Returning empty array.`);
            fs.writeFileSync(file, '[]'); // auto-repair
            return [] as unknown as T;
        }
        return JSON.parse(raw);
    } catch (e) {
        console.error(`Error reading ${file}: ${e}. Returning empty array and repairing file.`);
        fs.writeFileSync(file, '[]'); // auto-repair corrupt file
        return [] as unknown as T;
    }
}
function writeJson(file: string, data: unknown) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`Error writing ${file}: ${e}`);
    }
}

interface User { id: number; username: string; email: string; passwordHash: string; role: 'user' | 'mod' | 'admin'; templeCoins: number; createdAt: string; pfp?: string; bio?: string; ip?: string; }
interface Thread { id: number; title: string; author: string; authorId: number; category: string; replies: number; views: number; createdAt: string; }
interface Post { id: number; threadId: number; author: string; authorId: number; content: string; createdAt: string; reactions?: Record<string, number[]>; replyTo?: { id: number; author: string; contentSnippet: string; }; editedAt?: string; }
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
// NOTE: We always look up the live role from users.json so that role changes
// take effect without requiring a re-login (JWT only verifies identity, not role).
function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        // Always fetch the latest role from the database
        const users = readJson<User[]>(USERS_FILE);
        const liveUser = users.find(u => String(u.id) === String(decoded.id));
        if (!liveUser) { res.status(401).json({ error: 'User not found' }); return; }
        // Attach user with live role (not the JWT-cached one)
        (req as any).user = { ...decoded, role: liveUser.role, username: liveUser.username };
        next();
    } catch (e) { 
        console.warn('Auth error:', e);
        res.status(401).json({ error: 'Invalid token' }); 
    }
}

function authAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!(req as any).user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    if ((req as any).user.role !== 'admin') {
        console.warn(`Admin access denied for user: ${(req as any).user.username} (Role: ${(req as any).user.role})`);
        res.status(403).json({ error: 'Forbidden: Admin access required' });
        return;
    }
    next();
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
    res.json({ token, user: { id: newUser.id, username: newUser.username, role: newUser.role, templeCoins: newUser.templeCoins, pfp: newUser.pfp || 'cabbage.png', bio: newUser.bio || '' } });
});

app.post('/api/login', rateLimiter(10, 15 * 60 * 1000), async (req, res) => {
    const { username, password } = req.body;
    const users = readJson<User[]>(USERS_FILE);
    const user = users.find(u => u.username.toLowerCase() === username?.toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        res.status(401).json({ error: 'Invalid username or password' }); return;
    }
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, templeCoins: user.templeCoins, pfp: user.pfp || 'cabbage.png', bio: user.bio || '' } });
});

app.post('/api/logout', rateLimiter(10, 15 * 60 * 1000), (_req, res) => {
    // Dummy endpoint to handle logout rate limiting and logging
    res.json({ success: true });
});

app.get('/api/me', auth, (req, res) => {
    const { id } = (req as any).user;
    const user = readJson<User[]>(USERS_FILE).find(u => u.id === id);
    if (!user) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ id: user.id, username: user.username, role: user.role, templeCoins: user.templeCoins, pfp: user.pfp || 'cabbage.png', bio: user.bio || '' });
});

// Content Routes (News & Updates)
app.get('/api/news', (_req, res) => res.json(readJson<News[]>(NEWS_FILE)));
app.get('/api/updates', (_req, res) => res.json(readJson<Update[]>(UPDATES_FILE)));

app.post('/api/news', auth, authAdmin, (req, res) => {
    const { title, category, content } = req.body;
    console.log(`Attempting to post news: "${title}" by user ${(req as any).user.username}`);

    if (!title || !content) {
        res.status(400).json({ error: 'Title and content are required' });
        return;
    }

    const newsList = readJson<News[]>(NEWS_FILE);

    const today = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dateStr = `${today.getDate()}-${months[today.getMonth()]}-${today.getFullYear()}`;

    const newItem: News = { id: Date.now(), title, category: category || 'Update', date: dateStr, content };
    newsList.unshift(newItem); // Add to top
    writeJson(NEWS_FILE, newsList);
    console.log(`News posted successfully: ${title} (ID: ${newItem.id}, total news count: ${newsList.length})`);
    res.json(newItem);
});

app.post('/api/updates', auth, authAdmin, (req, res) => {
    const { title } = req.body;
    console.log(`Attempting to post update: "${title}" by user ${(req as any).user.username}`);
    
    if (!title) {
        res.status(400).json({ error: 'Title is required' });
        return;
    }

    const updateList = readJson<Update[]>(UPDATES_FILE);

    const today = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dateStr = `${today.getDate()}-${months[today.getMonth()]}-${today.getFullYear()}`;

    const newItem: Update = { id: Date.now(), title, date: dateStr };
    updateList.unshift(newItem); // Add to top
    writeJson(UPDATES_FILE, updateList);
    console.log(`Update posted successfully: ${title} (ID: ${newItem.id})`);
    res.json(newItem);
});

// Wiki Routes
app.get('/api/wiki', (_req, res) => res.json(readJson<WikiArticle[]>(WIKI_FILE)));

app.post('/api/wiki', auth, authAdmin, (req, res) => {
    const { title, category, content } = req.body;
    console.log(`Attempting to post wiki article: "${title}" by user ${(req as any).user.username}`);

    if (!title || !category || !content) { res.status(400).json({ error: 'All fields required' }); return; }

    const wikiList = readJson<WikiArticle[]>(WIKI_FILE);
    const newItem: WikiArticle = { id: Date.now(), title, category, content, createdAt: new Date().toISOString() };
    wikiList.push(newItem);
    writeJson(WIKI_FILE, wikiList);
    console.log(`Wiki article posted successfully: ${title} (ID: ${newItem.id})`);
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
            const author = allUsers.find(u => String(u.id) === String(p.authorId));
            return {
                ...p,
                authorRole: author?.role || 'user',
                authorPfp: author?.pfp || 'cabbage.png',
                authorBio: author?.bio || ''
            };
        });
    res.json({ thread, posts });
});

app.post('/api/threads/:id/posts', auth, (req, res) => {
    const threadId = Number(req.params.id);
    const { content, replyTo } = req.body;
    const { id: authorId, username: author } = (req as any).user;

    const threads = readJson<Thread[]>(THREADS_FILE);
    const thread = threads.find(t => t.id === threadId);
    if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }
    thread.replies++;
    writeJson(THREADS_FILE, threads);

    const posts = readJson<Post[]>(POSTS_FILE);

    let processedReplyTo = undefined;
    if (replyTo) {
        const targetPost = posts.find(p => p.id === replyTo);
        if (targetPost) {
            processedReplyTo = {
                id: targetPost.id,
                author: targetPost.author,
                contentSnippet: targetPost.content.substring(0, 100) + (targetPost.content.length > 100 ? '...' : '')
            };
        }
    }

    const newPost: Post = { id: Date.now(), threadId, author, authorId, content, createdAt: new Date().toISOString(), replyTo: processedReplyTo };
    posts.push(newPost);
    writeJson(POSTS_FILE, posts);
    res.json(newPost);
});

app.post('/api/threads/:threadId/posts/:postId/react', auth, (req, res) => {
    const threadIdStr = String(req.params.threadId);
    const postIdStr = String(req.params.postId);
    const { emoji } = req.body;
    const { id: userId } = (req as any).user;

    if (!emoji || typeof emoji !== 'string') { res.status(400).json({ error: 'Invalid emoji' }); return; }

    const posts = readJson<Post[]>(POSTS_FILE);
    const postIndex = posts.findIndex(p => String(p.id) === postIdStr && String(p.threadId) === threadIdStr);
    if (postIndex === -1) { 
        console.warn(`React failed: Post ${postIdStr} not found in thread ${threadIdStr}`);
        res.status(404).json({ error: 'Post not found' }); 
        return; 
    }

    const post = posts[postIndex];
    if (!post.reactions) post.reactions = {};
    if (!post.reactions[emoji]) post.reactions[emoji] = [];

    const userIdStr = String(userId);
    const existingIndex = post.reactions[emoji].findIndex(id => String(id) === userIdStr);

    if (existingIndex !== -1) {
        post.reactions[emoji].splice(existingIndex, 1);
        if (post.reactions[emoji].length === 0) delete post.reactions[emoji];
        console.log(`User ${userIdStr} removed reaction ${emoji} from post ${postIdStr}`);
    } else {
        post.reactions[emoji].push(Number(userId));
        console.log(`User ${userIdStr} added reaction ${emoji} to post ${postIdStr}`);
    }

    writeJson(POSTS_FILE, posts);
    res.json({ success: true, reactions: post.reactions });
});

app.put('/api/threads/:threadId/posts/:postId', auth, (req, res) => {
    const threadIdStr = String(req.params.threadId);
    const postIdStr = String(req.params.postId);
    const { content } = req.body;
    const { id: userId, role } = (req as any).user;

    if (!content) { res.status(400).json({ error: 'Content is required' }); return; }

    const posts = readJson<Post[]>(POSTS_FILE);
    const postIndex = posts.findIndex(p => String(p.id) === postIdStr && String(p.threadId) === threadIdStr);
    if (postIndex === -1) { res.status(404).json({ error: 'Post not found' }); return; }

    const post = posts[postIndex];
    if (String(post.authorId) !== String(userId) && role !== 'admin' && role !== 'mod') {
        res.status(403).json({ error: 'Unauthorized' }); return;
    }

    post.content = content;
    post.editedAt = new Date().toISOString();
    writeJson(POSTS_FILE, posts);
    console.log(`Post ${postIdStr} edited by user ${userId} (${role})`);
    res.json(post);
});

app.delete('/api/threads/:threadId/posts/:postId', auth, (req, res) => {
    const postIdStr = String(req.params.postId);
    const threadIdStr = String(req.params.threadId);
    let { id: userId, role } = (req as any).user;
    const userIdStr = String(userId);

    let posts = readJson<Post[]>(POSTS_FILE);
    const postIndex = posts.findIndex(p => String(p.id) === postIdStr && String(p.threadId) === threadIdStr);

    if (postIndex === -1) {
        res.status(404).json({ error: 'Post not found' });
        return;
    }

    if (String(posts[postIndex].authorId) !== String(userId) && role !== 'admin' && role !== 'mod') {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }

    posts.splice(postIndex, 1);
    writeJson(POSTS_FILE, posts);

    console.log(`Post ${postIdStr} deleted by user ${userId} (${role})`);

    // Update thread reply count
    const threads = readJson<Thread[]>(THREADS_FILE);
    const thread = threads.find(t => String(t.id) === threadIdStr);
    if (thread && thread.replies > 0) {
        thread.replies--;
        writeJson(THREADS_FILE, threads);
    }

    res.json({ success: true });
});

app.delete('/api/threads/:id', auth, (req, res) => {
    const threadIdStr = String(req.params.id);
    const { id: userId, role } = (req as any).user;
    const userIdStr = String(userId);

    const threads = readJson<Thread[]>(THREADS_FILE);
    const threadIndex = threads.findIndex(t => String(t.id) === threadIdStr);
    if (threadIndex === -1) { res.status(404).json({ error: 'Thread not found' }); return; }

    if (String(threads[threadIndex].authorId) !== String(userId) && role !== 'admin' && role !== 'mod') {
        res.status(403).json({ error: 'Forbidden' }); return;
    }

    threads.splice(threadIndex, 1);
    writeJson(THREADS_FILE, threads);

    console.log(`Thread ${threadIdStr} deleted by user ${userId} (${role})`);

    // Delete all posts in that thread
    let posts = readJson<Post[]>(POSTS_FILE);
    const postCountBefore = posts.length;
    posts = posts.filter(p => String(p.threadId) !== threadIdStr);
    const deletedPostCount = postCountBefore - posts.length;
    writeJson(POSTS_FILE, posts);
    console.log(`Deleted ${deletedPostCount} posts associated with thread ${threadIdStr}`);

    res.json({ success: true });
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

app.get('/api/emojis', (_req, res) => {
    const emojiDir = path.join(__dirname, '../public/emojis');
    if (!fs.existsSync(emojiDir)) return res.json([]);
    const files = fs.readdirSync(emojiDir).filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f));
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
    res.json({ success: true, user: { id: users[userIdx].id, username: users[userIdx].username, role: users[userIdx].role, templeCoins: users[userIdx].templeCoins, pfp: users[userIdx].pfp || 'cabbage.png', bio: users[userIdx].bio || '' } });
});

// Serve public folder (avatars, slideshow, emojis, etc.) - always available
app.use(express.static(path.join(__dirname, '../public')));

// In production, Express also serves the Vite-built frontend.
const DIST_DIR = path.join(__dirname, '../dist');
if (fs.existsSync(DIST_DIR)) {
    // Serve static assets from the build folder (JS, CSS, etc.)
    app.use(express.static(DIST_DIR));
    
    // SPA fallback: Express 5 requires named wildcards — use middleware form to avoid regex issues
    app.use((req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
    console.log(`Serving frontend from ${DIST_DIR}`);
} else {
    console.log('Production build (dist/) not found. Frontend should be run via Vite dev server.');
}

// 404 Handler for unknown API routes
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
        console.warn(`404 Not Found: ${req.method} ${req.url}`);
        res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.url}` });
        return;
    }
    next();
});

// Global error handler to ensure JSON responses
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Server Error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// Listen on one or two ports.
// PORT  = primary  (default 3001) — set in .env
// PORT2 = secondary (default 8080) — set in .env, leave blank to disable
const PORT = process.env.PORT || 3001;
const PORT2 = process.env.PORT2;

http.createServer(app).listen(PORT, () => console.log(`TempleRS running on port ${PORT}`));
if (PORT2) {
    http.createServer(app).listen(PORT2, () => console.log(`TempleRS also running on port ${PORT2}`));
}
