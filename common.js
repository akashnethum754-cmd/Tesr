const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString();
const j = async (u, o = {}) => { const r = await fetch(u, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...o, body: o.body ? JSON.stringify(o.body) : undefined }); return r.json(); };
const post = (u, b) => j(u, { method: 'POST', body: b || {} });
async function getMe() { const r = await j('/auth/me'); return r.status ? r.user : null; }
function nav(me) {
  $('#nav').innerHTML = `<a class="logo" href="/">⚡ API Hub</a><nav><a href="/">Home</a><a href="/dashboard.html">Dashboard</a><a href="/sandbox.html">Sandbox</a>${me?.isAdmin ? '<a href="/admin.html">Admin</a>' : ''}</nav>`;
}
function loginBox(el) {
  el.innerHTML = `<div class="card"><input id="lm" type="email" placeholder="Email" autocomplete="email"><input id="lp" type="password" placeholder="Password (min 6)" autocomplete="current-password" style="margin-top:8px"><input id="ln" placeholder="Name (only for new account)" style="margin-top:8px"><div class="row" style="margin-top:12px"><button id="bl">Log in</button><button class="alt" id="br">Create account</button></div><p id="le" class="bad"></p></div>`;
  const go = async url => { const r = await post(url, { email: $('#lm').value, password: $('#lp').value, name: $('#ln').value }); r.status ? location.reload() : $('#le').textContent = r.message; };
  $('#bl').onclick = () => go('/auth/login'); $('#br').onclick = () => go('/auth/register');
}
const copy = (t, b) => navigator.clipboard.writeText(t).then(() => { if (b) { const o = b.textContent; b.textContent = 'Copied'; setTimeout(() => b.textContent = o, 1200); } });
