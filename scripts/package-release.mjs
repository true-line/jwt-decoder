#!/usr/bin/env node
/**
 * Assembles the Chrome Web Store archive from tracked files only, using an
 * explicit allowlist of runtime paths.
 *
 * The repository root *is* the extension, so a naive `zip -r .` would ship the
 * governed agent harness, the tests, and the repository's own documentation.
 * Denylists fail open whenever a new directory appears, so selection is
 * allowlist-driven and the resulting archive is inspected afterwards.
 *
 * Run: `npm run package:release`
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, posix, resolve } from 'node:path';

/** Files that ship verbatim. */
export const RUNTIME_FILES = new Set(['manifest.json', 'popup.html', 'popup.css', 'popup.js', 'LICENSE']);

/** Directories that ship, subject to RUNTIME_DIR_EXCLUDES. */
export const RUNTIME_DIRS = ['src', 'icons'];

/** Per-directory exclusions: build-time helpers that are not runtime assets. */
export const RUNTIME_DIR_EXCLUDES = {
  icons: new Set(['generate-icons.html']),
};

// Zip's epoch; normalising every mtime to it keeps repeat builds byte-stable.
const FIXED_MTIME = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

/**
 * @param {string[]} trackedPaths paths as reported by `git ls-files`
 * @returns {string[]} the runtime file set, sorted for a stable archive order
 */
export function selectReleaseFiles(trackedPaths) {
  const selected = trackedPaths.filter((path) => {
    const dir = posix.dirname(path);
    const base = posix.basename(path);

    if (dir === '.') return RUNTIME_FILES.has(base);
    if (!RUNTIME_DIRS.includes(dir)) return false;

    return !(RUNTIME_DIR_EXCLUDES[dir]?.has(base));
  });

  return selected.sort();
}

/**
 * Compares an archive listing against the expected file set.
 *
 * @param {string[]} archiveEntries entries as listed by `zipinfo -1`
 * @param {string[]} expected       the selected runtime paths
 * @returns {{ ok: boolean, unexpected: string[], missing: string[] }}
 */
export function inspectArchive(archiveEntries, expected) {
  const archive = new Set(archiveEntries);
  const want = new Set(expected);

  return {
    ok: archive.size === want.size && [...want].every((p) => archive.has(p)),
    unexpected: [...archive].filter((p) => !want.has(p)).sort(),
    missing: [...want].filter((p) => !archive.has(p)).sort(),
  };
}

/** @param {Buffer|Uint8Array|string} bytes @returns {string} hex SHA-256 */
export function checksum(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** @returns {string} the version declared in manifest.json */
export function readVersion(cwd) {
  const manifest = JSON.parse(readFileSync(join(cwd, 'manifest.json'), 'utf8'));
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error('manifest.json has no version string');
  }
  return manifest.version;
}

/**
 * Builds `<outDir>/jwt-decoder-<version>.zip` plus its `.sha256`. The default
 * output directory is `dist/`, which is gitignored, so a build never leaves
 * untracked artifacts among the extension's own sources.
 *
 * @param {{ cwd?: string, outDir?: string }} [options]
 * @returns {{ archive: string, checksum: string, files: string[] }}
 */
export function packageRelease({ cwd = process.cwd(), outDir } = {}) {
  // Resolved against the repository, not the process cwd, and made absolute
  // before any command runs with `cwd: stage` — a relative archive path would
  // otherwise be interpreted inside the temporary staging directory.
  const target = resolve(cwd, outDir ?? 'dist');
  const tracked = execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const files = selectReleaseFiles(tracked);

  if (files.length === 0) throw new Error('no runtime files selected — is this a git checkout?');

  const version = readVersion(cwd);
  const stage = mkdtempSync(join(tmpdir(), 'jwt-decoder-release-'));

  try {
    for (const path of files) {
      const staged = join(stage, path);
      mkdirSync(dirname(staged), { recursive: true });
      copyFileSync(join(cwd, path), staged);
      utimesSync(staged, FIXED_MTIME, FIXED_MTIME);
    }

    const archive = join(target, `jwt-decoder-${version}.zip`);
    mkdirSync(target, { recursive: true });
    // `zip` updates an existing archive rather than replacing it, which would
    // silently fold a stale build into this one.
    rmSync(archive, { force: true });
    execFileSync('zip', ['-X', '-q', archive, ...files], { cwd: stage });

    const entries = execFileSync('zipinfo', ['-1', archive], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const inspection = inspectArchive(entries, files);
    if (!inspection.ok) {
      throw new Error(
        `archive does not match the runtime file set: unexpected=[${inspection.unexpected}] missing=[${inspection.missing}]`
      );
    }

    const digest = checksum(readFileSync(archive));
    const name = basename(archive);
    const checksumFile = `${archive}.sha256`;
    writeFileSync(checksumFile, `${digest}  ${name}\n`);

    return { archive, checksum: digest, files };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { archive, checksum: digest, files } = packageRelease();
  const size = statSync(archive).size;
  console.log(`${archive}  ${files.length} files  ${size} bytes  sha256 ${digest}`);
}
