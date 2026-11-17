// כללי ניקוי ובדיקה למתכונים: סיווג שורות רכיבים, ניקוי הוראות ובדיקות תקינות.
// סקריפט קלאסי (בלי import/export) שרץ גם בדפדפן וגם ב-Node (vm). אין שימוש ב-DOM ולא ב-URL.
(function (root) {
  'use strict';

  // ---------- קבועים ----------
  const PREFIX_RE = /^\s*(?:(?:–>|->|=>|\*|•|·)\s*)+/;
  const BOUND = '(?=$|[\\s\\-־–,.:;/()])'; // "גבול מילה" בעברית (\b לא עובד)
  const QTY_WORDS = ['חצי', 'רבע', 'שליש', 'שני שליש', 'שלושת רבעי', 'כוסות', 'כוס', 'כפות', 'כף', 'כפית', 'כפיות',
    'קורט', 'מעט', 'צרור', 'חופנים', 'חופן', 'שן', 'שיני', 'קילו', 'ק"ג', 'גרם', 'ליטר', 'חבילה', 'חבילת',
    'שקית', 'מיכל', 'גביע', 'קופסה', 'קופסת', 'שתי', 'שני', 'שלוש', 'שלושה', 'ארבע'];
  const QTY_WORD_RE = new RegExp('^(?:' + QTY_WORDS.join('|') + ')' + BOUND);
  const UI_PHRASES = ['בחר הכל', 'לוח המרת מידות', 'סמנו והוסיפו', 'פריטים נוספו', 'רשימת קניות', 'רשימת הקניות',
    'קישור למתכון', 'הדפסה', 'הדפס', 'שתפו', 'שתף', 'פורסם לראשונה', 'אהבתם את המתכון', 'דרגו', 'מצאתם טעות',
    'מצאת טעות', 'כתבו לנו', 'תגובות', 'הפעל טיימר'];
  const META_KEYS = ['סוג הארוחה', 'סוג המנה', 'מטבח', 'מילות מפתח', 'מחבר', 'זמן הכנה', 'זמן כולל', 'זמן בישול',
    'זמן אפייה', 'רמת קושי', 'כמות סועדים', 'מספר סועדים'];
  const META_RE = new RegExp('^(?:' + META_KEYS.join('|') + ')\\s*[:：]');
  const ING_WORDS_RE = /^(?:מצרכים|המצרכים|רכיבים|הרכיבים|מרכיבים|המרכיבים)$/;
  const SUB_HEAD_RE = /^ל(?:בצק|מלית|מילוי|ציפוי|רוטב|קרם|גנאש|תערובת|הגשה|קישוט|תחתית|שכבה|בלילה|סירופ|הכנת|תיבול|טיגון)/;
  const NOTE_START_RE = new RegExp('^(?:תבנית|סיר|מחבת|קערה)' + BOUND);
  const ADVICE_RE = /(?:^|\s)(?:להשתמש|מומלץ|אפשר|ניתן|כדאי|רצוי)(?:\s|$)/;
  const STEP_VERB_RE = /^(?:מחממים|מערבבים|אופים|מוסיפים|מכניסים|יוצקים|מבשלים|מטגנים|קוצצים|שמים|מניחים|חותכים)(?=\s|$)/;
  const SHARE_HOSTS = ['share.google', 'bit.ly', 'tinyurl.com', 'lnkd.in', 't.co', 'goo.gl', 'did.li'];

  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const stripPrefix = t => t.replace(PREFIX_RE, '').trim();
  const head = t => t.replace(/^[^א-תA-Za-z]+/, '');

  // כותרת "אופן ההכנה" (הועבר מ-scrapeLines)
  function isInsHead(t) {
    t = String(t == null ? '' : t);
    return t.length <= 70 && (
      /^(אופן|דרך|שלבי|הוראות)\s*ה?הכנה/.test(head(t)) ||
      /^איך\s+(מכינים|מכין|מבשלים|אופים|עושים|מכינות|מכינה)/.test(head(t)) ||
      /(^|\s)ה?הכנה\s*[:：]?\s*$/.test(head(t)) ||
      /^אופן\s+(ה?עבודה|הכנת המתכון)/.test(head(t)));
  }

  // האם השורה מתחילה בכמות (מספר, שבר, מילת כמות, או "כ-" לפני אחד מהם)
  function hasQuantity(t) {
    t = t.replace(/^כ-?\s*(?=[\d½⅓⅔¼¾⅛])/, '');
    if (/^[\d½⅓⅔¼¾⅛]/.test(t)) return true;
    if (/^כ-/.test(t)) return true;
    return QTY_WORD_RE.test(t);
  }

  // שורה שהיא רעש ממשק/כותרת תחתית (עד 60 תווים)
  function isUiPhrase(t) {
    if (t.length > 60) return false;
    return UI_PHRASES.some(p => t.indexOf(p) !== -1) || /^(?:סועדים|מנות|יחידות)$/.test(t.replace(/[:\-–\s]/g, ''));
  }

  // רעש משותף לרכיבים ולהוראות: ריק, מספרים בלבד, ביטויי ממשק, מטא-דאטה
  function isCommonJunk(t) {
    return !t || /^[\p{N}\s\p{P}\p{S}]*$/u.test(t) || isUiPhrase(t) || META_RE.test(t);
  }

  function sameAsName(t, name) {
    return name.length >= 6 && norm(t) === name;
  }

  // ---------- סיווג שורה ----------
  function classifyLine(line, ctx) {
    ctx = ctx || {};
    const name = norm(ctx.recipeName);
    const trimmed = String(line == null ? '' : line).trim();
    const t = stripPrefix(trimmed);
    const out = (kind, text) => ({ kind, text: text === undefined ? t : text });

    // 1-2) רעש
    if (isCommonJunk(t)) return out('junk');
    const nt = norm(t);
    if (name.length >= 6 && (nt === name || (nt.startsWith(name) && nt.length <= name.length + 25))) return out('junk');
    if (/^\([^()\d]*\)$/.test(t) && t.length <= 25 && !/תבנית|ס"מ/.test(t)) return out('junk');
    // 4) כותרת הוראות
    if (isInsHead(t)) return out('instructions-start');
    // 5) כמות בתחילת השורה (שורה שמסתיימת ב-":" בלי ספרות היא כותרת, למשל "שתי אפשרויות לציפוי:")
    const qty = hasQuantity(t);
    if (qty && !(/[:：]$/.test(t) && !/\d/.test(t))) return out('item');
    // 6) כותרת כללית "מצרכים"
    const bare = t.replace(/[:：\-–\s]/g, '');
    if (ING_WORDS_RE.test(bare)) return out('junk');
    // 7) כותרת קבוצה
    const stripped = t.replace(/^[:：]\s*/, '').replace(/\s*[:：\-–]+\s*$/, '').trim();
    const looksHead = /[:：\-–]\s*$/.test(t) || /^[:：]/.test(t);
    if (looksHead && stripped && stripped.length <= 40) return out('heading', stripped);
    const colonWithContent = /[:：]\s*\S/.test(t);
    if (t.length <= 30 && !/\d/.test(t) && SUB_HEAD_RE.test(t) && !colonWithContent) return out('heading', stripped);
    // 8) הערות
    if (/^\(.*\)$/.test(t) || NOTE_START_RE.test(t) || /^המצרכים-/.test(t) || /^כמות\s*[:：]/.test(t)) return out('note');
    if (t.indexOf('תבנית') !== -1 && !qty) return out('note');
    // 9) משפטי הסבר ארוכים
    if (!qty && (t.length > 90 || (t.length > 40 && ADVICE_RE.test(t)))) return out('note');
    // 10) רכיב
    return out('item');
  }

  // פירוק פנימי: מחזיר גם את השורה המקורית
  function parseFull(text, recipeName) {
    const res = [];
    let moved = false;
    String(text == null ? '' : text).split(/\r?\n/).forEach(raw => {
      const orig = raw.trim();
      if (!orig) return;
      if (moved) { res.push({ kind: 'moved-instructions', text: orig, orig }); return; }
      const c = classifyLine(orig, { recipeName });
      if (c.kind === 'instructions-start') { moved = true; res.push({ kind: 'moved-instructions', text: orig, orig, isHead: true }); return; }
      res.push({ kind: c.kind, text: c.text, orig });
    });
    return res;
  }

  function parseIngredients(text, recipeName) {
    return parseFull(text, recipeName).map(e => ({ kind: e.kind, text: e.text }));
  }

  // ---------- ניקוי הוראות ----------
  function cleanInstructions(text, recipeName) {
    const name = norm(recipeName);
    let lines = String(text == null ? '' : text).split(/\r?\n/).map(l => l.trim());
    const removed = [];
    const iHead = lines.findIndex(isInsHead);
    if (iHead >= 0) {
      lines.slice(0, iHead + 1).forEach(l => { if (l) removed.push(l); });
      lines = lines.slice(iHead + 1);
    }
    const kept = [];
    lines.forEach(l => {
      if (!l) return;
      if (isCommonJunk(l) || sameAsName(l, name) || /^הפעל טיימר/.test(l)) removed.push(l);
      else kept.push(l);
    });
    return { text: kept.join('\n'), removed };
  }

  // ---------- ניקוי מתכון שלם ----------
  function cleanRecipe(recipe) {
    const r = Object.assign({}, recipe);
    const removed = [], moved = [], ing = [];
    parseFull(r.ingredients, r.name).forEach(e => {
      if (e.kind === 'heading') ing.push(e.text + ':');
      else if (e.kind === 'item' || e.kind === 'note') ing.push(e.orig.replace(/^[:：]\s*/, ''));
      else if (e.kind === 'junk') removed.push(e.orig);
      else if (!e.isHead) moved.push(e.orig);
    });
    r.ingredients = ing.join('\n');
    let ins = String(r.instructions == null ? '' : r.instructions);
    if (!ins.trim() && moved.length) ins = moved.join('\n');
    const ci = cleanInstructions(ins, r.name);
    r.instructions = ci.text;
    ci.removed.forEach(l => removed.push(l));
    return { recipe: r, removed, moved };
  }

  // ---------- בדיקות תקינות ----------
  const trimUrl = u => String(u == null ? '' : u).trim().replace(/\/+$/, '');
  const isHttp = u => /^https?:\/\//i.test(u);
  const hostOf = u => { const m = /^https?:\/\/([^\/?#:]+)/i.exec(u); return m ? m[1].toLowerCase().replace(/^www\./, '') : ''; };

  function checkRecipe(recipe, allRecipes) {
    recipe = recipe || {};
    allRecipes = allRecipes || [];
    const issues = [];
    const add = (level, code, msg, lines) => issues.push(lines && lines.length ? { level, code, msg, lines } : { level, code, msg });
    const name = String(recipe.name == null ? '' : recipe.name).trim();
    const video = String(recipe.videoUrl == null ? '' : recipe.videoUrl).trim();
    const image = String(recipe.imageUrl == null ? '' : recipe.imageUrl).trim();
    const others = allRecipes.filter(o => o && o.id !== recipe.id);

    if (!name) add('error', 'name-empty', 'חסר שם למתכון');
    if (video && !isHttp(video)) add('error', 'bad-link', 'הקישור למתכון חייב להתחיל ב-http:// או https://');
    if (image && !isHttp(image)) add('error', 'bad-image', 'קישור התמונה חייב להתחיל ב-http:// או https://');

    const parsed = parseFull(recipe.ingredients, name);
    const junk = parsed.filter(e => e.kind === 'junk').map(e => e.orig);
    if (junk.length) add('warn', 'junk-ingredients', 'ברשימת הרכיבים יש שורות לא רלוונטיות', junk);
    if (parsed.some(e => e.isHead)) add('warn', 'instructions-in-ingredients', 'הוראות הכנה מופיעות בתוך רשימת הרכיבים');
    const ci = cleanInstructions(recipe.instructions, name);
    if (ci.removed.length) add('warn', 'junk-instructions', 'בהוראות ההכנה יש שורות לא רלוונטיות', ci.removed);
    const steps = parsed.filter(e => e.kind === 'item' && e.orig.length > 60 && STEP_VERB_RE.test(stripPrefix(e.orig))).map(e => e.orig);
    if (steps.length) add('warn', 'step-in-ingredients', 'נראה ששלבי הכנה נכנסו לרשימת הרכיבים', steps);

    const isYoutube = /(?:youtube\.com|youtu\.be)/i.test(video);
    if (!isYoutube) {
      if (!String(recipe.ingredients == null ? '' : recipe.ingredients).trim()) add('warn', 'no-ingredients', 'אין רכיבים במתכון');
      if (!String(recipe.instructions == null ? '' : recipe.instructions).trim()) add('warn', 'no-instructions', 'אין הוראות הכנה במתכון');
    }
    if (video && others.some(o => trimUrl(o.videoUrl) === trimUrl(video))) add('warn', 'duplicate-link', 'קיים מתכון אחר עם אותו קישור');
    if (video && isHttp(video) && (SHARE_HOSTS.indexOf(hostOf(video)) !== -1 || /\.page\.link$/.test(hostOf(video)))) {
      add('warn', 'share-link', 'זהו קישור שיתוף מקוצר ולא כתובת המתכון עצמו');
    }
    if (name && others.some(o => String(o.name == null ? '' : o.name).trim() === name)) add('warn', 'duplicate-name', 'קיים מתכון אחר עם אותו שם');
    if (name.length > 80 || name.indexOf(' | ') !== -1) add('warn', 'long-name', 'שם המתכון ארוך מדי או כולל שם אתר');
    return issues;
  }

  const RecipeRules = { classifyLine, parseIngredients, cleanInstructions, cleanRecipe, checkRecipe, isInsHead };
  if (typeof module !== 'undefined' && module.exports) module.exports = RecipeRules;
  root.RecipeRules = RecipeRules;
})(typeof window !== 'undefined' ? window : globalThis);
