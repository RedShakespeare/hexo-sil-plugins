'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normaliseManifestPath, normaliseObjectKey, normalisePath } = require('./manifest');

const DEFAULT_CONFIG_FILE = 'hexo-sil-assets.config.js';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normaliseManaged(value) {
  const entries = value == null ? [{ prefix: 'files', source: 'source/files', ignore: 'source/files/**' }] : value;
  if (!Array.isArray(entries) || !entries.length) throw new Error('Assets configuration error: managed must be a non-empty array.');
  const prefixes = new Set();
  return entries.map((entry, index) => {
    if (!isObject(entry)) throw new Error(`Assets configuration error: managed[${index}] must be a mapping.`);
    const prefix = normaliseObjectKey(entry.prefix, `managed[${index}].prefix`);
    if (prefixes.has(prefix)) throw new Error(`Assets configuration error: duplicate managed prefix ${prefix}.`);
    prefixes.add(prefix);
    return Object.freeze({
      prefix,
      source: normalisePath(entry.source, `managed[${index}].source`),
      ignore: entry.ignore == null || entry.ignore === '' ? '' : normalisePath(entry.ignore, `managed[${index}].ignore`)
    });
  });
}

function normaliseChecks(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Assets configuration error: publish.checks must be an array.');
  return value.map((check, index) => {
    if (!isObject(check) || typeof check.command !== 'string' || !check.command.trim() || !Array.isArray(check.args)) {
      throw new Error(`Assets configuration error: publish.checks[${index}] must contain command and args.`);
    }
    return Object.freeze({ command: check.command.trim(), args: check.args.map(String) });
  });
}

function normaliseGit(value) {
  if (value == null || value === false) return false;
  if (!isObject(value)) throw new Error('Assets configuration error: publish.git must be false or a mapping.');
  return Object.freeze({
    remote: String(value.remote || 'origin').trim(),
    branch: String(value.branch || '').trim(),
    stage: value.stage !== false,
    commit: value.commit !== false,
    push: value.push !== false
  });
}

function normaliseLegacySync(value) {
  if (value == null || value === false) return null;
  if (!isObject(value)) throw new Error('Assets configuration error: legacySync must be a mapping.');
  const inputs = value.implementationInputs == null ? [] : value.implementationInputs;
  if (!Array.isArray(inputs)) throw new Error('Assets configuration error: legacySync.implementationInputs must be an array.');
  return Object.freeze({
    source: normalisePath(value.source, 'legacySync.source'),
    remote: String(value.remote || '').trim(),
    implementationInputs: inputs.map((item, index) => normalisePath(item, `legacySync.implementationInputs[${index}]`))
  });
}

function loadAssetsConfig(root = process.cwd(), configFile) {
  const projectRoot = path.resolve(root);
  const requested = configFile || DEFAULT_CONFIG_FILE;
  const absolute = path.isAbsolute(requested) ? requested : path.join(projectRoot, requested);
  let raw = {};
  if (fs.existsSync(absolute)) {
    delete require.cache[require.resolve(absolute)];
    raw = require(absolute);
    if (!isObject(raw)) throw new Error('Assets configuration error: config module must export a mapping.');
  }
  const publish = isObject(raw.publish) ? raw.publish : {};
  return Object.freeze({
    root: projectRoot,
    configFile: absolute,
    manifest: normaliseManifestPath(raw.manifest),
    managed: Object.freeze(normaliseManaged(raw.managed)),
    workspace: normalisePath(raw.workspace || '.assets-workspace.json', 'workspace'),
    publish: Object.freeze({ checks: Object.freeze(normaliseChecks(publish.checks)), git: normaliseGit(publish.git) }),
    legacySync: normaliseLegacySync(raw.legacySync)
  });
}

function mappingForKey(config, key) {
  const objectKey = normaliseObjectKey(key);
  return config.managed
    .filter(entry => objectKey === entry.prefix || objectKey.startsWith(`${entry.prefix}/`))
    .sort((left, right) => right.prefix.length - left.prefix.length)[0] || null;
}

module.exports = { DEFAULT_CONFIG_FILE, loadAssetsConfig, mappingForKey, normaliseManaged };
