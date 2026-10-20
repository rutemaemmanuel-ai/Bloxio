# Vexora deployment and authentication

Vexora can run as a Cloudflare Worker with static assets and D1, Cloudflare's
managed SQLite database. User accounts and login sessions are stored in D1;
passwords are derived using PBKDF2-SHA-256 (100,000 iterations, the maximum
supported by the Workers Web Crypto runtime), and only hashes of session
cookies are stored. Browser-local profile and game settings are not
synchronized to accounts. Studio projects still use browser-local storage.

## Deploy on Cloudflare

1. Install Node.js 20 or later and run `npm install`.
2. Authenticate Wrangler with your Cloudflare account using `npx wrangler login`.
3. Create the database using `npm run cf:db:create`. Copy the returned database
   ID into `database_id` in `wrangler.jsonc`.
4. Apply the schema with `npm run cf:db:migrate:remote`.
5. Deploy with `npm run cf:deploy`.

Cloudflare's Workers Free plan includes a limited daily request allowance and
CPU budget; D1 Free includes limited rows read and written per day and a
combined storage allowance. Check current Cloudflare limits and usage in your
dashboard. Requests over the free limits can fail until the quota resets or the
account is upgraded. The default `workers.dev` address does not require buying a
domain.

The `.assetsignore` file prevents Worker source, configuration, tests, database
migrations, and dependency files from being served as public website assets.

## Run on Replit

1. Import `rutemaemmanuel-ai/Vexora.site` from GitHub at
   [replit.com/import](https://replit.com/import).
2. In the Replit workspace, open the **Database** tool and provision/enable a
   PostgreSQL database for the app.
3. Confirm the workspace's `DATABASE_URL` secret points to that database. Do
   not put connection strings in source files, chat, or GitHub.
4. Press **Run** to test. The included `.replit` file uses `npm start`.
5. Select **Publish** and ensure its production environment has a `DATABASE_URL`
   for its production PostgreSQL database.

## Run on Render

1. Create a PostgreSQL database in Render.
2. In the Vexora Web Service settings, add `DATABASE_URL` using the database's
   **internal** connection string. Keep credentials private; never commit them.
3. Set the start command to `npm start` and deploy.

## Run locally

Install dependencies with `npm install`, set `DATABASE_URL` to a PostgreSQL
database you control, then run `npm start`. Without `DATABASE_URL`, the Node
server can display the sign-in page, but account operations report that the
service is not configured; production startup fails instead of silently losing
accounts.
