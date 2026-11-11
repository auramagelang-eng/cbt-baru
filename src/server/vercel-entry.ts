import { createApp } from './app';

/**
 * Sumber handler serverless Vercel.
 *
 * File ini TIDAK dijalankan langsung oleh Vercel. Saat `npm run build` ia
 * dibundel menjadi `dist/handler.cjs` (seluruh dependency ikut di dalamnya),
 * lalu `api/index.js` hanya meneruskan request ke bundel tersebut.
 *
 * Alasan: Vercel menjalankan `api/` sebagai Node ESM TANPA bundling, sehingga
 * import relatif tanpa ekstensi (gaya TypeScript) akan gagal di-resolve dan
 * function mati dengan FUNCTION_INVOCATION_FAILED.
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
