import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  output: 'static',
  adapter: vercel({
    webAnalytics: { enabled: true },
  }),
  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp',
    },
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.notion.com',
      },
    ],
  },
  vite: {
    ssr: {
      external: ['html2canvas', 'jspdf'],
    },
  },
});
