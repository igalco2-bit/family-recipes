export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export const FIELDS = ['name', 'category', 'videoUrl', 'imageUrl', 'ingredients', 'instructions', 'notes', 'createdAt', 'updatedAt'];

export const ID_RE = /^[\w-]{1,64}$/;
