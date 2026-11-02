#!/usr/bin/env node

/**
 * Keep the n8n catalog (n8n-nodes-base, n8n-core, @n8n/n8n-nodes-langchain, n8n-workflow) in step with the latest
 * stable n8n release (fork-specific).
 *
 * Upstream's update-n8n-deps.js reads the sub-package versions from n8n@latest's `dependencies`, which n8n 2.x no
 * longer lists, so it skips every package. This resolves them from the registry instead: for n8n@latest X.Y.Z it
 * picks the highest published X.Y.* of each sub-package (they do not publish every patch).
 *
 *   node scripts/sync-n8n-catalog.js [--check] [--include-patches] [--n8n <X.Y.Z>] [--root <dir>]
 *
 * Rewrites package.json, the Dockerfile's n8n-workflow pin and the README badge under --root (default: repo root).
 * Exit codes: 0 update written (or available with --check), 10 nothing to do, 2 refused (major change or
 * downgrade), 1 error. With GITHUB_OUTPUT set it also exports `n8n_version` and `catalog_version`.
 *
 * A patch-only difference (same X.Y) is ignored unless --include-patches: data/nodes.db is ~70 MB and every
 * resync adds a copy of it to the git history.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PACKAGES = ['n8n-nodes-base', 'n8n-core', '@n8n/n8n-nodes-langchain', 'n8n-workflow'];
const BASE_PACKAGE = 'n8n-nodes-base';

function parseArgs(argv) {
  const opts = { check: false, includePatches: false, n8n: null, root: path.join(__dirname, '..') };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') opts.check = true;
    else if (arg === '--include-patches') opts.includePatches = true;
    else if (arg === '--n8n') opts.n8n = argv[++i];
    else if (arg === '--root') opts.root = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function npmView(spec, field) {
  const out = execFileSync('npm', ['view', spec, field, '--json'], { encoding: 'utf8' });
  return JSON.parse(out);
}

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v));
  return m ? m.slice(1).map(Number) : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** Highest stable `major.minor.*` published for a package, or null. */
function highestInMinor(pkg, major, minor) {
  const raw = npmView(pkg, 'versions');
  const versions = Array.isArray(raw) ? raw : [raw];
  const matching = versions
    .map((v) => ({ v, p: parseVersion(v) }))
    .filter((x) => x.p && x.p[0] === major && x.p[1] === minor)
    .sort((a, b) => compare(a.p, b.p));
  return matching.length ? matching[matching.length - 1].v : null;
}

function currentPins(packageJsonText) {
  const pins = {};
  for (const pkg of PACKAGES) {
    const m = new RegExp(`"${pkg}":\\s*"([^"]+)"`).exec(packageJsonText);
    if (!m) throw new Error(`${pkg} is not pinned in package.json`);
    pins[pkg] = m[1];
  }
  return pins;
}

function replaceOnce(text, pattern, replacement, label) {
  if (!pattern.test(text)) throw new Error(`Could not find ${label} to update`);
  return text.replace(pattern, replacement);
}

function exportOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pkgPath = path.join(opts.root, 'package.json');
  const pkgText = fs.readFileSync(pkgPath, 'utf8');
  const current = currentPins(pkgText);

  const n8nVersion = opts.n8n || npmView('n8n@latest', 'version');
  const n8nParsed = parseVersion(n8nVersion);
  if (!n8nParsed) throw new Error(`Unexpected n8n version: ${n8nVersion}`);
  const [major, minor] = n8nParsed;

  const currentBase = parseVersion(current[BASE_PACKAGE]);
  if (currentBase[0] !== major) {
    console.error(`n8n ${n8nVersion} is a different major than the catalog (${current[BASE_PACKAGE]}); review it by hand.`);
    return 2;
  }

  const target = {};
  for (const pkg of PACKAGES) {
    const version = highestInMinor(pkg, major, minor);
    if (!version) throw new Error(`No ${major}.${minor}.x release of ${pkg} on npm`);
    target[pkg] = version;
  }

  if (compare(parseVersion(target[BASE_PACKAGE]), currentBase) < 0) {
    console.error(`Refusing to downgrade ${BASE_PACKAGE} ${current[BASE_PACKAGE]} -> ${target[BASE_PACKAGE]}`);
    return 2;
  }

  console.log(`n8n latest: ${n8nVersion}`);
  for (const pkg of PACKAGES) {
    console.log(`  ${pkg.padEnd(26)} ${current[pkg]} -> ${target[pkg]}`);
  }

  const identical = PACKAGES.every((pkg) => current[pkg] === target[pkg]);
  const sameMinor = currentBase[1] === minor;
  if (identical || (sameMinor && !opts.includePatches)) {
    console.log(identical ? 'Catalog is up to date.' : `Same ${major}.${minor} minor, patch differences ignored (--include-patches).`);
    return 10;
  }

  exportOutput({ n8n_version: n8nVersion, catalog_version: target[BASE_PACKAGE] });
  if (opts.check) {
    console.log('Update available (--check: nothing written).');
    return 0;
  }

  let nextPkg = pkgText;
  for (const pkg of PACKAGES) {
    nextPkg = replaceOnce(nextPkg, new RegExp(`("${pkg}":\\s*")[^"]+(")`), `$1${target[pkg]}$2`, `${pkg} in package.json`);
  }
  fs.writeFileSync(pkgPath, nextPkg);

  const dockerfilePath = path.join(opts.root, 'Dockerfile');
  const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
  fs.writeFileSync(
    dockerfilePath,
    replaceOnce(dockerfile, /n8n-workflow@\d+\.\d+\.\d+/, `n8n-workflow@${target['n8n-workflow']}`, 'n8n-workflow pin in Dockerfile')
  );

  const readmePath = path.join(opts.root, 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');
  fs.writeFileSync(
    readmePath,
    replaceOnce(readme, /badge\/n8n-\d+\.\d+\.\d+-orange/, `badge/n8n-${target[BASE_PACKAGE]}-orange`, 'n8n badge in README')
  );

  console.log('package.json, Dockerfile and README.md updated. Run npm install, build and rebuild next.');
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`sync-n8n-catalog: ${error.message}`);
  process.exitCode = 1;
}
