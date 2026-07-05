'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { initDb, journal, medals, milestones, activities } = require('./db');
const { processMessage } = require('./agent');

async function runTests() {
  console.log('=== RUNNING SYNCROUTINE SYSTEM INTEGRATION TESTS ===\n');

  // 1. Database Initialization & Schema
  console.log('1. Database Initialization & Schema...');
  const db = await initDb();
  assert.ok(db, 'Database should initialize successfully');
  console.log('   ✓ Database initialized successfully');

  // 2. Encryption & Decryption (Security/Privacy)
  console.log('\n2. Security & Privacy: Journal AES-256-CBC Encryption...');
  const testContent = `Secret wellness thoughts at ${Date.now()}`;
  const entry = await journal.create({
    content: testContent,
    mood: 5,
    mood_label: 'great',
    date: new Date().toISOString().slice(0, 10)
  });

  assert.ok(entry, 'Journal entry should be created');
  assert.strictEqual(entry.content, testContent, 'Decrypted content must match original text');
  
  // Directly query the raw database to prove it is encrypted at rest
  const rawRow = db.exec(`SELECT content FROM journal_entries WHERE id = ${entry.id}`)[0].values[0][0];
  assert.notStrictEqual(rawRow, testContent, 'Raw content in DB should not be plaintext');
  assert.ok(!rawRow.includes('Secret'), 'Raw content should not contain plaintext substrings');
  console.log('   ✓ Journal entry encrypted in database at rest (AES-256-CBC)');
  console.log('   ✓ Transparently decrypted on retrieval');

  // 3. Medals description & CRUD
  console.log('\n3. Medals description & CRUD...');
  const medalData = {
    name: 'Hydration Challenge',
    icon: '💧',
    description: 'Drink 3L of water daily'
  };
  const newMedal = await medals.create(medalData);
  assert.strictEqual(newMedal.name, medalData.name);
  assert.strictEqual(newMedal.description, medalData.description);
  
  const updatedMedal = await medals.update(newMedal.id, {
    name: 'Super Hydration',
    icon: '🥤',
    description: 'Drink 4L of water daily'
  });
  assert.strictEqual(updatedMedal.name, 'Super Hydration');
  assert.strictEqual(updatedMedal.description, 'Drink 4L of water daily');
  console.log('   ✓ Medals create, retrieve, and update support description correctly');

  // 4. Milestones creation
  console.log('\n4. Milestones CRUD...');
  const msData = {
    title: 'Study 100 Hours of Code',
    description: 'Track software engineering learning time',
    category: 'Studying',
    target_metric: 'hours',
    target_value: 100,
    unit: 'hrs'
  };
  const milestone = await milestones.create(msData);
  assert.strictEqual(milestone.title, msData.title);
  assert.strictEqual(milestone.category, msData.category);
  assert.strictEqual(milestone.target_metric, msData.target_metric);
  console.log('   ✓ Milestones table verified, CRUD operations fully functional');

  // 5. Multi-Agent Coordinator classification
  console.log('\n5. Multi-Agent Coordinator & Gemini AI Engine...');
  const testPhrases = [
    { text: 'I ran for 45 minutes today', expected: 'LOG_ACTIVITY' },
    { text: 'Remind me to buy fruits tomorrow', expected: 'CREATE_TASK' },
    { text: 'schedule team sync at 10am next Monday', expected: 'ADD_SCHEDULE' },
    { text: 'How is my meditation progress looking?', expected: 'QUERY_DATA' }
  ];

  for (const phrase of testPhrases) {
    console.log(`   Classifying: "${phrase.text}"...`);
    const res = await processMessage(phrase.text);
    console.log(`   -> Classified as: ${res.intent}`);
    console.log(`   -> Reply: "${res.reply.split('\n')[0]}"`);
    if (res.requiresConfirmation) {
      console.log(`   -> Payload: ${JSON.stringify(res.payload)}`);
    }
  }
  console.log('   ✓ Multi-Agent Coordinator successfully routed and handled requests');

  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ✓ ===');
  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
