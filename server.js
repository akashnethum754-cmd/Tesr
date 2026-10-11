require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { User, Stat, Log } = db;
const endpoints = require('./endpoints');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginOpenerPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(cookieParser());

const newKey = () => 'api_' + crypto.randomBytes(16).toString('hex');
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- middleware ----------
async function auth(req, res, next) {
  try {
    const { id } = jwt.verify(req.cookies.token || '', process.env.JWT_SECRET);
    const u = await User.findById(id);
    if (!u) throw new Error();
    req.user = u; next();
  } catch (e) { res.status(401).json({ status: false, message: 'Not logged in' }); }
}
const adminOnly = (req, res, next) => db.isAdminEmail(req.user.email) ? next() : res.status(403).json({ status: false, message: 'Admins only' });

const rate = new Map();
function record(user, endpoint, status, ms) {
  const inc = { $inc: { total: 1, ok: status < 400 ? 1 : 0, ms } };
  Stat.updateOne({ _id: 'all' }, inc, { upsert: true }).catch(() => {});
  Stat.updateOne({ _id: 'day:' + new Date().toISOString().slice(0, 10) }, inc, { upsert: true }).catch(() => {});
  Log.create({ user: user._id, endpoint, status, ms }).catch(() => {});
}
async function apiKey(req, res, next) {
  try {
    const key = req.query.api_key || req.get('x-api-key');
    if (!key) return res.status(401).json({ status: false, message: 'API key missing' });
    const u = await User.findOne({ apiKey: key });
    if (!u) return res.status(401).json({ status: false, message: 'Invalid API key' });
    if (u.status !== 'ACTIVE') return res.status(403).json({ status: false, message: 'Account suspended' });
    const now = Date.now();
    const hits = (rate.get(String(u._id)) || []).filter(t => now - t < 60000);
    if (hits.length >= u.plan.rateLimit) return res.status(429).json({ status: false, message: 'Rate limit exceeded' });
    hits.push(now); rate.set(String(u._id), hits);
    // plan quota first, then coins
    const planOk = !u.plan.expiresAt || u.plan.expiresAt > new Date();
    let r = { modifiedCount: 0 };
    if (planOk) r = await User.updateOne({ _id: u._id, used: { $lt: u.plan.quota } }, { $inc: { used: 1, totalRequests: 1 }, $set: { lastUsed: new Date() } });
    if (!r.modifiedCount) r = await User.updateOne({ _id: u._id, coins: { $gt: 0 } }, { $inc: { coins: -1, totalRequests: 1 }, $set: { lastUsed: new Date() } });
    if (!r.modifiedCount) return res.status(402).json({ status: false, message: 'Quota finished. Top-up coins or upgrade plan.' });
    const start = Date.now();
    res.on('finish', () => record(u, req.path, res.statusCode, Date.now() - start));
    req.user = u; next();
  } catch (e) { res.status(500).json({ status: false, message: 'Server error' }); }
}

// ---------- auth routes ----------
const tries = new Map();
function limiter(req, res, next) {
  const now = Date.now(), a = (tries.get(req.ip) || []).filter(t => now - t < 15 * 60000);
  if (a.length >= 15) return res.status(429).json({ status: false, message: 'Too many attempts. Try again in 15 minutes.' });
  a.push(now); tries.set(req.ip, a); next();
}
function setCookie(res, u) {
  const token = jwt.sign({ id: u._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 864e5 });
}
app.get('/auth/config', (req, res) => res.json({ siteName: process.env.SITE_NAME || 'API Hub' }));
app.post('/auth/register', limiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), password = String(req.body.password || '');
  const name = String(req.body.name || '').trim().slice(0, 40) || email.split('@')[0];
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ status: false, message: 'Enter a valid email' });
  if (password.length < 6) return res.status(400).json({ status: false, message: 'Password must be at least 6 characters' });
  if (await User.findOne({ email })) return res.status(409).json({ status: false, message: 'Email already registered. Log in instead.' });
  const u = await User.create({ uid: 'u_' + crypto.randomBytes(8).toString('hex'), email, name, password: await bcrypt.hash(password, 10), apiKey: newKey() });
  setCookie(res, u); res.json({ status: true });
});
app.post('/auth/login', limiter, async (req, res) => {
  const u = await User.findOne({ email: String(req.body.email || '').trim().toLowerCase() });
  if (!u || !u.password || !(await bcrypt.compare(String(req.body.password || ''), u.password)))
    return res.status(401).json({ status: false, message: 'Wrong email or password' });
  setCookie(res, u); res.json({ status: true });
});
app.get('/auth/me', auth, (req, res) => {
  const u = req.user;
  res.json({ status: true, user: { uid: u.uid, email: u.email, name: u.name, picture: u.picture, apiKey: u.apiKey, status: u.status,
    coins: u.coins, used: u.used, totalRequests: u.totalRequests, plan: u.plan, telegramLinked: !!u.telegramId, isAdmin: db.isAdminEmail(u.email) } });
});
app.post('/auth/regenerate', auth, async (req, res) => { req.user.apiKey = newKey(); await req.user.save(); res.json({ status: true, apiKey: req.user.apiKey }); });
app.get('/auth/logs', auth, async (req, res) => res.json({ status: true, logs: await Log.find({ user: req.user._id }).sort({ at: -1 }).limit(20).select('-_id endpoint status ms at') }));
app.post('/auth/logout', (req, res) => { res.clearCookie('token'); res.json({ status: true }); });

// ---------- admin routes ----------
app.get('/admin/stats', auth, adminOnly, async (req, res) => res.json({ status: true, stats: await db.adminStats() }));
app.get('/admin/users', auth, adminOnly, async (req, res) => {
  const q = (req.query.q || '').trim(), page = Math.max(1, +req.query.page || 1);
  const f = q ? { $or: [{ email: new RegExp(esc(q), 'i') }, { name: new RegExp(esc(q), 'i') }, { uid: q }, { telegramId: q }] } : {};
  const [users, total] = await Promise.all([User.find(f).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).select('-apiKey -password'), User.countDocuments(f)]);
  res.json({ status: true, total, page, users });
});
app.post('/admin/users/:id/coins', auth, adminOnly, async (req, res) => {
  const n = parseInt(req.body.amount);
  if (!n) return res.status(400).json({ status: false, message: 'Invalid amount' });
  const u = await db.addCoins(req.params.id, n);
  if (!u) return res.status(404).json({ status: false, message: 'Not found' });
  require('./bot').notify(u, `🪙 ${n > 0 ? '+' : ''}${n} coins. New balance: ${u.coins}`);
  res.json({ status: true, coins: u.coins });
});
app.post('/admin/users/:id/status', auth, adminOnly, async (req, res) => {
  const s = req.body.status === 'BANNED' ? 'BANNED' : 'ACTIVE';
  res.json({ status: !!(await User.findByIdAndUpdate(req.params.id, { status: s })), newStatus: s });
});
app.post('/admin/users/:id/plan', auth, adminOnly, async (req, res) => {
  const { name, quota, rateLimit, days, resetUsed } = req.body, set = {};
  if (name) set['plan.name'] = name;
  if (quota >= 0) set['plan.quota'] = +quota;
  if (rateLimit > 0) set['plan.rateLimit'] = +rateLimit;
  if (days !== undefined) set['plan.expiresAt'] = +days > 0 ? new Date(Date.now() + days * 864e5) : null;
  if (resetUsed) set.used = 0;
  res.json({ status: !!(await User.findByIdAndUpdate(req.params.id, { $set: set })) });
});

// ---------- public stats + endpoint list ----------
app.get('/api/stats', async (req, res) => res.json(await db.publicStats()));
const list = endpoints.map(e => ({ name: e.name, description: e.description || '', category: e.category || 'General', path: '/api/v1/' + e.path, params: e.params || [] }));
app.get('/api/endpoints', (req, res) => res.json({ status: true, total: list.length, endpoints: list }));

// ---------- API endpoints from endpoints.js ----------
for (const ep of endpoints) {
  app.get('/api/v1/' + ep.path, apiKey, async (req, res) => {
    for (const p of ep.params || []) if (p.required && !req.query[p.name]) return res.status(400).json({ status: false, message: `Missing parameter: ${p.name}` });
    try {
      const data = await ep.handler(req.query, req);
      res.json({ status: true, creator: process.env.CREATOR_NAME || '', site: ep.path.split('/')[0], data });
    } catch (e) { res.status(e.status || 500).json({ status: false, message: e.message || 'Error' }); }
  });
}

// ---------- website files (whitelist, so server files are never exposed) ----------
const pages = ['index.html', 'dashboard.html', 'sandbox.html', 'admin.html', 'style.css', 'common.js'];
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/:f', (req, res, next) => pages.includes(req.params.f) ? res.sendFile(path.join(__dirname, req.params.f)) : next());
app.use((req, res) => res.status(404).json({ status: false, message: 'Not found' }));

mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log('MongoDB connected');
  app.listen(process.env.PORT || 3000, () => console.log('Running on :' + (process.env.PORT || 3000)));
  require('./bot')();
}).catch(e => { console.error('Mongo error:', e.message); process.exit(1); });
