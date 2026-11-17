import { test, expect } from '@playwright/test';

// Real requests against the local functions (no page.route mocks).
// baseURL from playwright.config.js is used for the relative paths.

const ID = 'test-api-1';
const NAME = 'בדיקת API';
const EVIL_ID = 'test-api-evil';

test.describe.configure({ mode: 'serial' });

async function listRecipes(request) {
  const res = await request.get('/api/recipes');
  expect(res.status()).toBe(200);
  return res.json();
}

test.afterAll(async ({ request }) => {
  await request.delete(`/api/recipes?id=${ID}`);
  await request.delete(`/api/recipes?id=${EVIL_ID}`);
});

test.describe('recipes API', () => {
  test('PUT, GET, DELETE round trip', async ({ request }) => {
    const put = await request.put('/api/recipes', {
      data: { id: ID, name: NAME, category: 'אחר', ingredients: 'קמח' },
    });
    expect(put.status()).toBe(200);

    const afterPut = await listRecipes(request);
    expect(Array.isArray(afterPut)).toBe(true);
    expect(afterPut).toContainEqual(expect.objectContaining({ id: ID, name: NAME }));

    const del = await request.delete(`/api/recipes?id=${ID}`);
    expect(del.status()).toBe(200);

    const afterDelete = await listRecipes(request);
    expect(afterDelete.map((r) => r.id)).not.toContain(ID);
  });

  test('PUT with empty name is rejected with 400', async ({ request }) => {
    const res = await request.put('/api/recipes', {
      data: { id: 'test-api-empty', name: '' },
    });
    expect(res.status()).toBe(400);
  });

  test('PUT with an invalid id is rejected with 400', async ({ request }) => {
    const res = await request.put('/api/recipes', {
      data: { id: 'bad id!', name: NAME },
    });
    expect(res.status()).toBe(400);
  });

  test('DELETE with a path-traversal id is rejected with 400', async ({ request }) => {
    const res = await request.delete('/api/recipes?id=../x');
    expect(res.status()).toBe(400);
  });

  test('POST is not allowed (405)', async ({ request }) => {
    const res = await request.post('/api/recipes', { data: { id: 'test-api-post', name: NAME } });
    expect(res.status()).toBe(405);
  });

  test('PUT keeps only whitelisted fields', async ({ request }) => {
    const put = await request.put('/api/recipes', {
      data: { id: EVIL_ID, name: NAME, evil: 'x' },
    });
    expect(put.status()).toBe(200);

    const stored = (await listRecipes(request)).find((r) => r.id === EVIL_ID);
    expect(stored).toBeDefined();
    expect(stored).toHaveProperty('name', NAME);
    expect(stored).not.toHaveProperty('evil');
  });
});

test.describe('fetch-recipe API', () => {
  test('localhost url is rejected with 400', async ({ request }) => {
    const res = await request.get(`/api/fetch-recipe?url=${encodeURIComponent('http://localhost/')}`);
    expect(res.status()).toBe(400);
  });

  test('non-URL input is rejected with 400', async ({ request }) => {
    const res = await request.get('/api/fetch-recipe?url=notaurl');
    expect(res.status()).toBe(400);
  });
});
