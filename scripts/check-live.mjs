// Read-only check of the recipes stored on the live site.
// Usage: npm run check:live
// Env: SITE_URL (defaults to the production site), FAMILY_CODE (sent as x-family-code if set).

import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const SITE = process.env.SITE_URL || 'https://superb-squirrel-2bafba.netlify.app';

const headers = {};
if (process.env.FAMILY_CODE) headers['x-family-code'] = process.env.FAMILY_CODE;

let recipes;
try {
  const res = await fetch(`${SITE}/.netlify/functions/recipes`, { headers });
  if (!res.ok) {
    console.error(`Failed to fetch recipes: HTTP ${res.status}`);
    process.exit(1);
  }
  recipes = await res.json();
} catch (error) {
  console.error(`Failed to fetch recipes: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(recipes)) {
  console.error('Unexpected response: expected an array of recipes');
  process.exit(1);
}

// recipe-rules.js is a classic script that exposes its API via module.exports or a global.
const code = await readFile(new URL('../recipe-rules.js', import.meta.url), 'utf8');
const context = { module: { exports: {} }, globalThis: {} };
vm.runInNewContext(code, context, { filename: 'recipe-rules.js' });

const rules =
  (context.module.exports && context.module.exports.checkRecipe ? context.module.exports : null) ||
  context.RecipeRules ||
  context.globalThis.RecipeRules;

if (!rules || typeof rules.checkRecipe !== 'function') {
  console.error('recipe-rules.js did not expose checkRecipe');
  process.exit(1);
}

let errorCount = 0;
let warnCount = 0;

for (const recipe of recipes) {
  const issues = rules.checkRecipe(recipe, recipes);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.length - errors;
  errorCount += errors;
  warnCount += warns;

  const icon = errors ? '❌' : warns ? '⚠️' : '✅';
  console.log(`${icon} ${recipe.name || '(ללא שם)'}`);

  for (const issue of issues) {
    console.log(`    ${issue.code}: ${issue.msg}`);
    for (const line of (issue.lines ?? []).slice(0, 3)) {
      console.log(`        ${line}`);
    }
  }
}

console.log(`\n${recipes.length} recipes, ${errorCount} errors, ${warnCount} warnings`);
process.exitCode = errorCount ? 1 : 0;
