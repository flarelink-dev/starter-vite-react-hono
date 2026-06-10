# Flarelink starter · Vite + React + Hono on Cloudflare Workers

Notebook MVP — sign up, write notes, attach files. The whole stack on one
Cloudflare Worker, gated by Flarelink-managed auth + storage + db. **Zero
Vercel, zero Netlify, zero "but does it run on the edge?"** — it runs on
Workers because it's a Worker.

```
flarelink-starter/
├─ client/        React SPA (Vite, Tailwind v4, React Router 7)
├─ server/        Hono Worker: auth proxy + notes API + R2 presigning
├─ migrations/    D1 schema (shares a DB with Flarelink's auth tables)
└─ wrangler.jsonc One Worker, ASSETS binding for the SPA
```

## What this gets you in 5 minutes

- ✅ Email/password signup + sign-in (Flarelink auth Worker behind a proxy)
- ✅ Email verification + auto-sign-in on click
- ✅ Per-user notes in D1 (proper FK to `user.id`, `WHERE user_id = ?` scoping)
- ✅ File attachments uploaded direct browser→R2 via presigned URLs (zero egress)
- ✅ Tailwind v4, React Router 7, TypeScript strict mode, no build tooling to fight
- ✅ Single `wrangler deploy` to ship it

## Prerequisites

- Node 20+
- A Flarelink project — provision one at
  [dash.flarelink.dev](https://dash.flarelink.dev). The wizard creates your
  auth Worker, a D1, an R2 bucket, and surfaces a one-time **service key**
  (`flarelink_sk_…`). You'll paste it in step 3 below; you can't recover it
  later, so save it somewhere safe.

## Quickstart

```bash
# 1. Clone the starter
npx degit flarelink-dev/starter-vite-react-hono notebook
cd notebook
npm install

# 2. Browser env (Vite reads .env at dev + build)
cp .env.example .env
# Set VITE_FLARELINK_URL=https://localhost:5175 (default is fine for dev)

# 3. Server env (Wrangler reads .dev.vars locally; gitignored)
cat > .dev.vars <<EOF
FLARELINK_URL=https://your-app-auth.your-subdomain.workers.dev
FLARELINK_SERVICE_KEY=flarelink_sk_paste_the_one_time_secret_here
EOF

# 4. Apply the notes schema (CREATE TABLE notes ... in your project's D1)
npm run db:migrate:local
npm run db:migrate:remote   # do this once, before you deploy

# 5. Run it
npm run dev
# → https://localhost:5175
# (first run installs a local HTTPS cert via mkcert — may prompt once)
```

Sign up, click the verification link, write a note, attach a file. Done.

> **Why HTTPS in dev?** The auth session cookie is `Secure` (and uses the
> `__Secure-` name prefix), which Safari and iOS refuse to store over plain
> `http://localhost`. The starter serves dev over `https://localhost:5175`
> via [vite-plugin-mkcert](https://github.com/liuweiGL/vite-plugin-mkcert) so
> sign-in works in every browser. First run installs a locally-trusted CA
> into your system keychain.

## Trusted origins

Flarelink's auth Worker only accepts requests from origins listed in its
`trustedOrigins` config. **You must add this app's origin** to that list
or BetterAuth will refuse cross-origin POSTs.

- **Dev:** `https://localhost:5175` (https, not http — see "Why HTTPS in dev?" above)
- **Prod:** `https://your-deployed-worker.your-subdomain.workers.dev`

Set both at [Authentication → Settings → Trusted origins](https://dash.flarelink.dev)
in the Flarelink dashboard. Updates are live within ~60s (or instantly if
the dashboard pings `/__flarelink/reload-config` after the save).

## Deploy

```bash
# Push server secrets — never commit them.
dotenv -e .dev.vars -- wrangler secret put FLARELINK_URL
dotenv -e .dev.vars -- wrangler secret put FLARELINK_SERVICE_KEY

# Ship it.
npm run deploy
```

After the first deploy, update `VITE_FLARELINK_URL` in your **production**
`.env` (or your CI's env) to the deployed Worker's URL, then redeploy so
the new value is baked into the SPA bundle.

## Architecture in one diagram

```
┌─ Browser ──────────────────────────────────────────────────────────────┐
│  flarelink.auth.signIn() → POST /api/auth/sign-in  ─┐                  │
│  fetch('/api/notes')      ──────────────────────────┼─→ (this Worker)  │
│  PUT to R2 (presigned)    ──────────────────────────┼─→ R2 directly    │
└──────────────────────────────────────────────────────┼─────────────────┘
                                                       │
                                ┌──────────────────────┴─────────────────┐
                                │  Hono Worker (this repo)               │
                                │  ┌─ /api/auth/* ───► proxy to ────────┼─→ Flarelink auth Worker
                                │  │                                    │     (sessions in KV,
                                │  │                                    │      D1 user/account)
                                │  ├─ /api/notes      ─┐                │
                                │  ├─ /api/attachments ┼─ via SDK ──────┼─→ Flarelink auth Worker
                                │  │ /upload-url      │   with          │     /api/db/query
                                │  │ /download-url    │   serviceKey    │     /api/storage/presign
                                │  └─ /api/*          ─┘                │
                                │  Anything else  ──► ASSETS binding ───┼─→ Vite-built SPA
                                └────────────────────────────────────────┘
```

The Hono Worker is the customer-facing API surface. **Flarelink is never
in the runtime path of your business logic** — it provisions the auth
Worker on your CF account and walks away. Your data lives in your D1
and R2.

### Why the proxy?

Cross-origin cookies break the cleanest server-side patterns (the
`SameSite=None` session cookie set by the auth Worker wouldn't be on
this Worker's domain, so `flarelink.auth.getSession({ headers })` here
would never see it). By proxying `/api/auth/*` to the auth Worker, the
cookie lands on **this** Worker's domain — and server routes can read
it freely, validate the session, and scope queries to the current user.

The proxy makes the cookie *first-party* but doesn't change its
attributes — it's still `Secure`. So the app must be served over HTTPS
for the browser to store it: `https://localhost:5175` in dev (handled by
vite-plugin-mkcert), and HTTPS in prod (every deployment already is).
Plain `http://localhost` silently drops the cookie in Safari.

## Extending

### Add a new table

1. Add a migration: `migrations/0001_my_thing.sql`. Reference `user(id)`
   with `ON DELETE CASCADE` if it's per-user data:
   ```sql
   CREATE TABLE my_thing (
     id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
     user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
     -- your columns
     created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
   );
   ```
2. `npm run db:migrate:local` then `npm run db:migrate:remote`.
3. Add server routes: copy the `/api/notes` pattern in `server/index.ts`.
   Use the SDK's tagged-template SQL — values bind safely:
   ```ts
   const { results } = await flarelink.sql`
     SELECT * FROM my_thing WHERE user_id = ${user.id}
   `;
   ```

### Add OAuth (Google, GitHub)

Set the client ID + secret at **Authentication → Settings → Providers**
in the Flarelink dashboard, then add a button on Login:

```ts
await flarelink.auth.signInWithSocial('google', {
  callbackURL: window.location.origin,
});
```

The verification + redirect flow is end-to-end managed by the auth Worker.

### Add a second R2 bucket

Create it at **Files** in the Flarelink dashboard (or via wrangler if you
prefer). Then in the upload route, swap the bucket name:

```ts
await flarelink.storage.from('my-other-bucket').createSignedUploadUrl(key, ...);
```

## What lives where

| Concern | Code |
|---|---|
| Browser-side SDK (auth only) | [client/lib/flarelink.ts](client/lib/flarelink.ts) |
| Server-side SDK (auth + db + storage) | [server/index.ts](server/index.ts) |
| Session hook + cache | [client/lib/session.ts](client/lib/session.ts) |
| Protected route wrapper | [client/components/RequireAuth.tsx](client/components/RequireAuth.tsx) |
| Notes API (server) | [server/index.ts](server/index.ts) — `/api/notes`, `/api/attachments/*` |
| Notes UI | [client/pages/Notes.tsx](client/pages/Notes.tsx) |
| Schema | [migrations/0000_notes.sql](migrations/0000_notes.sql) |

## License

MIT. Build whatever you want.
