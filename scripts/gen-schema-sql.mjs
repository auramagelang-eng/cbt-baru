/**
 * Menyalin supabase/schema.sql menjadi modul TypeScript (src/server/schemaSql.ts)
 * agar skema bisa dijalankan otomatis oleh server tanpa membaca file saat runtime
 * (filesystem Vercel tidak menyertakan file sembarangan di dalam function).
 */
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const sql = fs.readFileSync(path.join(root, 'supabase', 'schema.sql'), 'utf8');
const out = `// FILE INI DIHASILKAN OTOMATIS oleh scripts/gen-schema-sql.mjs dari supabase/schema.sql.\n// Jangan diedit manual: ubah supabase/schema.sql lalu jalankan ulang skrip tersebut.\nexport const SCHEMA_SQL: string = ${JSON.stringify(sql)};\n`;
fs.writeFileSync(path.join(root, 'src', 'server', 'schemaSql.ts'), out);
console.log('schemaSql.ts diperbarui dari supabase/schema.sql');
