import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lines = JSON.parse(readFileSync(path.join(here, 'fixtures', 'lines.json'), 'utf8'));

function makeRecipe(overrides = {}) {
  return {
    id: '1',
    name: 'מתכון',
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

async function check(page, recipe, all = [recipe]) {
  return page.evaluate(([r, a]) => RecipeRules.checkRecipe(r, a), [recipe, all]);
}

test.describe('recipe rules', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/.netlify/functions/recipes**', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: [] });
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.RecipeRules));
  });

  test.describe('classifyLine', () => {
    for (const { line, kind, name } of lines) {
      test(`classifyLine "${line}" → ${kind}`, async ({ page }) => {
        const result = await page.evaluate(
          ([l, n]) => RecipeRules.classifyLine(l, { recipeName: n }).kind,
          [line, name ?? null],
        );
        expect(result).toBe(kind);
      });
    }

    test('item with a leading –> marker has the marker stripped', async ({ page }) => {
      const entry = lines.find((e) => e.line.startsWith('–>'));
      const text = await page.evaluate(
        (l) => RecipeRules.classifyLine(l, { recipeName: null }).text,
        entry.line,
      );
      expect(text.startsWith('או רבע')).toBe(true);
    });
  });

  test.describe('parseIngredients', () => {
    test('instructions-start line and everything after it are moved-instructions', async ({ page }) => {
      const kinds = await page.evaluate(() =>
        RecipeRules.parseIngredients('2 כוסות קמח\nהוראות הכנה\nמחממים תנור', null).map((i) => i.kind),
      );
      expect(kinds).toEqual(['item', 'moved-instructions', 'moved-instructions']);
    });
  });

  test.describe('cleanRecipe', () => {
    test('strips junk and moves instructions out of the rice ingredients, without mutating input', async ({ page }) => {
      const input = makeRecipe({
        name: 'אורז עם פטריות וערמונים',
        ingredients:
          '12\nאורז עם פטריות וערמונים בתבנית אחת\nמצרכים\nבחר הכל\n2 כוסות אורז בסמטי\n1 בצל גדול, קצוץ\n0\nלהגשה: פטרוזיליה',
        instructions: 'מחממים תנור ל־190 מעלות.\nפורסם לראשונה: 21:58, 30.08.26\nאהבתם את המתכון? דרגו',
      });

      const { out, unchanged } = await page.evaluate((r) => {
        const snapshot = JSON.stringify(r);
        const res = RecipeRules.cleanRecipe(r);
        return { out: res, unchanged: JSON.stringify(r) === snapshot };
      }, input);

      expect(out.recipe.ingredients.split('\n')).toEqual([
        '2 כוסות אורז בסמטי',
        '1 בצל גדול, קצוץ',
        'להגשה: פטרוזיליה',
      ]);
      expect(out.recipe.instructions).toBe('מחממים תנור ל־190 מעלות.');
      expect(unchanged).toBe(true);
    });

    test('keeps only the instructions that follow the instructions-start marker', async ({ page }) => {
      const input = makeRecipe({
        ingredients: '',
        instructions: 'תיאור\nסוג הארוחה: מנה עיקרית\nמצרכים\n1 כף דבש\nהוראות הכנה\nמחממים תנור.\n\nאופים 20 דקות.',
      });
      const out = await page.evaluate((r) => RecipeRules.cleanRecipe(r), input);
      expect(out.recipe.instructions).toBe('מחממים תנור.\nאופים 20 דקות.');
    });
  });

  test.describe('checkRecipe', () => {
    test('empty name is an error', async ({ page }) => {
      const issues = await check(page, makeRecipe({ name: '' }));
      expect(issues).toContainEqual(expect.objectContaining({ level: 'error', code: 'name-empty' }));
    });

    test('javascript: link is an error', async ({ page }) => {
      const issues = await check(page, makeRecipe({ videoUrl: 'javascript:alert(1)' }));
      expect(issues).toContainEqual(expect.objectContaining({ level: 'error', code: 'bad-link' }));
    });

    test('a complete recipe has no issues', async ({ page }) => {
      const clean = makeRecipe({
        id: '10',
        name: 'עוגת גבינה',
        ingredients: '2 כוסות קמח\n1 ביצה',
        instructions: 'מערבבים\nאופים',
        videoUrl: 'https://example.com/recipe',
      });
      expect(await check(page, clean, [clean])).toEqual([]);
    });

    test('same link on another recipe is a duplicate-link warning', async ({ page }) => {
      const link = 'https://example.com/shared';
      const other = makeRecipe({ id: '1', name: 'מתכון אחר', videoUrl: link });
      const mine = makeRecipe({
        id: '2',
        name: 'מתכון שלי',
        ingredients: '2 כוסות קמח\n1 ביצה',
        instructions: 'מערבבים\nאופים',
        videoUrl: link,
      });
      const issues = await check(page, mine, [other]);
      expect(issues).toContainEqual(expect.objectContaining({ level: 'warn', code: 'duplicate-link' }));
    });

    test('share.google link is a share-link warning', async ({ page }) => {
      const issues = await check(page, makeRecipe({ videoUrl: 'https://share.google/abc' }));
      expect(issues.map((i) => i.code)).toContain('share-link');
    });

    test('YouTube link does not require ingredients or instructions', async ({ page }) => {
      const issues = await check(
        page,
        makeRecipe({ name: 'סרטון', videoUrl: 'https://www.youtube.com/watch?v=abc123' }),
      );
      const codes = issues.map((i) => i.code);
      expect(codes).not.toContain('no-ingredients');
      expect(codes).not.toContain('no-instructions');
    });

    test('junk ingredient is reported with the offending line', async ({ page }) => {
      const issues = await check(
        page,
        makeRecipe({
          name: 'בדיקה',
          ingredients: '2 כוסות קמח\nבחר הכל',
          instructions: 'מערבבים',
          videoUrl: 'https://example.com/x',
        }),
      );
      const junk = issues.find((i) => i.code === 'junk-ingredients');
      expect(junk).toBeDefined();
      expect(JSON.stringify(junk.lines)).toContain('בחר הכל');
    });
  });
});
