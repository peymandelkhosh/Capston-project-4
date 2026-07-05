---
name: syncroutine-manager
description: Troubleshoots and manages the local SyncRoutine environment via Docker and SQLite.
---

# SyncRoutine Manager Skill

You are now acting as the SyncRoutine Environment Manager. Use this skill when the user asks for help troubleshooting, deploying, or viewing logs for the SyncRoutine application.

## 1. Application Architecture Context
- **Backend:** Node.js Express (port 3000).
- **Database:** SQLite (`syncroutine.db`). The DB is synced directly to GCP via `gcs.js`.
- **Docker:** Configured with `docker-compose.yml` to run the app in a container named `syncroutine`.

## 2. Managing Docker
Whenever you need to restart, build, or check the status of the deployment:
- **Build and Start:** `docker-compose up -d --build`
- **Stop:** `docker-compose down`
- **View Logs:** `docker logs syncroutine --tail 50`

*Important Note:* Ensure you are in the workspace root directory before running `docker-compose` commands.

## 3. Querying the Database
If a user asks about their data or you need to debug a data issue, you can interact with the SQLite database directly from the host machine using `sqlite3 syncroutine.db`.
- **List Tables:** `sqlite3 syncroutine.db ".tables"`
- **View schema:** `sqlite3 syncroutine.db ".schema activities"`
- **Run query:** `sqlite3 syncroutine.db "SELECT * FROM activities LIMIT 5;"`

## 4. Troubleshooting GCP Sync
If there is a `403` or sync error from `gcs.js`:
- Verify the Google Cloud credentials in `.env` (`GOOGLE_APPLICATION_CREDENTIALS` or `GCP_PROJECT_ID`).
- Remind the user that the service account needs `roles/storage.objectAdmin` on the target bucket.
