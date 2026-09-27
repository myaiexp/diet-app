// htmlToPlainText table — entities, comments, tag stripping, and linear time on untrusted URLs

import { describe, test, expect } from 'vitest';
import { htmlToPlainText, stripTags } from '../ai/fetch-body.js';

describe('htmlToPlainText', () => {
  test.each([
    ['collapses whitespace and drops tags', '<p>a</p>   <p>b</p>', 'a b'],
    ['strips script including content', '<p>keep</p><script>alert(1)</script><p>me</p>', 'keep me'],
    [
      'strips script with attributes',
      '<p>keep</p><script type="module">alert(1)</script>',
      'keep',
    ],
    ['strips style including content', '<p>keep</p><style>.x{color:red}</style><p>me</p>', 'keep me'],
    ['strips noscript including content', '<p>keep</p><noscript>hidden</noscript><p>me</p>', 'keep me'],
    ['strips HTML comments', '<p>keep</p><!-- secret --><p>me</p>', 'keep me'],
    ['named &amp;', 'Boil &amp; simmer', 'Boil & simmer'],
    ['named &lt; and &gt;', '&lt;tag&gt;', '<tag>'],
    ['named &quot;', '&quot;quoted&quot;', '"quoted"'],
    ['named &#39;', 'it&#39;s', "it's"],
    ['named &apos;', "it&apos;s", "it's"],
    ['named &nbsp; becomes space', 'a&nbsp;b', 'a b'],
    ['decimal numeric entity', '&#65;&#66;', 'AB'],
    ['hex numeric entity', '&#x41;&#x42;', 'AB'],
    ['hex numeric entity mixed case', '&#x6A;&#X6A;', 'jj'],
    // 0x10ffff is the Unicode max; one past it is not a scalar and becomes a space.
    ['out-of-range decimal becomes space', 'A&#1114112;B', 'A B'],
    ['out-of-range hex becomes space', 'A&#x110000;B', 'A B'],
    [
      'max valid code point is kept',
      '&#x10ffff;',
      String.fromCodePoint(0x10ffff),
    ],
    ['unclosed script does not leak', 'keep<script>alert(1)', 'keep'],
    ['unclosed style does not leak', 'keep<style>.x{color:red}', 'keep'],
    ['unclosed noscript does not leak', 'keep<noscript>hidden', 'keep'],
    ['unclosed comment does not leak', 'keep<!-- secret', 'keep'],
    ['unclosed ordinary tag keeps text', '<p>hello', 'hello'],
    ['lone < in text is kept', 'a < b', 'a < b'],
    ['<> is not a tag', 'a<>b', 'a<>b'],
    ['< inside a quoted attribute stays inside the tag', '<img alt="1 < 2">x', 'x'],
  ] as const)('%s', (_name, html, expected) => {
    expect(htmlToPlainText(html)).toBe(expected);
  });

  // A remote page controls this input up to the 1.5 MB read cap; the regex
  // `/<[^>]+>/g` took minutes on a `<` run with no `>`, blocking the event loop.
  test.each([
    ['all <', '<'.repeat(1_500_000)],
    ['< with text, no >', '<a '.repeat(500_000)],
  ])('strips a 1.5 MB %s run in linear time', (_name, html) => {
    const start = performance.now();
    htmlToPlainText(html);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('stripTags', () => {
  // The scan replaced `/<[^>]+>/g`; it must produce the same output on any input.
  test('matches the regex it replaced on random markup', () => {
    const alphabet = '<>a "/';
    let seed = 1;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let i = 0; i < 20_000; i++) {
      let s = '';
      const len = rand() % 14;
      for (let j = 0; j < len; j++) s += alphabet[rand() % alphabet.length];
      expect(stripTags(s), JSON.stringify(s)).toBe(s.replace(/<[^>]+>/g, ' '));
    }
  });
});
