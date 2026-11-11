import { createApp } from './src/server/app';
import { supabaseStore } from './src/server/supabase';

/**
 * Entry point server lokal / Cloud Run.
 * Di Vercel, file ini tidak dipakai — lihat `api/index.ts`.
 */
async function startServer() {
  const app = await createApp();
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
