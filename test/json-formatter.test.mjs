import test from 'node:test';
import assert from 'node:assert/strict';

import { highlight } from '../src/json-formatter.js';

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
  const html = highlight({ '<tag>': 'a & b <script>x</script>' });

  assert.ok(!html.includes('<script'), 'a script tag reached the DOM');
  assert.ok(html.includes('&lt;tag&gt;'));
  assert.ok(html.includes('a &amp; b &lt;script&gt;x&lt;/script&gt;'));
});

test('matched and unmatched slices together reproduce the serialised JSON', () => {
  const value = { a: [1, 'two', { deep: null }], '<b>': '<&>' };

  assert.equal(stripMarkup(highlight(value)), JSON.stringify(value, null, 2));
});

test('a string value that looks like a key stays a string', () => {
  assert.deepEqual(classNames(highlight({ note: '"fake": 1' })), ['json-key', 'json-string']);
  assert.deepEqual(
    classNames(highlight({ 'trailing:': 'colon value:' })),
    ['json-key', 'json-string']
  );
});

test('classifies primitives', () => {
  assert.deepEqual(
    classNames(highlight({ n: 1.5, big: 1e21, t: true, f: false, z: null, s: 'x' })),
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
  assert.equal(spans(highlight([1e21]))[0][1], '1e+21');
});

test('negative numbers keep their sign inside the number token', () => {
  assert.deepEqual(spans(highlight({ n: -4.25 })), [
    ['json-key', '"n":'],
    ['json-number', '-4.25'],
  ]);
});

test('empty containers produce no tokens but keep their braces', () => {
  assert.equal(spans(highlight({})).length, 0);
  assert.equal(highlight({}), '{}');
  assert.equal(spans(highlight([])).length, 0);
  assert.equal(highlight([]), '[]');
});

test('preserves nesting, ordering, and unicode keys', () => {
  const pairs = spans(highlight({ '日本': [{ deep: true }] }));

  assert.deepEqual(pairs.map((p) => p[0]), ['json-key', 'json-key', 'json-boolean']);
  assert.equal(pairs[0][1], '"日本":');
  assert.ok(
    stripMarkup(highlight({ '日本': [{ deep: true }] })).includes('\n      "deep": true'),
    'nested indentation was not preserved'
  );
});

test('repeated and interleaved calls do not leak scan state between calls', () => {
  const value = { a: 1, b: 'two', c: [true, null] };

  const first = highlight(value);
  const other = highlight({ z: 9 });
  const again = highlight(value);

  assert.equal(again, first);
  assert.notEqual(other, first);
});
