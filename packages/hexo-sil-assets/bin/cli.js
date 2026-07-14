#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { spawnSync } = require('node:child_process');
const readline = require('node:readline/promises');
const {
  DEFAULT_MANIFEST_PATH,
  getObject,
  loadAssetManifest,
  manifestFilePath,
  normaliseObjectKey,
  serialiseManifest
} = require('../lib/manifest');
const { createR2Client, hashFile } = require('../lib/r2-client');
const { loadAssetsConfig, mappingForKey } = require('../lib/config');

let ASSET_CONFIG = loadAssetsConfig(process.cwd());
let REPOSITORY_ROOT = ASSET_CONFIG.root;
let WORKSPACE_PATH = path.join(REPOSITORY_ROOT, ASSET_CONFIG.workspace);
let GITIGNORE_PATH = path.join(REPOSITORY_ROOT, '.gitignore');
let R2_ASSET_IGNORE_RULES = ASSET_CONFIG.managed.map(entry => entry.ignore).filter(Boolean);
const AUDIO_EXTENSIONS = new Map([
  ['.mp3', 'audio/mpeg'], ['.m4a', 'audio/mp4'], ['.m4b', 'audio/mp4'], ['.mp4', 'audio/mp4'],
  ['.aac', 'audio/aac'], ['.ogg', 'audio/ogg'], ['.opus', 'audio/opus'], ['.wav', 'audio/wav'],
  ['.wave', 'audio/wav'], ['.flac', 'audio/flac'], ['.aif', 'audio/aiff'], ['.aiff', 'audio/aiff'], ['.webm', 'audio/webm']
]);
const MIME_TYPES = new Map([
  ...AUDIO_EXTENSIONS,
  ['.7z', 'application/x-7z-compressed'], ['.apk', 'application/vnd.android.package-archive'], ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'], ['.htm', 'text/html; charset=utf-8'], ['.html', 'text/html; charset=utf-8'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.pdf', 'application/pdf'], ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.tar', 'application/x-tar'], ['.tgz', 'application/gzip'],
  ['.txt', 'text/plain; charset=utf-8'], ['.wasm', 'application/wasm'], ['.wav', 'audio/wav'], ['.webp', 'image/webp'], ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'], ['.zip', 'application/zip'], ['.bz2', 'application/x-bzip2'], ['.gz', 'application/gzip']
]);

function assetError(message) {
  return new Error(`Assets: ${message}`);
}

function formatDuration(seconds) {
  const total = Math.max(1, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  const pad = value => String(value).padStart(2, '0');
  return hours ? `${pad(hours)}:${pad(minutes)}:${pad(remaining)}` : `${pad(minutes)}:${pad(remaining)}`;
}

function mimeType(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

function safeRelative(value, field) {
  const candidate = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!candidate || candidate.includes('?') || candidate.includes('#') || candidate.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw assetError(`${field} must be a safe relative path.`);
  }
  return candidate;
}

function lfsPointer(contents) {
  const source = Buffer.isBuffer(contents) ? contents.toString('utf8') : String(contents || '');
  const oid = source.match(/^oid sha256:([a-f0-9]{64})$/m);
  const size = source.match(/^size (\d+)$/m);
  return oid && size && source.startsWith('version https://git-lfs.github.com/spec/v1\n') ? { sha256: oid[1], size: Number(size[1]) } : null;
}

async function inspectFile(filePath, key) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) throw assetError(`${filePath} must be a regular file.`);
  const descriptor = await fsp.open(filePath, 'r');
  let sample;
  try {
    sample = Buffer.alloc(Math.min(stat.size, 1024));
    const { bytesRead } = await descriptor.read(sample, 0, sample.length, 0);
    sample = sample.subarray(0, bytesRead);
  } finally {
    await descriptor.close();
  }
  const pointer = lfsPointer(sample);
  const type = mimeType(filePath);
  const entry = {
    size: pointer ? pointer.size : stat.size,
    sha256: pointer ? pointer.sha256 : await hashFile(filePath),
    type,
    pointer: Boolean(pointer),
    sourcePath: filePath,
    key: normaliseObjectKey(key)
  };
  if (!pointer && AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    try {
      const metadata = await require('music-metadata').parseFile(filePath, { duration: true });
      const duration = Number(metadata && metadata.format && metadata.format.duration);
      if (Number.isFinite(duration) && duration > 0) entry.duration = formatDuration(duration);
      const title = String(metadata && metadata.common && metadata.common.title || '').trim();
      if (title) entry.title = title;
    } catch (error) {
      throw assetError(`could not read audio metadata from ${filePath}: ${error.message}.`);
    }
  }
  return entry;
}

async function walk(directory, relative = '') {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const output = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(absolute, childRelative));
    else if (entry.isFile()) output.push({ absolute, relative: childRelative });
  }
  return output;
}

function configureRuntime(options = {}) {
  ASSET_CONFIG = loadAssetsConfig(options.root || process.cwd(), options.configFile);
  REPOSITORY_ROOT = ASSET_CONFIG.root;
  WORKSPACE_PATH = path.join(REPOSITORY_ROOT, ASSET_CONFIG.workspace);
  GITIGNORE_PATH = path.join(REPOSITORY_ROOT, '.gitignore');
  R2_ASSET_IGNORE_RULES = ASSET_CONFIG.managed.map(entry => entry.ignore).filter(Boolean);
}

async function scanLocalAssets(root = REPOSITORY_ROOT, scopes = ASSET_CONFIG.managed.map(entry => entry.prefix), config = ASSET_CONFIG) {
  const output = new Map();
  for (const rawScope of scopes) {
    const scope = safeRelative(rawScope, 'scope');
    const mapping = mappingForKey(config, scope);
    if (!mapping) throw assetError(`unsupported managed scope ${scope}.`);
    const relative = scope === mapping.prefix ? '' : scope.slice(mapping.prefix.length + 1);
    const mappingRoot = path.resolve(root, mapping.source);
    const source = relative ? path.resolve(mappingRoot, ...relative.split('/')) : mappingRoot;
    if (source !== mappingRoot && !source.startsWith(`${mappingRoot}${path.sep}`)) throw assetError(`scope ${scope} resolves outside ${mapping.source}.`);
    let stat;
    try { stat = await fsp.stat(source); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isFile()) output.set(scope, await inspectFile(source, scope));
    else if (stat.isDirectory()) {
      for (const item of await walk(source)) {
        const key = `${scope}/${item.relative}`;
        output.set(key, await inspectFile(item.absolute, key));
      }
    } else {
      throw assetError(`${mapping.source} must be a regular file or directory.`);
    }
  }
  return output;
}

function manifestEntry(entry) {
  const value = { size: entry.size, sha256: entry.sha256, type: entry.type };
  if (entry.duration) value.duration = entry.duration;
  if (entry.title) value.title = entry.title;
  return value;
}

async function writeManifest(objects, root = REPOSITORY_ROOT, state = 'legacy') {
  const filePath = manifestFilePath(root, ASSET_CONFIG.manifest);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, serialiseManifest(objects, state));
  await fsp.rename(temporary, filePath);
}

function existingManifestState(root = REPOSITORY_ROOT) {
  const filePath = manifestFilePath(root, ASSET_CONFIG.manifest);
  try {
    return loadAssetManifest(filePath).state;
  } catch (error) {
    if (String(error.message).includes('could not read') && String(error.message).includes('ENOENT')) return 'legacy';
    throw error;
  }
}

async function loadWorkspace() {
  try {
    const value = JSON.parse(await fsp.readFile(WORKSPACE_PATH, 'utf8'));
    const scopes = Array.isArray(value.scopes) ? value.scopes.map(scope => safeRelative(scope, 'workspace scope')) : [];
    return { version: 1, scopes: [...new Set(scopes)] };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, scopes: [] };
    throw assetError(`could not read .assets-workspace.json: ${error.message}.`);
  }
}

async function writeWorkspace(scopes) {
  const value = { version: 1, scopes: [...new Set(scopes.map(scope => safeRelative(scope, 'workspace scope')))].sort() };
  await fsp.writeFile(WORKSPACE_PATH, `${JSON.stringify(value, null, 2)}\n`);
}

async function enableR2AssetIgnores() {
  let current = '';
  try {
    current = await fsp.readFile(GITIGNORE_PATH, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const rules = new Set(current.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
  const missing = R2_ASSET_IGNORE_RULES.filter(rule => !rules.has(rule));
  if (!missing.length) return;
  const separator = current && !current.endsWith('\n') ? '\n' : '';
  await fsp.writeFile(GITIGNORE_PATH, `${current}${separator}${missing.join('\n')}\n`);
}

function configuredScopes() {
  return ASSET_CONFIG.managed.map(entry => entry.prefix);
}

function localDestination(key) {
  const mapping = mappingForKey(ASSET_CONFIG, key);
  if (!mapping) return null;
  const relative = key === mapping.prefix ? '' : key.slice(mapping.prefix.length + 1);
  const root = path.resolve(REPOSITORY_ROOT, mapping.source);
  return relative ? path.resolve(root, ...relative.split('/')) : root;
}

function keyInScope(key, scope) {
  return key === scope || key.startsWith(`${scope}/`);
}

function diffManifest(manifest, local, scopes) {
  const uploads = [];
  const deletes = [];
  for (const [key, entry] of local) {
    const current = getObject(manifest, key);
    if (!current || current.sha256 !== entry.sha256 || current.size !== entry.size || current.type !== entry.type || current.duration !== entry.duration || current.title !== entry.title) {
      uploads.push(entry);
    }
  }
  for (const key of Object.keys(manifest.objects)) {
    if (scopes.some(scope => keyInScope(key, scope)) && !local.has(key)) deletes.push(key);
  }
  return { uploads: uploads.sort((left, right) => left.key.localeCompare(right.key)), deletes: deletes.sort() };
}

function command(name, args, options = {}) {
  const executable = process.platform === 'win32' && (name === 'npm' || name === 'npx') ? `${name}.cmd` : name;
  const result = spawnSync(executable, args, { cwd: REPOSITORY_ROOT, stdio: options.stdio || 'inherit', encoding: 'utf8' });
  if (result.error) throw assetError(`could not run ${name}: ${result.error.message}.`);
  if (result.status !== 0) throw assetError(`${name} ${args.join(' ')} failed.`);
  return result.stdout || '';
}

async function confirm(question, force) {
  if (force) return true;
  if (!process.stdin.isTTY) throw assetError(`${question} requires an interactive terminal or --yes.`);
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(?:es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim());
  } finally {
    prompt.close();
  }
}

async function promptCommitMessage(force, supplied) {
  if (supplied) return supplied;
  if (!process.stdin.isTTY) throw assetError('a commit message is required outside an interactive terminal (--message).');
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const message = (await prompt.question('Commit message: ')).trim();
    if (!message) throw assetError('commit message must not be empty.');
    return message;
  } finally {
    prompt.close();
  }
}

async function seed() {
  const scanned = await scanLocalAssets();
  const objects = {};
  for (const entry of scanned.values()) objects[entry.key] = manifestEntry(entry);
  await writeManifest(objects, REPOSITORY_ROOT, existingManifestState());
  await writeWorkspace(configuredScopes());
  console.log(`Wrote ${ASSET_CONFIG.manifest} with ${Object.keys(objects).length} objects.`);
}

async function verify(options) {
  const manifest = loadAssetManifest(manifestFilePath(REPOSITORY_ROOT, ASSET_CONFIG.manifest));
  const workspace = await loadWorkspace();
  const scopes = options.scope.length ? options.scope : workspace.scopes;
  if (!scopes.length) throw assetError('no managed workspace scope; run assets:pull or assets:seed first.');
  const local = await scanLocalAssets(REPOSITORY_ROOT, scopes);
  if (manifest.state === 'r2' && Array.from(local.values()).some(entry => entry.pointer)) {
    throw assetError('an R2-managed local asset is still a Git LFS pointer; restore it with assets:pull before verifying.');
  }
  const difference = diffManifest(manifest, local, scopes);
  if (difference.uploads.length || difference.deletes.length) throw assetError(`local assets differ from the manifest (${difference.uploads.length} changed, ${difference.deletes.length} missing).`);
  if (options.remote) {
    const client = createR2Client();
    for (const key of Object.keys(manifest.objects).filter(key => scopes.some(scope => keyInScope(key, scope)))) {
      const expected = manifest.objects[key];
      const actual = await client.headObject(key);
      if (actual.size !== expected.size || actual.sha256 !== expected.sha256) throw assetError(`R2 object does not match manifest: ${key}.`);
    }
  }
  console.log(`Verified ${local.size} managed local assets${options.remote ? ' and R2 objects' : ''}.`);
}

async function migrate(options) {
  const allScopes = configuredScopes();
  const scopes = options.scope.length ? options.scope : allScopes;
  if (options.finalize && (scopes.length !== allScopes.length || allScopes.some(scope => !scopes.includes(scope)))) {
    throw assetError('--finalize requires every configured managed prefix.');
  }
  const local = await scanLocalAssets(REPOSITORY_ROOT, scopes);
  const pointers = Array.from(local.values()).filter(entry => entry.pointer);
  if (pointers.length) throw assetError(`${pointers.length} LFS pointer(s) are not hydrated. Hydrate every configured source before migration.`);
  console.log(`Migration will SHA-256 verify ${local.size} local assets against R2.`);
  if (!await confirm('Upload missing or mismatched R2 assets and rewrite the manifest?', options.yes)) return;
  const client = createR2Client();
  const objects = {};
  let uploaded = 0;
  for (const entry of local.values()) {
    let matches = false;
    try {
      const remote = await client.headObject(entry.key);
      matches = remote.size === entry.size && remote.sha256 === entry.sha256;
    } catch (error) {
      if (!String(error.message).includes('404')) throw error;
    }
    if (!matches) {
      await client.uploadFile(entry.key, entry.sourcePath, entry);
      uploaded += 1;
    }
    const verified = await client.headObject(entry.key);
    if (verified.size !== entry.size || verified.sha256 !== entry.sha256) throw assetError(`R2 verification failed for ${entry.key}.`);
    objects[entry.key] = manifestEntry(entry);
  }
  const state = options.finalize ? 'r2' : existingManifestState();
  await writeManifest(objects, REPOSITORY_ROOT, state);
  await writeWorkspace(scopes);
  if (options.finalize) {
    if (!await confirm('Stop Git tracking the verified local binary assets (files stay on disk)?', options.yes)) {
      console.log('Remote migration completed, but the repository remains in legacy mode until tracking is removed.');
      await writeManifest(objects, REPOSITORY_ROOT, 'legacy');
      return;
    }
    await enableR2AssetIgnores();
    command('git', ['rm', '-r', '--cached', '--ignore-unmatch', '--', ...ASSET_CONFIG.managed.map(entry => entry.source)]);
  }
  console.log(`Migration complete: ${uploaded} object(s) uploaded, ${local.size} object(s) verified.`);
}

async function pull(options) {
  const scopes = options.scope.length ? options.scope : configuredScopes();
  const client = createR2Client();
  const manifest = loadAssetManifest(manifestFilePath(REPOSITORY_ROOT, ASSET_CONFIG.manifest));
  for (const scope of scopes) {
    const objects = Object.entries(manifest.objects).filter(([key]) => keyInScope(key, scope));
    if (!objects.length) throw assetError(`asset manifest has no objects under ${scope}.`);
    for (const [relative, expected] of objects) {
      const destination = localDestination(relative);
      if (!destination) throw assetError(`no local destination is configured for ${relative}.`);
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.partial`;
      try {
        await pipeline(await client.getObject(relative), fs.createWriteStream(temporary));
        const stat = await fsp.stat(temporary);
        const digest = await hashFile(temporary);
        if (stat.size !== expected.size || digest !== expected.sha256) {
          throw assetError(`downloaded R2 object does not match manifest: ${relative}.`);
        }
        await fsp.rename(temporary, destination);
      } catch (error) {
        await fsp.unlink(temporary).catch(() => undefined);
        throw error;
      }
      console.log(`Downloaded ${relative}`);
    }
  }
  const workspace = await loadWorkspace();
  await writeWorkspace([...workspace.scopes, ...scopes]);
}

async function publish(options) {
  const gitConfig = ASSET_CONFIG.publish.git;
  const branch = gitConfig && (gitConfig.branch || command('git', ['branch', '--show-current'], { stdio: 'pipe' }).trim());
  if (gitConfig && gitConfig.remote && branch) {
    command('git', ['fetch', gitConfig.remote, branch], { stdio: 'inherit' });
    const divergence = command('git', ['rev-list', '--left-right', '--count', `${branch}...${gitConfig.remote}/${branch}`], { stdio: 'pipe' }).trim().split(/\s+/).map(Number);
    if (divergence[1] > 0) throw assetError(`${branch} is behind ${gitConfig.remote}/${branch}; update the checkout before publishing.`);
  }
  const workspace = await loadWorkspace();
  const scopes = options.scope.length ? options.scope : workspace.scopes;
  if (!scopes.length) throw assetError('no managed workspace scope; run assets:pull or assets:seed first.');
  const manifest = loadAssetManifest(manifestFilePath(REPOSITORY_ROOT, ASSET_CONFIG.manifest));
  const local = await scanLocalAssets(REPOSITORY_ROOT, scopes);
  if (manifest.state === 'r2' && Array.from(local.values()).some(entry => entry.pointer)) {
    throw assetError('an R2-managed local asset is still a Git LFS pointer; restore it with assets:pull before publishing.');
  }
  const changes = diffManifest(manifest, local, scopes);
  console.log(`Assets: ${changes.uploads.length} upload/update, ${changes.deletes.length} delete.`);
  for (const entry of changes.uploads) console.log(`  upload ${entry.key}`);
  for (const key of changes.deletes) console.log(`  delete ${key}`);
  if (options.dryRun) return;
  if ((changes.uploads.length || changes.deletes.length) && !await confirm('Apply this R2 asset change?', options.yes)) {
    console.log('Cancelled.');
    return;
  }
  const objects = { ...manifest.objects };
  if (changes.uploads.length || changes.deletes.length) {
    const client = createR2Client();
    for (const entry of changes.uploads) {
      if (entry.pointer) throw assetError(`${entry.key} is an LFS pointer; hydrate its actual content before publishing.`);
      await client.uploadFile(entry.key, entry.sourcePath, entry);
      const actual = await client.headObject(entry.key);
      if (actual.size !== entry.size || actual.sha256 !== entry.sha256) throw assetError(`R2 verification failed for ${entry.key}.`);
      objects[entry.key] = manifestEntry(entry);
    }
    for (const key of changes.deletes) {
      await client.deleteObject(key);
      delete objects[key];
    }
  }
  if (changes.uploads.length || changes.deletes.length) await writeManifest(objects, REPOSITORY_ROOT, manifest.state);
  for (const check of ASSET_CONFIG.publish.checks) command(check.command, check.args);
  if (options.noGit || !gitConfig) return;
  if (gitConfig.stage) command('git', ['add', '-A']);
  const staged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: REPOSITORY_ROOT });
  if (staged.status === 0) {
    console.log('No tracked changes to commit.');
    return;
  }
  if (!gitConfig.commit) {
    if (gitConfig.push) command('git', ['push', gitConfig.remote, branch]);
    return;
  }
  if (!await confirm(`Commit${gitConfig.push ? ' and push' : ''} all staged non-ignored changes?`, options.yes)) {
    console.log('R2 assets are updated; Git changes remain staged.');
    return;
  }
  const message = await promptCommitMessage(options.yes, options.message);
  command('git', ['commit', '-m', message]);
  if (gitConfig.push) command('git', ['push', gitConfig.remote, branch]);
}

async function deleteAsset(options) {
  if (!options.key) throw assetError('delete requires --key <R2 object key>.');
  const key = normaliseObjectKey(options.key);
  if (!await confirm(`Delete ${key} from R2 and the manifest?`, options.yes)) return;
  const manifest = loadAssetManifest(manifestFilePath(REPOSITORY_ROOT, ASSET_CONFIG.manifest));
  if (!manifest.objects[key]) throw assetError(`${key} is not in the manifest.`);
  await createR2Client().deleteObject(key);
  const objects = { ...manifest.objects };
  delete objects[key];
  await writeManifest(objects, REPOSITORY_ROOT, manifest.state);
  console.log(`Deleted ${key}; run hexo-sil-assets publish to validate the updated manifest.`);
}

function mode() {
  const manifest = loadAssetManifest(manifestFilePath(REPOSITORY_ROOT, ASSET_CONFIG.manifest));
  console.log(`Asset pipeline mode: ${manifest.state}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `mode=${manifest.state}\n`);
}

function parseArguments(argv) {
  const [commandName = '', ...rest] = argv;
  const options = { scope: [], dryRun: false, remote: false, yes: false, noGit: false, finalize: false, key: '', message: '', root: '', configFile: '' };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === '--scope' || value === '--prefix') options.scope.push(safeRelative(rest[++index], value));
    else if (value === '--root') options.root = rest[++index] || '';
    else if (value === '--config') options.configFile = rest[++index] || '';
    else if (value === '--key') options.key = rest[++index];
    else if (value === '--message') options.message = rest[++index] || '';
    else if (value === '--dry-run') options.dryRun = true;
    else if (value === '--remote') options.remote = true;
    else if (value === '--yes') options.yes = true;
    else if (value === '--no-git') options.noGit = true;
    else if (value === '--finalize') options.finalize = true;
    else throw assetError(`unknown argument ${value}.`);
  }
  return { commandName, options };
}

async function main(argv = process.argv.slice(2)) {
  const { commandName, options } = parseArguments(argv);
  configureRuntime(options);
  if (commandName === 'seed') return seed();
  if (commandName === 'verify') return verify(options);
  if (commandName === 'pull') return pull(options);
  if (commandName === 'publish') return publish(options);
  if (commandName === 'migrate') return migrate(options);
  if (commandName === 'delete') return deleteAsset(options);
  if (commandName === 'mode') return mode();
  throw assetError('use one of: seed, verify, pull, publish, migrate, delete, mode.');
}

if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = {
  AUDIO_EXTENSIONS,
  DEFAULT_MANIFEST_PATH,
  R2_ASSET_IGNORE_RULES,
  diffManifest,
  enableR2AssetIgnores,
  formatDuration,
  inspectFile,
  lfsPointer,
  mimeType,
  parseArguments,
  configureRuntime,
  scanLocalAssets,
  seed
};
