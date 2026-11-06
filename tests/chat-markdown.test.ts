import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmojiOnly, parseMarkdown as md, plainSnippet } from '../src/lib/chatMarkdown';

const SPOILER = '<span class="chat-spoiler" data-chat-spoiler role="button" tabindex="0">';
const REL = 'target="_blank" rel="noopener noreferrer nofollow ugc" class="chat-link"';
const link = (href: string, text: string, title?: string) => `<a href="${href}" ${REL}${title ? ` title="${title}"` : ''}>${text}</a>`;

function assertSafe(html: string) {
  const tags = html.match(/<\/?[a-z][^>]*>/gi) ?? [];
  const allowed = /^<\/?(strong|em|u|del|code|pre|br|h[123]|small|blockquote|ul|ol|li|span|a)\b/;
  for (const tag of tags) {
    assert.match(tag, allowed, `unexpected tag ${tag}`);
    assert.doesNotMatch(tag, /\son[a-z]+\s*=/i, `event handler in ${tag}`);
    assert.doesNotMatch(tag, /\sstyle\s*=/i, `style in ${tag}`);
    const href = /\shref="([^"]*)"/.exec(tag);
    if (href) assert.match(href[1], /^https?:\/\//, `bad href in ${tag}`);
  }
  assert.doesNotMatch(html, /<(script|img|iframe|svg|object|embed|style|form|input)/i);
}

test('inline emphasis follows Discord', () => {
  assert.equal(md('**bold**'), '<strong>bold</strong>');
  assert.equal(md('*italic* and _italic_'), '<em>italic</em> and <em>italic</em>');
  assert.equal(md('***both***'), '<em><strong>both</strong></em>');
  assert.equal(md('__underline__'), '<u>underline</u>');
  assert.equal(md('~~gone~~'), '<del>gone</del>');
  assert.equal(md('||hidden||'), `${SPOILER}hidden</span>`);
  assert.equal(md('a **b** c'), 'a <strong>b</strong> c');
});

test('emphasis nests and combines', () => {
  assert.equal(md('__*underline italic*__'), '<u><em>underline italic</em></u>');
  assert.equal(md('*a **b** c*'), '<em>a <strong>b</strong> c</em>');
  assert.equal(md('***a** b*'), '<em><strong>a</strong> b</em>');
  assert.equal(md('**_x_**'), '<strong><em>x</em></strong>');
  assert.equal(md('___x___'), '<u><em>x</em></u>');
  assert.equal(md('||**secret** ~~x~~||'), `${SPOILER}<strong>secret</strong> <del>x</del></span>`);
  assert.equal(md('~~__*all*__~~'), '<del><u><em>all</em></u></del>');
  assert.equal(md('**a\nb**'), '<strong>a<br>b</strong>');
});

test('word-internal underscores and spaced stars stay literal', () => {
  assert.equal(md('snake_case_name'), 'snake_case_name');
  assert.equal(md('příliš_žluťoučký_kůň'), 'příliš_žluťoučký_kůň');
  assert.equal(md('2 * 3 * 4'), '2 * 3 * 4');
  assert.equal(md('a * b*'), 'a * b*');
});

test('unclosed markers render literally', () => {
  assert.equal(md('*open'), '*open');
  assert.equal(md('**open'), '**open');
  assert.equal(md('__open'), '__open');
  assert.equal(md('~~open'), '~~open');
  assert.equal(md('||open'), '||open');
  assert.equal(md('`open'), '`open');
  assert.equal(md('```open'), '```open');
  assert.equal(md('****'), '****');
  assert.equal(md('||||'), '||||');
  assert.equal(md('*a**'), '*a**');
  assert.equal(md('**a*'), '*<em>a</em>');
  assert.equal(md('[text](https://x.com'), '[text](<a href="https://x.com/" ' + REL + '>https://x.com</a>');
});

test('backslash escapes', () => {
  assert.equal(md('\\*not italic\\*'), '*not italic*');
  assert.equal(md('\\_x\\_'), '_x_');
  assert.equal(md('\\~\\~x\\~\\~'), '~~x~~');
  assert.equal(md('\\|\\|x\\|\\|'), '||x||');
  assert.equal(md('\\`x\\`'), '`x`');
  assert.equal(md('\\# not heading'), '# not heading');
  assert.equal(md('\\> not quote'), '&gt; not quote');
  assert.equal(md('\\- not list'), '- not list');
  assert.equal(md('**a\\**'), '**a**');
  assert.equal(md('**a\\*b**'), '<strong>a*b</strong>');
  assert.equal(md('\\\\*x*'), '\\<em>x</em>');
  assert.equal(md('a\\b'), 'a\\b');
});

test('headings and subtext only at line start', () => {
  assert.equal(md('# One'), '<h1>One</h1>');
  assert.equal(md('## Two'), '<h2>Two</h2>');
  assert.equal(md('### Three'), '<h3>Three</h3>');
  assert.equal(md('#### Four'), '#### Four');
  assert.equal(md('#nospace'), '#nospace');
  assert.equal(md('# '), '# ');
  assert.equal(md('text # not'), 'text # not');
  assert.equal(md('-# small print'), '<small class="chat-subtext">small print</small>');
  assert.equal(md('# **Bold** title\nbody'), '<h1><strong>Bold</strong> title</h1>body');
  assert.equal(md('intro\n## Sub'), 'intro<br><h2>Sub</h2>');
});

test('block quotes', () => {
  assert.equal(md('> quoted'), '<blockquote class="chat-quote">quoted</blockquote>');
  assert.equal(md('> a\n> b\nafter'), '<blockquote class="chat-quote">a<br>b</blockquote>after');
  assert.equal(md('>>> all\nof\nthis'), '<blockquote class="chat-quote">all<br>of<br>this</blockquote>');
  assert.equal(md('before\n>>> rest'), 'before<br><blockquote class="chat-quote">rest</blockquote>');
  assert.equal(md('> > nested'), '<blockquote class="chat-quote">&gt; nested</blockquote>');
  assert.equal(md('>no space'), '&gt;no space');
  assert.equal(md('a > b'), 'a &gt; b');
  assert.equal(md('> # Head\n> - item'), '<blockquote class="chat-quote"><h1>Head</h1><ul><li>item</li></ul></blockquote>');
  assert.equal(md('> ```\n> code\n> ```'), '<blockquote class="chat-quote"><pre class="chat-code-block"><code>code</code></pre></blockquote>');
  assert.equal(md('> '), '&gt; ');
});

test('lists with one nested level', () => {
  assert.equal(md('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(md('* a\n* b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(md('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(md('- a\n  - b\n  - c\n- d'), '<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>');
  assert.equal(md('1. a\n   1. b'), '<ol><li>a<ol><li>b</li></ol></li></ol>');
  assert.equal(md('  - orphan'), '<ul><li>orphan</li></ul>');
  assert.equal(md('- a\n1. b'), '<ul><li>a</li></ul><ol><li>b</li></ol>');
  assert.equal(md('3. three\n4. four'), '<ol start="3"><li>three</li><li>four</li></ol>');
  assert.equal(md('- **bold** item\ntext'), '<ul><li><strong>bold</strong> item</li></ul>text');
  assert.equal(md('-not a list'), '-not a list');
  assert.equal(md('1.5 million'), '1.5 million');
  assert.equal(md('**bold** start'), '<strong>bold</strong> start');
});

test('inline code is verbatim', () => {
  assert.equal(md('use `x = 1`'), 'use <code class="chat-code-inline">x = 1</code>');
  assert.equal(md('``a ` b``'), '<code class="chat-code-inline">a ` b</code>');
  assert.equal(md('`` `tick` ``'), '<code class="chat-code-inline">`tick`</code>');
  assert.equal(md('`**not bold** <b>`'), '<code class="chat-code-inline">**not bold** &lt;b&gt;</code>');
  assert.equal(md('`a\\`'), '<code class="chat-code-inline">a\\</code>');
  assert.equal(md('`https://x.com`'), '<code class="chat-code-inline">https://x.com</code>');
});

test('code blocks', () => {
  assert.equal(md('```\nplain\n```'), '<pre class="chat-code-block"><code>plain</code></pre>');
  assert.equal(
    md('```js\nconst a = **b**;\n  indented\n```'),
    '<pre class="chat-code-block" data-lang="js"><span class="chat-code-lang">js</span><code>const a = **b**;\n  indented</code></pre>',
  );
  assert.equal(md('```text```'), '<pre class="chat-code-block"><code>text</code></pre>');
  assert.equal(md('```hello world```'), '<pre class="chat-code-block"><code>hello world</code></pre>');
  assert.equal(md('```js\n```'), '<pre class="chat-code-block"><code>js</code></pre>');
  assert.equal(md('say ```x``` now'), 'say <pre class="chat-code-block"><code>x</code></pre> now');
  assert.equal(md('```\n# no\n> no\n- no\n||no||\n```\nafter'), '<pre class="chat-code-block"><code># no\n&gt; no\n- no\n||no||</code></pre>after');
  assert.equal(
    md('```html\n<script>alert(1)</script><img src=x onerror=alert(1)>\n```'),
    '<pre class="chat-code-block" data-lang="html"><span class="chat-code-lang">html</span><code>&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;</code></pre>',
  );
  assert.equal(md('```c++\nint x;\n```'), '<pre class="chat-code-block" data-lang="c++"><span class="chat-code-lang">c++</span><code>int x;</code></pre>');
  assert.equal(md('`a ```b` c```'), '<code class="chat-code-inline">a ```b</code> c```');
});

test('autolinks and trailing punctuation', () => {
  assert.equal(md('https://example.com'), link('https://example.com/', 'https://example.com'));
  assert.equal(md('see https://example.com.'), `see ${link('https://example.com/', 'https://example.com')}.`);
  assert.equal(md('(https://example.com/a)'), `(${link('https://example.com/a', 'https://example.com/a')})`);
  assert.equal(
    md('https://en.wikipedia.org/wiki/Foo_(bar), ok'),
    `${link('https://en.wikipedia.org/wiki/Foo_(bar)', 'https://en.wikipedia.org/wiki/Foo_(bar)')}, ok`,
  );
  assert.equal(md('https://x.com/a_b_c'), link('https://x.com/a_b_c', 'https://x.com/a_b_c'));
  assert.equal(md('HTTPS://X.COM'), link('https://x.com/', 'HTTPS://X.COM'));
  assert.equal(md('||https://x.com||'), `${SPOILER}${link('https://x.com/', 'https://x.com')}</span>`);
  assert.equal(md('**https://x.com**'), `<strong>${link('https://x.com/', 'https://x.com')}</strong>`);
  assert.equal(md('<https://x.com/a b>'), `&lt;${link('https://x.com/a', 'https://x.com/a')} b&gt;`);
  assert.equal(md('<https://x.com/path>'), link('https://x.com/path', 'https://x.com/path'));
  assert.equal(md('ftp://x.com www.x.com'), 'ftp://x.com www.x.com');
  assert.equal(md('https://'), 'https://');
  assert.equal(md('https://x.com?q="a"&b=<c>'), `${link('https://x.com/?q=', 'https://x.com?q=')}&quot;a&quot;&amp;b=&lt;c&gt;`);
});

test('masked links', () => {
  assert.equal(md('[docs](https://example.com/docs)'), link('https://example.com/docs', 'docs', 'https://example.com/docs'));
  assert.equal(md('[example.com](https://example.com)'), link('https://example.com/', 'example.com'));
  assert.equal(md('[https://example.com](https://example.com)'), link('https://example.com/', 'https://example.com'));
  assert.equal(md('[https://good.com](https://evil.com)'), link('https://evil.com/', 'https://good.com', 'https://evil.com/'));
  assert.equal(md('[**bold** link](https://x.com)'), link('https://x.com/', '<strong>bold</strong> link', 'https://x.com/'));
  assert.equal(md('[a](<https://x.com/a b>)'), '[a](&lt;' + link('https://x.com/a', 'https://x.com/a') + ' b&gt;)');
  assert.equal(md('[a]( https://x.com )'), link('https://x.com/', 'a', 'https://x.com/'));
  assert.equal(md('[a](https://x.com/(b))'), link('https://x.com/(b)', 'a', 'https://x.com/(b)'));
  assert.equal(md('[](https://x.com)'), `[](${link('https://x.com/', 'https://x.com')})`);
  assert.equal(md('\\[a](https://x.com)'), `[a](${link('https://x.com/', 'https://x.com')})`);
  assert.equal(md('[see https://inner.com](https://x.com)'), link('https://x.com/', 'see https://inner.com', 'https://x.com/'));
});

test('nested link attempts never nest anchors', () => {
  const html = md('[a [b](https://x.com)](https://y.com)');
  assert.equal((html.match(/<a /g) ?? []).length, 2);
  assert.doesNotMatch(html, /<a [^>]*>[^<]*<a /);
  const inner = md('[[x](https://a.com)](https://b.com)');
  assert.doesNotMatch(inner, /<a [^>]*>(?:(?!<\/a>).)*<a /);
  assertSafe(html);
  assertSafe(inner);
});

test('dangerous schemes are never linked', () => {
  const vectors = [
    '[x](javascript:alert(1))',
    '[x](JaVaScRiPt:alert(1))',
    '[x](java\nscript:alert(1))',
    '[x](java\tscript:alert(1))',
    '[x]( javascript:alert(1))',
    '[x](&#106;avascript:alert(1))',
    '[x](&#x6A;avascript:alert(1))',
    '[x](javascript&colon;alert(1))',
    '[x](%6Aavascript:alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '[x](vbscript:msgbox(1))',
    '[x](file:///etc/passwd)',
    '[x](//evil.com)',
    '[x](/relative)',
    '[x](\u0000javascript:alert(1))',
    '[x](\u200bjavascript:alert(1))',
    '<javascript:alert(1)>',
    '<data:text/html,x>',
    'javascript:alert(1)',
    '[x](https:alert(1))',
    '[x](http:/x.com)',
  ];
  for (const vector of vectors) {
    const html = md(vector);
    assert.doesNotMatch(html, /<a /, vector);
    assertSafe(html);
  }
});

test('quotes cannot break out of attributes', () => {
  const vectors = [
    '[x](https://a.com/"onmouseover="alert(1))',
    '[x](https://a.com/\'onmouseover=\'alert(1))',
    '[x](https://a.com"onclick=alert(1))',
    'https://a.com/"><script>alert(1)</script>',
    '<https://a.com/"onfocus="alert(1)>',
    '```"><img src=x onerror=alert(1)>\ncode\n```',
    '```js"onclick=x\ncode\n```',
  ];
  for (const vector of vectors) {
    const html = md(vector);
    assertSafe(html);
    for (const attr of html.match(/\s[a-z-]+="[^"]*"/gi) ?? []) assert.doesNotMatch(attr, /[<>]/, `${vector} -> ${attr}`);
  }
});

test('raw HTML in text is escaped', () => {
  const vectors = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '" onerror="alert(1)',
    "' onload='alert(1)",
    '**<svg onload=alert(1)>**',
    '||<iframe src=javascript:alert(1)>||',
    '# <b>head</b>',
    '> <style>*{}</style>',
    '- <img src=x onerror=alert(1)>',
    '&lt;script&gt;',
  ];
  for (const vector of vectors) assertSafe(md(vector));
  assert.equal(md('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(md('" onerror=\'x\''), '&quot; onerror=&#39;x&#39;');
  assert.equal(md('&lt;b&gt;'), '&amp;lt;b&amp;gt;');
});

test('line breaks are preserved', () => {
  assert.equal(md('a\nb'), 'a<br>b');
  assert.equal(md('a\n\nb'), 'a<br><br>b');
  assert.equal(md('a\r\nb'), 'a<br>b');
  assert.equal(md('```\nx\n```\nnext'), '<pre class="chat-code-block"><code>x</code></pre>next');
  assert.equal(md(''), '');
});

test('emoji-only messages are enlarged', () => {
  assert.equal(isEmojiOnly('😀'), true);
  assert.equal(isEmojiOnly('😀👍🔥'), true);
  assert.equal(isEmojiOnly(' 😀 👍 '), true);
  assert.equal(isEmojiOnly('👨‍👩‍👧‍👦'), true);
  assert.equal(isEmojiOnly('👍🏽'), true);
  assert.equal(isEmojiOnly('🇨🇿'), true);
  assert.equal(isEmojiOnly('❤️'), true);
  assert.equal(isEmojiOnly('😀😀😀😀'), false);
  assert.equal(isEmojiOnly('😀 hi'), false);
  assert.equal(isEmojiOnly('1'), false);
  assert.equal(isEmojiOnly('#'), false);
  assert.equal(isEmojiOnly(''), false);
  assert.equal(isEmojiOnly('   '), false);
  assert.equal(md('🔥'), '<span class="chat-jumbo">🔥</span>');
  assert.equal(md(' 😀👍 '), '<span class="chat-jumbo">😀👍</span>');
  assert.equal(md('🔥 **x**'), '🔥 <strong>x</strong>');
});

test('plainSnippet strips markup and stays on one line', () => {
  assert.equal(plainSnippet('**bold** *it* __u__ ~~s~~ `code`'), 'bold it u s code');
  assert.equal(plainSnippet('the answer is ||42||'), 'the answer is •••');
  assert.equal(plainSnippet('||**multi\nline**||'), '•••');
  assert.equal(plainSnippet('[read this](https://example.com/very/long)'), 'read this');
  assert.equal(plainSnippet('# Title\n-# sub\n> quoted\n>>> rest'), 'Title sub quoted rest');
  assert.equal(plainSnippet('- one\n- two\n  1. three'), 'one two three');
  assert.equal(plainSnippet('```js\nconst a = 1;\n```'), 'const a = 1;');
  assert.equal(plainSnippet('\\*literal\\*'), '*literal*');
  assert.equal(plainSnippet('see <https://x.com> and https://y.com'), 'see https://x.com and https://y.com');
  assert.equal(plainSnippet('a\n\n\tb   c'), 'a b c');
  assert.equal(plainSnippet('<b>x</b>'), '<b>x</b>');
  assert.equal(plainSnippet('x'.repeat(200), 10), `${'x'.repeat(9)}…`);
  assert.equal(plainSnippet('||' + 'secret '.repeat(100) + '||', 20), '•••');
  assert.equal(plainSnippet(''), '');
  assert.doesNotMatch(plainSnippet('a\nb\r\nc'), /\n/);
});

function timed(label: string, input: string, limit = 300) {
  for (const [name, fn] of [['parseMarkdown', md], ['plainSnippet', plainSnippet]] as const) {
    fn(input);
    const start = performance.now();
    fn(input);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < limit, `${name} on ${label} took ${elapsed.toFixed(1)}ms`);
  }
}

test('pathological input renders quickly', () => {
  timed('stars', '*'.repeat(100_000));
  timed('pipes', '||'.repeat(50_000));
  timed('alternating pipes', '||a'.repeat(60_000));
  timed('underscores', '_a'.repeat(100_000));
  timed('mixed openers', '**__~~||*_'.repeat(20_000));
  timed('nested quotes', '> '.repeat(100_000) + 'x');
  timed('quote lines', '> \n'.repeat(60_000));
  timed('brackets', '['.repeat(200_000));
  timed('bracket parens', '[a]('.repeat(50_000));
  timed('bracket url', '[a](https://x.com/'.repeat(10_000));
  timed('angles', '<'.repeat(100_000) + 'https://x.com');
  timed('angle urls', '<https://x.com/a'.repeat(12_000));
  timed('urls', 'https://a.co/('.repeat(14_000));
  timed('backticks', '`'.repeat(100_000));
  timed('backtick runs', '`a``b```c'.repeat(20_000));
  timed('fences', '```a\n'.repeat(40_000));
  timed('escapes', '\\'.repeat(200_000));
  timed('lists', '- a\n  - b\n'.repeat(20_000));
  timed('headings', '# a\n'.repeat(50_000));
  timed('deep nesting', '*_~~||__**'.repeat(10_000) + 'x' + '**__||~~_*'.repeat(10_000));
  timed('bold runs', '**a'.repeat(66_000));
  timed('long text', 'lorem ipsum **dolor** sit _amet_ `x` https://x.com/y ||s||\n'.repeat(3_500));
});

test('pathological input stays safe', () => {
  for (const input of ['*'.repeat(1000), '['.repeat(1000) + '](javascript:x)', '<'.repeat(500) + 'img onerror=x>', '`<b>`'.repeat(100)]) {
    assertSafe(md(input));
  }
});

test('random markup always yields balanced, safe HTML', () => {
  let seed = 0x2f6b1d;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const atoms = ['*', '**', '_', '__', '~~', '||', '`', '```', '\n', ' ', '> ', '>>> ', '# ', '-# ', '- ', '  - ', '1. ', '[', ']', '(', ')', '<', '>', '"', "'", '&', 'a', 'b', 'https://x.com/', 'javascript:', '\\', '😀', 'js\n'];
  const voidTags = new Set(['br']);
  for (let round = 0; round < 3000; round++) {
    let input = '';
    const len = 1 + rand(40);
    for (let k = 0; k < len; k++) input += atoms[rand(atoms.length)];
    for (const html of [md(input), md(`> ${input}`), md(`- ${input}`)]) {
      assertSafe(html);
      const stack: string[] = [];
      for (const [, close, name] of html.matchAll(/<(\/?)([a-z0-9]+)[^>]*>/gi)) {
        if (voidTags.has(name)) continue;
        if (close) assert.equal(stack.pop(), name, `${JSON.stringify(input)} -> ${html}`);
        else stack.push(name);
      }
      assert.deepEqual(stack, [], `${JSON.stringify(input)} -> ${html}`);
      assert.doesNotMatch(html.replace(/<[^>]*>/g, ''), /[<>"]/, `${JSON.stringify(input)} -> ${html}`);
    }
    assert.doesNotMatch(plainSnippet(input), /\n/);
  }
});
