import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// Static marketing site — deployed to Cloudflare Workers static assets.
export default defineConfig({
  site: 'https://hypheahub.com',
  vite: {
    plugins: [tailwindcss()],
  },
});
