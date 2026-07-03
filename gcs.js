/**
 * gcs.js — Google Cloud Storage sync layer (optional)
 * Gracefully no-ops if GCS_BUCKET is not configured.
 */

'use strict';
require('dotenv').config();
const path = require('path');
const { DB_PATH } = require('./db');

const BUCKET_NAME = process.env.GCS_BUCKET;
const KEY_FILE    = process.env.GCS_KEY_FILE;
const PROJECT_ID  = process.env.GCS_PROJECT_ID;
const GCS_OBJECT  = 'syncroutine.db';

let bucket = null;

function initGCS() {
  if (!BUCKET_NAME || !KEY_FILE || !PROJECT_ID) {
    console.log('[GCS] Not configured — running with local storage only.');
    return;
  }
  try {
    const { Storage } = require('@google-cloud/storage');
    const storage = new Storage({ projectId: PROJECT_ID, keyFilename: KEY_FILE });
    bucket = storage.bucket(BUCKET_NAME);
    console.log(`[GCS] Connected to bucket: ${BUCKET_NAME} ✓`);
  } catch (err) {
    console.warn('[GCS] Init failed (local only):', err.message);
    bucket = null;
  }
}

async function syncToGCS() {
  if (!bucket) return;
  try {
    await bucket.upload(DB_PATH, { destination: GCS_OBJECT });
  } catch (err) {
    console.error('[GCS] Sync failed:', err.message);
  }
}

async function restoreFromGCS() {
  if (!bucket) return;
  const fs = require('fs');
  if (fs.existsSync(DB_PATH)) return;
  try {
    console.log('[GCS] Restoring database from cloud...');
    await bucket.file(GCS_OBJECT).download({ destination: DB_PATH });
    console.log('[GCS] Database restored ✓');
  } catch (err) {
    if (err.code === 404) console.log('[GCS] No cloud backup found, starting fresh.');
    else console.error('[GCS] Restore failed:', err.message);
  }
}

initGCS();

module.exports = { syncToGCS, restoreFromGCS };
