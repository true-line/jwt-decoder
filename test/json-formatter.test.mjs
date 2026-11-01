import test from 'node:test';
import assert from 'node:assert/strict';

import { highlight } from '../src/json-formatter.js';

const markup = (value) => highlight(value).html;

/** Pairs of [class, escaped token] in document order. */
const spans = (html) =>
  [...html.matchAll(/<span class="([^"]+)">([\s\S]*?)<\/span>/g)].map((m) => [m[1], m[2]]);

const classNames = (html) => spans(html).map(([name]) => name);

/** Removes the markup and reverses the escaping, yielding the serialised JSON again. */
const stripMarkup = (html) =>
  html
    .replace(/<\/?span[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

test('escapes HTML significant characters in keys and values', () => {
  const html = markup({ '<tag>': 'a & b <script>x</script>' });

  assert.ok(!html.includes('<script'), 'a script tag reached the DOM');
  assert.ok(html.includes('&lt;tag&gt;'));
  assert.ok(html.includes('a &amp; b &lt;script&gt;x&lt;/script&gt;'));
});

test('matched and unmatched slices together reproduce the serialised JSON', () => {
  const value = { a: [1, 'two', { deep: null }], '<b>': '<&>' };

  assert.equal(stripMarkup(markup(value)), JSON.stringify(value, null, 2));
});

test('returns the same serialisation the markup renders', () => {
  const value = { payload: 'a & b', list: [1, '<'] };
  const { html, raw } = highlight(value);

  assert.equal(stripMarkup(html), raw);
  assert.equal(raw, JSON.stringify(value, null, 2));
});

test('a string value that looks like a key stays a string', () => {
  assert.deepEqual(classNames(markup({ note: '"fake": 1' })), ['json-key', 'json-string']);
  assert.deepEqual(
    classNames(markup({ 'trailing:': 'colon value:' })),
    ['json-key', 'json-string']
  );
});

test('classifies primitives', () => {
  assert.deepEqual(
    classNames(markup({ n: 1.5, big: 1e21, t: true, f: false, z: null, s: 'x' })),
    [
      'json-key', 'json-number',
      'json-key', 'json-number',
      'json-key', 'json-boolean',
      'json-key', 'json-boolean',
      'json-key', 'json-null',
      'json-key', 'json-string',
    ]
  );
});

test('exponential numbers stay one token', () => {
  assert.equal(spans(markup([1e21]))[0][1], '1e+21');
});

test('negative numbers keep their sign inside the number token', () => {
  assert.deepEqual(spans(markup({ n: -4.25 })), [
    ['json-key', '"n":'],
    ['json-number', '-4.25'],
  ]);
});

test('empty containers produce no tokens but keep their braces', () => {
  assert.equal(spans(markup({})).length, 0);
  assert.equal(markup({}), '{}');
  assert.equal(spans(markup([])).length, 0);
  assert.equal(markup([]), '[]');
});

test('preserves nesting, ordering, and unicode keys', () => {
  const value = { '日本': [{ deep: true }] };
  const pairs = spans(markup(value));

  assert.deepEqual(pairs.map((p) => p[0]), ['json-key', 'json-key', 'json-boolean']);
  assert.equal(pairs[0][1], '"日本":');
  assert.ok(stripMarkup(markup(value)).includes('\n      "deep": true'), 'nested indentation');
});

test('repeated and interleaved calls do not leak scan state between calls', () => {
  const value = { a: 1, b: 'two', c: [true, null] };

  const first = highlight(value);
  const other = highlight({ z: 9 });
  const again = highlight(value);

  assert.deepEqual(again, first);
  assert.notDeepEqual(other, first);
});
