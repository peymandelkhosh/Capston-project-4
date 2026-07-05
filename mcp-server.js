/**
 * mcp-server.js — SyncRoutine Custom MCP Server
 *
 * Exposes SyncRoutine database tools to external AI agents and IDEs via the
 * Model Context Protocol (MCP) over standard input/output (stdio).
 *
 * This process is launched independently by the MCP client (e.g. an IDE or
 * another agent) and initialises the database on its own.  It does NOT share
 * a process with server.js.
 *
 * Registered tools
 * ─────────────────
 *   • get_wellness_summary  – Configurable-day snapshot of activities and mood
 *   • add_activity_log      – Log a new wellness activity to the database
 *   • get_pending_tasks     – List of all incomplete tasks
 *
 * Transport: StdioServerTransport (JSON-RPC 2.0 over stdin / stdout)
 */

'use strict';

// Redirect console.log to stderr so database logging doesn't corrupt stdout MCP transport
console.log = (...args) => {
  process.stderr.write(args.join(' ') + '\n');
};

require('dotenv').config();

const { McpServer }            = require('@modelcontextprotocol/sdk/server/mcp');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio');
const z                        = require('zod');
const { initDb, activities, tasks, journal } = require('./db');

// ─── Server Definition ────────────────────────────────────────────────────────

const server = new McpServer(
  {
    name   : 'syncroutine-mcp',
    version: '1.0.0',
  },
  {
    capabilities: { tools: {} },
    instructions: [
      'SyncRoutine MCP server exposes wellness-data tools for the SyncRoutine',
      'personal routine and wellness concierge application.',
      'Use get_wellness_summary for an overview, add_activity_log to record new',
      'activities, and get_pending_tasks to view open to-dos.',
    ].join(' '),
  }
);

// ─── Tool: get_wellness_summary ───────────────────────────────────────────────

server.registerTool(
  'get_wellness_summary',
  {
    title      : 'Get Wellness Summary',
    description:
      'Returns a summary of logged wellness activities and mood journal entries ' +
      'for the past N days (default 7, max 90). Useful for a quick health ' +
      'snapshot or AI briefing.',
    inputSchema: {
      days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe(
          'Number of past days to include in the summary. Defaults to 7, maximum 90.'
        ),
    },
  },
  async ({ days = 7 }) => {
    const recentActivities = activities.getRecent(days);
    const activityStats    = activities.stats();
    const recentJournal    = journal.getRecent(days);
    const moodStats        = journal.moodStats();

    const summary = {
      period_days    : days,
      activities     : recentActivities,
      activity_stats : activityStats,
      journal_entries: recentJournal,
      mood_stats     : moodStats,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  }
);

// ─── Tool: add_activity_log ───────────────────────────────────────────────────

server.registerTool(
  'add_activity_log',
  {
    title      : 'Add Activity Log',
    description:
      'Logs a new wellness activity (e.g. Exercise, Reading, Meditation) ' +
      'directly to the SyncRoutine database. Returns the newly created record.',
    inputSchema: {
      type: z
        .string()
        .min(1)
        .describe(
          'Category of the activity. Examples: "Exercise", "Reading", ' +
          '"Meditation", "Sleep", "Nutrition".'
        ),
      duration: z
        .number()
        .int()
        .min(1)
        .describe('Duration of the activity in minutes (must be at least 1).'),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be an ISO date string: YYYY-MM-DD.')
        .describe('Date the activity took place in YYYY-MM-DD format.'),
      notes: z
        .string()
        .optional()
        .describe('Optional free-text notes about the activity.'),
    },
  },
  async ({ type, duration, date, notes = '' }) => {
    const newActivity = activities.create({ type, duration, date, notes });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success : true,
              message : `Activity "${type}" logged for ${date} (${duration} min).`,
              activity: newActivity,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Tool: get_pending_tasks ──────────────────────────────────────────────────

server.registerTool(
  'get_pending_tasks',
  {
    title      : 'Get Pending Tasks',
    description:
      'Fetches all incomplete (status = "pending") tasks from the SyncRoutine ' +
      'database, ordered by due date ascending. Useful for a daily productivity ' +
      'briefing or planning overview.',
    // Zero-argument tool — no inputSchema properties required
    inputSchema: {},
  },
  async () => {
    const pendingTasks = tasks.getPending();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              total        : pendingTasks.length,
              pending_tasks: pendingTasks,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  // Initialise the SQLite database (this MCP process owns its own DB handle)
  await initDb();

  // Connect to stdio transport — JSON-RPC 2.0 messages flow over stdin/stdout
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr only; stdout is reserved exclusively for MCP JSON-RPC traffic
  process.stderr.write('[MCP] SyncRoutine MCP server started (stdio transport)\n');
}

main().catch((err) => {
  process.stderr.write(`[MCP] Fatal startup error: ${err.message}\n`);
  process.exit(1);
});
