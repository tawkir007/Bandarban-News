const FEEDS = [
  { q: 'বান্দরবান', hl: 'bn', gl: 'BD', ceid: 'BD:bn', lang: 'bn' },
  { q: 'বান্দরবান পার্বত্য জেলা', hl: 'bn', gl: 'BD', ceid: 'BD:bn', lang: 'bn' },
  { q: 'Bandarban', hl: 'en-BD', gl: 'BD', ceid: 'BD:en', lang: 'en' },
];
const WINDOW = 'when:14d';
const MAX_ITEMS = 80;

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
  return m ? decode(m[1]) : '';
}

async function fetchFeed(f) {
  const url =
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(f.q + ' ' + WINDOW) +
    `&hl=${f.hl}&gl=${f.gl}&ceid=${encodeURIComponent(f.ceid)}`;
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 BandarbanNews' } });
  if (!res.ok) throw new Error('feed ' + res.status);
  const xml = await res.text();
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const source = tag(b, 'source');
    let title = tag(b, 'title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const date = new Date(tag(b, 'pubDate'));
    if (!title || isNaN(date)) continue;
    items.push({ title, link: tag(b, 'link'), source, date: date.toISOString(), lang: f.lang });
  }
  return items;
}

export async function onRequestGet(ctx) {
  const cache = caches.default;
  const key = new Request(new URL(ctx.request.url).origin + '/api/news');
  const hit = await cache.match(key);
  if (hit) return hit;

  const settled = await Promise.allSettled(FEEDS.map(fetchFeed));
  const seen = new Set();
  const items = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const it of r.value) {
      const k = it.title.replace(/\s+/g, ' ').toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(it);
    }
  }
  items.sort((a, b) => new Date(b.date) - new Date(a.date));

  const res = new Response(
    JSON.stringify({ updated: new Date().toISOString(), items: items.slice(0, MAX_ITEMS) }),
    { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=600' } }
  );
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
