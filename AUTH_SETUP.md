# Vexora authentication setup

Vexora account registration and sessions are stored in PostgreSQL. Passwords are
hashed with Node.js scrypt; the database stores only a hash of each session
cookie. The existing game and profile settings stored in browser local storage
are not synchronized to user accounts.

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
