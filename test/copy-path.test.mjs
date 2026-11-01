import test from 'node:test';
import assert from 'node:assert/strict';

import { copyButtonFrom, handleCopy, renderJson } from '../src/ui-controller.js';
import { highlight } from '../src/json-formatter.js';

/** A stand-in for a Copy button: records its label, class list, and target. */
const button = (copyTarget) => {
  const classes = new Set();
  return {
    dataset: { copyTarget },
    textContent: 'Copy',
    classes,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
  };
};

/** Replaces the clipboard and the timers for one test body, then restores both. */
async function withHost(stubs, body) {
  const saved = new Map(
    Object.keys(stubs).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)])
  );
  try {
    for (const [key, descriptor] of Object.entries(stubs)) {
      Object.defineProperty(globalThis, key, { ...descriptor, configurable: true, writable: true });
    }
    return await body();
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

const timerRegistry = () => {
  const scheduled = new Set();
  return {
    pending: () => [...scheduled].filter((e) => !e.cleared),
    stubs: {
      setTimeout: {
        value: (cb, ms) => {
          const entry = { cb, ms, cleared: false };
          scheduled.add(entry);
          return entry;
        },
      },
      clearTimeout: { value: (entry) => { if (entry) entry.cleared = true; } },
    },
  };
};

test('a click on a child node still resolves the copy button', () => {
  const btn = button('payload-output');
  const nested = { closest: (selector) => (selector === '.copy-btn' ? btn : null) };

  assert.equal(copyButtonFrom(nested), btn);
  assert.equal(copyButtonFrom({ closest: () => null }), null);
  assert.equal(copyButtonFrom(undefined), null);
});

test('the copied text is the same serialisation the DOM shows', async () => {
  const pre = { id: 'payload-output', innerHTML: '' };
  const value = { sub: '1', note: 'a & b' };
  renderJson(pre, value);

  const written = [];
  await withHost({ navigator: { value: { clipboard: { writeText: async (text) => { written.push(text); } } } } }, async () => {
    const btn = button('payload-output');
    await handleCopy(btn);
  });

  assert.deepEqual(written, [JSON.stringify(value, null, 2)]);
  assert.equal(pre.innerHTML, highlight(value).html);
});

test('a failed clipboard write reports the failure instead of claiming success', async () => {
  await withHost(
    { navigator: { value: { clipboard: { writeText: async () => { throw new Error('denied'); } } } } },
    async () => {
      const btn = button('header-output');
      await handleCopy(btn);

      assert.equal(btn.textContent, 'Error');
      assert.ok(!btn.classes.has('is-copied'));
    }
  );
});

test('a second click cancels the pending label restore', async () => {
  const timers = timerRegistry();
  await withHost(
    {
      navigator: { value: { clipboard: { writeText: async () => {} } } },
      ...timers.stubs,
    },
    async () => {
      const btn = button('header-output');
      await handleCopy(btn);
      await handleCopy(btn);

      assert.equal(timers.pending().length, 1, 'the first restore should be cleared');
      assert.equal(btn.textContent, 'Copied!');

      timers.pending()[0].cb();
      assert.equal(btn.textContent, 'Copy');
      assert.ok(!btn.classes.has('is-copied'));
    }
  );
});

test('a slow second write does not inherit the first click restore timer', async () => {
  const timers = timerRegistry();
  let releaseFirst;
  let releaseSecond;
  const writes = [
    new Promise((resolve) => { releaseFirst = resolve; }),
    new Promise((resolve) => { releaseSecond = resolve; }),
  ];
  let call = 0;
  const clipboard = { writeText: async () => { await writes[call++]; } };

  await withHost({ navigator: { value: { clipboard } }, ...timers.stubs }, async () => {
    const btn = button('header-output');

    const first = handleCopy(btn);
    await Promise.resolve();
    releaseFirst();
    await first;

    // The first click's restore is now pending. Start a second click whose
    // write is still open: it must cancel that timer on entry, otherwise the
    // label flips to "Copy" while this write is in flight.
    const second = handleCopy(btn);
    await Promise.resolve();

    assert.equal(timers.pending().length, 0, 'the earlier restore must be cancelled before the write settles');
    assert.notEqual(btn.textContent, 'Copy', 'label must not revert mid-write');

    releaseSecond();
    await second;

    assert.equal(timers.pending().length, 1, 'exactly one restore is scheduled for the new write');
    assert.equal(btn.textContent, 'Copied!');
  });
});
