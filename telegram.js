/**
 * telegram.js — Telegram bot (polling mode, no webhook needed)
 */

'use strict';
require('dotenv').config();
const { processMessage, transcribeAudio, INTENTS } = require('./agent');
const { activities, tasks, schedules, journal, medals } = require('./db');
const { syncToGCS } = require('./gcs');
const https = require('https');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const pending = new Map(); // chatId → { intent, payload }

function initTelegram() {
  if (!TOKEN) { console.warn('[Telegram] No BOT_TOKEN — bot disabled.'); return; }
  try {
    const TelegramBot = require('node-telegram-bot-api');
    const bot = new TelegramBot(TOKEN, { polling: true });
    console.log('[Telegram] Bot polling started ✓');

    // /start
    bot.onText(/\/start/, async (msg) => {
      const name = msg.from.first_name || 'there';
      await bot.sendMessage(msg.chat.id,
        `👋 Hi ${name}! I'm *SyncRoutine* — your AI wellness concierge.\n\n` +
        `Try sending:\n• _"I worked out for 45 minutes"_\n• _"Schedule dentist at 2pm tomorrow"_\n• _"Add task: buy groceries"_\n• A voice note 🎙️`,
        { parse_mode: 'Markdown' }
      );
    });

    // Text messages
    bot.on('message', async (msg) => {
      if (msg.voice || !msg.text || msg.text.startsWith('/')) return;
      const chatId = msg.chat.id;
      await bot.sendChatAction(chatId, 'typing');
      const res = await processMessage(msg.text);
      if (res.requiresConfirmation) {
        pending.set(chatId, { intent: res.intent, payload: res.payload });
        await bot.sendMessage(chatId, res.reply, {
          reply_markup: { inline_keyboard: [[
            { text: '✅ Yes, save it', callback_data: 'confirm' },
            { text: '❌ Cancel',       callback_data: 'cancel'  },
          ]] },
        });
      } else {
        await bot.sendMessage(chatId, res.reply);
      }
    });

    // Voice messages
    bot.on('voice', async (msg) => {
      const chatId = msg.chat.id;
      await bot.sendMessage(chatId, '🎙️ Transcribing...');
      const fileInfo = await bot.getFile(msg.voice.file_id);
      const buf = await downloadBuffer(`https://api.telegram.org/file/bot${TOKEN}/${fileInfo.file_path}`);
      const transcript = await transcribeAudio(buf, 'audio/ogg');
      if (!transcript) return bot.sendMessage(chatId, '⚠️ Transcription failed — add your GEMINI_API_KEY.');
      await bot.sendMessage(chatId, `📝 Heard: _"${transcript}"_`, { parse_mode: 'Markdown' });
      const res = await processMessage(transcript);
      if (res.requiresConfirmation) {
        pending.set(chatId, { intent: res.intent, payload: res.payload });
        await bot.sendMessage(chatId, res.reply, {
          reply_markup: { inline_keyboard: [[
            { text: '✅ Yes, save it', callback_data: 'confirm' },
            { text: '❌ Cancel',       callback_data: 'cancel'  },
          ]] },
        });
      } else {
        await bot.sendMessage(chatId, res.reply);
      }
    });

    // Callbacks
    bot.on('callback_query', async (q) => {
      const chatId = q.message.chat.id;
      await bot.answerCallbackQuery(q.id);
      if (q.data === 'cancel') {
        pending.delete(chatId);
        return bot.sendMessage(chatId, '❌ Cancelled.');
      }
      const p = pending.get(chatId);
      if (!p) return bot.sendMessage(chatId, '⚠️ No pending action. Please try again.');
      try {
        switch (p.intent) {
          case INTENTS.LOG_ACTIVITY:  activities.create(p.payload); break;
          case INTENTS.CREATE_TASK:   tasks.create(p.payload); break;
          case INTENTS.ADD_SCHEDULE:  schedules.create(p.payload); break;
          case INTENTS.LOG_JOURNAL:   journal.create(p.payload); break;
          case INTENTS.LOG_MEDAL: {
            const all  = medals.getAll();
            const m = all.find(x => x.name.toLowerCase() === (p.payload.name || '').toLowerCase());
            m ? medals.logToday(m.id) : medals.create(p.payload);
            break;
          }
        }
        syncToGCS();
        pending.delete(chatId);
        await bot.sendMessage(chatId, '✅ Saved! Open the web app to see your updated dashboard.');
      } catch (err) {
        await bot.sendMessage(chatId, '⚠️ Save failed. Please try again.');
      }
    });

  } catch (err) {
    console.error('[Telegram] Init error:', err.message);
  }
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

module.exports = { initTelegram };
