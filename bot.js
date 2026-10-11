// Telegram bot (runs inside the same process). Enabled when BOT_TOKEN is set.
const { User } = require('./db');
const core = require('./db');
let bot = null;

const send = (id, text, opt) => bot && bot.sendMessage(id, text, opt).catch(() => {});
const card = u => `👤 ${u.name || '-'}\n📧 ${u.email}\n🆔 ${u.uid}\n📌 ${u.status}\n` +
  `📊 Quota: ${u.used}/${u.plan.quota} (${u.plan.name})\n🪙 Coins: ${u.coins}\n⚡ Rate: ${u.plan.rateLimit}/min\n` +
  `📈 Total requests: ${u.totalRequests}\n🔗 Telegram: ${u.telegramId || 'not linked'}`;

module.exports = () => {
  if (!process.env.BOT_TOKEN) return console.log('Telegram bot disabled (no BOT_TOKEN)');
  const TelegramBot = require('node-telegram-bot-api');
  bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
  const admins = (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const onlyAdmin = fn => async m => { if (!admins.includes(String(m.from.id))) return send(m.chat.id, '⛔ Admins only'); try { await fn(m); } catch (e) { send(m.chat.id, 'Error: ' + e.message); } };
  const mine = m => User.findOne({ telegramId: String(m.from.id) });
  const needLink = m => send(m.chat.id, 'Link first: /link YOUR_API_KEY');

  bot.onText(/^\/start|^\/help/, m => send(m.chat.id,
    '👋 API Hub bot\n\n/link <api_key> - link your account\n/balance - coins & quota\n/mystats - account stats\n/key - show API key\n/regen - new API key\n/unlink' +
    (admins.includes(String(m.from.id)) ? '\n\n🛠 Admin:\n/addcoins <email|tgid> <n>\n/user <email|tgid|uid>\n/ban <..>\n/unban <..>\n/apistats\n/broadcast <text>' : '')));

  bot.onText(/^\/link (\S+)/, async (m, x) => {
    const u = await User.findOne({ apiKey: x[1] });
    if (!u) return send(m.chat.id, '❌ Invalid API key');
    u.telegramId = String(m.from.id); await u.save();
    send(m.chat.id, `✅ Linked to ${u.email}`);
    bot.deleteMessage(m.chat.id, m.message_id).catch(() => {}); // hide key from chat
  });
  bot.onText(/^\/unlink/, async m => { const u = await mine(m); if (!u) return needLink(m); u.telegramId = undefined; await u.save(); send(m.chat.id, 'Unlinked'); });
  bot.onText(/^\/balance/, async m => { const u = await mine(m); if (!u) return needLink(m); send(m.chat.id, `🪙 Coins: ${u.coins}\n📊 Quota: ${u.used}/${u.plan.quota} (${u.plan.quota - u.used} left)`); });
  bot.onText(/^\/mystats/, async m => { const u = await mine(m); if (!u) return needLink(m); send(m.chat.id, card(u)); });
  bot.onText(/^\/key/, async m => { const u = await mine(m); if (!u) return needLink(m); if (m.chat.type !== 'private') return send(m.chat.id, 'Use in private chat'); send(m.chat.id, `<code>${u.apiKey}</code>`, { parse_mode: 'HTML' }); });
  bot.onText(/^\/regen/, async m => { const u = await mine(m); if (!u) return needLink(m); u.apiKey = 'api_' + require('crypto').randomBytes(16).toString('hex'); await u.save(); send(m.chat.id, `New key:\n<code>${u.apiKey}</code>`, { parse_mode: 'HTML' }); });

  bot.onText(/^\/addcoins (\S+) (-?\d+)/, onlyAdmin(async (m) => {
    const [, q, n] = m.text.match(/^\/addcoins (\S+) (-?\d+)/);
    const u = await core.findUser(q); if (!u) return send(m.chat.id, 'User not found');
    const r = await core.addCoins(u._id, +n);
    send(m.chat.id, `✅ ${r.email}: ${n} coins. Balance: ${r.coins}`);
    module.exports.notify(r, `🪙 ${+n > 0 ? '+' : ''}${n} coins. New balance: ${r.coins}`);
  }));
  bot.onText(/^\/user (\S+)/, onlyAdmin(async m => { const u = await core.findUser(m.text.split(' ')[1]); send(m.chat.id, u ? card(u) : 'User not found'); }));
  bot.onText(/^\/(ban|unban) (\S+)/, onlyAdmin(async m => {
    const [, cmd, q] = m.text.match(/^\/(ban|unban) (\S+)/);
    const u = await core.findUser(q); if (!u) return send(m.chat.id, 'User not found');
    u.status = cmd === 'ban' ? 'BANNED' : 'ACTIVE'; await u.save(); send(m.chat.id, `${u.email} → ${u.status}`);
  }));
  bot.onText(/^\/apistats/, onlyAdmin(async m => {
    const s = await core.adminStats();
    send(m.chat.id, `📊 API Stats\nUsers: ${s.users} (new today ${s.newToday}, banned ${s.banned})\nActive now: ${s.activeUsers}\n` +
      `Total requests: ${s.totalRequests}\nToday: ${s.todayRequests}\nSuccess: ${s.successRate}%\nAvg latency: ${s.avgLatency}ms\n` +
      `Coins in circulation: ${s.totalCoins}\nRAM: ${s.ramMB}MB\n\nLast 7 days:\n` + s.last7.map(d => `${d.day}: ${d.total}`).join('\n') +
      '\n\nTop endpoints:\n' + (s.topEndpoints.map(e => `${e.endpoint} - ${e.count}`).join('\n') || '-'));
  }));
  bot.onText(/^\/broadcast (.+)/s, onlyAdmin(async m => {
    const text = m.text.replace(/^\/broadcast /, '');
    const us = await User.find({ telegramId: { $exists: true, $ne: null } }).select('telegramId');
    for (const u of us) { await send(u.telegramId, '📢 ' + text); await new Promise(r => setTimeout(r, 60)); }
    send(m.chat.id, `Sent to ${us.length} users`);
  }));
  bot.on('polling_error', e => console.error('Bot:', e.message));
  console.log('Telegram bot started');
};
module.exports.notify = (u, text) => { if (u && u.telegramId) send(u.telegramId, text); };
