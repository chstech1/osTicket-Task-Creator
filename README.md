# osTicket Task Creator

A small Express-based web application for managing reusable task templates and clients alongside reference data from an osTicket database. The UI uses server-rendered EJS views with Bootstrap styling and minimal client-side JavaScript.

## Do I need another web server?
No extra web server is required. This app runs an Express server that serves **both** the HTML UI and the JSON APIs. When you start it, Express listens on port 3000 by default (or the port set in the `PORT` environment variable). For local use you do **not** need Apache, Nginx, Docker, or any reverse proxy—just Node.js.

## Prerequisites

- Node.js 18+ and npm
- Access to an osTicket MySQL/MariaDB database (read-only) with credentials for queries against departments, teams, and staff
- File-system write access to the `data/` directory so JSON files can be created/updated

## Detailed setup steps

1. **Install dependencies**
   - From the project root run:
     ```bash
     npm install
     ```
   - This pulls Express, EJS, MySQL client libraries, and UUID helpers. No build step is required.

2. **Configure database access**
   - Open `db/config.json` and fill in your osTicket DB connection values:
     ```json
     {
       "host": "localhost",
       "port": 3306,
       "user": "osticket_user",
       "password": "secret",
       "database": "osticket_db"
     }
     ```
   - The app reads this file at startup and attempts a connection. If it cannot connect:
     - The UI still renders, but dropdowns for Departments/Teams/Staff will be empty.
     - An error banner appears on the page and the server log will show the connection error.
     - Update the credentials or network access and restart the server to retry.

3. **Initialize data files (optional)**
   - `data/clients.json` and `data/templates.json` are created automatically as empty arrays on first run if they do not exist.
   - If you want starter data, you can manually add objects matching the documented schema before first launch.

## How to run the server

Start the Express server (serves the web UI and APIs) on port 3000 by default:
```bash
npm start
```

What happens when you run this:
- The server reads `db/config.json` and attempts to connect to MySQL.
- It creates `data/clients.json` and `data/templates.json` if they are missing.
- It listens on port 3000 (or `PORT` if set) and serves:
  - Web pages at routes like `/clients`, `/templates`, `/templates/new`.
  - JSON APIs at `/api/...`.

After the log shows "Server listening on ...", open http://localhost:3000 in your browser. To use a different port, set `PORT` before starting:
```bash
PORT=4000 npm start
```

## Using the UI

1. Open http://localhost:3000 (or your chosen port).
2. Use the navbar links:
   - **Clients**
     - Add a client with the **Add Client** button.
     - Edit or delete existing clients via the table actions. Deletion is blocked if templates reference the client.
   - **Task Templates**
     - Filter templates by client using the dropdown at the top.
     - Create a new template via **New Template**. Fill in recurrence details; the form shows only the relevant fields for the selected recurrence type.
     - Edit or delete existing templates via the table actions.
3. Watch for alert banners: they show success or error messages from API responses.

## Troubleshooting

- **Cannot connect to MySQL:** Confirm `db/config.json` values, ensure the database allows network connections, and check that the MySQL user has read access to the `ost_department`, `ost_team`, and `ost_staff` tables.
- **Port already in use:** Set a different `PORT` environment variable before running.
- **Permission errors writing JSON:** Ensure the `data/` directory is writable by the user running Node.js.

## Project structure

- `server.js` – Express server, routes, validation, and page rendering.
- `views/` – EJS templates for layout, lists, and forms.
- `public/` – Static assets (CSS, client-side JavaScript).
- `data/` – JSON persistence layer plus helper modules for file reads/writes.
- `db/` – MySQL helper and connection configuration for osTicket read-only access.

