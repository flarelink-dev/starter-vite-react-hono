# AGENTS.md · Flarelink starter

Rules for AI coding agents (Cursor, Claude Code, Copilot, etc.) extending
this starter. Read this before generating code that touches auth, storage,
or the database.

## The stack

- **Vite + React 19** SPA in `client/`
- **Hono** Worker in `server/` (single file, single export)
- **Tailwind v4** via `@tailwindcss/vite` — no config file, no PostCSS
- **React Router 7** for SPA routing
- **`@flarelink/client` SDK** — auth in browser, db + storage server-only
- Deploys as **one Cloudflare Worker** with the `ASSETS` binding for the SPA
- Single **D1** holds Flarelink auth tables (`user` / `account` /
  `verification`) + customer tables (`notes`, …) — shared, not separate

## Cardinal rules

### 1. `serviceKey` is server-only. NEVER ship it to the browser.

- ✅ `server/index.ts` reads `c.env.FLARELINK_SERVICE_KEY`
- ❌ Don't put it in `.env` as `VITE_*` — Vite would bake it into the SPA
  bundle and any visitor could exfiltrate it
- ❌ Don't pass it through props or fetch it from a public endpoint

If you need a new client-side feature that touches db/storage, add a
**server route** in `server/index.ts` that uses the SDK, and have the
client call that route.

### 2. Every per-user mutation goes through `requireUser` middleware.

`requireUser` validates the session cookie via the SDK and populates
`c.var.user`. Use `c.var.user.id` in your WHERE clause so a malicious
client can't read or write another user's rows.

```ts
// ✅ correct
app.get('/api/my-thing', requireUser, async (c) => {
  const flarelink = server(c.env);
  const { results } = await flarelink.sql`
    SELECT * FROM my_thing WHERE user_id = ${c.var.user.id}
  `;
  return c.json({ items: results });
});

// ❌ never trust user-supplied user_id
app.get('/api/my-thing', async (c) => {
  const userId = c.req.query('userId'); // 🚨 forgeable
  // ...
});
```

### 3. Auth lives behind a reverse proxy at `/api/auth/*`.

Browser SDK is configured with `url: VITE_FLARELINK_URL` which points at
**this Worker**, not at the auth Worker. The proxy in `server/index.ts`
forwards `/api/auth/*` to the auth Worker so the session cookie lands
on this Worker's domain (same-origin auth).

- ✅ Browser: `flarelink.auth.signIn({ email, password })` → goes to `/api/auth/sign-in/email` on this Worker → proxied
- ✅ Server: pass the incoming Cookie at construction via
  `createFlarelink({ url, serviceKey, cookies: () => c.req.raw.headers.get('cookie') ?? '' })`,
  then `await flarelink.auth.getMe()` returns the `User` (or `null`)
- ❌ Don't bypass the proxy and call the auth Worker URL directly from the browser — cookies won't survive
- ❌ `flarelink.auth.getSession()` takes NO arguments — it always reads the cookie configured at construction time. Don't try to pass headers per-call.

### 4. Identifier safety: table + column names match `/^[A-Za-z_][A-Za-z0-9_]*$/`.

The SDK enforces this at both client + server layers (throws
`INVALID_IDENTIFIER` on bad inputs). Don't try to concatenate
user-supplied strings into table or column names. Values are always
bound; identifiers should be literal constants in your code.

### 5. Shared D1 — `notes` lives next to `user`.

The D1 binding holds BOTH Flarelink's auth tables AND your app's
tables. This is intentional (single billing line, FK works, no
cross-DB joins needed).

- ✅ `notes.user_id REFERENCES "user"(id) ON DELETE CASCADE` — deleting
  a user from the Flarelink Users panel removes their notes too
- ✅ You can `flarelink.from('user')` server-side to read the auth user
  list (e.g. for admin views)
- ❌ Don't try to add columns to `user` / `account` / `verification` —
  those are managed by the auth module. Make a sibling table
  (`profile`) keyed by `id` and FK into `user`.
- ❌ Don't name a new table `flarelink_config` — that's reserved

## SDK surface (memorise this)

### Browser-safe (no serviceKey needed)

```ts
import { createFlarelink } from '@flarelink/client';
const flarelink = createFlarelink({ url: import.meta.env.VITE_FLARELINK_URL });

// Auth — see types.ts for full input shapes.
// Returned `User` has: id, email, name, emailVerified, image, createdAt, updatedAt.
// Returned `Session` has: id, userId, expiresAt, createdAt, updatedAt, ipAddress?, userAgent?.
//   (Session does NOT carry a nested user object — use getMe() to get the user.)

await flarelink.auth.signUp({ email, password, name });           // → { user: User }
await flarelink.auth.signIn({ email, password });                 // → { user: User }
await flarelink.auth.signInWithSocial('google', { callbackURL }); // → { url } (navigates by default)
await flarelink.auth.signInWithMagicLink(email, { callbackURL }); // first arg is the email string, NOT an object
await flarelink.auth.signOut();                                   // → void
await flarelink.auth.getMe();                                     // → User | null
await flarelink.auth.getSession();                                // → Session | null (no args)
await flarelink.auth.requestPasswordReset({ email, redirectTo }); // → { status: true }
await flarelink.auth.resetPassword({ token, newPassword });       // → { status: true }
await flarelink.auth.sendVerificationEmail({ email, callbackURL });
```

### Server-only (serviceKey required, lives in `c.env.FLARELINK_SERVICE_KEY`)

Construct the SDK **per request** when you need a session — `cookies` is
captured at construction time, not per-call. Reuse the same instance
across requests only when you don't need a session (e.g. public stats).
See [server/index.ts](server/index.ts) for the `server(c)` helper that
does this.

```ts
const flarelink = createFlarelink({
  url: c.env.FLARELINK_URL,
  serviceKey: c.env.FLARELINK_SERVICE_KEY,
  // Forward the inbound request's Cookie header to the auth Worker so
  // getMe() / getSession() can resolve. Omit when calling unauthenticated
  // endpoints (sql / from / storage with serviceKey alone).
  cookies: () => c.req.raw.headers.get('cookie') ?? '',
});

// Server-side session check — call getMe() to get the User (including email
// + name). getSession() returns only the Session row (id / userId / expiresAt).
const me = await flarelink.auth.getMe();
if (!me) return c.json({ error: 'sign in required' }, 401);

// Tagged-template SQL — values bind safely as numbered params.
// IMPORTANT: returned shape is { rows, meta } — not { results }. The wire
// format uses `results`, but the SDK renames it to `rows` for consistency
// with the builder.
const { rows, meta } = await flarelink.sql<{ id: string; content: string }>`
  SELECT id, content FROM notes
  WHERE user_id = ${me.id}
  ORDER BY created_at DESC
  LIMIT ${limit}
`;

// Chainable builder — equality + AND only. For OR / IN / joins / >, < use the sql tagged template.
// .select takes either '*' (default), an array of column names, or call without args (defaults to '*').
await flarelink.from('notes')
  .select(['id', 'content', 'created_at'])
  .where({ user_id: me.id, archived: false })
  .orderBy('created_at', 'desc')
  .limit(50);

await flarelink.from('notes')
  .insert({ id: crypto.randomUUID(), user_id: me.id, content })
  .returning('*');

await flarelink.from('notes')
  .update({ content })
  .where({ id: noteId, user_id: me.id })
  .returning('*');

await flarelink.from('notes')
  .delete()
  .where({ id: noteId, user_id: me.id });

// Storage — presigned URLs. createSignedUploadUrl returns BOTH the URL
// and `signedHeaders` you MUST send on the browser's PUT (or the
// SigV4 signature won't match). Don't add extra headers to the PUT.
const { url, signedHeaders } = await flarelink.storage.from('attachments')
  .createSignedUploadUrl(key, { contentType, expiresIn: 600 });

const { url: downloadUrl } = await flarelink.storage.from('attachments')
  .createSignedDownloadUrl(key, { expiresIn: 600 });

await flarelink.storage.from('attachments').remove([key1, key2]);
await flarelink.storage.from('attachments').list({ prefix: 'notes/', cursor });
await flarelink.storage.listBuckets();
```

## Where to add things

| You want to… | Do this |
|---|---|
| Add a new page | New file under `client/pages/`, route it in `client/App.tsx` |
| Add a protected page | Wrap in `<RequireAuth>` like `Notes` |
| Add a new server API | Add `app.METHOD('/api/your-path', requireUser, async (c) => ...)` in `server/index.ts` |
| Add a new D1 table | New migration in `migrations/`, FK into `user(id)` if per-user |
| Add OAuth provider | Configure in the Flarelink dashboard; call `signInWithSocial` from your Login page |
| Add a new R2 bucket | Create it in the Flarelink dashboard; reference by name in `flarelink.storage.from(name)` |
| Show the current user | `useSession()` from `client/lib/session.ts` |
| Refresh session after auth change | `refreshSession()` from same file |

## Patterns to copy

### Pattern: protected mutation with user scoping

`server(c)` is the per-request SDK helper in [server/index.ts](server/index.ts)
that constructs `createFlarelink({ url, serviceKey, cookies: ... })` with
the inbound request's Cookie header. Don't try to share an SDK instance
across requests when you need a session — cookies are captured at
construction.

```ts
app.post('/api/my-things', requireUser, async (c) => {
  const flarelink = server(c);
  const body = await c.req.json<{ name?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: 'name required' }, 400);

  const id = crypto.randomUUID();
  await flarelink.sql`
    INSERT INTO my_things (id, user_id, name)
    VALUES (${id}, ${c.var.user.id}, ${name})
  `;
  return c.json({ id }, 201);
});
```

### Pattern: direct browser → R2 upload via presigned URL

Server route mints the URL + `signedHeaders`, browser PUTs with EXACTLY
those headers. Zero bytes through the Worker. The signedHeaders include
the bound `content-type` — adding extra headers (or omitting these) breaks
the SigV4 signature.

```ts
// server
app.post('/api/uploads', requireUser, async (c) => {
  const flarelink = server(c);
  const { filename, contentType } = await c.req.json();
  const key = `mythings/${c.var.user.id}/${Date.now()}-${filename}`;
  const { url, signedHeaders } = await flarelink.storage
    .from('attachments')
    .createSignedUploadUrl(key, { contentType, expiresIn: 600 });
  return c.json({ url, signedHeaders, key });
});

// client
const r = await fetch('/api/uploads', { ... });
const { url, signedHeaders, key } = await r.json();
await fetch(url, {
  method: 'PUT',
  body: file,
  headers: signedHeaders, // use exactly what the server returned — don't add Content-Type yourself
});
```

## Things NOT to do

- ❌ Don't add `useEffect` chains that fetch the same thing on every
  render. Use the cache pattern in `client/lib/session.ts` if you need a
  global piece of state.
- ❌ Don't put the service key in `.env` (Vite reads `VITE_*` into the
  client bundle). It lives in `.dev.vars` (server-only) locally and
  `wrangler secret put` in prod.
- ❌ Don't bypass `requireUser` for "internal" admin routes — there's no
  such thing as internal in a browser-accessible Worker.
- ❌ Don't call `flarelink.auth.getSession()` directly inside React
  render functions. Use `useSession()` instead — it deduplicates the
  network call across components.
- ❌ Don't store secrets in D1. The auth Worker holds OAuth client
  secrets, the R2 keypair, and the service key hash in its own D1's
  `flarelink_config` table — that's the contract. App-level tables
  shouldn't hold credentials.
- ❌ Don't write to `user`, `account`, or `verification` — Flarelink
  manages them. Use the auth Worker's endpoints (via the SDK) instead.

## When stuck

- **"sign in required" on every server call** → Trusted origins. Check
  the Flarelink dashboard's Authentication → Settings → Trusted origins
  includes BOTH `http://localhost:5174` (dev) AND your deployed Worker
  URL (prod).
- **CORS error on PUT to R2** → Bucket's CORS rule doesn't include this
  app's origin. Click "fix cors" on the Files page in the Flarelink
  dashboard, or re-create the bucket (it auto-applies CORS for the
  dashboard's origins; add yours manually if different).
- **`SignatureDoesNotMatch` from R2** → Content-Type at PUT didn't match
  contentType at sign time. They're part of the SigV4 signature.
- **`INVALID_IDENTIFIER`** → You're passing a user-supplied string as a
  table or column name. Use a literal constant; bind values as params.
- **CF 1102 on auth Worker calls** → CPU budget exceeded. Flarelink's
  auth Worker uses PBKDF2 (well under the 10ms free-tier limit) but if
  you've added custom work, profile it.
