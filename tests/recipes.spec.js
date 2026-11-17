import { test, expect } from '@playwright/test';

const VIEW_BUTTON = 'צפה במתכון';

function makeRecipe(overrides = {}) {
  return {
    id: '1',
    name: 'מתכון לדוגמה',
    category: 'עיקריות',
    videoUrl: '',
    imageUrl: '',
    ingredients: '',
    instructions: '',
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// wakeLock: 'mock' installs a fake navigator.wakeLock that records calls,
// 'none' removes navigator.wakeLock, anything else keeps the browser default.
async function setup(page, recipes, { wakeLock } = {}) {
  await page.route('**/.netlify/functions/recipes**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: recipes });
    return route.fulfill({ json: { ok: true } });
  });

  await page.addInitScript(
    ([items, mode]) => {
      localStorage.setItem(
        'family_recipes',
        JSON.stringify(items.map((r) => ({ ...r, _synced: true }))),
      );

      if (mode === 'mock') {
        window.__wl = { requests: [], releases: 0 };
        Object.defineProperty(navigator, 'wakeLock', {
          configurable: true,
          value: {
            request: async (type) => {
              window.__wl.requests.push(type);
              return {
                release: async () => {
                  window.__wl.releases++;
                },
                addEventListener() {},
              };
            },
          },
        });
      }

      if (mode === 'none') {
        delete Navigator.prototype.wakeLock;
      }
    },
    [recipes, wakeLock ?? 'default'],
  );

  await page.goto('/');
}

// The card is the nearest ancestor of the recipe's h3 that holds its view button.
function cardFor(page, name) {
  return page
    .locator('h3', { hasText: name })
    .locator(`xpath=ancestor::*[.//button[normalize-space()="${VIEW_BUTTON}"]][1]`);
}

async function openRecipe(page, name) {
  await page.locator('#searchInput').fill(name);
  await cardFor(page, name).getByRole('button', { name: VIEW_BUTTON }).click();
  await expect(page.locator('#viewModal')).toBeVisible();
}

async function closeModal(page) {
  await page.locator('#viewModal').getByRole('button', { name: 'סגור' }).click();
}

test.describe('recipe name links', () => {
  test('valid http(s) videoUrl links the name in the card and in the modal', async ({ page }) => {
    const name = 'עוגת שוקולד';
    await setup(page, [makeRecipe({ id: '1', name, videoUrl: 'https://example.com/recipe' })]);

    await page.locator('#searchInput').fill(name);
    const cardLink = cardFor(page, name).getByTestId('recipe-name-link');
    await expect(cardLink).toHaveAttribute('href', 'https://example.com/recipe');
    await expect(cardLink).toHaveAttribute('target', '_blank');
    await expect(cardLink).toHaveAttribute('rel', /noopener/);

    await openRecipe(page, name);
    const modalLink = page.locator('#viewModalContent').getByTestId('recipe-name-link');
    await expect(modalLink).toHaveAttribute('href', 'https://example.com/recipe');
    await expect(modalLink).toHaveAttribute('target', '_blank');
    await expect(modalLink).toHaveAttribute('rel', /noopener/);
  });

  test('empty videoUrl renders the name without a link', async ({ page }) => {
    const name = 'לחם ביתי';
    await setup(page, [makeRecipe({ id: '2', name, videoUrl: '' })]);

    await page.locator('#searchInput').fill(name);
    const card = cardFor(page, name);
    await expect(card.getByTestId('recipe-name')).toBeVisible();
    await expect(card.locator('h3 a')).toHaveCount(0);
  });

  for (const videoUrl of ['javascript:alert(1)', 'www.site.co.il']) {
    test(`unsafe or non-http videoUrl "${videoUrl}" is not linked`, async ({ page }) => {
      const name = `מתכון ${videoUrl.length}`;
      await setup(page, [makeRecipe({ id: '3', name, videoUrl })]);

      await page.locator('#searchInput').fill(name);
      const card = cardFor(page, name);
      await expect(card.getByTestId('recipe-name-link')).toHaveCount(0);
      await expect(card.getByTestId('recipe-name')).toBeVisible();

      await openRecipe(page, name);
      await expect(page.locator('#viewModalContent').getByTestId('recipe-name-link')).toHaveCount(0);
    });
  }
});

test.describe('recipe name escaping', () => {
  test('HTML in the recipe name is rendered as text', async ({ page }) => {
    const name = 'עוגה <b>מודגשת</b> "מיוחדת"';
    await setup(page, [makeRecipe({ id: '4', name })]);

    await page.locator('#searchInput').fill('מודגשת');
    const heading = cardFor(page, 'מודגשת').locator('h3');
    await expect(heading).toContainText('<b>מודגשת</b>');
    await expect(heading.locator('b')).toHaveCount(0);
  });
});

test.describe('ingredients checklist', () => {
  const ingredients = 'לבצק:\n2 כוסות קמח\n\n1 ביצה\nלמילוי:\nשוקולד';

  test('headings are not checkable and checked items get a line-through', async ({ page }) => {
    const name = 'עוגה מרובת שכבות';
    await setup(page, [makeRecipe({ id: '5', name, ingredients })]);
    await openRecipe(page, name);

    const modal = page.locator('#viewModalContent');
    const items = modal.getByTestId('ingredient-item');
    const headings = modal.getByTestId('ingredient-heading');

    await expect(items).toHaveCount(3);
    await expect(headings).toHaveCount(2);
    await expect(headings.locator('input[type=checkbox]')).toHaveCount(0);

    // Clicking the label toggles its checkbox; the checkbox itself is visually hidden.
    const firstItem = items.nth(0);
    const firstText = firstItem.getByText('2 כוסות קמח');
    await firstItem.click();
    await expect(firstItem.locator('input[type=checkbox]')).toBeChecked();
    await expect(firstText).toHaveCSS('text-decoration-line', 'line-through');
  });

  test('checked state is not kept after closing and reopening the modal', async ({ page }) => {
    const name = 'עוגה מרובת שכבות חוזרת';
    await setup(page, [makeRecipe({ id: '6', name, ingredients })]);
    await openRecipe(page, name);

    const modal = page.locator('#viewModalContent');
    await modal.getByTestId('ingredient-item').nth(0).click();
    await expect(modal.getByTestId('ingredient-item').nth(0).locator('input[type=checkbox]')).toBeChecked();

    await closeModal(page);
    await openRecipe(page, name);

    await expect(page.locator('#viewModal input[type=checkbox]:checked')).toHaveCount(0);
  });
});

test.describe('wake lock', () => {
  test('acquires a screen wake lock while the recipe is open and releases it on close', async ({ page }) => {
    const name = 'מרק עדשים';
    await setup(page, [makeRecipe({ id: '7', name })], { wakeLock: 'mock' });
    await openRecipe(page, name);

    await expect.poll(() => page.evaluate(() => window.__wl.requests)).toEqual(['screen']);
    await expect(page.locator('#viewModal').getByTestId('wakelock-note')).toBeVisible();

    await closeModal(page);
    await expect.poll(() => page.evaluate(() => window.__wl.releases)).toBe(1);
  });

  test('without wake lock support the note stays hidden and no errors are logged', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    const name = 'מרק עדשים ללא נעילה';
    await setup(page, [makeRecipe({ id: '8', name })], { wakeLock: 'none' });
    await openRecipe(page, name);

    await expect(page.locator('#viewModal').getByTestId('wakelock-note')).toBeHidden();
    expect(errors).toEqual([]);
  });
});
