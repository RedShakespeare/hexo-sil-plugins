#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadAssetsConfig } = require('../lib/config');

const ZERO_SHA = /^0+$/;

function syncError(message) {
  return new Error(`R2 asset sync: ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: options.encoding || 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe']
  });
  if (result.error) throw syncError(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    throw syncError(`${command} ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return result.stdout;
}

function runtime(options = {}) {
  const config = loadAssetsConfig(options.root || process.cwd(), options.configFile);
  if (!config.legacySync) throw syncError('legacySync is not configured.');
  if (!config.legacySync.remote) throw syncError('legacySync.remote is required.');
  return { root: config.root, ...config.legacySync };
}

function gitCommitExists(revision, cwd = process.cwd()) {
  if (!revision || ZERO_SHA.test(revision)) return false;
  return spawnSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], { cwd, stdio: 'ignore' }).status === 0;
}

function parseDiff(base, head, settings) {
  const source = settings.source.replace(/\/+$/, '');
  const output = run('git', ['diff', '--name-status', '-z', '--find-renames', base, head, '--', source], { cwd: settings.root, encoding: 'buffer' });
  const fields = output.toString('utf8').split('\0');
  const uploads = new Set();
  const deletes = new Set();
  for (let index = 0; index < fields.length - 1;) {
    const status = fields[index++];
    if (!status) continue;
    const code = status[0];
    if (code === 'R' || code === 'C') {
      const oldPath = fields[index++];
      const newPath = fields[index++];
      if (code === 'R' && (oldPath === source || oldPath.startsWith(`${source}/`))) deletes.add(oldPath);
      if (newPath === source || newPath.startsWith(`${source}/`)) uploads.add(newPath);
      continue;
    }
    const filename = fields[index++];
    if (!filename || (filename !== source && !filename.startsWith(`${source}/`))) continue;
    if (code === 'D') deletes.add(filename);
    else uploads.add(filename);
  }
  for (const filename of uploads) deletes.delete(filename);
  return { uploads: [...uploads].sort(), deletes: [...deletes].sort() };
}

function hasImplementationChanges(base, head, settings) {
  if (!settings.implementationInputs.length) return false;
  return run('git', ['diff', '--name-only', base, head, '--', ...settings.implementationInputs], { cwd: settings.root }).trim().length > 0;
}

function collectChanges(base, head, settings) {
  return { ...parseDiff(base, head, settings), implementationChanged: hasImplementationChanges(base, head, settings) };
}

function requestedMode(env = process.env) {
  const mode = env.SYNC_MODE || 'incremental';
  if (!['incremental', 'full'].includes(mode)) throw syncError(`SYNC_MODE must be incremental or full, received ${mode}`);
  return mode;
}

function detectMode(settings, env = process.env) {
  if (requestedMode(env) === 'full') return 'full';
  const base = env.GITHUB_EVENT_BEFORE;
  const head = env.GITHUB_SHA || 'HEAD';
  if (!gitCommitExists(base, settings.root) || !gitCommitExists(head, settings.root)) return 'full';
  const changes = collectChanges(base, head, settings);
  if (changes.implementationChanged) return 'full';
  return changes.uploads.length || changes.deletes.length ? 'incremental' : 'none';
}

function isLfsPointer(filename, cwd) {
  const target = path.resolve(cwd, filename);
  if (!fs.existsSync(target)) return false;
  const descriptor = fs.openSync(target, 'r');
  try {
    const buffer = Buffer.alloc(128);
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1\n');
  } finally {
    fs.closeSync(descriptor);
  }
}

function objectPath(sourcePath, source = 'source/files') {
  const prefix = `${source.replace(/\/+$/, '')}/`;
  if (!sourcePath.startsWith(prefix)) throw syncError(`unexpected source path ${sourcePath}`);
  return sourcePath.slice(prefix.length);
}

function hydrate(paths, mode, settings) {
  run('git', ['lfs', 'install', '--local'], { cwd: settings.root, stdio: 'inherit' });
  if (mode === 'full') {
    run('git', ['lfs', 'pull', `--include=${settings.source}/**`], { cwd: settings.root, stdio: 'inherit' });
    return;
  }
  for (const filename of paths) {
    if (isLfsPointer(filename, settings.root)) run('git', ['lfs', 'pull', `--include=${filename}`], { cwd: settings.root, stdio: 'inherit' });
  }
}

function sync(mode, settings, env = process.env) {
  const base = env.GITHUB_EVENT_BEFORE;
  const head = env.GITHUB_SHA || 'HEAD';
  const changes = mode === 'incremental' ? collectChanges(base, head, settings) : { uploads: [], deletes: [] };
  hydrate(changes.uploads, mode, settings);
  run('rclone', ['lsf', settings.remote, '--max-depth', '1'], { cwd: settings.root, stdio: 'inherit' });
  if (mode === 'full') {
    run('rclone', ['sync', settings.source, settings.remote, '--fast-list', '--delete-during', '--progress'], { cwd: settings.root, stdio: 'inherit' });
    return;
  }
  for (const filename of changes.uploads) {
    if (!fs.existsSync(path.resolve(settings.root, filename))) throw syncError(`changed asset no longer exists: ${filename}`);
    run('rclone', ['copyto', filename, `${settings.remote}/${objectPath(filename, settings.source)}`, '--progress'], { cwd: settings.root, stdio: 'inherit' });
  }
  for (const filename of changes.deletes) run('rclone', ['deletefile', `${settings.remote}/${objectPath(filename, settings.source)}`], { cwd: settings.root, stdio: 'inherit' });
}

function parseArguments(argv) {
  const options = { root: '', configFile: '', detect: false, sync: false, mode: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--root') options.root = argv[++index] || '';
    else if (value === '--config') options.configFile = argv[++index] || '';
    else if (value === '--detect') options.detect = true;
    else if (value === '--sync') options.sync = true;
    else if (value === '--mode') options.mode = argv[++index] || '';
    else throw syncError(`unknown argument ${value}`);
  }
  return options;
}

function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArguments(argv);
  const settings = runtime(options);
  if (options.detect) {
    const mode = detectMode(settings, env);
    console.log(`mode=${mode}`);
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `mode=${mode}\n`);
    return;
  }
  if (options.sync) {
    const mode = options.mode || detectMode(settings, env);
    if (!['incremental', 'full'].includes(mode)) throw syncError(`invalid sync mode ${mode}`);
    sync(mode, settings, env);
    return;
  }
  throw syncError('use --detect or --sync');
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { collectChanges, detectMode, hasImplementationChanges, main, objectPath, parseDiff, requestedMode, runtime, syncError };
