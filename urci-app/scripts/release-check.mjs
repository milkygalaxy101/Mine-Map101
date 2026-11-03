// Release gate (DEP-1 / T9), run by .github/workflows/urci-release.yml on a urci-v* tag:
//   - the tag is exactly urci-v<versionName> from release.json
//   - release.json, package.json and www/version.js agree on the version name
//   - versionCode is a positive integer and higher than at the previous urci-v* tag (Android refuses to install
//     an update with a lower or equal versionCode, and the crew would have to uninstall and lose app settings)
// Usage: node scripts/release-check.mjs <tag>
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function checkRelease({ tag, release, pkgVersion, jsVersion, prev }) {
  const errors = [];
  const v = release && release.versionName;
  const code = release && release.versionCode;
  if (typeof v !== 'string' || !/^\d+\.\d+\.\d+$/.test(v)) errors.push(`release.json versionName must be x.y.z, got ${JSON.stringify(v)}`);
  if (!Number.isInteger(code) || code < 1 || code > 2100000000) errors.push(`release.json versionCode must be a positive integer, got ${JSON.stringify(code)}`);
  if (tag !== `urci-v${v}`) errors.push(`tag ${tag} does not match release.json versionName ${v} (expected urci-v${v})`);
  if (pkgVersion !== v) errors.push(`package.json version ${pkgVersion} differs from release.json ${v}`);
  if (jsVersion !== v) errors.push(`www/version.js URCI_VERSION ${jsVersion} differs from release.json ${v}`);
  if (prev) {
    if (!(code > prev.release.versionCode)) errors.push(`versionCode ${code} must be higher than ${prev.release.versionCode} at ${prev.tag}`);
    if (v === prev.release.versionName) errors.push(`versionName ${v} was already released as ${prev.tag}`);
  }
  return errors;
}

export function jsVersionOf(src) {
  const m = /URCI_VERSION\s*=\s*'([^']+)'/.exec(src);
  return m ? m[1] : null;
}

function main() {
  const tag = process.argv[2];
  if (!tag) { console.error('usage: release-check.mjs <tag>'); process.exit(2); }
  const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const read = (p) => readFileSync(path.join(app, p), 'utf8');
  const git = (...a) => execFileSync('git', a, { cwd: app, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const release = JSON.parse(read('release.json'));
  let prev = null;
  try {
    const prevTag = git('describe', '--tags', '--abbrev=0', '--match', 'urci-v*', `${tag}^`);
    prev = { tag: prevTag, release: JSON.parse(git('show', `${prevTag}:urci-app/release.json`)) };
  } catch (e) { /* first release: nothing to compare */ }
  const errors = checkRelease({ tag, release, pkgVersion: JSON.parse(read('package.json')).version, jsVersion: jsVersionOf(read('www/version.js')), prev });
  if (errors.length) {
    for (const e of errors) console.error(`::error::${e}`);
    process.exit(1);
  }
  console.log(`release ${release.versionName} (versionCode ${release.versionCode}) ok${prev ? `; previous ${prev.tag} had versionCode ${prev.release.versionCode}` : '; first release'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
