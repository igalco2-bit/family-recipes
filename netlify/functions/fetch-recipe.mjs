// פונקציית שרת קטנה: מביאה את ה-HTML של דף מתכון, בלי מגבלות CORS של הדפדפן.
// כתובת הקריאה: /.netlify/functions/fetch-recipe?url=https://...

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\..*|10\..*|192\.168\..*|169\.254\..*|172\.(1[6-9]|2\d|3[01])\..*|\[.*\])$/i;

function decode(buf, contentType) {
  let charset = /charset=([\w-]+)/i.exec(contentType || '')?.[1];
  if (!charset) {
    const head = new TextDecoder('latin1').decode(buf.slice(0, 3000));
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try { return new TextDecoder(charset || 'utf-8').decode(buf); }
  catch { return new TextDecoder('utf-8').decode(buf); }
}

export default async (req) => {
  const target = new URL(req.url).searchParams.get('url') || '';
  let u;
  try { u = new URL(target); } catch { return new Response('bad url', { status: 400 }); }
  if (!/^https?:$/.test(u.protocol) || PRIVATE_HOST.test(u.hostname)) {
    return new Response('url not allowed', { status: 400 });
  }

  try {
    const res = await fetch(u, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'he-IL,he;q=0.9,en;q=0.7'
      }
    });
    if (!res.ok) return new Response('upstream ' + res.status, { status: 502 });
    const type = res.headers.get('content-type') || '';
    if (!/html|xml/i.test(type)) return new Response('not html', { status: 415 });
    const buf = new Uint8Array(await res.arrayBuffer()).slice(0, 3_000_000);
    return new Response(decode(buf, type), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
    });
  } catch (e) {
    return new Response('fetch failed', { status: 502 });
  }
};
