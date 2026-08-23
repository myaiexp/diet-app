// htmlToPlainText table — entities, comments, and tag stripping for untrusted URLs

import { describe, test, expect } from 'vitest';
import { htmlToPlainText } from '../ai/fetch-body.js';

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
  ] as const)('%s', (_name, html, expected) => {
    expect(htmlToPlainText(html)).toBe(expected);
  });
});
