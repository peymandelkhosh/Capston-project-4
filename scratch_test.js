'use strict';
require('dotenv').config();
const { initDb } = require('./db');
const { processMessage } = require('./agent');

async function test() {
  console.log('Initializing DB...');
  await initDb();
  console.log('Testing processMessage...');
  try {
    const res = await processMessage('hello');
    console.log('Result:', JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
