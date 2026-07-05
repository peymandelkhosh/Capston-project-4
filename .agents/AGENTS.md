# SyncRoutine - Workspace Agent Guidelines

Welcome, Antigravity Agent! You are assisting in developing **SyncRoutine**, a premium personal wellness and routine concierge web application built as the Capstone Project for the **Kaggle AI Agents Intensive Vibe Coding course**.

---

## 1. Project Overview & Architecture

SyncRoutine helps users log daily wellness activities, maintain encrypted journals, organize schedules, and track habits.

*   **Backend**: Node.js Express server (`server.js`) on Port 3000.
*   **Database**: SQLite managed synchronously via `sql.js` (`db.js`). All write operations are committed synchronously, loaded on startup, and synced to Google Cloud Storage.
*   **Cloud Sync**: Google Cloud Storage (`gcs.js`) automatically backs up the database file to GCP.
*   **Telegram Bot**: Multi-channel integration (`telegram.js`) enabling users to log routine stats via Telegram.
*   **Frontend**: Single Page Application in the `public/` folder, utilizing modern responsive layout, Vanilla CSS, and custom visualizations.

---

## 2. Capstone Certification Requirements

To achieve full certification, this project implements **all key course concepts**:
1.  **Multi-Agent Coordination**: `agent.js` routes queries to a *Concierge Agent* (logging/writes) and an *Analytics & Briefing Agent* (data queries & AI tech news briefings).
2.  **Custom MCP Server**: Exposes database tools to external agents via Model Context Protocol (`mcp-server.js`).
3.  **Antigravity Customizations**: Workspace rules defined in this file (`.agents/AGENTS.md`) and custom workspace skills.
4.  **Security/Privacy**: Journal entries (`content` column in `user_journal` table) are cryptographically encrypted at rest using Node.js's native `crypto` module.
5.  **Deployability**: Containerized configuration (`Dockerfile`, `docker-compose.yml`) for seamless cloud hosting.
6.  **Agent Skills**: Custom skills defined in `.agents/skills/`.

---

## 3. Development Guidelines

### Frontend & Aesthetics
*   **Aesthetic Quality**: Every user interface must look premium, modern, and state-of-the-art.
*   **Styling**: Use strictly **Vanilla CSS** with elegant color palettes (HSL, cohesive dark modes), subtle micro-animations on hover, and modern typography (e.g., Google Fonts "Inter" or "Outfit"). Never use browser defaults or raw unstyled elements.
*   **Visual Assets**: Use rich, dynamic assets instead of placeholders.

### Security & Database
*   Always encrypt journal entry text via standard `AES-256-CBC` encryption before database writes, and decrypt on retrieval.
*   Never write plain-text API keys or credentials directly to code files. Always read from `.env`.

### Code Consistency
*   Preserve all GCS and Telegram bot connection routines.
*   Ensure that any new route or module is correctly registered in `server.js`.
