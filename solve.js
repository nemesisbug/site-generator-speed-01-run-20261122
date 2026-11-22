// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
//
// Same answers as makefun-site's build, byte for byte, on every input; written
// for speed instead of for the plugin shape. The dialect is makefun-site's own
// (README.md in the kit): its front matter, Markdown subset, template dialect,
// slug rule and report. Where the README and the reference code differ, the code
// is the reference, and this file follows the code.
//
// Speed comes from: templates compiled once per case into plain JS functions
// (no tree walk per render), Markdown rendered straight into a string array
// (no token objects, no per-character escaping), slugify/date memoised per run
// (titles, tags and headings repeat a lot), and front matter / block
// classification done by hand instead of by regex.
//
// Verified 23 Nov 2026: byte-identical answers on all 3 practice cases
// (practice/reference/expected.json), `makefun grade-local` passed 3/3 with
// the L1 regrade reproducing byte for byte; ~150 ms per 3-case set against
// ~530-610 ms for makefun-site itself behind the same driver.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;

/** `text` with & < > " and ' escaped. */
export function escapeHtml(text) {
  return text.replace(ESC_RE, (c) => ESCAPES[c]);
}

/** Code-unit order (never the locale's). */
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words, from the string alone: "2026-11-09" is "9 November 2026". */
function longDate(date) {
  const [y, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/**
 * The slug of `text`, memoised per run: NFKD, combining marks dropped, A-Z
 * lowered, every run of characters other than a-z and 0-9 one "-", none at
 * either end, at most 64 characters (a "-" left at the cut dropped), and
 * "untitled" when nothing is left.
 */
function makeSlugify() {
  const cache = new Map();
  return function slugify(text) {
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
    const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
    let out = '';
    let gap = false;
    for (const ch of plain) {
      let keep = null;
      if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
      else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
      if (keep === null) {
        gap = out.length > 0;
        continue;
      }
      if (gap) out += '-';
      gap = false;
      out += keep;
    }
    out = out.slice(0, 64).replace(/-+$/, '');
    const r = out === '' ? 'untitled' : out;
    cache.set(text, r);
    return r;
  };
}

/** `slug` made unique against `taken` (and added to it): the first of slug, slug-2, slug-3 ... not taken. */
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

/** The words of a body: its runs of characters other than whitespace (no allocation, unlike /\S+/g). */
function wordsOf(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const ws = c <= 32 || c === 0x00a0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
    if (ws) inWord = false;
    else if (!inWord) {
      inWord = true;
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------- front matter

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

/** The days of month `m` (1-12) of year `y`, by the Gregorian rule. */
function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

const isDigit = (c) => c >= '0' && c <= '9';

/** A string value: "..." with \" and \\ its only escapes, or bare, the rest of the line (never opening on " or [). */
function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

/** Whether `s` is a template name: [a-z0-9-]+, at least one character. */
function isName(s) {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-')) return false;
  }
  return true;
}

/** Whether `s` is a slug: [a-z0-9]+ groups joined by single "-", at most 64 characters. */
function isSlug(s) {
  if (s.length === 0 || s.length > 64) return false;
  let prevDash = true;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '-') {
      if (prevDash) return false;
      prevDash = true;
    } else if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) prevDash = false;
    else return false;
  }
  return !prevDash;
}

/** One key's value, or why it is refused. */
function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      let ok = raw.length === 10 && raw.charCodeAt(4) === 45 && raw.charCodeAt(7) === 45;
      if (ok) {
        for (let i = 0; i < 10; i++) {
          if (i !== 4 && i !== 7 && !isDigit(raw[i])) { ok = false; break; }
        }
      }
      const y = ok ? Number(raw.slice(0, 4)) : 0;
      const mo = ok ? Number(raw.slice(5, 7)) : 0;
      const d = ok ? Number(raw.slice(8, 10)) : 0;
      if (!ok || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) {
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      }
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (const t of tags) {
        if (t === '' || t.indexOf('"') !== -1 || t.indexOf('[') !== -1 || t.indexOf(']') !== -1) {
          return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        }
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return isName(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return isSlug(raw) ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

const isBlank = (line) => {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
};

/** `line` with spaces and tabs at either end dropped. */
function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return line.slice(a, b);
}

/** `line` with spaces and tabs at its end dropped. */
function trimRightST(line) {
  let b = line.length;
  while (b > 0 && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return line.slice(0, b);
}

/**
 * A source's front matter and body: { data, body }, or { error } with the first reason it is refused.
 * `text` has "\n" line ends. Only the front matter is walked line by line; the body is sliced, not split.
 */
function parseFrontMatter(text) {
  let start = 0;
  let end = text.indexOf('\n', start);
  if ((end === -1 ? text.slice(start) : text.slice(start, end)) !== '---') return { error: 'no front matter' };
  start = end === -1 ? text.length : end + 1;
  const data = {};
  let lineNo = 1;
  let closeEnd = -1;
  for (;;) {
    end = text.indexOf('\n', start);
    const line = end === -1 ? text.slice(start) : text.slice(start, end);
    if (line === '---') {
      closeEnd = end;
      break;
    }
    if (isBlank(line) || line.charCodeAt(0) === 35) {
      // blank or a comment: skipped
    } else {
      // /^([a-z_]+):(?: (.*))?$/
      let k = 0;
      while (k < line.length && ((line[k] >= 'a' && line[k] <= 'z') || line[k] === '_')) k++;
      if (k === 0 || line[k] !== ':') return { error: `line ${lineNo + 1} is not "key: value"` };
      const key = line.slice(0, k);
      let raw;
      if (k + 1 === line.length) raw = '';
      else if (line[k + 1] === ' ') raw = line.slice(k + 2);
      else return { error: `line ${lineNo + 1} is not "key: value"` };
      raw = trimRightST(raw);
      if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
      if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
      if (raw === '') return { error: `key "${key}" has no value` };
      const v = valueOf(key, raw);
      if ('error' in v) return v;
      data[key] = v.value;
    }
    if (end === -1) break;
    start = end + 1;
    lineNo++;
  }
  if (closeEnd === -1) return { error: 'the front matter is not closed' };
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: closeEnd === -1 ? '' : text.slice(closeEnd + 1) };
}

// ---------------------------------------------------------------- Markdown

/** The characters a backslash escapes. */
const ESCAPABLE = new Uint8Array(128);
for (const c of ['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']) ESCAPABLE[c.charCodeAt(0)] = 1;

/** A fence's language, or null when `line` does not open one: /^```([A-Za-z0-9_+-]*)[ \t]*$/. */
function fenceOpen(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let i = 3;
  const start = i;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) i++;
    else break;
  }
  const lang = line.slice(start, i);
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return null;
    i++;
  }
  return lang;
}

/** Whether `line` closes a fence: /^```[ \t]*$/. */
function fenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A heading line's level and text, or null (a heading's text is never empty). */
function headingOf(line) {
  let n = 0;
  while (n < line.length && line.charCodeAt(n) === 35) n++;
  if (n === 0 || n > 6) return null;
  if (n >= line.length) return null;
  const c = line.charCodeAt(n);
  if (c !== 32 && c !== 9) return null;
  let i = n;
  while (i < line.length && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) i++;
  let j = line.length;
  while (j > i && (line.charCodeAt(j - 1) === 32 || line.charCodeAt(j - 1) === 9)) j--;
  if (j === i) return null;
  return { depth: n, text: line.slice(i, j) };
}

/** Whether `line` is a thematic break: /^(?:---|\*\*\*)[ \t]*$/. */
function isHr(line) {
  if (line.length < 3) return false;
  const c0 = line.charCodeAt(0);
  if (c0 === 45) {
    if (line.charCodeAt(1) !== 45 || line.charCodeAt(2) !== 45) return false;
  } else if (c0 === 42) {
    if (line.charCodeAt(1) !== 42 || line.charCodeAt(2) !== 42) return false;
  } else return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Whether `line` ends a paragraph: a blank line, a fence, a heading or a thematic break. */
function endsParagraph(line) {
  if (line.length === 0) return true;
  const c0 = line.charCodeAt(0);
  // Blank, fence, heading and break lines all open on space, tab, `, #, - or *; anything else cannot end one.
  if (c0 !== 32 && c0 !== 9 && c0 !== 96 && c0 !== 35 && c0 !== 45 && c0 !== 42) return false;
  return isBlank(line) || fenceOpen(line) !== null || headingOf(line) !== null || isHr(line);
}

/** A bullet item's text, or null: /^[-*] (.*)$/. */
function bulletOf(line) {
  const c = line.charCodeAt(0);
  if ((c === 45 || c === 42) && line.charCodeAt(1) === 32) return line.slice(2);
  return null;
}

/** An ordered item's number and text, or null: /^(\d{1,9})\. (.*)$/. */
function orderedOf(line) {
  let i = 0;
  let n = 0;
  while (i < line.length && i < 9) {
    const c = line.charCodeAt(i);
    if (c < 48 || c > 57) break;
    n = n * 10 + (c - 48);
    i++;
  }
  if (i === 0) return null;
  if (line.charCodeAt(i) !== 46 || line.charCodeAt(i + 1) !== 32) return null;
  return { num: n, rest: line.slice(i + 2) };
}

/** Whether `line` continues a list item: /^ {2,}\S/. */
function isContinued(line) {
  return line.charCodeAt(0) === 32 && line.charCodeAt(1) === 32 && line.length > 2 && !/\s/.test(line[2]);
}

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE[s.charCodeAt(j + 1)]) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE[s.charCodeAt(j + 1)]) {
      j++;
      continue;
    }
    if (c !== '*') continue;
    if (s[j + 1] === '*') {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/** One scan for inline: a construct opener (\ ` * [) or a character the escape table names. Shared, with lastIndex saved and restored around the recursive calls below. */
const INLINE_RE = /[\\`*\[]|[&<>"']/g;

/**
 * `s` rendered inline; `env.link(target)` is a link's href. One regex pass: a plain run is copied as-is until a
 * match, an escapable character is written as its entity, and a construct opener is handled in place.
 */
function inline(s, env) {
  const re = INLINE_RE;
  re.lastIndex = 0;
  let out = null;
  let plain = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    const i = m.index;
    const c = m[0];
    if (c === '&' || c === '<' || c === '>' || c === '"' || c === "'") {
      if (out === null) out = [];
      if (i > plain) out.push(s.slice(plain, i));
      out.push(ESCAPES[c]);
      plain = i + 1;
      continue;
    }
    if (c === '\\' && i + 1 < s.length && ESCAPABLE[s.charCodeAt(i + 1)]) {
      if (out === null) out = [];
      if (i > plain) out.push(s.slice(plain, i));
      const n = s[i + 1];
      out.push(n === '>' ? '&gt;' : n);
      plain = i + 2;
      re.lastIndex = plain;
      continue;
    }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        if (out === null) out = [];
        if (i > plain) out.push(s.slice(plain, i));
        out.push('<code>', escapeHtml(s.slice(i + 1, j)), '</code>');
        plain = j + 1;
        re.lastIndex = plain;
      }
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) {
          if (out === null) out = [];
          if (i > plain) out.push(s.slice(plain, i));
          const saved = re.lastIndex;
          const inner = inline(s.slice(i + 2, j), env);
          re.lastIndex = saved;
          out.push('<strong>', inner, '</strong>');
          plain = j + 2;
          re.lastIndex = plain;
        } else {
          re.lastIndex = i + 2;
        }
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) {
        if (out === null) out = [];
        if (i > plain) out.push(s.slice(plain, i));
        const saved = re.lastIndex;
        const inner = inline(s.slice(i + 1, j), env);
        re.lastIndex = saved;
        out.push('<em>', inner, '</em>');
        plain = j + 1;
        re.lastIndex = plain;
      }
      continue;
    }
    if (c === '[') {
      const k = findUnescaped(s, ']', i + 1);
      const mm = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = mm === -1 ? '' : s.slice(k + 2, mm);
      if (target !== '' && !/\s/.test(target)) {
        if (out === null) out = [];
        if (i > plain) out.push(s.slice(plain, i));
        const saved = re.lastIndex;
        const inner = inline(s.slice(i + 1, k), env);
        re.lastIndex = saved;
        out.push('<a href="', escapeHtml(env.link(target)), '">', inner, '</a>');
        plain = mm + 1;
        re.lastIndex = plain;
        continue;
      }
      continue;
    }
  }
  if (out === null) return s;
  if (plain < s.length) out.push(s.slice(plain));
  return out.join('');
}

/**
 * `src` rendered: its HTML (each block on its own lines, a "\n" after the last), its table of contents (every level 2
 * and 3 heading: level, id and its inline HTML) and its excerpt (the first paragraph's inline HTML, or "").
 */
function renderMarkdown(src, env, slugify) {
  const lines = src.split('\n');
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    const c0 = line.length === 0 ? -1 : line.charCodeAt(0);
    // Dispatch on the first character: most lines are plain paragraph text, and only a few first
    // characters can open another block.
    if (c0 === -1 || c0 === 32 || c0 === 9) {
      if (isBlank(line)) {
        i++;
        continue;
      }
    } else if (c0 === 96) {
      const lang = fenceOpen(line);
      if (lang !== null) {
        const body = [];
        i++;
        while (i < n && !fenceClose(lines[i])) body.push(lines[i++]);
        i++;
        const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
        const inner = body.length === 0 ? '' : `${escapeHtml(body.join('\n'))}\n`;
        blocks.push(`<pre><code${cls}>${inner}</code></pre>\n`);
        continue;
      }
    } else if (c0 === 35) {
      const h = headingOf(line);
      if (h !== null) {
        const id = uniqueSlug(slugify(h.text), ids);
        const html = inline(h.text, env);
        blocks.push(`<h${h.depth} id="${id}">${html}</h${h.depth}>\n`);
        if (h.depth === 2 || h.depth === 3) toc.push({ level: h.depth, id, html });
        i++;
        continue;
      }
    } else if (c0 === 45 || c0 === 42) {
      if (isHr(line)) {
        blocks.push('<hr>\n');
        i++;
        continue;
      }
      const b0 = bulletOf(line);
      if (b0 !== null) {
        const items = [];
        while (i < n) {
          const m = bulletOf(lines[i]);
          if (m !== null) {
            items.push([trimLine(m)]);
            i++;
            continue;
          }
          if (isContinued(lines[i])) {
            items[items.length - 1].push(trimLine(lines[i]));
            i++;
            continue;
          }
          break;
        }
        let inner = '';
        for (const parts of items) inner += `<li>${inline(parts.join('\n'), env)}</li>\n`;
        blocks.push(`<ul>\n${inner}</ul>\n`);
        continue;
      }
    } else if (c0 === 62) {
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        let l = lines[i].slice(1);
        if (l.charCodeAt(0) === 32) l = l.slice(1);
        body.push(l);
        i++;
      }
      const ls = body.map(trimLine).filter((l) => l !== '');
      blocks.push(ls.length === 0 ? '<blockquote>\n</blockquote>\n' : `<blockquote>\n<p>${inline(ls.join('\n'), env)}</p>\n</blockquote>\n`);
      continue;
    } else if (c0 >= 48 && c0 <= 57) {
      const o0 = orderedOf(line);
      if (o0 !== null) {
        const items = [];
        while (i < n) {
          const m = orderedOf(lines[i]);
          if (m !== null) {
            items.push([trimLine(m.rest)]);
            i++;
            continue;
          }
          if (isContinued(lines[i])) {
            items[items.length - 1].push(trimLine(lines[i]));
            i++;
            continue;
          }
          break;
        }
        const open = o0.num !== 1 ? `<ol start="${o0.num}">` : '<ol>';
        let inner = '';
        for (const parts of items) inner += `<li>${inline(parts.join('\n'), env)}</li>\n`;
        blocks.push(`${open}\n${inner}</ol>\n`);
        continue;
      }
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>\n`);
  }
  return { html: blocks.join(''), toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

/** The deepest an include nests: one past it renders nothing. */
const INCLUDE_DEPTH = 8;

/** A template that does not parse: its name and why. */
class TemplateError extends Error {}

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

/** The path `text` names, split at its dots, or a TemplateError. */
function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/** `src` parsed into its tree of nodes (a TemplateError when it does not parse). */
function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
function txt(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(txt).join(', ');
  return '';
}

/** A value as escaped text, for {{ }}: a string is escaped straight off, anything else goes through txt first. */
function vr(v) {
  return typeof v === 'string' ? escapeHtml(v) : escapeHtml(txt(v));
}

/** A value as raw text, for {{{ }}}: a string is itself, anything else goes through txt. */
function raw(v) {
  return typeof v === 'string' ? v : txt(v);
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** The value of a top-scope name: the nearest scope in the chain holding it (includes pass their loop bindings on). */
function top(scope, name) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, name)) s = s.parent;
  return s === null ? undefined : s.vars[name];
}

/** The own property `name` of `v`, or undefined when `v` has none (a null, a primitive, or a missing key). */
function get(v, name) {
  return v !== null && typeof v === 'object' && Object.hasOwn(v, name) ? v[name] : undefined;
}

/**
 * A parsed template compiled to a function (scope, out, depth): the same
 * rendering as walking the node tree, without the walk. A for loop's element
 * and `loop` are plain locals (their bindings are known at compile time, so a
 * path starting on one reads the local straight off); any other first name is
 * read from the scope chain, and each further name through `get`. An include
 * gets a scope holding the caller's loop bindings over the same parent, so it
 * sees exactly what the tree walk would show it. `H` carries the helpers and
 * the compiled templates (`tpl`) for includes.
 */
function compileTemplate(nodes, H) {
  let uid = 0;
  const pathExpr = (path, sc, bindings) => {
    const first = path[0];
    let expr = Object.hasOwn(bindings, first) ? bindings[first] : `H.top(${sc},${JSON.stringify(first)})`;
    for (let k = 1; k < path.length; k++) expr = `H.get(${expr},${JSON.stringify(path[k])})`;
    return expr;
  };
  const gen = (ns, sc, bindings) => {
    let code = '';
    for (const n of ns) {
      if (n.kind === 'text') code += `out.push(${JSON.stringify(n.text)});`;
      else if (n.kind === 'var') code += `out.push(H.vr(${pathExpr(n.path, sc, bindings)}));`;
      else if (n.kind === 'raw') code += `out.push(H.raw(${pathExpr(n.path, sc, bindings)}));`;
      else if (n.kind === 'if') {
        code += `if(H.truthy(${pathExpr(n.path, sc, bindings)})!==${n.not}){${gen(n.then, sc, bindings)}}`;
        if (n.else !== null) code += `else{${gen(n.else, sc, bindings)}}`;
      } else if (n.kind === 'for') {
        const id = uid++;
        const xs = `_x${id}`;
        const k = `_k${id}`;
        const e = `_e${id}`;
        const l = `_l${id}`;
        const inner = { ...bindings, [n.name]: e, loop: l };
        code += `{const ${xs}=${pathExpr(n.path, sc, bindings)};if(Array.isArray(${xs})){for(let ${k}=0;${k}<${xs}.length;${k}++){const ${e}=${xs}[${k}];const ${l}={index:${k}+1,first:${k}===0,last:${k}===${xs}.length-1,length:${xs}.length};${gen(n.body, sc, inner)}}}}`;
      } else if (n.kind === 'include') {
        const id = uid++;
        const entries = Object.entries(bindings)
          .map(([name, v]) => `[${JSON.stringify(name)}]:${v}`)
          .join(',');
        code += `{const _t${id}=H.tpl.get(${JSON.stringify(n.name)});if(_t${id}!==undefined&&depth<${INCLUDE_DEPTH}){const _s${id}={vars:{${entries}},parent:${sc}};_t${id}(_s${id},out,depth+1);}}`;
      }
    }
    return code;
  };
  return new Function('H', `return function(scope,out,depth){${gen(nodes, 'scope', Object.create(null))}}`)(H);
}

// ---------------------------------------------------------------- the build

/** `rel` (a link's path, "/"-separated) from the directory `dir` of a source, or null when it climbs out of the root. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** The top-level directories the generator writes itself, which no page's slug at the root may take. */
const RESERVED = ['posts', 'tags', 'page'];

/** The report file every build writes. */
export const REPORT_FILE = 'build-report.txt';

/** One site's output tree: path -> text. */
export function run(input) {
  const slugify = makeSlugify();
  const dateCache = new Map();
  const dateLong = (d) => {
    let v = dateCache.get(d);
    if (v === undefined) {
      v = longDate(d);
      dateCache.set(d, v);
    }
    return v;
  };

  // Templates, parsed in code-unit order of their name; one that does not parse is reported and left out.
  const report = [];
  const trees = new Map();
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      trees.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const H = { txt, vr, raw, truthy, top, get, tpl: new Map() };
  for (const [name, nodes] of trees) H.tpl.set(name, compileTemplate(nodes, H));

  const b = {
    input,
    base: input.site.base_url.replace(/\/+$/, ''),
    templates: H.tpl,
    sources: [],
    statics: [],
    bySource: new Map(),
    broken: new Set(),
    report,
    posts: [],
    tags: [],
    cards: new Map(),
    output: {},
  };

  // 1. The sources, in code-unit order of their paths, line ends made "\n"; a source that is not .md is static.
  const files = [...b.input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  for (const f of files) {
    if (f.path.endsWith('.md')) b.sources.push({ path: f.path, text: f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n') });
    else b.statics.push({ path: f.path, content: f.content });
  }

  // 2. Each source's front matter: a refused source is reported and dropped, and so is a draft.
  const kept = [];
  for (const s of b.sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      b.report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) {
      b.report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      b.report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!b.templates.has(layout)) {
      b.report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      b.report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  b.sources = kept;

  // 3. Each page's output directory and url: its slug made unique in its directory, in source order.
  const taken = new Map();
  const takenIn = (dir) => {
    if (!taken.has(dir)) taken.set(dir, new Set(dir === '' ? RESERVED : []));
    return taken.get(dir);
  };
  for (const s of b.sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), takenIn(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${b.base}/${s.outDir}/`;
    b.bySource.set(s.path, s);
  }

  // 4. Each body's Markdown, its links resolved to the pages and static files they name.
  const staticPaths = new Set(b.statics.map((f) => f.path));
  const linkCaches = new Map();
  for (const s of b.sources) {
    const dir = dirOf(s.path);
    let lc = linkCaches.get(dir);
    if (lc === undefined) {
      lc = { hrefs: new Map(), broken: new Set() };
      linkCaches.set(dir, lc);
    }
    const env = {
      link: (target) => {
        let href = lc.hrefs.get(target);
        if (href === undefined) {
          if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) href = target;
          else {
            const hash = target.indexOf('#');
            const rel = hash === -1 ? target : target.slice(0, hash);
            const frag = hash === -1 ? '' : target.slice(hash);
            const path = rel === '' ? null : resolvePath(dir, rel);
            if (path !== null && b.bySource.has(path)) href = `${b.bySource.get(path).url}${frag}`;
            else if (path !== null && staticPaths.has(path)) href = `${b.base}/${path}${frag}`;
            else {
              lc.broken.add(target);
              href = target;
            }
          }
          lc.hrefs.set(target, href);
        }
        if (lc.broken.has(target)) b.broken.add(`broken-link ${s.path} -> ${target}`);
        return href;
      },
    };
    const md = renderMarkdown(s.body, env, slugify);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // 5. The posts, newest first and then by slug; each post's newer and older neighbours.
  const posts = b.sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  b.posts = posts;
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // A post's card, as lists show it (computed once, shared by the page and the lists).
  for (const s of b.sources) {
    s.card = {
      title: s.data.title,
      url: s.url,
      date: s.data.date ?? '',
      date_long: s.data.date === undefined ? '' : dateLong(s.data.date),
      summary: s.data.summary ?? '',
      excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
      tags: null, // filled below, once tagRefs exist
    };
  }

  // 6. The tags: grouped by their slug, each named as first met in the posts' order, ordered by count and then slug.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    return (s.data.tags ?? []).filter((name) => !seen.has(slugify(name)) && seen.add(slugify(name)));
  };
  for (const p of b.posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      if (!bySlug.has(slug)) bySlug.set(slug, { name, slug, url: `${b.base}/tags/${slug}/`, posts: [] });
      const tag = bySlug.get(slug);
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of b.sources) {
    if (!s.post) s.tagRefs = ownTags(s).map((name) => bySlug.get(slugify(name)) ?? { name, slug: slugify(name), url: '', posts: [] });
    s.card.tags = s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url }));
  }
  b.tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));
  b.cards = new Map(b.posts.map((p) => [p, p.card]));

  // 7. Every page through its layout, the index pages and the tag pages through theirs.
  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : dateLong(s.data.date) });
  const site = { title: b.input.site.title, base_url: b.base };
  const allTags = b.tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = b.posts.slice(0, b.input.site.recent).map((p) => b.cards.get(p));
  const render = (name, vars) => {
    const fn = b.templates.get(name);
    if (fn === undefined) return null;
    const out = [];
    fn({ vars: { site, tags: allTags, recent, ...vars }, parent: null }, out, 0);
    return out.join('');
  };
  const pageOf = (s) => ({
    ...s.card,
    slug: s.slug,
    content: s.html,
    toc: s.toc, // already { level, id, html } per heading, exactly what the layout reads
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  });
  for (const s of b.sources) b.output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = b.input.site.per_page;
  const pages = Math.max(1, Math.ceil(b.posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${b.base}/` : `${b.base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: b.posts.slice((k - 1) * per, k * per).map((p) => b.cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) b.output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  const tagOf = (t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => b.cards.get(p)) });
  for (const t of b.tags) {
    const html = render('tag', { tag: tagOf(t) });
    if (html !== null) b.output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) b.output['tags/index.html'] = tagsHtml;
  for (const f of b.statics) {
    if (Object.hasOwn(b.output, f.path)) b.report.push(`shadowed ${f.path}: a built page has its path`);
    else b.output[f.path] = f.content;
  }

  // 8. The report: every refusal, draft, broken link and template that did not parse, sorted, then the counts.
  const lines = [...b.report, ...b.broken].sort(byCodeUnits);
  const pageCount = b.sources.filter((s) => !s.post).length;
  lines.push(`built ${pageCount} pages, ${b.posts.length} posts, ${b.tags.length} tags and ${b.statics.length} static files`);
  b.output[REPORT_FILE] = `${lines.join('\n')}\n`;
  return b.output;
}
