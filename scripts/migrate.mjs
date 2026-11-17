// Copy recipes from one deployed site to another (e.g. the old Netlify site to the Cloudflare Pages site).
// Usage: node scripts/migrate.mjs <fromSite> <toSite> [--dry-run]
// Env (optional): FROM_CODE / TO_CODE are sent as x-family-code to the source / destination.
// Exit codes: 0 ok, 1 failed PUT or mismatch after retries, 2 usage error.

const FROM_CODE = process.env.FROM_CODE;
const TO_CODE = process.env.TO_CODE;

const COMPARE_FIELDS = ['name', 'category', 'videoUrl', 'imageUrl', 'ingredients', 'instructions', 'notes'];
const RETRIES = 6;
const RETRY_DELAY_MS = 10_000;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [fromArg, toArg] = args.filter((a) => !a.startsWith('--'));

if (!fromArg || !toArg) {
  console.error('שימוש: node scripts/migrate.mjs <fromSite> <toSite> [--dry-run]');
  console.error('usage: node scripts/migrate.mjs <fromSite> <toSite> [--dry-run]');
  console.error('optional env: FROM_CODE, TO_CODE');
  process.exit(2);
}

const FROM = fromArg.replace(/\/+$/, '');
const TO = toArg.replace(/\/+$/, '');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function headersFor(code) {
  return code ? { 'x-family-code': code } : {};
}

async function fetchRecipeArray(url, code) {
  const res = await fetch(url, { headers: headersFor(code) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('non-JSON response');
  }
  if (!Array.isArray(data)) throw new Error('expected an array of recipes');
  return data;
}

// The old Netlify site may not have the /api redirect yet, so fall back to the function path.
async function readSource() {
  const primary = `${FROM}/api/recipes`;
  try {
    return { recipes: await fetchRecipeArray(primary, FROM_CODE), url: primary };
  } catch (error) {
    const fallback = `${FROM}/.netlify/functions/recipes`;
    console.log(`(${primary} failed: ${error.message}; trying ${fallback})`);
    try {
      return { recipes: await fetchRecipeArray(fallback, FROM_CODE), url: fallback };
    } catch (fallbackError) {
      throw new Error(`could not read source recipes: ${fallbackError.message}`);
    }
  }
}

let source;
try {
  source = await readSource();
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

console.log(`Read ${source.recipes.length} recipes from ${source.url}`);

// Strip local-only fields before sending.
const payloads = source.recipes.map(({ _synced, ...rest }) => rest);

if (dryRun) {
  console.log(`--dry-run: would PUT ${payloads.length} recipes to ${TO}/api/recipes (nothing written)`);
  for (const p of payloads) {
    console.log(`\n--- ${p.name || '(no name)'} [${p.id}]`);
    console.log(JSON.stringify(p, null, 2));
  }
  process.exit(0);
}

let failedPuts = 0;
for (const p of payloads) {
  const label = p.name || '(no name)';
  let ok = false;
  let status;
  try {
    const res = await fetch(`${TO}/api/recipes`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...headersFor(TO_CODE) },
      body: JSON.stringify(p),
    });
    ok = res.ok;
    status = res.status;
    await res.text();
  } catch (error) {
    status = `network error: ${error.message}`;
  }
  if (ok) {
    console.log(`✅ ${label}`);
  } else {
    console.log(`❌ ${label} ${status}`);
    failedPuts++;
  }
}

// Compare the destination with the source. KV is eventually consistent, so retry a few times.
async function compareWithDestination() {
  let dest;
  try {
    dest = await fetchRecipeArray(`${TO}/api/recipes`, TO_CODE);
  } catch (error) {
    return [`could not read destination recipes: ${error.message}`];
  }

  const problems = [];
  if (dest.length !== payloads.length) {
    problems.push(`count differs: source ${payloads.length}, destination ${dest.length}`);
  }

  const byId = new Map(dest.map((r) => [r.id, r]));
  for (const src of payloads) {
    const label = `${src.name || '(no name)'} [${src.id}]`;
    const d = byId.get(src.id);
    if (!d) {
      problems.push(`${label}: missing on destination`);
      continue;
    }
    for (const field of COMPARE_FIELDS) {
      const a = JSON.stringify(src[field] ?? '');
      const b = JSON.stringify(d[field] ?? '');
      if (a !== b) problems.push(`${label}: field "${field}" differs`);
    }
  }
  return problems;
}

let problems = [];
for (let attempt = 0; attempt <= RETRIES; attempt++) {
  if (attempt > 0) {
    console.log(`… destination not in sync yet, retrying in 10s (${attempt}/${RETRIES})`);
    await sleep(RETRY_DELAY_MS);
  }
  problems = await compareWithDestination();
  if (problems.length === 0) break;
}

console.log(
  `\nSummary: ${payloads.length - failedPuts} of ${payloads.length} saved, ${failedPuts} failed PUT(s), ` +
    `${problems.length} verification issue(s)`,
);
for (const problem of problems) console.log(`  ⚠ ${problem}`);

process.exitCode = failedPuts || problems.length ? 1 : 0;
