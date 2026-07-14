#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PACKAGE_NAMES = Object.freeze([
  'hexo-sil-archive',
  'hexo-sil-assets',
  'hexo-sil-audio',
  'hexo-sil-podcast',
  'hexo-sil-podcast-inside'
]);
const BUMP_TYPES = new Set(['major', 'minor', 'patch']);
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function releaseError(message) {
  return new Error(`Release configuration error: ${message}`);
}

function parseSemver(value, label = 'version') {
  const source = String(value || '').trim();
  const match = source.match(SEMVER_PATTERN);
  if (!match) throw releaseError(`${label} must be a strict SemVer without build metadata.`);
  const prerelease = match[4] || '';
  if (prerelease.split('.').some(identifier => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'))) {
    throw releaseError(`${label} contains a numeric prerelease identifier with a leading zero.`);
  }
  return {
    version: source,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease
  };
}

function compareVersions(left, right) {
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease, 'en');
}

function caretContains(range, version) {
  const source = String(range || '').trim();
  if (!source.startsWith('^')) return source === version.version;
  let minimum;
  try {
    minimum = parseSemver(source.slice(1), 'peer dependency range');
  } catch {
    return true;
  }
  let maximum;
  if (minimum.major > 0) maximum = { major: minimum.major + 1, minor: 0, patch: 0, prerelease: '' };
  else if (minimum.minor > 0) maximum = { major: 0, minor: minimum.minor + 1, patch: 0, prerelease: '' };
  else maximum = { major: 0, minor: 0, patch: minimum.patch + 1, prerelease: '' };
  return compareVersions(version, minimum) >= 0 && compareVersions(version, maximum) < 0;
}

function packageFile(root, name) {
  if (!PACKAGE_NAMES.includes(name)) throw releaseError(`unknown workspace package ${name || '(empty)'}.`);
  return path.join(root, 'packages', name, 'package.json');
}

function readPackage(root, name) {
  const filename = packageFile(root, name);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (error) {
    throw releaseError(`could not read ${path.relative(root, filename)}: ${error.message}`);
  }
  if (value.name !== name) throw releaseError(`${path.relative(root, filename)} must declare name ${name}.`);
  return value;
}

function releaseInfo(root, tag) {
  const value = String(tag || '').trim();
  const separator = value.lastIndexOf('@');
  if (separator <= 0) throw releaseError('tag must use <package>@<version>.');
  const name = value.slice(0, separator);
  const parsed = parseSemver(value.slice(separator + 1), 'tag version');
  const pkg = readPackage(root, name);
  if (pkg.private === true) throw releaseError(`${name} must not be private.`);
  if (pkg.version !== parsed.version) {
    throw releaseError(`tag version ${parsed.version} does not match ${name} package version ${pkg.version}.`);
  }
  return {
    package: name,
    path: `packages/${name}`,
    version: parsed.version,
    prerelease: Boolean(parsed.prerelease),
    distTag: parsed.prerelease ? 'next' : 'latest',
    tag: value
  };
}

function peerWarnings(root, name, version) {
  const parsed = parseSemver(version);
  const warnings = [];
  for (const candidate of PACKAGE_NAMES) {
    if (candidate === name) continue;
    const pkg = readPackage(root, candidate);
    const range = pkg.peerDependencies && pkg.peerDependencies[name];
    if (range && !caretContains(range, parsed)) warnings.push(`${candidate} declares ${name}@${range}, which does not include ${version}.`);
  }
  return warnings;
}

function runNpmVersion(root, name, specifier) {
  const filename = packageFile(root, name);
  const beforeSource = fs.readFileSync(filename, 'utf8');
  const beforeVersion = readPackage(root, name).version;
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(executable, ['version', specifier, '--workspace', name, '--no-git-tag-version', '--ignore-scripts'], {
    cwd: root,
    stdio: 'inherit'
  });
  if (result.error) throw releaseError(`could not run npm version: ${result.error.message}`);
  if (result.status !== 0) throw releaseError('npm version failed.');
  const afterVersion = readPackage(root, name).version;
  const needle = `"version": "${beforeVersion}"`;
  if (beforeSource.split(needle).length !== 2) throw releaseError(`${name} package version field could not be updated without reformatting.`);
  fs.writeFileSync(filename, beforeSource.replace(needle, `"version": "${afterVersion}"`));
}

function prepareRelease(root, name, specifier, options = {}) {
  readPackage(root, name);
  const requested = String(specifier || '').trim();
  if (!BUMP_TYPES.has(requested)) parseSemver(requested, 'requested version');
  (options.runVersion || runNpmVersion)(root, name, requested);
  const pkg = readPackage(root, name);
  const parsed = parseSemver(pkg.version, 'prepared package version');
  const warnings = peerWarnings(root, name, parsed.version);
  return { ...releaseInfo(root, `${name}@${parsed.version}`), warnings };
}

function writeOutputs(filename, info) {
  if (!filename) return;
  const lines = [
    `package=${info.package}`,
    `path=${info.path}`,
    `version=${info.version}`,
    `prerelease=${info.prerelease}`,
    `dist_tag=${info.distTag}`,
    `tag=${info.tag}`
  ];
  fs.appendFileSync(filename, `${lines.join('\n')}\n`);
}

function usage() {
  return 'Usage:\n  npm run release:prepare -- <package> <major|minor|patch|version>\n  npm run release:check -- <package@version>';
}

function main(argv = process.argv.slice(2), root = path.resolve(__dirname, '..')) {
  const [command, ...args] = argv;
  if (command === 'check' && args.length === 1) {
    const info = releaseInfo(root, args[0]);
    writeOutputs(process.env.GITHUB_OUTPUT, info);
    console.log(JSON.stringify(info, null, 2));
    return info;
  }
  if (command === 'prepare' && args.length === 2) {
    const info = prepareRelease(root, args[0], args[1]);
    console.log(`Prepared ${info.tag}.`);
    for (const warning of info.warnings) console.warn(`Release warning: ${warning}`);
    console.log(`Commit the version files on main, then publish GitHub Release ${info.tag}.`);
    return info;
  }
  throw releaseError(usage());
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  PACKAGE_NAMES,
  caretContains,
  main,
  parseSemver,
  peerWarnings,
  prepareRelease,
  releaseInfo,
  writeOutputs
};
