// ניקוי מתכונים: הרצה יבשה בלבד. קורא קובץ JSON, מדפיס דוח וכותב קובץ פלט מקומי. לא מתחבר לשרת ולא כותב אליו.
// שימוש: node scripts/fix-recipes.mjs <recipes.json> [out.json]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// טעינת recipe-rules.js בהקשר מבודד (הקובץ הוא סקריפט קלאסי)
function loadRules() {
  const code = fs.readFileSync(path.join(here, '..', 'recipe-rules.js'), 'utf8');
  const sandbox = { module: { exports: {} } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);
  return sandbox.RecipeRules || sandbox.module.exports;
}

const [, , inFile, outArg] = process.argv;
if (!inFile) {
  console.error('שימוש: node scripts/fix-recipes.mjs <recipes.json> [out.json]');
  process.exit(1);
}
const outFile = outArg || path.join(here, 'out', 'cleaned.json');
const Rules = loadRules();

const recipes = JSON.parse(fs.readFileSync(inFile, 'utf8'));
if (!Array.isArray(recipes)) { console.error('הקובץ חייב להכיל מערך מתכונים'); process.exit(1); }

const results = recipes.map(r => ({ orig: r, ...Rules.cleanRecipe(r) }));
const allCleaned = results.map(x => x.recipe);

let changed = 0, withWarnings = 0;
results.forEach((x, i) => {
  const r = x.orig, c = x.recipe;
  const isChanged = (r.ingredients || '') !== c.ingredients || (r.instructions || '') !== c.instructions;
  const issues = Rules.checkRecipe(c, allCleaned);
  if (issues.length) withWarnings++;
  if (!isChanged && !issues.length) return;
  if (isChanged) changed++;
  console.log(`\n=== ${r.name || '(ללא שם)'} [${r.id || i}] ${isChanged ? '' : '(ללא שינוי)'}`);
  if (isChanged) {
    if (x.removed.length) { console.log('- removed:'); x.removed.forEach(l => console.log('    ' + l)); }
    if (x.moved.length) { console.log('- moved:'); x.moved.forEach(l => console.log('    ' + l)); }
  }
  if (issues.length) {
    console.log('- remaining issues:');
    issues.forEach(s => console.log(`    [${s.level}] ${s.code}: ${s.msg}`));
  }
});

// פלט: רק שדות תוכן, בלי _synced
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const out = allCleaned.map(({ _synced, ...rest }) => rest);
fs.writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');

console.log(`\nסיכום: ${changed} שונו, ${withWarnings} עם אזהרות/שגיאות שנותרו (מתוך ${recipes.length}). נכתב ל-${outFile}`);
