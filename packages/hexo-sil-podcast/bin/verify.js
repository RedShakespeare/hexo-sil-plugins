#!/usr/bin/env node
'use strict';

const { main } = require('../lib/verify');

main(process.argv).catch(error => {
  console.error(`Podcast verification failed: ${error.message}`);
  process.exitCode = 1;
});
