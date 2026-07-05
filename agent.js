/**
 * agent.js — Multi-Agent Coordinator System
 *
 * Architecture:
 *   1. COORDINATOR AGENT  — classifies intent, routes to the right sub-agent.
 *   2. CONCIERGE AGENT    — handles all write intents (LOG_*, CREATE_*, ADD_*).
 *                           Always sets requiresConfirmation: true.
 *   3. ANALYTICS AGENT    — handles QUERY_DATA / GENERAL_CHAT.
 *                           Appends a "Daily AI & Tech News Briefing" section.
 *                           Always sets requiresConfirmation: false.
 *
 * All Gemini calls use responseMimeType: "application/json" (JSON Mode) so the
 * SDK guarantees a parseable JSON string without needing fence-stripping.
 * The existing regexFallback is preserved unchanged as the graceful degradation path.
 */

'use strict';
require('dotenv').config();
const { getContextSnapshot } = require('./db');

// ─── Gemini Model Factory ──────────────────────────────────────────────────────
//
// We keep one GoogleGenerativeAI instance but create two distinct model handles:
//   • jsonModel  — JSON Mode (responseMimeType: application/json) for the
//                  Coordinator and Concierge, where the full structured envelope
//                  must be returned.
//   • textModel  — plain text, used by the Analytics agent (which builds the
//                  reply string itself and wraps it in the envelope in JS) and
//                  by the voice transcription function.

let _genAI     = null;   // shared GoogleGenerativeAI instance
let _jsonModel = null;   // gemini model configured for JSON output
let _textModel = null;   // gemini model configured for plain text output

function getGenAI() {
  if (_genAI) return _genAI;
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.startsWith('YOUR_')) return null;
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    _genAI = new GoogleGenerativeAI(key);
    console.log('[Agent] Gemini client initialized ✓');
    return _genAI;
  } catch (err) {
    console.error('[Agent] Gemini init failed:', err.message);
    return null;
  }
}

function getJsonModel() {
  if (_jsonModel) return _jsonModel;
  const genAI = getGenAI();
  if (!genAI) return null;
  _jsonModel = genAI.getGenerativeModel({
    model            : 'gemini-2.5-flash',
    generationConfig : { responseMimeType: 'application/json' },
  });
  console.log('[Agent] Gemini JSON-mode model ready ✓');
  return _jsonModel;
}

function getTextModel() {
  if (_textModel) return _textModel;
  const genAI = getGenAI();
  if (!genAI) return null;
  _textModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  return _textModel;
}

// ─── Intent Constants ─────────────────────────────────────────────────────────

const INTENTS = {
  LOG_ACTIVITY : 'LOG_ACTIVITY',
  CREATE_TODO  : 'CREATE_TODO',
  ADD_SCHEDULE : 'ADD_SCHEDULE',
  LOG_JOURNAL  : 'LOG_JOURNAL',
  LOG_MEDAL    : 'LOG_MEDAL',
  CREATE_MILESTONE : 'CREATE_MILESTONE',
  QUERY_DATA   : 'QUERY_DATA',
  GENERAL_CHAT : 'GENERAL_CHAT',
};

const WRITE_INTENTS = new Set([
  INTENTS.LOG_ACTIVITY,
  INTENTS.CREATE_TODO,
  INTENTS.ADD_SCHEDULE,
  INTENTS.LOG_JOURNAL,
  INTENTS.LOG_MEDAL,
  INTENTS.CREATE_MILESTONE,
]);

// ─── JSON Schema Instruction (shared by Coordinator + Concierge) ──────────────

const JSON_SCHEMA_BLOCK = `
## Required JSON Response Schema
Respond with ONLY a single valid JSON object matching this exact schema:
{
  "intent": "<LOG_ACTIVITY | CREATE_TODO | ADD_SCHEDULE | LOG_JOURNAL | LOG_MEDAL | CREATE_MILESTONE | QUERY_DATA | GENERAL_CHAT>",
  "reply": "<string — the assistant reply shown in the chat UI>",
  "requiresConfirmation": <boolean>,
  "payload": {
    // LOG_ACTIVITY : { "type": string, "duration": number (minutes), "notes": string, "date": "YYYY-MM-DD", "time": "HH:MM" (optional) }
    // CREATE_TODO  : { "title": string, "description": string, "estimated_duration": number, "deadline": "YYYY-MM-DDTHH:MM", "extra_notes": string }
    // ADD_SCHEDULE : { "title": string, "time": "HH:MM", "date": "YYYY-MM-DD", "recurrence": "none|daily|weekly", "notes": string }
    // LOG_JOURNAL  : { "content": string, "mood": 1-5, "mood_label": "terrible|bad|neutral|good|great", "date": "YYYY-MM-DD" }
    // LOG_MEDAL    : { "name": string, "icon": string, "description": string }
    // CREATE_MILESTONE : { "title": string, "description": string, "category": "Health|Fitness|Productivity|Mindfulness|Other", "target_metric": string, "target_value": number, "unit": string }
    // QUERY_DATA / GENERAL_CHAT : {}
  }
}
No markdown, no code fences, no extra keys. Pure JSON only.`;

// ─── Agent 1 · COORDINATOR ────────────────────────────────────────────────────
//
// Single responsibility: classify the intent. Returns the intent string.
// Uses JSON mode so the response is always parseable.

async function runCoordinator(userMessage, context, today, tomorrow) {
  const model = getJsonModel();
  if (!model) return null;

  const prompt = `You are the SyncRoutine Coordinator Agent.
Today: ${today}. Tomorrow: ${tomorrow}.

Your ONLY job is to classify the user's intent into exactly one of these values:
  LOG_ACTIVITY, CREATE_TODO, ADD_SCHEDULE, LOG_JOURNAL, LOG_MEDAL, CREATE_MILESTONE, QUERY_DATA, GENERAL_CHAT

Recent user context (last 7 days):
${JSON.stringify(context, null, 2)}

${JSON_SCHEMA_BLOCK}

Classification rules:
- LOG_ACTIVITY  → user logged physical or mental activity (exercise, study, read, meditate, work, yoga, cycling)
- CREATE_TODO   → user wants to add a pending task, to-do item, or reminder (e.g. "remind me to...", "todo:", "task:")
- ADD_SCHEDULE  → user wants to schedule an event, meeting, or appointment
- LOG_JOURNAL   → user expresses feelings, mood, or wants to journal
- LOG_MEDAL     → user logs a habit/medal streak or wants to create a new medal
- CREATE_MILESTONE → user wants to create a new milestone or goal
- QUERY_DATA    → user asks a question about their own logged data or statistics
- GENERAL_CHAT  → everything else (greetings, advice questions, general AI/tech queries)

Set "reply" to an empty string "". Set "requiresConfirmation" to false. Set "payload" to {}.
The sub-agents will fill in reply, requiresConfirmation, and payload.

User message: "${userMessage}"`;

  const result  = await model.generateContent(prompt);
  const parsed  = JSON.parse(result.response.text());
  return parsed.intent || null;
}

// ─── Agent 2 · CONCIERGE (Write Handler) ─────────────────────────────────────
//
// Persona: warm, supportive, extremely concise (1-2 sentences).
// Validates params, constructs payload, sets requiresConfirmation: true.

async function runConcierge(intent, userMessage, context, today, tomorrow) {
  const model = getJsonModel();
  if (!model) return null;

  const prompt = `You are the SyncRoutine Concierge Agent — warm, supportive, and concise.
Today: ${today}. Tomorrow: ${tomorrow}.

The user wants to perform a "${intent}" action.

User message: "${userMessage}"

Recent context:
${JSON.stringify(context, null, 2)}

${JSON_SCHEMA_BLOCK}

Concierge rules:
- Set "intent" to exactly: ${intent}
- ALWAYS set "requiresConfirmation": true — the user will confirm before the data is saved.
- Keep "reply" to 1-2 warm, encouraging sentences. End with something like "Ready to save!"
- Convert hours to minutes for duration fields: "2 hours" → 120.
- Resolve relative dates: "today" → ${today}, "tomorrow" → ${tomorrow}.
- Payload field rules:
    LOG_ACTIVITY : type must be one of: Exercise, Running, Studying, Reading, Meditation, Work, Yoga, Cycling, Other. If user mentions a specific time, format it as "HH:MM" in the "time" field.
    CREATE_TODO  : estimated_duration is a number in minutes
    ADD_SCHEDULE : time in 24h HH:MM format; recurrence is "none", "daily", or "weekly"
    LOG_JOURNAL  : mood integer 1-5; mood_label matches mood (1=terrible,2=bad,3=neutral,4=good,5=great)
    LOG_MEDAL    : name is the habit/medal name string, icon is a single emoji, description is a short description
    CREATE_MILESTONE : title is the milestone title, category is Health/Fitness/Productivity/Mindfulness/Other, target_metric is what to track, target_value is numeric, unit is the metric unit
- If any required field cannot be confidently inferred from the user message, use a sensible default.`;

  const result = await model.generateContent(prompt);
  const parsed = JSON.parse(result.response.text());

  // Enforce invariants regardless of model output
  parsed.intent                = intent;
  parsed.requiresConfirmation  = true;
  if (!parsed.payload) parsed.payload = {};

  return parsed;
}

// ─── Agent 3 · ANALYTICS & BRIEFING (Read/Chat Handler) ──────────────────────
//
// Persona: analytical, encouraging, informative.
// Computes wellness summaries from context + appends a Daily AI & Tech News Briefing.
// Sets requiresConfirmation: false.

async function runAnalytics(intent, userMessage, context, today, tomorrow) {
  const model = getTextModel();
  if (!model) return null;

  const prompt = `You are the SyncRoutine Analytics & Briefing Agent — analytical, encouraging, and informative.
Today: ${today}. Tomorrow: ${tomorrow}.

Intent classified as: ${intent}
User message: "${userMessage}"

## User's Wellness Context (last 7 days)
${JSON.stringify(context, null, 2)}

## Your Task
1. Answer the user's question or provide a helpful wellness summary/insight from the context data above.
   - If QUERY_DATA: compute relevant stats (averages, totals, streaks) from the data and answer directly.
   - If GENERAL_CHAT: give a helpful, brief, encouraging response.
   - Keep your main response to 3-5 sentences maximum.

2. MANDATORY: At the end of your response, append this exact section (with the header):

---
📡 Daily AI & Tech News Briefing
• [First AI/tech breakthrough headline and 1-sentence description]
• [Second AI/tech breakthrough headline and 1-sentence description]

Use realistic, plausible, exciting AI or tech breakthroughs (can be recent real events or near-future plausible ones).
Return ONLY plain text — no JSON, no code fences. This is the reply string only.`;

  const result     = await model.generateContent(prompt);
  const replyText  = result.response.text().trim();

  // Wrap the text reply into the standard envelope in JavaScript
  return {
    intent               : intent,
    reply                : replyText,
    requiresConfirmation : false,
    payload              : {},
  };
}

// ─── Regex Fallback Parser ────────────────────────────────────────────────────
// Kept entirely intact and unchanged from the original implementation.

function regexFallback(message) {
  const msg   = message.toLowerCase().trim();
  const today = new Date().toISOString().slice(0, 10);

  // Activity: "logged 30 min reading at 5pm", "worked out for 1 hour"
  const actMatch = msg.match(/(\d+)\s*(hour|hr|min|minute)/i);
  const timeMatch = msg.match(/at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
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
    
    // Simplistic time formatting for the regex fallback
    let time = null;
    if (timeMatch) {
      let tStr = timeMatch[1].toLowerCase().replace(/\s/g, '');
      let hr = parseInt(tStr);
      if (tStr.includes('pm') && hr !== 12) hr += 12;
      if (tStr.includes('am') && hr === 12) hr = 0;
      let mn = tStr.includes(':') ? tStr.split(':')[1].replace(/[a-z]/g,'') : '00';
      time = `${hr.toString().padStart(2, '0')}:${mn}`;
    }

    return {
      intent: INTENTS.LOG_ACTIVITY,
      reply: `Got it! I'll log ${duration} minutes of ${type} for today${time ? ' at ' + time : ''}. Confirm to save?`,
      requiresConfirmation: true,
      payload: { type, duration, notes: '', date: today, time },
    };
  }

  // Task/Todo: "add task: ...", "remind me to ...", "todo: ..."
  const taskMatch = msg.match(/(?:add\s+task|remind(?:\s+me)?(?:\s+to)?|todo)[:\s]+(.+)/i);
  if (taskMatch) {
    return {
      intent: INTENTS.CREATE_TODO,
      reply: `I'll add a task: "${taskMatch[1].trim()}". Confirm to save?`,
      requiresConfirmation: true,
      payload: { title: taskMatch[1].trim(), description: '', estimated_duration: 0, deadline: null, extra_notes: '' },
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
//
// Orchestration flow:
//   1. Coordinator  → classify intent
//   2. Route intent → Concierge (writes) or Analytics (reads/chat)
//   3. On any Gemini error → regexFallback

async function processMessage(userMessage) {
  const genAI = getGenAI();

  if (!genAI) {
    console.log('[Agent] No Gemini key — using regex fallback');
    return regexFallback(userMessage);
  }

  try {
    const context  = getContextSnapshot();
    const today    = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    // ── Step 1: Coordinator classifies intent ────────────────────────────────
    console.log('[Agent] Coordinator classifying intent…');
    const intent = await runCoordinator(userMessage, context, today, tomorrow);

    if (!intent || !INTENTS[intent]) {
      console.warn('[Agent] Coordinator returned invalid intent, falling back');
      return regexFallback(userMessage);
    }
    console.log(`[Agent] Intent classified → ${intent}`);

    // ── Step 2: Route to appropriate sub-agent ───────────────────────────────
    let result;

    if (WRITE_INTENTS.has(intent)) {
      // Concierge handles all write operations
      console.log('[Agent] Routing to Concierge Agent (write)…');
      result = await runConcierge(intent, userMessage, context, today, tomorrow);
    } else {
      // Analytics & Briefing handles reads and general chat
      console.log('[Agent] Routing to Analytics & Briefing Agent (read/chat)…');
      result = await runAnalytics(intent, userMessage, context, today, tomorrow);
    }

    if (!result || !result.reply) throw new Error('Sub-agent returned empty result');

    console.log(`[Agent] Response ready (requiresConfirmation=${result.requiresConfirmation})`);
    return result;

  } catch (err) {
    console.error('[Agent] Multi-agent pipeline error, using fallback:', err.message);
    return regexFallback(userMessage);
  }
}

// ─── Voice Transcription ──────────────────────────────────────────────────────
// Unchanged — uses plain text model, not JSON mode.

async function transcribeAudio(audioBuffer, mimeType = 'audio/webm') {
  const model = getTextModel();
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

async function generateNewsBriefing() {
  const model = getTextModel();
  if (!model) {
    return '• No Gemini API key configured. Check your .env file.\n• Please configure GEMINI_API_KEY to retrieve briefings.';
  }
  try {
    const prompt = `You are the SyncRoutine AI Tech Briefing system.
Generate a fresh "Daily AI & Tech News Briefing".
It MUST contain exactly 2 bullet points highlighting exciting breakthroughs in AI or tech (recent real ones or plausible future ones).
Format as exactly 2 lines starting with bullet points (•). Keep it concise, engaging, and professional. Do not add markdown headers, code fences, or wrappers.`;
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error('[Agent] News briefing generation failed:', err.message);
    return '• Unable to contact Gemini API right now.\n• Please try again later.';
  }
}

module.exports = { processMessage, transcribeAudio, generateNewsBriefing, INTENTS };
