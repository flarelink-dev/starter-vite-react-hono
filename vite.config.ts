import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  server: {
    // Pin so VITE_FLARELINK_URL=http://localhost:5174 in .env stays valid.
    port: 5174,
    strictPort: true,
  },
});
