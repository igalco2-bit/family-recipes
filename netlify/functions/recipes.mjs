// מסד הנתונים של המתכונים (Netlify Blobs). מתכון אחד = רשומה אחת לפי ה-id שלו.
// GET    /.netlify/functions/recipes           -> כל המתכונים
// PUT    /.netlify/functions/recipes           -> שמירה/עדכון של מתכון (JSON בגוף הבקשה)
// DELETE /.netlify/functions/recipes?id=...    -> מחיקה
// אם הוגדר משתנה סביבה FAMILY_CODE, כל בקשה חייבת לשלוח אותו בכותרת x-family-code.
import { getStore } from '@netlify/blobs';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const FIELDS = ['name', 'category', 'videoUrl', 'imageUrl', 'ingredients', 'instructions', 'notes', 'createdAt', 'updatedAt'];

export default async (req) => {
  const code = process.env.FAMILY_CODE;
  if (code && req.headers.get('x-family-code') !== code) return json({ error: 'unauthorized' }, 401);

  const store = getStore('recipes');

  try {
    if (req.method === 'GET') {
      const { blobs } = await store.list();
      const items = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
      return json(items.filter(Boolean));
    }

    if (req.method === 'PUT') {
      const r = await req.json();
      if (!r || typeof r.id !== 'string' || !/^[\w-]{1,64}$/.test(r.id) || typeof r.name !== 'string' || !r.name.trim()) {
        return json({ error: 'bad recipe' }, 400);
      }
      const clean = { id: r.id };
      for (const f of FIELDS) clean[f] = typeof r[f] === 'string' ? r[f].slice(0, 20000) : '';
      await store.setJSON(r.id, clean);
      return json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = new URL(req.url).searchParams.get('id') || '';
      if (!/^[\w-]{1,64}$/.test(id)) return json({ error: 'bad id' }, 400);
      await store.delete(id);
      return json({ ok: true });
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    return json({ error: 'server error' }, 500);
  }
};
