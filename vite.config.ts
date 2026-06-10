import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig({
  // mkcert serves the dev app over HTTPS with a locally-trusted cert.
  // This is REQUIRED for auth in dev: the auth session cookie is
  // `__Secure-…; Secure`, and Safari (+ the cookie's `__Secure-` prefix)
  // refuse to store a Secure cookie over plain http://localhost. Over
  // https://localhost it's stored first-party and sign-in works. First run
  // installs a local CA into your system keychain (may prompt once).
  plugins: [mkcert(), react(), tailwindcss(), cloudflare()],
  server: {
    // Pin so VITE_FLARELINK_URL=https://localhost:5175 in .env stays valid.
    port: 5175,
    strictPort: true,
  },
});
