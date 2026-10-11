// ✏️ YOUR API SCRIPTS GO HERE.
// Add one object per endpoint. Restart server after editing (pm2 restart apihub).
// handler gets the query params and returns any JSON (goes inside "data"). Throw Error to send an error.

module.exports = [
  {
    name: 'Wattpad Story Search',
    description: 'Search stories by keyword on Wattpad',
    category: 'Books',
    path: 'wattpad/search', // => /api/v1/wattpad/search
    params: [{ name: 'q', required: true, description: 'Target query' }],
    async handler({ q }) {
      const url = 'https://www.wattpad.com/v4/search/stories?limit=20&query=' + encodeURIComponent(q) +
        '&fields=stories(id,title,description,cover,url,voteCount,readCount,user(name))';
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) throw Object.assign(new Error('Upstream error ' + r.status), { status: 502 });
      const j = await r.json();
      return (j.stories || []).map(s => ({ id: s.id, title: s.title, author: s.user?.name, description: s.description,
        cover: s.cover, url: s.url, votes: s.voteCount, reads: s.readCount }));
    }
  },

  // ---- copy this block for a new endpoint ----
  // {
  //   name: 'My Endpoint', description: 'What it does', category: 'General', path: 'site/action',
  //   params: [{ name: 'q', required: true, description: 'Keyword' }],
  //   async handler({ q }) { return [{ title: 'Hello ' + q }]; }
  // },
];
