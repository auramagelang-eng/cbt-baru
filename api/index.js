/**
 * Entry Serverless Function Vercel.
 *
 * File ini sengaja ditulis sebagai ESM murni dengan SATU import yang memakai
 * ekstensi `.cjs`. Vercel mengeksekusi file di folder `api/` sebagai Node ESM
 * tanpa bundling; import relatif tanpa ekstensi (seperti `../src/server/app`)
 * akan gagal di-resolve dan menghasilkan 500 FUNCTION_INVOCATION_FAILED.
 *
 * Seluruh isi aplikasi (Express + dependency) sudah dibundel oleh `npm run build`
 * ke `dist/handler.cjs`, jadi runtime hanya perlu memuat satu file.
 */
import bundle from '../dist/handler.cjs';

const handler = bundle && bundle.default ? bundle.default : bundle;

export default handler;
