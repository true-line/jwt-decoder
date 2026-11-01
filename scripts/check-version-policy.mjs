#!/usr/bin/env node
/**
 * Asserts that the extension manifest and the package metadata declare the same
 * version, so a reviewer publishing an archive is publishing what was reviewed.
 *
 * `manifest.json` is authoritative for the extension; `package.json` exists so
 * Node tooling and Changesets have a version to move. Divergence between them
 * is a release defect, so this check fails closed.
 *
 * Run: `npm run check:version`
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Chrome's manifest version: 1 to 4 dot-separated integers, each at most
// 65535, no leading zero on a non-zero component. SemVer is *not* the same
// grammar — `1.0.1-beta.0`, `01.2.3` and `70000.2.3` are all valid to a
// permissive pattern and all unloadable in Chrome, so the release gate has to
// speak the browser's rules.
// https://developer.chrome.com/docs/extensions/reference/manifest/version
const CHROME_VERSION = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/;
const CHROME_VERSION_MAX = 65535;

/**
 * @param {unknown} version
 * @returns {string | null} a reason the value is not a Chrome manifest version
 */
export function chromeVersionProblem(version) {
  if (typeof version !== 'string') return 'missing version string';
  if (!CHROME_VERSION.test(version)) return `${JSON.stringify(version)} is not 1-4 dot-separated integers without leading zeros`;
  const tooLarge = version.split('.').filter((part) => Number(part) > CHROME_VERSION_MAX);
  if (tooLarge.length) return `${JSON.stringify(version)} has a component above ${CHROME_VERSION_MAX}`;
  return null;
}

/**
 * @param {{ manifestText: string, packageText: string }} sources
 * @returns {{ ok: boolean, version: string | null, problems: string[] }}
 */
export function evaluateVersions({ manifestText, packageText }) {
  const problems = [];
  let manifest;
  let pkg;

  try {
    manifest = JSON.parse(manifestText);
  } catch {
    problems.push('manifest.json is not valid JSON');
  }
  try {
    pkg = JSON.parse(packageText);
  } catch {
    problems.push('package.json is not valid JSON');
  }
  if (problems.length) return { ok: false, version: null, problems };

  if (manifest.manifest_version !== 3) {
    problems.push(`manifest.json manifest_version is ${JSON.stringify(manifest.manifest_version)}, expected 3`);
  }

  const manifestVersion = manifest.version;
  const packageVersion = pkg.version;

  if (typeof manifestVersion !== 'string') problems.push('manifest.json has no version string');
  if (typeof packageVersion !== 'string') problems.push('package.json has no version string');

  // The archive is loaded by Chrome, so the manifest's grammar governs the
  // shared value; parity then pins package.json to the same string.
  const manifestProblem = chromeVersionProblem(manifestVersion);
  if (manifestProblem) problems.push(`manifest.json version ${manifestProblem}`);
  const packageProblem = chromeVersionProblem(packageVersion);
  if (packageProblem && packageVersion !== manifestVersion) {
    problems.push(`package.json version ${packageProblem}`);
  }
  if (
    typeof manifestVersion === 'string' &&
    typeof packageVersion === 'string' &&
    manifestVersion !== packageVersion
  ) {
    problems.push(`version drift: manifest.json ${manifestVersion} != package.json ${packageVersion}`);
  }

  return {
    ok: problems.length === 0,
    version: problems.length ? null : manifestVersion,
    problems,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cwd = process.cwd();
  const read = (name) => {
    try {
      return readFileSync(join(cwd, name), 'utf8');
    } catch {
      return null;
    }
  };
  const manifestText = read('manifest.json');
  const packageText = read('package.json');

  if (manifestText === null || packageText === null) {
    console.error('check-version-policy: missing manifest.json or package.json');
    process.exit(1);
  }

  const result = evaluateVersions({ manifestText, packageText });
  if (!result.ok) {
    for (const problem of result.problems) console.error(`check-version-policy: ${problem}`);
    process.exit(1);
  }
  console.log(`version ${result.version} consistent across manifest.json and package.json`);
}
