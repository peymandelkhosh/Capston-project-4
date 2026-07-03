/**
 * agent.js — Gemini AI intent engine
 * Classifies user messages into structured intents with payloads.
 * Falls back to regex rules if Gemini is unavailable or API key is missing.
 */

'use strict';
require('dotenv').config();
const { getContextSnapshot } = require('./db');

// ─── Gemini Setup ─────────────────────────────────────────────────────────────

let geminiModel = null;

function getModel() {
  if (geminiModel) return geminiModel;
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.startsWith('YOUR_')) return null;
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(key);
    geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    console.log('[Agent] Gemini 2.5-Flash initialized ✓');
    return geminiModel;
  } catch (err) {
    console.error('[Agent] Gemini init failed:', err.message);
    return null;
  }
}

// ─── Intent Constants ─────────────────────────────────────────────────────────

const INTENTS = {
  LOG_ACTIVITY : 'LOG_ACTIVITY',
  CREATE_TASK  : 'CREATE_TASK',
  ADD_SCHEDULE : 'ADD_SCHEDULE',
  LOG_JOURNAL  : 'LOG_JOURNAL',
  LOG_MEDAL    : 'LOG_MEDAL',
  QUERY_DATA   : 'QUERY_DATA',
  GENERAL_CHAT : 'GENERAL_CHAT',
};

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(context) {
  const today     = new Date().toISOString().slice(0, 10);
  const tomorrow  = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  return `You are SyncRoutine, a friendly AI personal routine and wellness concierge.
Today: ${today}. Tomorrow: ${tomorrow}.

## User Data (last 7 days)
${JSON.stringify(context, null, 2)}

## Your Response Format
Always reply with a single raw JSON object (no markdown, no code fences):
{
  "intent": "<LOG_ACTIVITY | CREATE_TASK | ADD_SCHEDULE | LOG_JOURNAL | LOG_MEDAL | QUERY_DATA | GENERAL_CHAT>",
  "reply": "<warm, concise reply to show in chat>",
  "requiresConfirmation": <true for writes, false for reads/chat>,
  "payload": {
    // LOG_ACTIVITY:  { "type": string, "duration": number (minutes), "notes": string, "date": "YYYY-MM-DD" }
    // CREATE_TASK:   { "title": string, "notes": string, "due_date": "YYYY-MM-DD"|null, "priority": "low|medium|high" }
    // ADD_SCHEDULE:  { "title": string, "time": "HH:MM", "date": "YYYY-MM-DD", "recurrence": "none|daily|weekly", "notes": string }
    // LOG_JOURNAL:   { "content": string, "mood": 1-5, "mood_label": "terrible|bad|neutral|good|great", "date": "YYYY-MM-DD" }
    // LOG_MEDAL:     { "name": string }
    // QUERY_DATA:    {}
    // GENERAL_CHAT:  {}
  }
}

## Rules
- Always set requiresConfirmation: true for LOG_*, CREATE_*, ADD_* intents.
- Convert hours to minutes: "2 hours" = 120.
- Extract relative dates: "today" = ${today}, "tomorrow" = ${tomorrow}.
- If the user asks a question about their data, use QUERY_DATA and answer in the reply field.
- Be warm, encouraging, and brief in replies (2-3 sentences max).`;
}

// ─── Regex Fallback Parser ────────────────────────────────────────────────────

function regexFallback(message) {
  const msg   = message.toLowerCase().trim();
  const today = new Date().toISOString().slice(0, 10);

  // Activity: "logged 30 min reading", "worked out for 1 hour", "studied for 2 hours"
  const actMatch = msg.match(/(\d+)\s*(hour|hr|min|minute)/i);
  if (actMatch && /log|did|work|exercise|study|read|meditat|ran|yoga|cycl/i.test(msg)) {
    const amount   = parseInt(actMatch[1]);
    const isHour   = /hour|hr/i.test(actMatch[2]);
    const duration = isHour ? amount * 60 : amount;
    const type     = /study|studi/i.test(msg) ? 'Studying'
                   : /work/i.test(msg)         ? 'Work'
                   : /exercise|gym/i.test(msg) ? 'Exercise'
                   : /ran|run/i.test(msg)       ? 'Running'
                   : /read/i.test(msg)          ? 'Reading'
                   : /meditat/i.test(msg)       ? 'Meditation'
                   : /yoga/i.test(msg)          ? 'Yoga'
                   : /cycl/i.test(msg)          ? 'Cycling'
                   : 'Other';
    return {
      intent: INTENTS.LOG_ACTIVITY,
      reply: `Got it! I'll log ${duration} minutes of ${type} for today. Confirm to save?`,
      requiresConfirmation: true,
      payload: { type, duration, notes: '', date: today },
    };
  }

  // Task: "add task: ...", "remind me to ...", "todo: ..."
  const taskMatch = msg.match(/(?:add\s+task|remind(?:\s+me)?(?:\s+to)?|todo)[:\s]+(.+)/i);
  if (taskMatch) {
    return {
      intent: INTENTS.CREATE_TASK,
      reply: `I'll create a task: "${taskMatch[1].trim()}". Confirm to save?`,
      requiresConfirmation: true,
      payload: { title: taskMatch[1].trim(), notes: '', due_date: null, priority: 'medium' },
    };
  }

  // Schedule: "schedule ...", "set meeting at ..."
  const schedMatch = msg.match(/(?:schedule|set\s+(?:a\s+)?(?:meeting|event|alarm|appointment))[:\s]+(.+)/i);
  if (schedMatch) {
    return {
      intent: INTENTS.ADD_SCHEDULE,
      reply: `I'll schedule "${schedMatch[1].trim()}". Confirm to save?`,
      requiresConfirmation: true,
      payload: { title: schedMatch[1].trim(), time: '09:00', date: today, recurrence: 'none', notes: '' },
    };
  }

  // Journal: "feeling ...", "today was ..."
  if (/feel|mood|today was|i am|i'm|journa/i.test(msg)) {
    return {
      intent: INTENTS.LOG_JOURNAL,
      reply: `I'll save this as a journal entry. Confirm to save?`,
      requiresConfirmation: true,
      payload: { content: message, mood: 3, mood_label: 'neutral', date: today },
    };
  }

  return {
    intent: INTENTS.GENERAL_CHAT,
    reply: "I'm here to help! Try: 'Log 30 min reading', 'Schedule meeting at 3pm', 'Add task: call doctor', or 'How many activities this week?'",
    requiresConfirmation: false,
    payload: {},
  };
}

// ─── Main Process Function ────────────────────────────────────────────────────

async function processMessage(userMessage) {
  const model = getModel();

  if (!model) {
    console.log('[Agent] No Gemini key — using regex fallback');
    return regexFallback(userMessage);
  }

  try {
    const context = getContextSnapshot();
    const prompt  = buildSystemPrompt(context);

    const result  = await model.generateContent([prompt, '\n\nUser message: ' + userMessage]);
    const text    = result.response.text().trim();

    // Strip markdown code fences if model adds them
    const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    const parsed  = JSON.parse(cleaned);

    if (!parsed.intent || !parsed.reply) throw new Error('Missing required fields');
    return parsed;

  } catch (err) {
    console.error('[Agent] Gemini error, using fallback:', err.message);
    return regexFallback(userMessage);
  }
}

// ─── Voice Transcription ──────────────────────────────────────────────────────

async function transcribeAudio(audioBuffer, mimeType = 'audio/webm') {
  const model = getModel();
  if (!model) return null;
  try {
    const result = await model.generateContent([
      { text: 'Transcribe this audio accurately. Return only the spoken words, nothing else.' },
      { inlineData: { mimeType, data: audioBuffer.toString('base64') } },
    ]);
    return result.response.text().trim();
  } catch (err) {
    console.error('[Agent] Transcription error:', err.message);
    return null;
  }
}

module.exports = { processMessage, transcribeAudio, INTENTS };
