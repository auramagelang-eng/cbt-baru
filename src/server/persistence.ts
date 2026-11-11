import type { Exam, Question, User, ViolationLog } from '../types/cbt';
import type { StoredSession } from './db';

/**
 * Kontrak lapisan penyimpanan permanen.
 *
 * `DatabaseStore` (src/server/db.ts) tetap menjadi cache in-memory super cepat,
 * tetapi SETIAP perubahan data juga dikirim ke backend permanen lewat hook di
 * bawah ini. Dengan begitu:
 *   - 40 peserta bisa ujian bersamaan tanpa saling menunggu query database,
 *   - data soal / user / jawaban / hasil tetap aman walau proses server
 *     di-restart, crash, atau (di Vercel) berpindah instance.
 *
 * Semua method mengembalikan Promise agar pemanggil bisa menunggu jaminan
 * "sudah tersimpan" (lihat `flush()`) sebelum mengirim HTTP 200 ke client.
 */
export interface SnapshotData {
  users: User[];
  exams: Exam[];
  questionsByExamId: Record<string, Question[]>;
  sessions: StoredSession[];
  violationLogs: ViolationLog[];
}

export interface PersistenceBackend {
  /** true bila backend permanen aktif (env terisi & koneksi siap). */
  readonly ready: boolean;
  readonly kind: 'supabase' | 'none';

  saveUser(user: User): Promise<void>;
  saveUsers(users: User[]): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  clearUsers(): Promise<void>;

  saveExam(exam: Exam): Promise<void>;
  deleteExam(examId: string): Promise<void>;

  saveQuestions(examId: string, questions: Question[]): Promise<void>;
  deleteQuestions(examId: string): Promise<void>;

  saveSession(session: StoredSession): Promise<void>;
  deleteSessions(sessionIds: string[]): Promise<void>;

  logViolation(violation: ViolationLog): Promise<void>;
  deleteViolations(sessionIds?: string[]): Promise<void>;

  /** Hapus seluruh data (dipakai tombol "Wipe All Data" admin). */
  wipeAll(): Promise<void>;

  /** Muat seluruh data dari database (dipakai saat boot / refresh). */
  loadAll(): Promise<SnapshotData>;

  /** true bila semua tulisan yang tertunda sudah benar-benar tersimpan. */
  flush(): Promise<boolean>;
}

/** Backend default: tidak menyimpan apa pun (mode file JSON lokal saja). */
class NoopPersistence implements PersistenceBackend {
  readonly ready = false;
  readonly kind = 'none' as const;

  async saveUser(): Promise<void> {}
  async saveUsers(): Promise<void> {}
  async deleteUser(): Promise<void> {}
  async clearUsers(): Promise<void> {}
  async saveExam(): Promise<void> {}
  async deleteExam(): Promise<void> {}
  async saveQuestions(): Promise<void> {}
  async deleteQuestions(): Promise<void> {}
  async saveSession(): Promise<void> {}
  async deleteSessions(): Promise<void> {}
  async logViolation(): Promise<void> {}
  async deleteViolations(): Promise<void> {}
  async wipeAll(): Promise<void> {}
  async loadAll(): Promise<SnapshotData> {
    return { users: [], exams: [], questionsByExamId: {}, sessions: [], violationLogs: [] };
  }
  async flush(): Promise<boolean> {
    return true;
  }
}

let activeBackend: PersistenceBackend = new NoopPersistence();

/** Dipakai oleh src/server/db.ts (hook tulis) dan controller (flush). */
export function getPersistence(): PersistenceBackend {
  return activeBackend;
}

/** Dipanggil sekali oleh SupabaseStore setelah koneksi siap. */
export function setPersistenceBackend(backend: PersistenceBackend): void {
  activeBackend = backend;
}
