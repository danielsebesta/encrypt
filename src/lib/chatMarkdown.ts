const MAX_DEPTH = 10;
const MAX_URL = 2048;
const MAX_LANG = 32;

const ESC_RE = /[&<>"']/g;
const ESC_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s: string): string {
  return s.replace(ESC_RE, (c) => ESC_MAP[c]);
}

const BACKSLASH = 92;
const NEWLINE = 10;
const BACKTICK = 96;

function isPunct(code: number): boolean {
  return (code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126);
}

const SPACE_RE = /\s/;

function isSpace(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  const c = ch.charCodeAt(0);
  if (c < 128) return c === 32 || (c >= 9 && c <= 13);
  return SPACE_RE.test(ch);
}

const WORD_RE = /[\p{L}\p{N}_]/u;

function isWord(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  const c = ch.charCodeAt(0);
  if (c < 128) return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
  return WORD_RE.test(ch);
}

/** Only absolute http(s) URLs survive; the normalized form from the URL parser is what lands in href. */
function safeUrl(raw: string): URL | null {
  if (raw.length === 0 || raw.length > MAX_URL) return null;
  if (!/^https?:\/\/[^\s\u0000-\u001f\u007f]+$/i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!/^(?:[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.?|\[[0-9a-f:.]+\])$/i.test(url.hostname)) return null;
  return url;
}

type Mode = 'html' | 'plain';

interface Out {
  mode: Mode;
}

function text(o: Out, s: string): string {
  if (o.mode === 'plain') return s;
  return esc(s).replace(/\n/g, '<br>');
}

function linkHtml(url: URL, inner: string, title: boolean): string {
  const href = esc(url.href);
  return `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow ugc" class="chat-link"${title ? ` title="${href}"` : ''}>${inner}</a>`;
}

const SPOILER_OPEN = '<span class="chat-spoiler" data-chat-spoiler role="button" tabindex="0">';

type Kind = 'strong' | 'under' | 'strike' | 'spoiler' | 'emStar' | 'emUnder';

const KIND_WIDTH: Record<Kind, number> = { strong: 2, under: 2, strike: 2, spoiler: 2, emStar: 1, emUnder: 1 };

const URL_START = /https?:\/\//iy;

class Inline {
  readonly s: string;
  readonly n: number;
  readonly o: Out;
  private escaped: Uint8Array;
  private runStartArr: Int32Array | null = null;
  private closers = new Map<Kind, Int32Array>();
  private ticks: Map<number, number[]> | null = null;

  constructor(s: string, o: Out) {
    this.s = s;
    this.n = s.length;
    this.o = o;
    this.escaped = new Uint8Array(this.n + 1);
    for (let i = 0; i < this.n; i++) {
      if (s.charCodeAt(i) === BACKSLASH && i + 1 < this.n && isPunct(s.charCodeAt(i + 1))) {
        this.escaped[i + 1] = 1;
        i++;
      }
    }
  }

  private runStart(j: number): number {
    if (!this.runStartArr) {
      const arr = new Int32Array(this.n);
      for (let i = 0; i < this.n; i++) arr[i] = i > 0 && this.s[i] === this.s[i - 1] ? arr[i - 1] : i;
      this.runStartArr = arr;
    }
    return this.runStartArr[j];
  }

  /** Whether a closer of this kind sits at j, treating `to` as the end of the text. */
  private closesAt(kind: Kind, j: number, to: number): boolean {
    const s = this.s;
    if (this.escaped[j]) return false;
    const next = j + KIND_WIDTH[kind] < to ? s[j + KIND_WIDTH[kind]] : undefined;
    switch (kind) {
      case 'strong':
        return s[j] === '*' && s[j + 1] === '*' && next !== '*';
      case 'under':
        return s[j] === '_' && s[j + 1] === '_' && next !== '_';
      case 'strike':
        return s[j] === '~' && s[j + 1] === '~' && next !== '~';
      case 'spoiler':
        return s[j] === '|' && s[j + 1] === '|';
      case 'emStar':
        return s[j] === '*' && next !== '*' && j > 0 && !isSpace(s[j - 1]) && j - this.runStart(j) + 1 !== 2;
      case 'emUnder':
        return s[j] === '_' && !isWord(next) && j > 0 && j - this.runStart(j) + 1 !== 2;
    }
  }

  private candidates(kind: Kind): Int32Array {
    let arr = this.closers.get(kind);
    if (arr) return arr;
    const ch = kind === 'strong' || kind === 'emStar' ? '*' : kind === 'under' || kind === 'emUnder' ? '_' : kind === 'strike' ? '~' : '|';
    const found: number[] = [];
    let from = 0;
    for (;;) {
      const j = this.s.indexOf(ch, from);
      if (j === -1) break;
      if (j + KIND_WIDTH[kind] <= this.n && this.closesAt(kind, j, this.n)) found.push(j);
      from = j + 1;
    }
    arr = Int32Array.from(found);
    this.closers.set(kind, arr);
    return arr;
  }

  /** Nearest closer at or after `min` that ends inside the region. */
  private findCloser(kind: Kind, min: number, to: number): number {
    const width = KIND_WIDTH[kind];
    const arr = this.candidates(kind);
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < min) lo = mid + 1;
      else hi = mid;
    }
    const edge = to - width;
    if (lo < arr.length && arr[lo] < edge) return arr[lo];
    if (edge >= min && this.closesAt(kind, edge, to)) return edge;
    return -1;
  }

  private tickRun(from: number, len: number, to: number): number {
    if (!this.ticks) {
      const map = new Map<number, number[]>();
      let i = 0;
      while (i < this.n) {
        if (this.s.charCodeAt(i) !== BACKTICK) {
          i++;
          continue;
        }
        let k = i;
        while (k < this.n && this.s.charCodeAt(k) === BACKTICK) k++;
        const list = map.get(k - i);
        if (list) list.push(i);
        else map.set(k - i, [i]);
        i = k;
      }
      this.ticks = map;
    }
    const list = this.ticks.get(len);
    if (!list) return -1;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < from) lo = mid + 1;
      else hi = mid;
    }
    return lo < list.length && list[lo] + len <= to ? list[lo] : -1;
  }

  render(from: number, to: number, depth: number, links: boolean): string {
    const s = this.s;
    const o = this.o;
    const plain = o.mode === 'plain';
    let out = '';
    let t = from;
    let i = from;
    const flush = (end: number) => {
      if (end > t) out += text(o, s.slice(t, end));
    };
    const deeper = depth < MAX_DEPTH;

    while (i < to) {
      const c = s[i];

      if (c === '\\') {
        if (i + 1 < to && this.escaped[i + 1]) {
          flush(i);
          out += text(o, s[i + 1]);
          i += 2;
          t = i;
          continue;
        }
        i++;
        continue;
      }

      if (c === '`') {
        let k = i;
        while (k < to && s.charCodeAt(k) === BACKTICK) k++;
        const len = k - i;
        const close = this.tickRun(k + 1, len, to);
        if (close !== -1) {
          flush(i);
          let code = s.slice(k, close).replace(/\n/g, ' ');
          if (code.length > 2 && code[0] === ' ' && code[code.length - 1] === ' ' && code.trim()) code = code.slice(1, -1);
          out += plain ? code : `<code class="chat-code-inline">${esc(code)}</code>`;
          i = close + len;
          t = i;
          continue;
        }
        i = k;
        continue;
      }

      if (deeper && !this.escaped[i] && (c === '*' || c === '_' || c === '~' || c === '|')) {
        const pair = s[i + 1] === c && i + 1 < to;
        let kind: Kind | null = null;
        let width = 0;
        let j = -1;
        if (pair) {
          kind = c === '*' ? 'strong' : c === '_' ? 'under' : c === '~' ? 'strike' : 'spoiler';
          width = 2;
          j = this.findCloser(kind, i + 3, to);
        }
        if (c === '*' && i + 1 < to && !isSpace(s[i + 1]) && (s[i + 1] !== '*' || s[i + 2] === '*')) {
          const em = this.findCloser('emStar', s[i + 1] === '*' ? i + 4 : i + 2, to);
          if (em !== -1 && (j === -1 || em + 1 >= j + 2)) {
            kind = 'emStar';
            width = 1;
            j = em;
          }
        } else if (c === '_' && j === -1 && i + 1 < to && s[i + 1] !== '_' && (i === from || !isWord(s[i - 1]))) {
          kind = 'emUnder';
          width = 1;
          j = this.findCloser(kind, i + 2, to);
        }
        if (j !== -1 && kind) {
          flush(i);
          const inner = this.render(i + width, j, depth + 1, links);
          out += plain ? (kind === 'spoiler' ? '•••' : inner) : wrap(kind, inner);
          i = j + width;
          t = i;
          continue;
        }
        i++;
        continue;
      }

      if (links && !this.escaped[i]) {
        if (c === '[') {
          const link = this.maskedLink(i, to, depth);
          if (link) {
            flush(i);
            out += link.html;
            i = link.end;
            t = i;
            continue;
          }
        } else if (c === '<') {
          const link = this.angleLink(i, to);
          if (link) {
            flush(i);
            out += link.html;
            i = link.end;
            t = i;
            continue;
          }
        } else if (c === 'h' || c === 'H') {
          const link = this.bareLink(i, to);
          if (link) {
            flush(i);
            out += link.html;
            i = link.end;
            t = i;
            continue;
          }
        }
      }

      i++;
    }
    flush(to);
    return out;
  }

  private maskedLink(i: number, to: number, depth: number): { html: string; end: number } | null {
    const s = this.s;
    let k = i + 1;
    while (k < to) {
      const ch = s[k];
      if (ch === '\\' && this.escaped[k + 1]) {
        k += 2;
        continue;
      }
      if (ch === ']' || ch === '[' || ch === '\n') break;
      k++;
    }
    if (k >= to || s[k] !== ']' || k === i + 1 || s[k + 1] !== '(') return null;
    const textEnd = k;
    let u = k + 2;
    while (u < to && (s[u] === ' ' || s[u] === '\t')) u++;
    const angle = s[u] === '<';
    if (angle) u++;
    const urlStart = u;
    let parens = 0;
    while (u < to && u - urlStart <= MAX_URL) {
      const ch = s[u];
      if (isSpace(ch) || ch === '<' || ch === '[') break;
      if (angle) {
        if (ch === '>') break;
      } else if (ch === '(') {
        parens++;
      } else if (ch === ')') {
        if (parens === 0) break;
        parens--;
      }
      u++;
    }
    const urlEnd = u;
    if (angle) {
      if (s[u] !== '>') return null;
      u++;
    }
    while (u < to && (s[u] === ' ' || s[u] === '\t')) u++;
    if (u >= to || s[u] !== ')') return null;
    const url = safeUrl(s.slice(urlStart, urlEnd));
    if (!url) return null;
    const label = s.slice(i + 1, textEnd);
    if (!label.trim()) return null;
    const inner = this.render(i + 1, textEnd, depth + 1, false);
    if (this.o.mode === 'plain') return { html: inner, end: u + 1 };
    const visible = plainSnippet(label, MAX_URL).toLowerCase();
    const host = url.hostname.toLowerCase();
    const same = visible === url.href.toLowerCase() || visible === s.slice(urlStart, urlEnd).toLowerCase() || visible === host || visible === host.replace(/^www\./, '');
    return { html: linkHtml(url, inner, !same), end: u + 1 };
  }

  private angleLink(i: number, to: number): { html: string; end: number } | null {
    const s = this.s;
    let k = i + 1;
    while (k < to && k - i <= MAX_URL + 1) {
      const ch = s[k];
      if (ch === '>' || ch === '<' || isSpace(ch)) break;
      k++;
    }
    if (k >= to || s[k] !== '>') return null;
    const raw = s.slice(i + 1, k);
    const url = safeUrl(raw);
    if (!url) return null;
    return { html: this.o.mode === 'plain' ? raw : linkHtml(url, esc(raw), false), end: k + 1 };
  }

  private bareLink(i: number, to: number): { html: string; end: number } | null {
    const s = this.s;
    URL_START.lastIndex = i;
    if (!URL_START.test(s)) return null;
    const start = i;
    const hostStart = URL_START.lastIndex;
    let k = hostStart;
    let opens = 0;
    let closes = 0;
    let bopens = 0;
    let bcloses = 0;
    while (k < to && k - start < MAX_URL) {
      const ch = s[k];
      if (isSpace(ch) || ch === '<' || ch === '>' || ch === '"' || ch === '`') break;
      if (ch === '|' && s[k + 1] === '|') break;
      if (ch === '(') opens++;
      else if (ch === ')') closes++;
      else if (ch === '[') bopens++;
      else if (ch === ']') bcloses++;
      k++;
    }
    let end = k;
    while (end > hostStart) {
      const ch = s[end - 1];
      if ('.,:;!?\'"*_~|'.includes(ch)) {
        end--;
      } else if (ch === ')' && closes > opens) {
        closes--;
        end--;
      } else if (ch === ']' && bcloses > bopens) {
        bcloses--;
        end--;
      } else {
        break;
      }
    }
    if (end <= hostStart) return null;
    const raw = s.slice(start, end);
    const url = safeUrl(raw);
    if (!url) return null;
    return { html: this.o.mode === 'plain' ? raw : linkHtml(url, esc(raw), false), end };
  }
}

function wrap(kind: Kind, inner: string): string {
  switch (kind) {
    case 'strong':
      return `<strong>${inner}</strong>`;
    case 'under':
      return `<u>${inner}</u>`;
    case 'strike':
      return `<del>${inner}</del>`;
    case 'spoiler':
      return `${SPOILER_OPEN}${inner}</span>`;
    default:
      return `<em>${inner}</em>`;
  }
}

function inline(src: string, o: Out): string {
  if (!src) return '';
  return new Inline(src, o).render(0, src.length, 0, true);
}

const HEADING_RE = /^(#{1,3}) +(?=\S)/;
const SUBTEXT_RE = /^-# +(?=\S)/;
const LIST_RE = /^( *)([-*]|\d{1,9}\.) +(?=\S)/;
const QUOTE_LINE_RE = /^ *> /;
const QUOTE_ALL_RE = /^ *>>> /;
const LANG_RE = /^[a-z0-9_+\-.#]$/i;

interface ListItem {
  indent: number;
  ordered: boolean;
  num: number;
  content: string;
}

function renderList(items: ListItem[], o: Out): string {
  const plain = o.mode === 'plain';
  const openList = (item: ListItem) => {
    if (plain) return '';
    if (!item.ordered) return '<ul>';
    return item.num === 1 ? '<ol>' : `<ol start="${item.num}">`;
  };
  const closeList = (ordered: boolean) => (plain ? '' : ordered ? '</ol>' : '</ul>');
  const li = (item: ListItem) => (plain ? ` ${inline(item.content, o)} ` : `<li>${inline(item.content, o)}`);
  const endLi = plain ? '' : '</li>';

  let out = '';
  let top: boolean | null = null;
  let nested: boolean | null = null;
  for (const item of items) {
    if (item.indent >= 2 && top !== null) {
      if (nested !== null && nested !== item.ordered) {
        out += closeList(nested);
        nested = null;
      }
      if (nested === null) {
        out += openList(item);
        nested = item.ordered;
      }
      out += li(item) + endLi;
      continue;
    }
    if (nested !== null) {
      out += closeList(nested);
      nested = null;
    }
    if (top !== null) out += endLi;
    if (top !== null && top !== item.ordered) {
      out += closeList(top);
      top = null;
    }
    if (top === null) {
      out += openList(item);
      top = item.ordered;
    }
    out += li(item);
  }
  if (nested !== null) out += closeList(nested);
  if (top !== null) out += endLi + closeList(top);
  return out;
}

class Blocks {
  private readonly src: string;
  private readonly n: number;
  private readonly o: Out;
  private readonly inQuote: boolean;
  private out = '';
  private para = '';
  private ticks: Map<number, number[]> | null = null;
  private fenceFailFrom = Infinity;
  private runFrom = -1;
  private runTo = -1;

  constructor(src: string, o: Out, inQuote: boolean) {
    this.src = src;
    this.n = src.length;
    this.o = o;
    this.inQuote = inQuote;
  }

  private flush() {
    if (this.para) {
      this.out += inline(this.para, this.o);
      this.para = '';
    }
  }

  private emit(html: string) {
    this.flush();
    this.out += this.o.mode === 'plain' ? ` ${html} ` : html;
  }

  private lineEnd(i: number): number {
    const e = this.src.indexOf('\n', i);
    return e === -1 ? this.n : e;
  }

  run(): string {
    let i = 0;
    while (i < this.n) i = this.atLineStart(i);
    this.flush();
    return this.out;
  }

  private atLineStart(i: number): number {
    const src = this.src;
    const end = this.lineEnd(i);
    const line = src.slice(i, end);
    const next = end < this.n ? end + 1 : end;
    const plain = this.o.mode === 'plain';

    if (!this.inQuote) {
      const all = QUOTE_ALL_RE.exec(line);
      if (all) {
        const content = src.slice(i + all[0].length);
        if (content.trim()) {
          const inner = new Blocks(content, this.o, true).run();
          this.emit(plain ? inner : `<blockquote class="chat-quote">${inner}</blockquote>`);
          return this.n;
        }
      }
      if (QUOTE_LINE_RE.test(line) && !QUOTE_ALL_RE.test(line)) {
        const parts: string[] = [];
        let k = i;
        while (k < this.n) {
          const e = this.lineEnd(k);
          const l = src.slice(k, e);
          if (!QUOTE_LINE_RE.test(l) || QUOTE_ALL_RE.test(l)) break;
          parts.push(l.slice(l.indexOf('>') + 2));
          k = e < this.n ? e + 1 : e;
        }
        const content = parts.join('\n');
        if (content.trim()) {
          const inner = new Blocks(content, this.o, true).run();
          this.emit(plain ? inner : `<blockquote class="chat-quote">${inner}</blockquote>`);
        } else {
          this.para += src.slice(i, k);
        }
        return k;
      }
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length;
      const inner = inline(line.slice(heading[0].length).trim(), this.o);
      this.emit(plain ? inner : `<h${level}>${inner}</h${level}>`);
      return next;
    }

    const sub = SUBTEXT_RE.exec(line);
    if (sub) {
      const inner = inline(line.slice(sub[0].length).trim(), this.o);
      this.emit(plain ? inner : `<small class="chat-subtext">${inner}</small>`);
      return next;
    }

    if (LIST_RE.test(line)) {
      const items: ListItem[] = [];
      let k = i;
      while (k < this.n) {
        const e = this.lineEnd(k);
        const l = src.slice(k, e);
        const m = LIST_RE.exec(l);
        if (!m) break;
        const marker = m[2];
        const ordered = marker !== '-' && marker !== '*';
        items.push({ indent: m[1].length, ordered, num: ordered ? parseInt(marker, 10) : 0, content: l.slice(m[0].length).trimEnd() });
        k = e < this.n ? e + 1 : e;
      }
      this.emit(renderList(items, this.o));
      return k;
    }

    return this.plainLine(i);
  }

  private nextTickRun(len: number, from: number): number {
    if (!this.ticks) {
      const map = new Map<number, number[]>();
      let i = 0;
      while (i < this.n) {
        if (this.src.charCodeAt(i) !== BACKTICK) {
          i++;
          continue;
        }
        let k = i;
        while (k < this.n && this.src.charCodeAt(k) === BACKTICK) k++;
        const list = map.get(k - i);
        if (list) list.push(i);
        else map.set(k - i, [i]);
        i = k;
      }
      this.ticks = map;
    }
    const list = this.ticks.get(len);
    if (!list) return -1;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < from) lo = mid + 1;
      else hi = mid;
    }
    return lo < list.length ? list[lo] : -1;
  }

  private findFenceClose(from: number): number {
    if (from >= this.fenceFailFrom) return -1;
    const c = this.src.indexOf('```', from);
    if (c === -1) this.fenceFailFrom = from;
    return c;
  }

  private fence(k: number): { html: string; end: number } | null {
    const src = this.src;
    const p = k + 3;
    let q = p;
    while (q < this.n && q - p <= MAX_LANG && LANG_RE.test(src[q])) q++;
    const attempts: Array<[string, number]> = [];
    if (q > p && q - p <= MAX_LANG && src.charCodeAt(q) === NEWLINE) attempts.push([src.slice(p, q), q + 1]);
    attempts.push(['', p]);
    for (const [lang, start] of attempts) {
      let s = start;
      while (s < this.n && src.charCodeAt(s) === NEWLINE) s++;
      if (s >= this.n) continue;
      const close = this.findFenceClose(s + 1);
      if (close === -1) continue;
      let e = close;
      while (e > s && src.charCodeAt(e - 1) === NEWLINE) e--;
      const code = src.slice(s, e);
      if (this.o.mode === 'plain') return { html: code, end: close + 3 };
      const label = lang ? `<span class="chat-code-lang">${esc(lang)}</span>` : '';
      const attr = lang ? ` data-lang="${esc(lang)}"` : '';
      return { html: `<pre class="chat-code-block"${attr}>${label}<code>${esc(code)}</code></pre>`, end: close + 3 };
    }
    return null;
  }

  private plainLine(i: number): number {
    const src = this.src;
    let start = i;
    let k = i;
    while (k < this.n) {
      const c = src.charCodeAt(k);
      if (c === NEWLINE) {
        k++;
        break;
      }
      if (c === BACKSLASH && k + 1 < this.n && isPunct(src.charCodeAt(k + 1))) {
        k += 2;
        continue;
      }
      if (c === BACKTICK) {
        let r = k > this.runFrom && k < this.runTo ? this.runTo : k;
        while (r < this.n && src.charCodeAt(r) === BACKTICK) r++;
        this.runFrom = k;
        this.runTo = r;
        const len = r - k;
        if (len >= 3) {
          const block = this.fence(k);
          if (block) {
            this.para += src.slice(start, k);
            this.emit(block.html);
            k = block.end;
            if (src.charCodeAt(k) === NEWLINE) return k + 1;
            start = k;
            continue;
          }
        }
        const close = this.nextTickRun(len, r + 1);
        k = close === -1 ? r : close + len;
        continue;
      }
      k++;
    }
    this.para += src.slice(start, k);
    return k;
  }
}

let emojiRe: RegExp | undefined;

function emojiPattern(): RegExp {
  if (emojiRe) return emojiRe;
  try {
    emojiRe = new RegExp('^(?:\\p{RGI_Emoji}\\s*){1,3}$', 'v');
  } catch {
    emojiRe = /^(?:(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}[️\p{Emoji_Modifier}]*(?:‍\p{Extended_Pictographic}[️\p{Emoji_Modifier}]*)*)\s*){1,3}$/u;
  }
  return emojiRe;
}

/** True for 1–3 emoji with nothing else but whitespace, the messages Discord shows enlarged. */
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 96) return false;
  return emojiPattern().test(trimmed);
}

export function parseMarkdown(text: string): string {
  if (!text) return '';
  if (isEmojiOnly(text)) return `<span class="chat-jumbo">${esc(text.trim())}</span>`;
  const src = text.replace(/\r\n?/g, '\n');
  return new Blocks(src, { mode: 'html' }, false).run();
}

/** One line of plain text for quoting a message: markup removed and spoilers kept hidden. */
export function plainSnippet(text: string, max = 140): string {
  if (!text) return '';
  const src = text.replace(/\r\n?/g, '\n');
  const plain = new Blocks(src, { mode: 'plain' }, false).run().replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

export function revealSpoilers(node: HTMLElement) {
  function toggleSpoiler(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    const spoiler = target.closest<HTMLElement>('[data-chat-spoiler]');
    if (!spoiler || !node.contains(spoiler)) return false;
    spoiler.classList.toggle('revealed');
    return true;
  }

  function handleClick(event: MouseEvent) {
    toggleSpoiler(event.target);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (toggleSpoiler(event.target)) event.preventDefault();
  }

  node.addEventListener('click', handleClick);
  node.addEventListener('keydown', handleKeydown);
  return {
    destroy() {
      node.removeEventListener('click', handleClick);
      node.removeEventListener('keydown', handleKeydown);
    },
  };
}
