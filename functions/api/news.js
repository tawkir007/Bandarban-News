const FEEDS = [
  { src: 'google', q: 'বান্দরবান', hl: 'bn', gl: 'BD', ceid: 'BD:bn', lang: 'bn' },
  { src: 'google', q: 'বান্দরবান পার্বত্য জেলা', hl: 'bn', gl: 'BD', ceid: 'BD:bn', lang: 'bn' },
  { src: 'google', q: 'Bandarban', hl: 'en-BD', gl: 'BD', ceid: 'BD:en', lang: 'en' },
  { src: 'bing', q: 'বান্দরবান', lang: 'bn' },
  { src: 'bing', q: 'Bandarban', lang: 'en' },
];
const MAX_ITEMS = 80;
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

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

function feedUrl(f) {
  if (f.src === 'bing') {
    return 'https://www.bing.com/news/search?format=rss&q=' + encodeURIComponent(f.q);
  }
  return (
    'https://news.google.com/rss/search?q=' +
    encodeURIComponent(f.q + ' when:14d') +
    `&hl=${f.hl}&gl=${f.gl}&ceid=${encodeURIComponent(f.ceid)}`
  );
}

function cleanLink(link, src) {
  if (src !== 'bing') return link;
  try {
    const u = new URL(link).searchParams.get('url');
    return u || link;
  } catch (e) {
    return link;
  }
}

async function fetchFeed(f) {
  const res = await fetch(feedUrl(f), {
    headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml, */*' },
  });
  if (!res.ok) throw new Error(`${f.src} ${f.lang}: HTTP ${res.status}`);
  const xml = await res.text();
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const source = tag(b, f.src === 'bing' ? 'News:Source' : 'source');
    let title = tag(b, 'title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const date = new Date(tag(b, 'pubDate'));
    if (!title || isNaN(date)) continue;
    items.push({
      title,
      link: cleanLink(tag(b, 'link'), f.src),
      source,
      date: date.toISOString(),
      lang: f.lang,
    });
  }
  if (!items.length) throw new Error(`${f.src} ${f.lang}: 0 items`);
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
  const errors = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') {
      errors.push(String(r.reason && r.reason.message ? r.reason.message : r.reason));
      continue;
    }
    for (const it of r.value) {
      const k = it.title.replace(/\s+/g, ' ').toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(it);
    }
  }
  items.sort((a, b) => new Date(b.date) - new Date(a.date));

  const ok = items.length > 0;
  const res = new Response(
    JSON.stringify({ updated: new Date().toISOString(), items: items.slice(0, MAX_ITEMS), errors }),
    {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': ok ? 'public, max-age=600' : 'no-store',
      },
    }
  );
  if (ok) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
