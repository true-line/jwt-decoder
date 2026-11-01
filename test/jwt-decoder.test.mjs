import test from 'node:test';
import assert from 'node:assert/strict';

import { decode, extractTimestampClaims } from '../src/jwt-decoder.js';

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

const token = (payload, header = { alg: 'HS256', typ: 'JWT' }, signature = 'signature') =>
  [b64url(header), b64url(payload), signature].join('.');

test('decodes the three segments', () => {
  const decoded = decode(token({ sub: '1', scope: 'read' }));

  assert.deepEqual(decoded.header, { alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(decoded.payload, { sub: '1', scope: 'read' });
  assert.equal(decoded.signature, 'signature');
});

test('decodes UTF-8 claims that raw base64 would mangle', () => {
  const decoded = decode(token({ name: 'Добрый день', '日本語': '値', emoji: '🙂' }));

  assert.deepEqual(decoded.payload, { name: 'Добрый день', '日本語': '値', emoji: '🙂' });
});

test('accepts surrounding whitespace from a paste', () => {
  const decoded = decode(`  \n${token({ a: 1 })}\t  `);

  assert.deepEqual(decoded.payload, { a: 1 });
});

test('keeps an empty signature segment as an empty string', () => {
  const [header, payload] = [b64url({ alg: 'none' }), b64url({ a: 1 })];

  assert.equal(decode(`${header}.${payload}.`).signature, '');
});

test('rejects a segment count other than three, naming what it found', () => {
  assert.throws(() => decode('a.b'), /expected 3 dot-separated segments, got 2/);
  assert.throws(() => decode('a.b.c.d'), /expected 3 dot-separated segments, got 4/);
});

test('rejects a segment that is not valid base64url JSON', () => {
  assert.throws(
    () => decode(`${b64url({ alg: 'HS256' })}.AAAAA.sig`),
    /Could not decode segment/
  );
  assert.throws(
    () => decode(`${b64url({ alg: 'HS256' })}.${b64url({ a: 1 }).slice(0, 2)}%%.sig`),
    /Could not decode segment/
  );
});

test('passes through a segment whose JSON is not an object', () => {
  assert.deepEqual(decode(`${b64url([1, 2])}.${b64url('scalar')}.sig`).header, [1, 2]);
  assert.equal(decode(`${b64url({ alg: 'HS256' })}.${b64url('scalar')}.sig`).payload, 'scalar');
});

test('extracts the well-known claims in a stable order', () => {
  const issued = 1_700_000_000;
  const rows = extractTimestampClaims({
    nbf: issued + 200,
    exp: issued + 100,
    iat: issued,
    sub: '1',
  });

  assert.deepEqual(rows.map((row) => row.field), ['iat', 'exp', 'nbf']);
  rows.forEach((row, index) => {
    assert.equal(row.date.getTime(), [issued, issued + 100, issued + 200][index] * 1000);
  });
});

test('ignores absent and non-numeric claims', () => {
  assert.deepEqual(extractTimestampClaims({ sub: '1' }), []);
  assert.deepEqual(extractTimestampClaims({ iat: '1700000000', exp: null }), []);
});
