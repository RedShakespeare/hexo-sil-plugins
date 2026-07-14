'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { objectPath, runtime } = require('../bin/legacy-sync');

test('maps incremental assets beneath the existing R2 files prefix', () => {
  assert.equal(objectPath('source/files/hxh_civ/index.html'), 'hxh_civ/index.html');
  assert.equal(objectPath('source/files/rl/game.zip'), 'rl/game.zip');
});

test('requires explicit legacy sync configuration', () => {
  assert.throws(() => runtime({ root: process.cwd() }), /legacySync is not configured/);
});
