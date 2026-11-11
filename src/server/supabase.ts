import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ensureDatabaseSchema, isMissingSchemaError } from './databaseMigrate';import type { Exam, Question, User, ViolationLog } from '../types/cbt';
import type { StoredSession } from './db';
import {
  getPersistence,
  setPersistenceBackend,
  type PersistenceBackend,
  type SnapshotData,
} from './persistence';

/**
 * ============================================================================
 *  SupabaseStore - penyimpanan permanen seluruh data CBT
 * ============================================================================
 *
 *  Alur data:
 *
 *    HTTP Request  ->  DatabaseStore (cache in-memory, super cepat)
 *                            |
 *                            +--> hook persistence (file ini) --> Supabase
 *
 *  Kenapa tetap pakai cache in-memory?
 *   - 40 peserta mengerjakan ujian bersamaan: baca soal & tulis jawaban tidak
 *     perlu menunggu round-trip database pada setiap render.
 *   - Tulisan tetap dikirim ke Supabase (write-through) dan controller
 *     menunggu `flush()` sebelum membalas HTTP 200, sehingga jawaban siswa
 *     benar-benar tersimpan permanen sebelum dianggap sukses.
 *
 *  Kenapa aman di Vercel (serverless / banyak instance)?
 *   - Setiap instance melakukan hydrate penuh dari Supabase saat cold start
 *     (`ensureReady`).
 *   - Instance yang sudah panas menyegarkan cache secara berkala
 *     (`refreshIfStale`, dibatasi 10 detik sekali) dan melakukan read-through
 *     satu sesi bila sesi belum ada di cache (`loadSession`).
 *
 *  Kegagalan database TIDAK menghilangkan pekerjaan:
 *   - Tulisan yang gagal dicoba ulang 3x dengan backoff.
 *   - Bila masih gagal, operasi disimpan di dead-letter queue dan dicoba lagi
 *     pada `flush()` berikutnya (setiap auto-save peserta memicu flush).
 *   - Endpoint simpan jawaban membalas 503 bila belum durable, sehingga
 *     aplikasi peserta mempertahankan salinan di localStorage dan mengirim ulang.
 */

const TABLES = {
  users: 'cbt_users',
  exams: 'cbt_exams',
  questions: 'cbt_questions',
  sessions: 'cbt_sessions',
  violations: 'cbt_violation_logs',
} as const;

const PAGE_SIZE = 500;
const MAX_UPSERT_CHUNK = 200;
const MAX_DEAD_LETTERS = 500;

/** Interval penyegaran cache dari Supabase (multi-instance / Vercel). */
const REFRESH_INTERVAL_MS = Number(process.env.SUPABASE_REFRESH_MS || 10_000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== '') return value.trim();
  }
  return undefined;
}

/** Buang properti null/undefined agar objek di memori tetap identik dengan tipe. */
function compact<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out as T;
}

function toNumber(value: any): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

function isoOrUndefined(value: any): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Antrian tulisan dengan retry + dead-letter agar tidak ada data yang hilang. */
class DurableWriteQueue {
  private inFlight = new Set<Promise<boolean>>();
  private deadLetters: Array<{ label: string; run: () => Promise<void> }> = [];

  /**
   * Antrikan satu operasi tulis. Hasil akhir (sukses/gagal) tidak perlu
   * di-await oleh pemanggil; gunakan `flush()` untuk memastikan semuanya durable.
   */
  submit(label: string, run: () => Promise<void>): Promise<void> {
    const promise = this.execute(label, run);
    this.inFlight.add(promise);
    void promise.finally(() => this.inFlight.delete(promise));
    return promise.then(() => undefined);
  }

  private async execute(label: string, run: () => Promise<void>, attempt = 1): Promise<boolean> {
    try {
      await run();
      return true;
    } catch (err: any) {
      const message = err?.message || String(err);
      if (attempt < 3) {
        // Backoff singkat: gangguan jaringan sesaat tidak boleh menggagalkan ujian.
        await sleep(150 * attempt * attempt);
        return this.execute(label, run, attempt + 1);
      }
      console.error(`[Supabase] Gagal menyimpan "${label}" setelah 3 percobaan: ${message}`);
      if (this.deadLetters.length >= MAX_DEAD_LETTERS) {
        const dropped = this.deadLetters.shift();
        console.error(`[Supabase] Dead-letter penuh, membuang operasi terlama: ${dropped?.label}`);
      }
      this.deadLetters.push({ label, run });
      return false;
    }
  }

  get pendingCount(): number {
    return this.inFlight.size;
  }

  get failedCount(): number {
    return this.deadLetters.length;
  }

  /**
   * Tunggu semua tulisan selesai, lalu coba ulang operasi yang sebelumnya gagal.
   * @returns true bila seluruh data sudah benar-benar tersimpan di Supabase.
   */
  async flush(): Promise<boolean> {
    if (this.inFlight.size > 0) {
      await Promise.allSettled(Array.from(this.inFlight));
    }

    if (this.deadLetters.length > 0) {
      const retry = this.deadLetters;
      this.deadLetters = [];
      for (const item of retry) {
        await this.execute(item.label, item.run);
      }
    }

    return this.deadLetters.length === 0;
  }
}

/** Jeda antar percobaan inisialisasi ulang setelah gagal (ms). */
const INIT_RETRY_MS = 10_000;

export class SupabaseStore implements PersistenceBackend {
  private client: SupabaseClient | null = null;
  private initPromise: Promise<void> | null = null;
  private isReady = false;
  private lastRefreshAt = 0;
  /**
   * Alasan status penyimpanan (ditampilkan di /api/health):
   * - `ok`              : tersambung ke Supabase (data permanen)
   * - `env-missing`     : env Supabase belum diisi di server/Vercel
   * - `publishable-key` : yang dipakai anon/publishable key, bukan service role
   * - `init-failed`     : env ada tapi koneksi/skema tabel bermasalah
   */
  private statusReason: 'ok' | 'env-missing' | 'publishable-key' | 'init-failed' = 'env-missing';
  private statusMessage = 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diisi.';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  /** Kapan percobaan inisialisasi terakhir dilakukan (untuk jeda percobaan ulang). */
  private lastInitAttemptAt = 0;
  private readonly queue = new DurableWriteQueue();

  readonly kind = 'supabase' as const;

  get ready(): boolean {
    return this.isReady;
  }

  // --------------------------------------------------------------------------
  // Inisialisasi & sinkronisasi
  // --------------------------------------------------------------------------

  /**
   * Dipanggil di setiap request /api; aman dipanggil berkali-kali.
   *
   * Kegagalan TIDAK di-cache selamanya: kalau koneksi/skema baru diperbaiki
   * (mis. tabel cbt_* baru dibuat), instance yang sama bisa pulih sendiri
   * tanpa perlu redeploy. Percobaan ulang dibatasi tiap 10 detik agar tidak
   * membanjiri database.
   */
  ensureReady(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    const now = Date.now();
    if (!this.isReady && this.statusReason === 'init-failed' && now - this.lastInitAttemptAt < INIT_RETRY_MS) {
      return Promise.resolve();
    }
    this.lastInitAttemptAt = now;

    this.initPromise = this.init().finally(() => {
      // Bila gagal, lepaskan promise supaya request berikutnya mencoba lagi.
      if (!this.isReady) this.initPromise = null;
    });
    return this.initPromise;
  }

  private async init(): Promise<void> {
    const url = readEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
    const key = readEnv(
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_SERVICE_KEY',
      'SUPABASE_SECRET_KEY'
    );

    if (!url || !key) {
      this.statusReason = 'env-missing';
      this.statusMessage =
        'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diisi. Database belum tersambung, jadi semua permintaan tulis DITOLAK agar tidak ada data yang hilang.';
      console.warn(
        '[Supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diisi. ' +
          'Aplikasi TIDAK punya penyimpanan permanen: semua permintaan tulis akan ditolak.'
      );
      return;
    }

    if (key.startsWith('sb_publishable_') || key.startsWith('sb_anon')) {
      this.statusReason = 'publishable-key';
      this.statusMessage =
        'Kunci yang dipakai adalah publishable/anon key; gunakan SERVICE ROLE KEY agar data bisa ditulis permanen.';
      console.error(
        '[Supabase] Kunci yang dipakai adalah publishable/anon key. RLS akan menolak ' +
          'semua tulisan. Gunakan SERVICE ROLE KEY di environment server.'
      );
      return;
    }

    try {
      this.client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { 'x-application-name': 'cbt-equiz-platform' } },
        db: { schema: 'public' },
      });

      // Probe ringan: memastikan tabel sudah dibuat (lihat supabase/schema.sql).
      // Bila tabel belum ada, server mencoba membuatnya sendiri lewat
      // SUPABASE_DB_URL memakai skema di src/server/schemaSql.ts.
      let probe = await this.client
        .from(TABLES.exams)
        .select('id', { count: 'exact', head: true });

      if (probe.error && isMissingSchemaError(probe.error)) {
        const migration = await ensureDatabaseSchema();
        console.warn(`[Supabase] ${migration.message}`);
        if (migration.status === 'created' || migration.status === 'exists') {
          probe = await this.client
            .from(TABLES.exams)
            .select('id', { count: 'exact', head: true });
        } else {
          throw new Error(`${probe.error.message}. ${migration.message}`);
        }
      }

      if (probe.error) {
        throw new Error(
          `${probe.error.message}. Pastikan file supabase/schema.sql sudah dijalankan di SQL Editor Supabase.`
        );
      }

      const snapshot = await this.loadAll();
      const isEmpty =
        snapshot.users.length === 0 &&
        snapshot.exams.length === 0 &&
        snapshot.sessions.length === 0;

      let summary = `${snapshot.users.length} user, ${snapshot.exams.length} ujian, ${snapshot.sessions.length} sesi`;

      if (isEmpty) {
        await this.bootstrapFromLocalMemory();
        const { dbStore } = await import('./db');
        const uploaded = dbStore.getFullSnapshot();
        summary = `${uploaded.users.length} user, ${uploaded.exams.length} ujian, ${uploaded.sessions.length} sesi (data awal diunggah)`;
      } else {
        // Cache in-memory diisi dari database (sumber kebenaran).
        const { dbStore } = await import('./db');
        dbStore.hydrate(snapshot);
        summary += ' (dimuat dari database)';
      }

      this.isReady = true;
      // Pastikan baris admin ada di database (dibutuhkan login admin), tanpa
      // pernah membuat soal/ujian/peserta contoh.
      const { dbStore: store } = await import('./db');
      store.ensureAdminAccount();
      this.statusReason = 'ok';
      this.statusMessage = `Tersambung ke Supabase: ${summary}.`;
      setPersistenceBackend(this);
      this.lastRefreshAt = Date.now();
      this.startRefreshTimer();

      console.log(`[Supabase] Terhubung: ${summary}.`);
    } catch (err: any) {
      console.error('[Supabase] Inisialisasi gagal:', err?.message || err);
      this.client = null;
      this.isReady = false;
      this.statusReason = 'init-failed';
      this.statusMessage = `Koneksi Supabase gagal: ${err?.message || err}`;
    }
  }

  /** Database kosong (deploy pertama): unggah data awal dari memori (mis. akun admin). */
  private async bootstrapFromLocalMemory(): Promise<void> {
    const { dbStore } = await import('./db');
    const snapshot = dbStore.getFullSnapshot();

    if (snapshot.users.length === 0 && snapshot.exams.length === 0) {
      console.warn('[Supabase] Tidak ada data awal untuk diunggah. Database dibiarkan kosong.');
      return;
    }

    console.log('[Supabase] Database kosong -> mengunggah data awal (soal, peserta, admin)...');
    await this.upsertUsers(snapshot.users);
    for (const exam of snapshot.exams) await this.upsertExam(exam);
    for (const [examId, questions] of Object.entries(snapshot.questionsByExamId)) {
      await this.upsertQuestions(examId, questions);
    }
    for (const session of snapshot.sessions) await this.upsertSession(session);
    for (const violation of snapshot.violationLogs) await this.insertViolation(violation);
    console.log('[Supabase] Data awal berhasil diunggah.');
  }

  /**
   * Timer refresh hanya untuk proses long-running (lokal / Cloud Run).
   * Di Vercel timer tidak dijalankan agar function tetap bisa idle/scale-to-zero.
   */
  private startRefreshTimer(): void {
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return;
    if (this.refreshTimer) return;

    this.refreshTimer = setInterval(() => {
      void this.refreshIfStale(REFRESH_INTERVAL_MS);
    }, Math.max(REFRESH_INTERVAL_MS, 5_000));
    this.refreshTimer.unref?.();
  }

  /**
   * Segarkan cache dari database paling sering sekali per `minIntervalMs`.
   * Dilewati bila masih ada tulisan tertunda supaya perubahan lokal tidak tertimpa.
   */
  async refreshIfStale(minIntervalMs = REFRESH_INTERVAL_MS): Promise<void> {
    if (!this.isReady || !this.client) return;
    if (this.queue.pendingCount > 0) return;
    // Jangan menimpa cache lokal selama masih ada tulisan yang gagal tersimpan,
    // supaya soal/ujian yang baru dibuat admin tidak "hilang lagi".
    if (this.queue.failedCount > 0) return;
    if (Date.now() - this.lastRefreshAt < minIntervalMs) return;

    this.lastRefreshAt = Date.now();
    try {
      const snapshot = await this.loadAll();
      const { dbStore } = await import('./db');
      dbStore.hydrate(snapshot);
    } catch (err: any) {
      console.warn('[Supabase] Refresh cache gagal (dilewati):', err?.message || err);
    }
  }

  /**
   * Read-through bank soal satu ujian langsung dari database.
   *
   * Dipakai halaman admin supaya daftar soal SELALU sama dengan isi database,
   * walaupun request mendarat di instance serverless yang cache-nya masih lama.
   * Null berarti database belum siap → pemanggil memakai cache in-memory.
   */
  async loadExamQuestions(examId: string): Promise<Question[] | null> {
    if (!this.isReady || !this.client || !examId) return null;
    try {
      const { data, error } = await this.client
        .from(TABLES.questions)
        .select('*')
        .eq('exam_id', examId)
        .order('position', { ascending: true });
      if (error) throw new Error(error.message);

      const questions = (data || []).map((row: any) => rowToQuestion(row));
      const { dbStore } = await import('./db');
      dbStore.replaceQuestionsFromRemote(examId, questions);
      return questions;
    } catch (err: any) {
      console.warn('[Supabase] Read-through soal gagal (memakai cache):', err?.message || err);
      return null;
    }
  }

  /** Read-through satu sesi (dipakai bila instance Vercel belum punya sesi di cache). */
  async loadSession(sessionId: string): Promise<boolean> {
    if (!this.isReady || !this.client || !sessionId) return false;
    try {
      const { data, error } = await this.client
        .from(TABLES.sessions)
        .select('*')
        .eq('session_id', sessionId)
        .maybeSingle();
      if (error || !data) return false;

      const { dbStore } = await import('./db');
      dbStore.upsertSessionFromRemote(rowToSession(data));
      return true;
    } catch (err: any) {
      console.warn('[Supabase] Read-through sesi gagal:', err?.message || err);
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Query dasar
  // --------------------------------------------------------------------------

  private async fetchAll<T = any>(table: string): Promise<T[]> {
    if (!this.client) throw new Error('Supabase client belum siap');
    const rows: T[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await this.client
        .from(table)
        .select('*')
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;

      rows.push(...(data as T[]));
      if (data.length < PAGE_SIZE) break;
    }

    return rows;
  }

  private async upsertRows(table: string, rows: any[], onConflict: string): Promise<void> {
    if (!this.client) throw new Error('Supabase client belum siap');
    if (rows.length === 0) return;

    for (let i = 0; i < rows.length; i += MAX_UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + MAX_UPSERT_CHUNK);
      const { error } = await this.client.from(table).upsert(chunk, { onConflict });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  }

  private async deleteWhere(
    table: string,
    column: string,
    values: string | string[]
  ): Promise<void> {
    if (!this.client) throw new Error('Supabase client belum siap');
    const query = this.client.from(table).delete();
    const { error } = Array.isArray(values)
      ? await query.in(column, values)
      : await query.eq(column, values);
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  async loadAll(): Promise<SnapshotData> {
    const [users, exams, questions, sessions, violations] = await Promise.all([
      this.fetchAll(TABLES.users),
      this.fetchAll(TABLES.exams),
      this.fetchAll(TABLES.questions),
      this.fetchAll(TABLES.sessions),
      this.fetchAll(TABLES.violations),
    ]);

    const questionsByExamId: Record<string, Question[]> = {};
    questions
      .filter((row) => row?.exam_id)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .forEach((row) => {
        const examId = String(row.exam_id);
        if (!questionsByExamId[examId]) questionsByExamId[examId] = [];
        questionsByExamId[examId].push(rowToQuestion(row));
      });

    return {
      users: users.map(rowToUser),
      exams: exams.map(rowToExam),
      questionsByExamId,
      sessions: sessions.map(rowToSession),
      violationLogs: violations.map(rowToViolation),
    };
  }

  async flush(): Promise<boolean> {
    if (!this.isReady) return true; // tanpa Supabase, file JSON lokal yang menjadi penyimpanan
    return this.queue.flush();
  }

  getStatus() {
    return {
      mode: this.isReady ? 'supabase' : 'file',
      reason: this.statusReason,
      message: this.statusMessage,
      durable: this.isReady,
      pendingWrites: this.queue.pendingCount,
      failedWrites: this.queue.failedCount,
    };
  }

  // --------------------------------------------------------------------------
  // Hook tulis (dipanggil DatabaseStore)
  // --------------------------------------------------------------------------

  private async upsertUsers(users: User[]): Promise<void> {
    await this.upsertRows(TABLES.users, users.map(userToRow), 'id');
  }

  private async upsertExam(exam: Exam): Promise<void> {
    await this.upsertRows(TABLES.exams, [examToRow(exam)], 'id');
  }

  private async upsertQuestions(examId: string, questions: Question[]): Promise<void> {
    // Primary key gabungan: satu soal boleh dipakai di lebih dari satu ujian.
    await this.upsertRows(
      TABLES.questions,
      questions.map((q, index) => questionToRow(examId, q, index)),
      'exam_id,id'
    );
  }

  private async upsertSession(session: StoredSession): Promise<void> {
    await this.upsertRows(TABLES.sessions, [sessionToRow(session)], 'session_id');
  }

  private async insertViolation(violation: ViolationLog): Promise<void> {
    await this.upsertRows(TABLES.violations, [violationToRow(violation)], 'id');
  }

  // -- Peserta / user -------------------------------------------------------

  saveUser(user: User): Promise<void> {
    return this.queue.submit(`user ${user.id}`, () => this.upsertUsers([user]));
  }

  saveUsers(users: User[]): Promise<void> {
    if (users.length === 0) return Promise.resolve();
    return this.queue.submit(`users batch (${users.length})`, () => this.upsertUsers(users));
  }

  deleteUser(userId: string): Promise<void> {
    return this.queue.submit(`hapus user ${userId}`, () =>
      this.deleteWhere(TABLES.users, 'id', userId)
    );
  }

  clearUsers(): Promise<void> {
    return this.queue.submit('kosongkan user', () =>
      this.deleteWhere(TABLES.users, 'role', 'PARTICIPANT')
    );
  }

  // -- Ujian & soal ---------------------------------------------------------

  saveExam(exam: Exam): Promise<void> {
    return this.queue.submit(`ujian ${exam.id}`, () => this.upsertExam(exam));
  }

  deleteExam(examId: string): Promise<void> {
    return this.queue.submit(`hapus ujian ${examId}`, async () => {
      await this.deleteWhere(TABLES.exams, 'id', examId);
      await this.deleteWhere(TABLES.questions, 'exam_id', examId);
    });
  }

  saveQuestions(examId: string, questions: Question[]): Promise<void> {
    return this.queue.submit(`soal ujian ${examId} (${questions.length})`, async () => {
      await this.upsertQuestions(examId, questions);
      // Hapus soal yang sudah tidak ada lagi di bank soal ujian ini.
      if (!this.client) return;
      const keepIds = questions.map((q) => q.id);
      const { data, error } = await this.client
        .from(TABLES.questions)
        .select('id')
        .eq('exam_id', examId);
      if (error) throw new Error(error.message);
      const staleIds = (data || [])
        .map((row: any) => row.id)
        .filter((id: string) => !keepIds.includes(id));
      if (staleIds.length > 0) {
        const { error: deleteError } = await this.client
          .from(TABLES.questions)
          .delete()
          .eq('exam_id', examId)
          .in('id', staleIds);
        if (deleteError) throw new Error(deleteError.message);
      }
    });
  }

  deleteQuestions(examId: string): Promise<void> {
    return this.queue.submit(`hapus soal ujian ${examId}`, () =>
      this.deleteWhere(TABLES.questions, 'exam_id', examId)
    );
  }

  // -- Sesi ujian & jawaban -------------------------------------------------

  saveSession(session: StoredSession): Promise<void> {
    return this.queue.submit(`sesi ${session.sessionId}`, () => this.upsertSession(session));
  }

  deleteSessions(sessionIds: string[]): Promise<void> {
    if (sessionIds.length === 0) return Promise.resolve();
    return this.queue.submit(`hapus ${sessionIds.length} sesi`, async () => {
      await this.deleteWhere(TABLES.sessions, 'session_id', sessionIds);
      await this.deleteWhere(TABLES.violations, 'session_id', sessionIds);
    });
  }

  // -- Pelanggaran ----------------------------------------------------------

  logViolation(violation: ViolationLog): Promise<void> {
    return this.queue.submit(`pelanggaran ${violation.id}`, () =>
      this.insertViolation(violation)
    );
  }

  deleteViolations(sessionIds?: string[]): Promise<void> {
    return this.queue.submit('hapus pelanggaran', async () => {
      if (!this.client) throw new Error('Supabase client belum siap');
      if (sessionIds && sessionIds.length > 0) {
        await this.deleteWhere(TABLES.violations, 'session_id', sessionIds);
        return;
      }
      const { error } = await this.client
        .from(TABLES.violations)
        .delete()
        .neq('id', '__never__');
      if (error) throw new Error(error.message);
    });
  }

  // -- Wipe total -----------------------------------------------------------

  /** Hapus seluruh baris tabel (Supabase mewajibkan filter pada DELETE). */
  private async deleteAllRows(table: string, primaryKey: string): Promise<void> {
    if (!this.client) throw new Error('Supabase client belum siap');
    const { error } = await this.client.from(table).delete().neq(primaryKey, '__none__');
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  async wipeAll(): Promise<void> {
    // Urutan penting: detail dulu, induk terakhir.
    await this.deleteAllRows(TABLES.violations, 'id');
    await this.deleteAllRows(TABLES.sessions, 'session_id');
    await this.deleteAllRows(TABLES.questions, 'id');
    await this.deleteAllRows(TABLES.exams, 'id');
    await this.deleteWhere(TABLES.users, 'role', 'PARTICIPANT');
  }
}

// ============================================================================
//  Mapping baris database <-> objek aplikasi
// ============================================================================

function userToRow(user: User) {
  return compact({
    id: user.id,
    username: user.username,
    name: user.name,
    original_name: user.originalName ?? null,
    role: user.role,
    participant_code: user.participantCode ?? null,
    token: user.token ?? null,
    active_device_id: user.activeDeviceId ?? null,
    ip_address: user.ipAddress ?? null,
  });
}

function rowToUser(row: any): User {
  return compact({
    id: row.id,
    username: row.username,
    name: row.name,
    originalName: row.original_name ?? undefined,
    role: row.role,
    participantCode: row.participant_code ?? undefined,
    token: row.token ?? undefined,
    activeDeviceId: row.active_device_id ?? undefined,
    ipAddress: row.ip_address ?? undefined,
  }) as User;
}

function examToRow(exam: Exam) {
  return compact({
    id: exam.id,
    title: exam.title,
    subject: exam.subject,
    duration_minutes: exam.durationMinutes,
    total_questions: exam.totalQuestions,
    pass_percentage: exam.passPercentage,
    token: exam.token ?? null,
    is_active: exam.isActive,
    shuffle_questions: exam.shuffleQuestions,
    shuffle_answers: exam.shuffleAnswers,
    max_violations: exam.maxViolations,
    max_attempts: exam.maxAttempts ?? 3,
    is_per_question_timed: exam.isPerQuestionTimed ?? false,
    question_duration_seconds: exam.questionDurationSeconds ?? 30,
    is_strict_timer: exam.isStrictTimer ?? true,
    show_instant_feedback: exam.showInstantFeedback ?? false,
    show_answer_keys: exam.showAnswerKeys ?? true,
    created_at: exam.createdAt || new Date().toISOString(),
  });
}

function rowToExam(row: any): Exam {
  return compact({
    id: row.id,
    title: row.title,
    subject: row.subject,
    durationMinutes: toNumber(row.duration_minutes) ?? 60,
    totalQuestions: toNumber(row.total_questions) ?? 0,
    passPercentage: toNumber(row.pass_percentage) ?? 70,
    token: row.token ?? '',
    isActive: row.is_active !== false,
    shuffleQuestions: row.shuffle_questions !== false,
    shuffleAnswers: row.shuffle_answers !== false,
    maxViolations: toNumber(row.max_violations) ?? 3,
    maxAttempts: toNumber(row.max_attempts) ?? 3,
    isPerQuestionTimed: row.is_per_question_timed ?? false,
    questionDurationSeconds: toNumber(row.question_duration_seconds) ?? 30,
    isStrictTimer: row.is_strict_timer ?? true,
    showInstantFeedback: row.show_instant_feedback ?? false,
    showAnswerKeys: row.show_answer_keys ?? true,
    createdAt: isoOrUndefined(row.created_at) || new Date().toISOString(),
  }) as Exam;
}

function questionToRow(examId: string, question: Question, position: number) {
  return compact({
    id: question.id,
    exam_id: examId,
    position,
    type: question.type,
    question_text: question.questionText,
    image_url: question.imageUrl ?? null,
    points: question.points ?? 0,
    options: question.options ?? [],
    correct_option_id: question.correctOptionId ?? null,
    essay_answer_key: question.essayAnswerKey ?? null,
    essay_ai_rubric: question.essayAiRubric ?? null,
    short_answer_key: question.shortAnswerKey ?? null,
    short_answer_keys: question.shortAnswerKeys ?? null,
    answer_key: question.answerKey ?? null,
    short_answer_multi_key: question.shortAnswerMultiKey ?? null,
    is_case_sensitive: question.isCaseSensitive ?? null,
  });
}

function rowToQuestion(row: any): Question {
  return compact({
    id: row.id,
    examId: row.exam_id,
    type: row.type,
    questionText: row.question_text,
    imageUrl: row.image_url ?? undefined,
    points: toNumber(row.points) ?? 0,
    options: Array.isArray(row.options) ? row.options : [],
    correctOptionId: row.correct_option_id ?? undefined,
    essayAnswerKey: row.essay_answer_key ?? undefined,
    essayAiRubric: row.essay_ai_rubric ?? undefined,
    shortAnswerKey: row.short_answer_key ?? undefined,
    shortAnswerKeys: row.short_answer_keys ?? undefined,
    answerKey: row.answer_key ?? undefined,
    shortAnswerMultiKey: row.short_answer_multi_key ?? undefined,
    isCaseSensitive: row.is_case_sensitive ?? undefined,
  }) as Question;
}

function sessionToRow(session: StoredSession) {
  return compact({
    session_id: session.sessionId,
    exam_id: session.examId,
    participant_id: session.participantId,
    attempt_number: session.attemptNumber ?? 1,
    start_time: session.startTime ?? 0,
    end_time: session.endTime ?? 0,
    shuffled_questions: session.shuffledQuestions ?? [],
    answers: session.answers ?? {},
    violations_count: session.violationsCount ?? 0,
    status: session.status ?? 'IN_PROGRESS',
    submitted_at: session.submittedAt ?? null,
    score: session.score ?? null,
    max_score: session.maxScore ?? null,
    current_question_index: session.currentQuestionIndex ?? null,
    active_device_id: session.activeDeviceId ?? null,
    ip_address: session.ipAddress ?? null,
  });
}

function rowToSession(row: any): StoredSession {
  return compact({
    sessionId: row.session_id,
    examId: row.exam_id,
    participantId: row.participant_id,
    attemptNumber: toNumber(row.attempt_number) ?? 1,
    startTime: toNumber(row.start_time) ?? 0,
    endTime: toNumber(row.end_time) ?? 0,
    shuffledQuestions: Array.isArray(row.shuffled_questions) ? row.shuffled_questions : [],
    answers: row.answers && typeof row.answers === 'object' ? row.answers : {},
    violationsCount: toNumber(row.violations_count) ?? 0,
    status: row.status ?? 'IN_PROGRESS',
    submittedAt: isoOrUndefined(row.submitted_at),
    score: toNumber(row.score),
    maxScore: toNumber(row.max_score),
    currentQuestionIndex: toNumber(row.current_question_index),
    activeDeviceId: row.active_device_id ?? undefined,
    ipAddress: row.ip_address ?? undefined,
  }) as StoredSession;
}

function violationToRow(violation: ViolationLog) {
  return compact({
    id: violation.id,
    session_id: violation.sessionId,
    participant_name: violation.participantName ?? '',
    type: violation.type,
    details: violation.details ?? '',
    created_at: isoOrUndefined(violation.timestamp) || new Date().toISOString(),
  });
}

function rowToViolation(row: any): ViolationLog {
  return {
    id: row.id,
    sessionId: row.session_id,
    participantName: row.participant_name || '',
    type: row.type,
    details: row.details || '',
    timestamp: isoOrUndefined(row.created_at) || new Date().toISOString(),
  };
}

/** Instance tunggal yang dipakai seluruh server. */
export const supabaseStore = new SupabaseStore();

/** Helper untuk controller: benar bila seluruh data sudah durable. */
export async function flushPersistence(): Promise<boolean> {
  const backend = getPersistence();
  // Tanpa backend permanen (mis. env Supabase kosong di Vercel) tidak ada
  // jaminan apa pun data tersimpan. Jangan pernah membalas `persisted: true`
  // secara palsu: itu yang membuat admin merasa soal sudah masuk padahal
  // hanya ada di memori instance.
  if (!backend.ready) return false;
  return backend.flush();
}
