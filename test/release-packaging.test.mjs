import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  inspectArchive,
  packageRelease,
  selectReleaseFiles,
  checksum,
} from '../scripts/package-release.mjs';
import { evaluateVersions, chromeVersionProblem } from '../scripts/check-version-policy.mjs';

const REPO = new URL('..', import.meta.url).pathname;

const TRACKED = [
  '.claude/settings.json',
  '.codex/config.toml',
  '.cursor/hooks.json',
  '.github/CODEOWNERS',
  '.github/workflows/ci.yml',
  '.prettierignore',
  '.windsurf/hooks.json',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'icons/generate-icons.html',
  'icons/icon128.png',
  'icons/icon16.png',
  'icons/icon48.png',
  'manifest.json',
  'package.json',
  'popup.css',
  'popup.html',
  'popup.js',
  'scripts/package-release.mjs',
  'src/json-formatter.js',
  'src/jwt-decoder.js',
  'src/ui-controller.js',
  'test/release-packaging.test.mjs',
];

test('the allowlist keeps only runtime files', () => {
  // Sorted lexicographically for a stable archive order: "icon128" precedes
  // "icon16" the way strings do, not the way sizes do.
  assert.deepEqual(selectReleaseFiles(TRACKED), [
    'LICENSE',
    'icons/icon128.png',
    'icons/icon16.png',
    'icons/icon48.png',
    'manifest.json',
    'popup.css',
    'popup.html',
    'popup.js',
    'src/json-formatter.js',
    'src/jwt-decoder.js',
    'src/ui-controller.js',
  ]);
});

test('an unrecognised path is excluded rather than shipped', () => {
  // The allowlist fails closed: a new root file, a new dot-directory, or a new
  // build script never enters the archive without an explicit decision here.
  for (const added of ['background.js', '.agents/config.json', 'dist/bundle.js', 'CHANGELOG.md']) {
    assert.ok(!selectReleaseFiles([...TRACKED, added]).includes(added), `${added} leaked into the release set`);
  }
});

test('the build-time icon generator is not a runtime asset', () => {
  const icons = selectReleaseFiles(TRACKED).filter((p) => p.startsWith('icons/'));
  assert.deepEqual(icons, ['icons/icon128.png', 'icons/icon16.png', 'icons/icon48.png']);
});

test('archive inspection reports both directions of drift', () => {
  const expected = ['a.js', 'b.js'];

  assert.deepEqual(inspectArchive(['a.js', 'b.js'], expected), { ok: true, unexpected: [], missing: [] });
  assert.deepEqual(inspectArchive(['a.js', 'b.js', 'secret.env'], expected).unexpected, ['secret.env']);
  assert.deepEqual(inspectArchive(['a.js'], expected).missing, ['b.js']);
});

test('checksum is a stable digest of the bytes', () => {
  assert.equal(checksum('abc'), checksum(Buffer.from('abc')));
  assert.notEqual(checksum('abc'), checksum('abd'));
});

test('the repository tracks exactly the runtime files the selection expects', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
  const selected = selectReleaseFiles(tracked);

  for (const required of ['manifest.json', 'popup.html', 'popup.css', 'popup.js', 'src/jwt-decoder.js']) {
    assert.ok(selected.includes(required), `${required} must ship`);
  }
  assert.ok(!selected.some((p) => p.startsWith('.')), 'no dot-files or dot-directories ship');
  assert.ok(!selected.some((p) => p === 'README.md' || p === 'AGENTS.md' || p === 'package.json'));
});

test('version policy accepts matching semver and rejects drift', () => {
  const ok = evaluateVersions({
    manifestText: '{"manifest_version":3,"version":"1.2.3"}',
    packageText: '{"version":"1.2.3"}',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.version, '1.2.3');

  const drift = evaluateVersions({
    manifestText: '{"manifest_version":3,"version":"1.2.3"}',
    packageText: '{"version":"1.2.4"}',
  });
  assert.equal(drift.ok, false);
  assert.match(drift.problems.join('\n'), /version drift: manifest\.json 1\.2\.3 != package\.json 1\.2\.4/);
});

test('version policy rejects malformed input rather than passing silently', () => {
  assert.equal(evaluateVersions({ manifestText: '{oops', packageText: '{}' }).ok, false);
  assert.equal(
    evaluateVersions({ manifestText: '{"manifest_version":2,"version":"1.0.0"}', packageText: '{"version":"1.0.0"}' }).ok,
    false,
    'MV2 must not pass a release gate written for MV3'
  );
  assert.equal(
    evaluateVersions({ manifestText: '{"manifest_version":3}', packageText: '{"version":"1.0.0"}' }).ok,
    false,
    'a missing manifest version must fail'
  );
  assert.equal(
    evaluateVersions({
      manifestText: '{"manifest_version":3,"version":"v1.0"}',
      packageText: '{"version":"v1.0"}',
    }).ok,
    false,
    'a non-semver version must fail'
  );
});

test('the real repository passes the version policy', () => {
  const result = evaluateVersions({
    manifestText: readFileSync(join(REPO, 'manifest.json'), 'utf8'),
    packageText: readFileSync(join(REPO, 'package.json'), 'utf8'),
  });
  assert.equal(result.problems.join('\n'), '', 'committed versions must agree');
  assert.equal(result.ok, true);
});

const hasZip = (() => {
  try {
    execFileSync('zip', ['-v'], { stdio: 'ignore' });
    execFileSync('zipinfo', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test('packageRelease builds an archive whose contents equal the selection', { skip: !hasZip }, () => {
  const outDir = join(tmpdir(), `jwt-release-test-${process.pid}`);
  try {
    const first = packageRelease({ cwd: REPO, outDir });
    const second = packageRelease({ cwd: REPO, outDir });

    assert.deepEqual(first.files, selectReleaseFiles(
      execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean)
    ));
    assert.match(first.archive, /jwt-decoder-\d+\.\d+\.\d+\.zip$/);
    assert.equal(existsSync(`${first.archive}.sha256`), true);
    assert.equal(first.checksum, second.checksum, 'two builds of the same tree must be byte-identical');
    assert.equal(readFileSync(`${first.archive}.sha256`, 'utf8').split(' ')[0], first.checksum);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('a relative outDir resolves against the repository, not the staging directory', { skip: !hasZip }, () => {
  const relative = 'dist-relative-test';
  try {
    const result = packageRelease({ cwd: REPO, outDir: relative });

    assert.equal(result.archive, join(REPO, relative, 'jwt-decoder-1.0.0.zip'));
    assert.equal(existsSync(result.archive), true, 'the archive must land under the repository cwd');
  } finally {
    rmSync(join(REPO, relative), { recursive: true, force: true });
  }
});

test('the version gate speaks Chrome manifest grammar, not loose semver', () => {
  for (const valid of ['1', '1.0', '0.1.2', '1.2.3', '1.2.3.4', '1.2.3.0', '65535.65535.65535.65535']) {
    assert.equal(chromeVersionProblem(valid), null, `${valid} must be accepted`);
  }
  // Every one of these passes a permissive semver pattern and none loads in Chrome.
  for (const invalid of ['1.0.1-beta.0', '01.2.3', '70000.2.3', '1.2.3.65536', '1.2.3.4.5', 'v1.0.0', '1.2.x', '', '1..3']) {
    assert.notEqual(chromeVersionProblem(invalid), null, `${invalid} must be rejected`);
  }
});

test('agreeing files are still rejected when Chrome cannot load the version', () => {
  const result = evaluateVersions({
    manifestText: '{"manifest_version":3,"version":"1.0.1-beta.0"}',
    packageText: '{"version":"1.0.1-beta.0"}',
  });

  assert.equal(result.ok, false, 'parity is not enough — the value itself must be loadable');
  assert.match(result.problems.join('\n'), /manifest\.json version .*not 1-4 dot-separated integers/);
});
