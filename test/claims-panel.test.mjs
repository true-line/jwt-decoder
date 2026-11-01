import test from 'node:test';
import assert from 'node:assert/strict';

import { extractTimestampClaims } from '../src/jwt-decoder.js';
import { claimsPanelHtml } from '../src/ui-controller.js';

const rows = (payload) => claimsPanelHtml(extractTimestampClaims(payload));
const NOW = Math.floor(Date.now() / 1000);

test('renders the human label and keeps the raw claim name as a hint', () => {
  const html = rows({ iat: NOW - 60, exp: NOW + 3600 });

  assert.match(html, /<span class="claim-field" title="iat">Issued At<\/span>/);
  assert.match(html, /<span class="claim-field" title="exp">Expires<\/span>/);
  assert.ok(!html.includes('>iat<'), 'the raw claim name is still the visible text');
});

test('badges each row at most once', () => {
  assert.match(rows({ exp: NOW - 1 }), /claim-badge--expired/);
  assert.match(rows({ exp: NOW + 3600 }), /claim-badge--valid/);

  const both = rows({ iat: NOW - 10, exp: NOW - 1 });
  assert.equal((both.match(/claim-badge/g) || []).length, 2); // one badge element = 2 matches
  assert.equal((both.match(/claim-badge--/g) || []).length, 1);
});

test('a row without a status renders its date and no badge', () => {
  const html = rows({ iat: NOW - 60, nbf: NOW + 60 });

  assert.equal((html.match(/claim-badge--/g) || []).length, 0);
  assert.equal((html.match(/claim-row/g) || []).length, 2); // one per row
});

test('an implausible epoch shows its value but never a Valid badge', () => {
  const html = rows({ exp: Date.now() });

  assert.match(html, /claim-date/);
  assert.equal((html.match(/claim-badge--valid/g) || []).length, 0);
});

test('no claims renders nothing', () => {
  assert.equal(rows({ sub: '1' }), '');
});
