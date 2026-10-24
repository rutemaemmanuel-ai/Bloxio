# Bloxio

Play. Create. Explore.

## Live site

**https://bloxio.rutemaemmanuel.workers.dev**

This is the canonical address. It is served by the Cloudflare Worker `bloxio`
and includes the working sign-in API (`/api/auth/*`).

A static mirror is also published by GitHub Pages at
`https://rutemaemmanuel-ai.github.io/Bloxio/`, but Pages cannot run the Worker,
so sign-in does **not** work there. Use the `workers.dev` address.

There is no custom domain yet. `wrangler.jsonc` holds the route for one (for
example `bloxio.site`) as commented-out config; attaching it only needs the
domain to be registered and its zone active in Cloudflare.

## Deploying

```bash
cd Bloxio
npx wrangler deploy
```

Configuration (Worker name, D1 binding, routes) lives in `wrangler.jsonc`.
Database schema lives in `migrations/`.

## Running locally

```bash
npm install
npm start
```

See [AUTH_SETUP.md](AUTH_SETUP.md) for authentication and hosting details.
