'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const site = process.env.HEXO_SIL_SITE;
if (!site) throw new Error('HEXO_SIL_SITE must point to a Hexo site checkout.');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hexo-sil-integration-'));
const packs = path.join(temporary, 'packs');
const fixture = path.join(temporary, 'site');
fs.mkdirSync(packs);

try {
  const packed = [];
  for (const name of fs.readdirSync(path.join(root, 'packages')).sort()) {
    const cwd = path.join(root, 'packages', name);
    const result = JSON.parse(execFileSync('npm', ['pack', '--pack-destination', packs, '--json'], { cwd, encoding: 'utf8' }))[0];
    packed.push({ name: result.name, file: path.join(packs, result.filename) });
  }
  fs.cpSync(site, fixture, {
    recursive: true,
    filter(source) {
      const relative = path.relative(site, source);
      if (!relative) return true;
      const first = relative.split(path.sep)[0];
      return !['.git', '.deploy_git', 'node_modules', 'public'].includes(first) && relative !== 'db.json';
    }
  });
  const packageFile = path.join(fixture, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  pkg.scripts.postinstall = 'hexo-sil-podcast-inside-patch';
  for (const item of packed) pkg.dependencies[item.name] = `file:${item.file}`;
  fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);
  for (const file of ['hexo-sil-assets.js', 'hexo-sil-audio.js', 'hexo-sil-archive.js', 'hexo-sil-podcast.js', 'hexo-sil-podcast-inside.js']) {
    fs.rmSync(path.join(fixture, 'scripts', file), { force: true });
  }
  fs.rmSync(path.join(fixture, 'plugins', 'hexo-sil-assets'), { recursive: true, force: true });
  execFileSync('npm', ['install', '--ignore-scripts=false'], { cwd: fixture, stdio: 'inherit' });
  execFileSync(process.execPath, ['-e', packed.map(item => `require.resolve(${JSON.stringify(item.name)})`).join(';')], { cwd: fixture, stdio: 'inherit' });
  execFileSync('npx', ['hexo', 'generate', '--bail'], { cwd: fixture, stdio: 'inherit' });
  for (const file of ['public/css/hexo-sil-audio.css', 'public/css/hexo-sil-archive.css', 'public/hxh_civ/index.html', 'public/podcasts/index.html']) {
    if (!fs.existsSync(path.join(fixture, file))) throw new Error(`Integration output is missing ${file}.`);
  }
  const archiveDirectory = path.join(fixture, 'public', 'archive-data');
  const archiveFiles = fs.readdirSync(archiveDirectory).filter(file => file.endsWith('.json'));
  const hxhTree = archiveFiles.map(file => fs.readFileSync(path.join(archiveDirectory, file), 'utf8'))
    .find(source => source.includes('CIV_474_01'));
  if (!hxhTree) throw new Error('The generated HxH archive tree was not found.');
  if (/index\.html/.test(hxhTree)) throw new Error('The generated HxH archive tree exposes obsolete index.html files.');
  process.stdout.write(`Integration passed in ${fixture}\n`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
