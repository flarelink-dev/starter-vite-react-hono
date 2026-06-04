// Browser-side Flarelink client.
//
// IMPORTANT: no `serviceKey` here. The browser only ever calls
// flarelink.auth.* (signUp / signIn / signOut / getSession). For db +
// storage we go through this Worker's server routes, which DO carry the
// service key (server/index.ts).
//
// `url` points at THIS Worker, not at the auth Worker directly. The
// server proxies /api/auth/* to the auth Worker so the session cookie
// lands on the app's own domain. See server/index.ts for the proxy.

import { createFlarelink } from '@flarelink/client';

const url = import.meta.env.VITE_FLARELINK_URL;
if (!url) {
  throw new Error(
    'Missing VITE_FLARELINK_URL. Copy .env.example to .env and fill it in.',
  );
}

export const flarelink = createFlarelink({ url });
