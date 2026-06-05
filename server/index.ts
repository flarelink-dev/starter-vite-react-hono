// Notebook starter — server.
//
// Three responsibilities, in order of how requests land:
//   1. Reverse-proxy `/api/auth/*` to your Flarelink auth Worker so the
//      session cookie lands on THIS Worker's domain (single-origin auth).
//      Without this the cookie would be on the auth Worker's domain and
//      server routes here couldn't read it.
//   2. Server-side notes endpoints (list / create / delete / upload-url)
//      gated by session cookie + scoped to `WHERE user_id = ${session.user.id}`.
//      The SDK's serviceKey gates the Flarelink-side calls; the WHERE
//      clause enforces per-user isolation.
//   3. Static SPA via the ASSETS binding for everything else.

import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { createFlarelink, AuthError, DatabaseError } from '@flarelink/client';

type Bindings = {
  ASSETS: Fetcher;
  /** Your auth Worker URL — set in .dev.vars locally and via
   *  `wrangler secret put FLARELINK_URL` in production. */
  FLARELINK_URL: string;
  /** Service key — server-only. Surfaced once at provision by Flarelink.
   *  If you lose it, rotate via the dashboard. */
  FLARELINK_SERVICE_KEY: string;
};

type Vars = {
  user: { id: string; email: string; name: string | null };
};

type AppEnv = { Bindings: Bindings; Variables: Vars };

const app = new Hono<AppEnv>();

// ---- 1. Auth proxy --------------------------------------------------
// Reverse-proxy auth-Worker endpoints so the browser sees same-origin
// (cookies set on this Worker's domain) and server routes here can read
// the session cookie via the SDK's `cookies` option.
//
// Three path prefixes need to be proxied because the browser SDK touches
// all three:
//   - /api/auth/*       BetterAuth's signup / signin / signout / verify-email / ...
//   - /api/me           the SDK's getMe() / getSession() target
//   - /__flarelink/*    Worker version + config inspection endpoints
//
// Anything else falls through to /api/notes / /api/attachments (our own
// routes) or the ASSETS binding (the SPA).
//
// Make sure your Flarelink auth Worker's `trustedOrigins` (configurable on
// Authentication → Settings → Trusted origins) includes this Worker's URL
// (and http://localhost:5174 for dev). Otherwise BetterAuth refuses the
// cross-origin POST.
async function proxyToAuthWorker(c: Context<AppEnv>): Promise<Response> {
  const incoming = new URL(c.req.url);
  const upstream = new URL(c.env.FLARELINK_URL);
  // Preserve the path + query — only the host swaps.
  const target = new URL(incoming.pathname + incoming.search, upstream);
  const headers = new Headers(c.req.raw.headers);
  // Forward as-is. Auth Worker's BetterAuth treats this request's Host as
  // its baseURL and uses Origin (preserved from the browser) for the
  // trustedOrigins check.
  headers.set('host', target.host);
  return fetch(target.toString(), {
    method: c.req.method,
    headers,
    body:
      c.req.method === 'GET' || c.req.method === 'HEAD'
        ? undefined
        : c.req.raw.body,
    redirect: 'manual',
  });
}

app.all('/api/auth/*', proxyToAuthWorker);
app.all('/api/me', proxyToAuthWorker);
app.all('/__flarelink/*', proxyToAuthWorker);

// ---- Server-side SDK factory + session middleware -------------------
//
// IMPORTANT: construct per-request when you need a session — the SDK
// captures `cookies` at construction time, not per-call. Forwarding the
// inbound Cookie header is what lets `flarelink.auth.getMe()` resolve
// the user from a server context. (In the browser, the SDK ignores
// `cookies` because the fetch already forwards credentials automatically.)
function server(c: Context<AppEnv>) {
  return createFlarelink({
    url: c.env.FLARELINK_URL,
    serviceKey: c.env.FLARELINK_SERVICE_KEY,
    // Forward the inbound request's Cookie header on every outbound call
    // so the auth Worker can resolve the user via getMe() / getSession().
    // No effect in the browser (cookies flow via credentials: 'include').
    cookies: () => c.req.raw.headers.get('cookie') ?? '',
  });
}

// requireUser: 401 if no session, otherwise populates c.var.user.
const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  try {
    const flarelink = server(c);
    // getMe returns User | null (with id / email / name / etc.).
    // getSession returns Session | null (id / userId / expiresAt / …) — no
    // user fields, so use getMe when you want email + name in one hit.
    const me = await flarelink.auth.getMe();
    if (!me) return c.json({ error: 'sign in required' }, 401);
    c.set('user', {
      id: me.id,
      email: me.email,
      name: me.name ?? null,
    });
    await next();
  } catch (err) {
    if (err instanceof AuthError) {
      return c.json({ error: err.message }, err.status as 400 | 401);
    }
    throw err;
  }
};

// ---- 2. Notes endpoints ---------------------------------------------

app.get('/api/notes', requireUser, async (c) => {
  const flarelink = server(c);
  const user = c.var.user;
  try {
    // SDK returns `{ rows, meta }` — rows[] is the row list. (The wire
    // format uses `results`; the SDK renames to keep terminology aligned
    // with the chainable builder.)
    const { rows } = await flarelink.sql`
      SELECT id, content, attachment_key, created_at
      FROM notes
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return c.json({ notes: rows });
  } catch (err) {
    if (err instanceof DatabaseError) {
      return c.json({ error: err.message, code: err.code }, 500);
    }
    throw err;
  }
});

app.post('/api/notes', requireUser, async (c) => {
  const flarelink = server(c);
  const user = c.var.user;
  const body = await c.req.json<{ content?: string; attachmentKey?: string | null }>();
  const content = body.content?.trim();
  if (!content) return c.json({ error: 'content required' }, 400);
  if (content.length > 4000) return c.json({ error: 'content too long (max 4000 chars)' }, 400);
  const id = crypto.randomUUID();
  const attachmentKey = body.attachmentKey?.trim() || null;
  await flarelink.sql`
    INSERT INTO notes (id, user_id, content, attachment_key)
    VALUES (${id}, ${user.id}, ${content}, ${attachmentKey})
  `;
  return c.json({ id }, 201);
});

app.delete('/api/notes/:id', requireUser, async (c) => {
  const flarelink = server(c);
  const user = c.var.user;
  const id = c.req.param('id');
  // WHERE user_id = ? prevents one user from deleting another's note
  // even if they guess the id. The SDK binds both as params.
  const result = await flarelink.sql`
    DELETE FROM notes WHERE id = ${id} AND user_id = ${user.id}
  `;
  return c.json({ deleted: result.meta.changes ?? 0 });
});

// Mint a presigned PUT URL for an attachment. Browser uploads directly to
// R2 — Flarelink never sees the bytes. Key is namespaced under the
// user's id so customers can't collide / overwrite each other.
app.post('/api/attachments/upload-url', requireUser, async (c) => {
  const flarelink = server(c);
  const user = c.var.user;
  const body = await c.req.json<{ filename?: string; contentType?: string }>();
  const filename = body.filename?.trim();
  const contentType = body.contentType?.trim() || 'application/octet-stream';
  if (!filename) return c.json({ error: 'filename required' }, 400);
  // Replace anything that isn't [A-Za-z0-9._-] so the key is URL-clean.
  const safeName = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 200);
  const key = `notes/${user.id}/${Date.now()}-${safeName}`;

  // `attachments` is the bucket name — attach it to the active project
  // from the Flarelink dashboard's R2 / Files page before first use, OR
  // create it via `wrangler r2 bucket create attachments` if you have
  // direct CLI access.
  //
  // Returns BOTH the presigned URL AND the headers the browser must send
  // on the PUT. The signature is bound to those headers — adding extra
  // headers (or omitting these) makes R2 reject the upload with
  // SignatureDoesNotMatch.
  const { url, signedHeaders } = await flarelink.storage
    .from('attachments')
    .createSignedUploadUrl(key, { contentType, expiresIn: 600 });
  return c.json({ url, signedHeaders, key });
});

// Mint a presigned GET URL so the browser can render attachments.
app.get('/api/attachments/download-url', requireUser, async (c) => {
  const flarelink = server(c);
  const user = c.var.user;
  const key = c.req.query('key');
  if (!key) return c.json({ error: 'key required' }, 400);
  // Defense-in-depth: refuse any key not under this user's prefix.
  if (!key.startsWith(`notes/${user.id}/`)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const { url } = await flarelink.storage
    .from('attachments')
    .createSignedDownloadUrl(key, { expiresIn: 600 });
  return c.json({ url });
});

// ---- 3. SPA fallback ------------------------------------------------
// Everything that didn't match above hands to the assets binding, which
// serves the built Vite SPA + falls back to index.html for client-side
// routes (Login / Signup / Notes etc).
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: (err as Error).message || 'internal error' }, 500);
});

export default app;
