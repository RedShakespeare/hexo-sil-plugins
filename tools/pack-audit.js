'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const packages = fs.readdirSync(path.join(root, 'packages')).sort();

for (const name of packages) {
  const cwd = path.join(root, 'packages', name);
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd, encoding: 'utf8' });
  const result = JSON.parse(output)[0];
  const files = result.files.map(file => file.path);
  assert(files.includes('package.json'), `${name} package.json is missing`);
  assert(files.includes('README.md'), `${name} README.md is missing`);
  assert(files.includes('LICENSE'), `${name} LICENSE is missing`);
  assert(!files.some(file => file.startsWith('test/')), `${name} published test files`);
  assert(!files.some(file => file.includes('node_modules')), `${name} published node_modules`);
  process.stdout.write(`${name}: ${files.length} files, ${result.size} bytes\n`);
}
