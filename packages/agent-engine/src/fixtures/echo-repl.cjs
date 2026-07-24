#!/usr/bin/env node
'use strict';
const readline = require('node:readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
process.stdout.write('ready\n');
rl.on('line', (l) => {
  process.stdout.write(`echo:${l}\n`);
  if (l.trim() === 'quit') process.exit(0);
});
