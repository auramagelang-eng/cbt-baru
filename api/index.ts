import { createApp } from '../src/server/app';

/**
 * Vercel Serverless Function.
 *
 * Vercel mengeksekusi file ini untuk semua request `/api/*`
 * (lihat aturan `rewrites` pada vercel.json). Path asli tetap diteruskan ke
 * Express, sehingga route seperti `/api/session/batch-save` tetap cocok.
 *
 * Aplikasi Express dibuat SEKALI per instance (cold start) lalu dipakai ulang
 * oleh request berikutnya. Data tidak hilang saat instance berganti karena
 * `createApp` melakukan hydrate dari Supabase sebelum melayani request.
 */
const appPromise = createApp();

export default async function handler(req: any, res: any) {
  const app = await appPromise;
  return app(req, res);
}
