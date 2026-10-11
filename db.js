// Database models + shared helpers (used by server.js and bot.js)
const mongoose = require('mongoose');

const User = mongoose.model('User', new mongoose.Schema({
  uid: { type: String, unique: true },
  email: { type: String, lowercase: true, index: true },
  password: String,
  name: String, picture: String,
  apiKey: { type: String, unique: true },
  telegramId: { type: String, index: true },
  status: { type: String, default: 'ACTIVE' }, // ACTIVE | BANNED
  coins: { type: Number, default: () => +process.env.DEFAULT_COINS || 5 },
  used: { type: Number, default: 0 },
  totalRequests: { type: Number, default: 0 },
  plan: {
    name: { type: String, default: () => process.env.DEFAULT_PLAN_NAME || 'Core Tier' },
    quota: { type: Number, default: () => +process.env.DEFAULT_QUOTA || 1700 },
    rateLimit: { type: Number, default: () => +process.env.DEFAULT_RATE_LIMIT || 60 },
    activatedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null } // null = lifetime
  },
  lastUsed: Date,
  createdAt: { type: Date, default: Date.now }
}));
const Stat = mongoose.model('Stat', new mongoose.Schema({
  _id: String, total: { type: Number, default: 0 }, ok: { type: Number, default: 0 }, ms: { type: Number, default: 0 }
}));
const Log = mongoose.model('Log', new mongoose.Schema({
  user: mongoose.Schema.Types.ObjectId, endpoint: String, status: Number, ms: Number,
  at: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 }
}));

const day = (d = new Date()) => d.toISOString().slice(0, 10);
const isAdminEmail = e => (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes((e || '').toLowerCase());
const findUser = q => {
  q = String(q).trim();
  if (q.includes('@')) return User.findOne({ email: q.toLowerCase() });
  if (/^\d+$/.test(q)) return User.findOne({ telegramId: q });
  return User.findOne({ $or: [{ uid: q }, { apiKey: q }] });
};
const addCoins = (id, n) => User.findByIdAndUpdate(id, { $inc: { coins: n } }, { new: true });

async function publicStats() {
  const [all, today, users, active, activeKeys] = await Promise.all([
    Stat.findById('all'), Stat.findById('day:' + day()), User.countDocuments(),
    User.countDocuments({ lastUsed: { $gte: new Date(Date.now() - 5 * 60000) } }),
    User.countDocuments({ status: 'ACTIVE' })
  ]);
  const total = all?.total || 0;
  return { users, activeUsers: active, activeKeys, totalRequests: total, todayRequests: today?.total || 0,
    successRate: total ? +((all.ok / total) * 100).toFixed(2) : 100, avgLatency: total ? Math.round(all.ms / total) : 0,
    ramMB: Math.round(process.memoryUsage().rss / 1048576) };
}

async function adminStats() {
  const days = [...Array(7)].map((_, i) => day(new Date(Date.now() - (6 - i) * 864e5)));
  const [pub, dayDocs, top, coinsAgg, banned, newToday] = await Promise.all([
    publicStats(), Stat.find({ _id: { $in: days.map(d => 'day:' + d) } }),
    Log.aggregate([{ $match: { at: { $gte: new Date(Date.now() - 7 * 864e5) } } },
      { $group: { _id: '$endpoint', count: { $sum: 1 }, avgMs: { $avg: '$ms' }, errors: { $sum: { $cond: [{ $gte: ['$status', 400] }, 1, 0] } } } },
      { $sort: { count: -1 } }, { $limit: 10 }]),
    User.aggregate([{ $group: { _id: null, coins: { $sum: '$coins' } } }]),
    User.countDocuments({ status: 'BANNED' }), User.countDocuments({ createdAt: { $gte: new Date(day()) } })
  ]);
  return { ...pub, banned, newToday, totalCoins: coinsAgg[0]?.coins || 0,
    last7: days.map(d => ({ day: d, total: dayDocs.find(x => x._id === 'day:' + d)?.total || 0 })),
    topEndpoints: top.map(t => ({ endpoint: t._id, count: t.count, avgMs: Math.round(t.avgMs), errors: t.errors })) };
}

module.exports = { User, Stat, Log, isAdminEmail, findUser, addCoins, publicStats, adminStats };
