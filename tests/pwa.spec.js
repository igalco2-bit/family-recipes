import { test, expect } from '@playwright/test';

test.describe('PWA / home-screen icon', () => {
  test('manifest and icons are served', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest.short_name).toBe('מתכונים');
    const srcs = manifest.icons.map((i) => i.src);
    expect(srcs.length).toBeGreaterThanOrEqual(3);
    for (const src of [...srcs, '/icons/apple-touch-icon.png', '/icons/favicon-32.png']) {
      const r = await request.get(src);
      expect(r.status(), src).toBe(200);
      expect(r.headers()['content-type'], src).toContain('image/png');
    }
  });

  test('page head links the manifest and touch icon', async ({ page }) => {
    await page.route('**/api/recipes**', (route) => route.fulfill({ json: [] }));
    await page.goto('/');
    await expect(page.locator('link[rel=apple-touch-icon]')).toHaveCount(1);
    await expect(page.locator('link[rel=manifest]')).toHaveCount(1);
  });
});
