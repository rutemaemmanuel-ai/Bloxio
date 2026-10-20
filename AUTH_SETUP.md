# Vexora deployment and authentication setup

Vexora account registration and sessions are stored in PostgreSQL. Passwords are
hashed with Node.js scrypt; the database stores only a hash of each session
cookie. The existing game and profile settings stored in browser local storage
are not synchronized to user accounts.

## Run on Replit

1. Import `rutemaemmanuel-ai/Vexora.site` from GitHub at
   [replit.com/import](https://replit.com/import).
2. In the Replit workspace, open the **Database** tool and provision/enable a
   PostgreSQL database for the app.
3. Confirm the workspace's `DATABASE_URL` secret points to that database. Do
   not put connection strings in source files, chat, or GitHub.
4. Press **Run** to test. The included `.replit` file uses `npm start`.
5. Select **Publish** and choose an Autoscale web deployment. Ensure its
   production environment has a `DATABASE_URL` for its production PostgreSQL
   database before the service starts. Replit development and production
   databases are separate; verify that a production database has been
   provisioned in the Publishing/Database settings.

The Node server listens on Replit's assigned `PORT`. Vexora creates its account
and session tables at startup. Published apps must store persistent data in the
database rather than the deployment's local filesystem.

## Run on Render

1. Create a PostgreSQL database in Render.
2. In the Vexora Web Service settings, add `DATABASE_URL` using the database's
   **internal** connection string. Keep credentials private; never commit them.
3. Set the start command to `npm start` (or keep `node serve.js`).
4. Deploy. On startup, Vexora creates its account and session tables.

Use the PostgreSQL database and its connection string from Render. Do not use
the web service's local filesystem to store account data.

## Run locally

Install dependencies with `npm install`, set `DATABASE_URL` to a PostgreSQL
database you control, then run `npm start`. Without `DATABASE_URL`, the server
can display the sign-in page, but account operations report that the service is
not configured; production startup fails instead of silently losing accounts.
