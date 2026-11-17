// Recipes API on Cloudflare Pages Functions + KV (binding: RECIPES).
// GET /api/recipes, PUT /api/recipes (JSON body), DELETE /api/recipes?id=...
// If env.FAMILY_CODE is set, every request must send it in the x-family-code header.
import { json, FIELDS, ID_RE } from '../_shared.js';

export async function onRequest({ request, env }) {
  const code = env.FAMILY_CODE;
  if (code && request.headers.get('x-family-code') !== code) return json({ error: 'unauthorized' }, 401);

  const kv = env.RECIPES;
  if (!kv) return json({ error: 'storage not configured' }, 500);

  try {
    if (request.method === 'GET') {
      const keys = [];
      let cursor;
      do {
        const page = await kv.list(cursor ? { cursor } : {});
        for (const k of page.keys) keys.push(k.name);
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      const items = await Promise.all(keys.map(k => kv.get(k, 'json')));
      return json(items.filter(Boolean));
    }

    if (request.method === 'PUT') {
      const r = await request.json();
      if (!r || typeof r.id !== 'string' || !ID_RE.test(r.id) || typeof r.name !== 'string' || !r.name.trim()) {
        return json({ error: 'bad recipe' }, 400);
      }
      const clean = { id: r.id };
      for (const f of FIELDS) clean[f] = typeof r[f] === 'string' ? r[f].slice(0, 20000) : '';
      await kv.put(r.id, JSON.stringify(clean));
      return json({ ok: true });
    }

    if (request.method === 'DELETE') {
      const id = new URL(request.url).searchParams.get('id') || '';
      if (!ID_RE.test(id)) return json({ error: 'bad id' }, 400);
      await kv.delete(id);
      return json({ ok: true });
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    return json({ error: 'server error' }, 500);
  }
}
