'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  PACKAGE_NAMES,
  parseSemver,
  prepareRelease,
  releaseInfo,
  writeOutputs
} = require('../tools/release');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexo-sil-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of PACKAGE_NAMES) {
    const directory = path.join(root, 'packages', name);
    fs.mkdirSync(directory, { recursive: true });
    const peerDependencies = name === 'hexo-sil-audio' ? { 'hexo-sil-assets': '^0.1.0' } : undefined;
    fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify({ name, version: '0.1.0', peerDependencies }, null, 2)}\n`);
  }
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return root;
}

test('release tags select exactly one stable or prerelease workspace', t => {
  const root = fixture(t);
  assert.deepEqual(releaseInfo(root, 'hexo-sil-assets@0.1.0'), {
    package: 'hexo-sil-assets',
    path: 'packages/hexo-sil-assets',
    version: '0.1.0',
    prerelease: false,
    distTag: 'latest',
    tag: 'hexo-sil-assets@0.1.0'
  });
  const podcast = path.join(root, 'packages', 'hexo-sil-podcast', 'package.json');
  fs.writeFileSync(podcast, `${JSON.stringify({ name: 'hexo-sil-podcast', version: '0.2.0-beta.1' }, null, 2)}\n`);
  assert.equal(releaseInfo(root, 'hexo-sil-podcast@0.2.0-beta.1').distTag, 'next');
});

test('release tags reject unknown packages, malformed versions, and mismatches', t => {
  const root = fixture(t);
  assert.throws(() => releaseInfo(root, 'unknown@0.1.0'), /unknown workspace/);
  assert.throws(() => releaseInfo(root, 'hexo-sil-assets@v0.1.0'), /strict SemVer/);
  assert.throws(() => releaseInfo(root, 'hexo-sil-assets@0.1.1'), /does not match/);
  assert.throws(() => parseSemver('1.0.0-beta.01'), /leading zero/);
  assert.throws(() => parseSemver('1.0.0+build'), /without build metadata/);
});

test('version preparation changes one package and warns about incompatible peer ranges', t => {
  const root = fixture(t);
  const info = prepareRelease(root, 'hexo-sil-assets', '0.2.0', {
    runVersion(projectRoot, name, version) {
      const filename = path.join(projectRoot, 'packages', name, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(filename, 'utf8'));
      pkg.version = version;
      fs.writeFileSync(filename, `${JSON.stringify(pkg, null, 2)}\n`);
    }
  });
  assert.equal(info.tag, 'hexo-sil-assets@0.2.0');
  assert.deepEqual(info.warnings, ['hexo-sil-audio declares hexo-sil-assets@^0.1.0, which does not include 0.2.0.']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'packages', 'hexo-sil-audio', 'package.json'))).version, '0.1.0');
});

test('GitHub outputs use fixed release field names', t => {
  const root = fixture(t);
  const output = path.join(root, 'output');
  writeOutputs(output, releaseInfo(root, 'hexo-sil-audio@0.1.0'));
  const source = fs.readFileSync(output, 'utf8');
  assert.match(source, /^package=hexo-sil-audio$/m);
  assert.match(source, /^dist_tag=latest$/m);
  assert.match(source, /^prerelease=false$/m);
});
