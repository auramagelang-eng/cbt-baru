import { Client } from 'pg';
import { SCHEMA_SQL } from './schemaSql';

/**
 * Migrasi otomatis skema database.
 *
 * Masalah yang diselesaikan: bila tabel `cbt_*` belum pernah dibuat di project
 * Supabase, API Supabase membalas "Could not find the table 'public.cbt_questions'
 * in the schema cache" dan seluruh penyimpanan gagal. Dengan env `SUPABASE_DB_URL`
 * (Supabase -> Settings -> Database -> Connection string), server bisa membuat
 * tabelnya sendiri dari `supabase/schema.sql` saat pertama kali berjalan.
 */

export interface MigrationResult {
  status: 'created' | 'exists' | 'no-credentials' | 'failed';
  message: string;
}

export const REQUIRED_TABLES = [
  'cbt_users',
  'cbt_exams',
  'cbt_questions',
  'cbt_sessions',
  'cbt_violation_logs',
];

/** Ambil connection string Postgres bila tersedia (beberapa nama env didukung). */
export function getDatabaseUrl(): string | null {
  const raw =
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    '';
  const url = raw.trim();
  return url ? url : null;
}

/**
 * Pesan bantuan saat tabel tidak ada dan migrasi tidak bisa dijalankan.
 * Dipakai juga oleh /api/health supaya penyebabnya jelas.
 */
export const SCHEMA_HINT =
  'Tabel cbt_* belum ada di database. Jalankan supabase/schema.sql di Supabase SQL Editor, ' +
  'atau isi env SUPABASE_DB_URL (Supabase -> Settings -> Database -> Connection string) ' +
  'agar server membuat tabelnya otomatis.';

/** True bila error Supabase berarti tabel/skema belum ada. */
export function isMissingSchemaError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = (error.message || '').toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    message.includes('could not find the table') ||
    message.includes('schema cache') ||
    message.includes('does not exist')
  );
}

let inFlight: Promise<MigrationResult> | null = null;

/** Jalankan migrasi sekali per instance (hasil di-cache; kegagalan boleh dicoba lagi). */
export function ensureDatabaseSchema(): Promise<MigrationResult> {
  if (!inFlight) {
    inFlight = runMigration().then((result) => {
      if (result.status === 'failed') inFlight = null;
      return result;
    });
  }
  return inFlight;
}

async function listExistingTables(client: Client): Promise<Set<string>> {
  const { rows } = await client.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])`,
    [REQUIRED_TABLES]
  );
  return new Set(rows.map((row) => row.table_name));
}

async function runMigration(): Promise<MigrationResult> {
  const url = getDatabaseUrl();
  if (!url) {
    return {
      status: 'no-credentials',
      message: `SUPABASE_DB_URL belum diisi. ${SCHEMA_HINT}`,
    };
  }

  const client = new Client({
    connectionString: url,
    // Supabase memakai sertifikat yang tidak selalu ada di CA lokal.
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const existing = await listExistingTables(client);
    const missing = REQUIRED_TABLES.filter((table) => !existing.has(table));
    if (missing.length === 0) {
      return { status: 'exists', message: 'Semua tabel cbt_* sudah tersedia di database.' };
    }

    console.log(`[Migrasi] Membuat tabel yang belum ada: ${missing.join(', ')}`);
    await client.query(SCHEMA_SQL);

    const after = await listExistingTables(client);
    const stillMissing = REQUIRED_TABLES.filter((table) => !after.has(table));
    if (stillMissing.length > 0) {
      return {
        status: 'failed',
        message: `Tabel belum lengkap setelah migrasi: ${stillMissing.join(', ')}.`,
      };
    }

    return {
      status: 'created',
      message: `Tabel database berhasil dibuat otomatis: ${missing.join(', ')}.`,
    };
  } catch (err: any) {
    return {
      status: 'failed',
      message: `Migrasi database gagal: ${err?.message || err}. ${SCHEMA_HINT}`,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
