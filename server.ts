import type { RequestHandler } from 'express';
import { createApp } from './src/server/app';
import { supabaseStore } from './src/server/supabase';

/**
 * Entry point server lokal / Cloud Run.
 * Di Vercel file ini TIDAK dipakai — entry serverless ada di `api/index.ts`.
 */
async function startServer() {
  let devMiddleware: RequestHandler | undefined;

  // Vite hanya dimuat di mode development, dan hanya dari file ini,
  // supaya bundel serverless produksi tidak ikut membawa Vite/esbuild.
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    devMiddleware = vite.middlewares as unknown as RequestHandler;
  }

  const app = await createApp({ devMiddleware });
  const PORT = Number(process.env.PORT) || 3000;

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CBT Cloud Engine] Server running on http://0.0.0.0:${PORT}`);
    // Siapkan database di latar belakang agar request pertama tidak menunggu.
    void supabaseStore.ensureReady();
  });
}

startServer().catch((err) => {
  console.error('[CBT Cloud Engine] Gagal menjalankan server:', err);
  process.exit(1);
});
