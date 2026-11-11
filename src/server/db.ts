import { User, Exam, Question, ParticipantAnswer, ViolationLog, ExamResult } from '../types/cbt';
import fs from 'fs';
import path from 'path';
import { getPersistence, type PersistenceBackend, type SnapshotData } from './persistence';

export interface StoredSession {
  sessionId: string;
  examId: string;
  participantId: string;
  attemptNumber?: number;
  startTime: number;
  endTime: number;
  shuffledQuestions: Question[];
  answers: Record<string, ParticipantAnswer>;
  violationsCount: number;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'AUTO_SUBMITTED';
  submittedAt?: string;
  score?: number;
  maxScore?: number;
  currentQuestionIndex?: number;
  activeDeviceId?: string;
  ipAddress?: string;
}

const DB_FILE_PATH = path.join(process.cwd(), 'db_store.json');

class DatabaseStore {
  private users = new Map<string, User>();
  private usersByToken = new Map<string, User>();
  private usersByParticipantCode = new Map<string, User>();

  private exams = new Map<string, Exam>();
  private examsByToken = new Map<string, Exam>();

  private questionsByExamId = new Map<string, Question[]>();
  private sessions = new Map<string, StoredSession>();
  private sessionsByParticipantExam = new Map<string, StoredSession>(); // Key: `${participantId}_${examId}`

  private violationLogs: ViolationLog[] = [];

  public queryCount = 0;
  public totalRequests = 0;
  public savedRequestsCount = 0; // Each batch save saves N-1 per-question requests

  /**
   * Bila false, snapshot JSON tidak lagi ditulis ke disk.
   * Di Vercel filesystem bersifat read-only & sementara, jadi penyimpanan
   * permanen sepenuhnya diserahkan ke Supabase.
   */
  private diskPersistenceEnabled = true;

  /** Saat hydrate dari database, hook tulis dimatikan agar tidak menulis balik. */
  private suppressPersistence = false;

  constructor() {
    // Vercel: filesystem read-only & ephemeral, jangan pernah menulis snapshot.
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      this.diskPersistenceEnabled = false;
    }

    if (!this.loadPersistedData()) {
      // Tidak ada snapshot lokal: mulai kosong, hanya admin yang dibuat.
      this.persistData();
    }
    this.ensureAdminAccount();
  }

  /**
   * Simpan perubahan satu user (nama, token, kunci perangkat) ke cache + database.
   * Dipakai saat login peserta mengunci perangkat atau mengubah nama.
   */
  public saveUser(user: User): void {
    this.queryCount++;

    // Bersihkan index lama agar token/kode yang berubah tidak menyisakan entri basi.
    for (const [key, u] of this.usersByToken.entries()) {
      if (u.id === user.id) this.usersByToken.delete(key);
    }
    for (const [key, u] of this.usersByParticipantCode.entries()) {
      if (u.id === user.id) this.usersByParticipantCode.delete(key);
    }

    this.indexUser(user);
    this.persistData();
    this.persistToBackend((p) => p.saveUser(user));
  }

  /** Dipanggil server saat berjalan di lingkungan serverless (Vercel). */
  public setDiskPersistence(enabled: boolean): void {
    this.diskPersistenceEnabled = enabled;
  }

  /** true bila snapshot JSON lokal masih dipakai (bukan di Vercel). */
  public isDiskPersistenceEnabled(): boolean {
    return this.diskPersistenceEnabled;
  }

  /**
   * Kirim setiap perubahan ke backend permanen (Supabase).
   * Fire-and-forget: request tidak menunggu jaringan, tetapi controller bisa
   * menunggu `flush()` untuk memastikan data benar-benar tersimpan.
   */
  private persistToBackend(op: (backend: PersistenceBackend) => Promise<void>): void {
    if (this.suppressPersistence) return;
    const backend = getPersistence();
    if (!backend.ready) return;
    try {
      void op(backend);
    } catch (err) {
      console.error('[DatabaseStore] Gagal mengirim perubahan ke database:', err);
    }
  }

  private indexUser(user: User): void {
    this.users.set(user.id, user);
    if (user.token) {
      const upper = user.token.trim().toUpperCase();
      this.usersByToken.set(upper, user);
      this.usersByToken.set(upper.replace(/[\/\-\_\s]/g, ''), user);
    }
    if (user.participantCode) {
      const upper = user.participantCode.trim().toUpperCase();
      this.usersByParticipantCode.set(upper, user);
      this.usersByParticipantCode.set(upper.replace(/[\/\-\_\s]/g, ''), user);
    }
  }

  private indexExam(exam: Exam): void {
    this.exams.set(exam.id, exam);
    if (exam.token) {
      const upper = exam.token.trim().toUpperCase();
      this.examsByToken.set(upper, exam);
      this.examsByToken.set(upper.replace(/[\/\-\_\s]/g, ''), exam);
    }
  }

  /** Snapshot lengkap (dipakai untuk bootstrap / migrasi ke Supabase). */
  public getFullSnapshot(): SnapshotData {
    return {
      users: Array.from(this.users.values()),
      exams: Array.from(this.exams.values()),
      questionsByExamId: Object.fromEntries(this.questionsByExamId.entries()),
      sessions: Array.from(this.sessions.values()),
      violationLogs: [...this.violationLogs],
    };
  }

  public isEmpty(): boolean {
    return this.users.size === 0 && this.exams.size === 0 && this.sessions.size === 0;
  }

  /**
   * Isi ulang cache in-memory dari database (sumber kebenaran).
   * Tidak memicu penulisan balik ke database dan tidak menghapus penghitung metrik.
   */
  public hydrate(snapshot: SnapshotData): void {
    this.suppressPersistence = true;
    try {
      this.users.clear();
      this.usersByToken.clear();
      this.usersByParticipantCode.clear();
      snapshot.users.forEach((user) => this.indexUser(user));
      // Admin tidak boleh hilang walau tabel database belum punya barisnya.
      this.ensureAdminAccount();

      this.exams.clear();
      this.examsByToken.clear();
      snapshot.exams.forEach((exam) => this.indexExam(exam));

      this.questionsByExamId.clear();
      Object.entries(snapshot.questionsByExamId || {}).forEach(([examId, questions]) => {
        this.questionsByExamId.set(examId, questions);
      });

      // Gabungkan sesi: sesi IN_PROGRESS yang hidup di instance ini TIDAK
      // ditimpa data lama dari database (bisa menghapus jawaban terbaru).
      const previousSessions = new Map(this.sessions);
      const remoteIds = new Set(snapshot.sessions.map((session) => session.sessionId));

      this.sessions.clear();
      this.sessionsByParticipantExam.clear();

      snapshot.sessions.forEach((remote) => {
        const local = previousSessions.get(remote.sessionId);
        const keepLocal =
          !!local && local.status === 'IN_PROGRESS' && remote.status === 'IN_PROGRESS';
        const chosen = keepLocal ? local! : remote;

        this.sessions.set(chosen.sessionId, chosen);
        this.sessionsByParticipantExam.set(
          `${chosen.participantId}_${chosen.examId}`,
          chosen
        );
      });

      // Sesi lokal yang belum sempat tercatat di database tetap dipertahankan.
      previousSessions.forEach((local, sessionId) => {
        if (remoteIds.has(sessionId)) return;
        if (local.status !== 'IN_PROGRESS') return;
        this.sessions.set(sessionId, local);
        this.sessionsByParticipantExam.set(
          `${local.participantId}_${local.examId}`,
          local
        );
      });

      this.violationLogs = [...(snapshot.violationLogs || [])];
    } finally {
      this.suppressPersistence = false;
    }
  }

  /**
   * Ganti daftar soal satu ujian dengan hasil read-through dari Supabase.
   * Tidak menulis balik ke backend, supaya tidak terjadi loop tulis-baca.
   */
  public replaceQuestionsFromRemote(examId: string, questions: Question[]): void {
    this.suppressPersistence = true;
    try {
      this.questionsByExamId.set(examId, questions);
      const exam = this.exams.get(examId);
      if (exam) {
        exam.totalQuestions = questions.length;
        this.exams.set(examId, exam);
      }
    } finally {
      this.suppressPersistence = false;
    }
  }

  /** Sisipkan satu sesi hasil read-through Supabase tanpa menulis balik. */
  public upsertSessionFromRemote(session: StoredSession): void {
    this.suppressPersistence = true;
    try {
      this.sessions.set(session.sessionId, session);
      this.sessionsByParticipantExam.set(
        `${session.participantId}_${session.examId}`,
        session
      );
    } finally {
      this.suppressPersistence = false;
    }
  }

  private loadPersistedData(): boolean {
    try {
      if (!fs.existsSync(DB_FILE_PATH)) {
        return false;
      }
      const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8');
      const data = JSON.parse(raw);

      if (!data || !data.users || !data.exams) {
        return false;
      }

      this.users.clear();
      this.usersByToken.clear();
      this.usersByParticipantCode.clear();
      (data.users || []).forEach((u: User) => {
        if (u.role === 'PARTICIPANT' && !u.originalName) {
          if (u.name && (u.name.startsWith('Peserta') || u.name.startsWith('Siswa'))) {
            u.originalName = u.name;
          } else {
            const code = (u.participantCode || u.username || '').toUpperCase();
            const rplMatch = code.match(/^RPL0*(\d+)$/i);
            if (rplMatch) {
              u.originalName = `Peserta RPL ${rplMatch[1].padStart(2, '0')}`;
            } else if (code) {
              u.originalName = `Peserta ${code}`;
            }
          }
        }
        this.users.set(u.id, u);
        if (u.token) this.usersByToken.set(u.token.toUpperCase(), u);
        if (u.participantCode) this.usersByParticipantCode.set(u.participantCode.toUpperCase(), u);
      });

      this.exams.clear();
      this.examsByToken.clear();
      (data.exams || []).forEach((e: Exam) => {
        this.exams.set(e.id, e);
        if (e.token) {
          this.examsByToken.set(e.token.toUpperCase(), e);
          const cleaned = e.token.trim().toUpperCase().replace(/[\/\-\_\s]/g, '');
          this.examsByToken.set(cleaned, e);
        }
      });

      this.questionsByExamId.clear();
      if (data.questionsByExamId) {
        Object.entries(data.questionsByExamId).forEach(([examId, questions]) => {
          this.questionsByExamId.set(examId, questions as Question[]);
        });
      }

      this.sessions.clear();
      this.sessionsByParticipantExam.clear();
      (data.sessions || []).forEach((s: StoredSession) => {
        this.sessions.set(s.sessionId, s);
        this.sessionsByParticipantExam.set(`${s.participantId}_${s.examId}`, s);
      });

      this.violationLogs = data.violationLogs || [];


      console.log('DatabaseStore successfully loaded from persistent file:', DB_FILE_PATH);
      return true;
    } catch (err) {
      console.error('Failed to load db_store.json, falling back to seed data:', err);
      return false;
    }
  }

  private persistTimer: any = null;
  public persistData(immediate = true): void {
    // Di serverless tidak ada disk permanen; Supabase sudah menerima datanya.
    if (!this.diskPersistenceEnabled) return;

    const doWrite = () => {
      try {
        const data = {
          users: Array.from(this.users.values()),
          exams: Array.from(this.exams.values()),
          questionsByExamId: Object.fromEntries(this.questionsByExamId.entries()),
          sessions: Array.from(this.sessions.values()),
          violationLogs: this.violationLogs,
        };
        fs.writeFileSync(DB_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
      } catch (err) {
        console.error('Failed to persist database to disk:', err);
      }
    };

    if (immediate) {
      if (this.persistTimer) clearTimeout(this.persistTimer);
      doWrite();
    } else {
      if (this.persistTimer) clearTimeout(this.persistTimer);
      this.persistTimer = setTimeout(doWrite, 100);
    }
  }

  /**
   * Pastikan akun admin tersedia.
   *
   * Soal, ujian, dan peserta TIDAK PERNAH dibuat otomatis dari kode: seluruh
   * data hanya boleh berasal dari database (Supabase). Ini mencegah data contoh
   * muncul kembali setelah admin menghapusnya.
   */
  public ensureAdminAccount(): void {
    if (this.users.has('usr_admin')) return;
    const adminUser: User = {
      id: 'usr_admin',
      username: 'ahmad',
      name: 'Ahmad (Administrator)',
      role: 'ADMIN',
    };
    this.users.set(adminUser.id, adminUser);
    this.persistToBackend((p) => p.saveUser(adminUser));
  }

  // --- Indexed Data Accessors with Query Counters ---

  public getUserByToken(token: string): User | undefined {
    this.queryCount++;
    if (!token) return undefined;
    const cleanToken = token.trim().toUpperCase();
    const cleanStripped = cleanToken.replace(/[\/\-\_\s]/g, '');

    // 1. Exact match in token index
    let user = this.usersByToken.get(cleanToken) || this.usersByToken.get(cleanStripped);
    if (user) {
      const uToken = (user.token || '').trim().toUpperCase();
      const uTokenClean = uToken.replace(/[\/\-\_\s]/g, '');
      if (uToken === cleanToken || uTokenClean === cleanStripped || uToken === `TK-${cleanToken}`) {
        return user;
      }
      // Stale map entry - clean it up
      this.usersByToken.delete(cleanToken);
      this.usersByToken.delete(cleanStripped);
      user = undefined;
    }

    // 2. Exact match in participantCode index
    user = this.usersByParticipantCode.get(cleanToken) || this.usersByParticipantCode.get(cleanStripped);
    if (user) {
      const uCode = (user.participantCode || '').trim().toUpperCase();
      const uCodeClean = uCode.replace(/[\/\-\_\s]/g, '');
      if (uCode === cleanToken || uCodeClean === cleanStripped) {
        return user;
      }
      this.usersByParticipantCode.delete(cleanToken);
      this.usersByParticipantCode.delete(cleanStripped);
      user = undefined;
    }

    // 3. Fallback scan: case-insensitive match strictly against CURRENT values
    return Array.from(this.users.values()).find(u => {
      const uToken = (u.token || '').trim().toUpperCase();
      const uTokenClean = uToken.replace(/[\/\-\_\s]/g, '');
      const uCode = (u.participantCode || '').trim().toUpperCase();
      const uCodeClean = uCode.replace(/[\/\-\_\s]/g, '');
      const uName = (u.username || '').trim().toUpperCase();
      return (
        uToken === cleanToken ||
        uTokenClean === cleanStripped ||
        uCode === cleanToken ||
        uCodeClean === cleanStripped ||
        uName === cleanToken ||
        uToken === `TK-${cleanToken}`
      );
    });
  }

  public getUserByParticipantCode(code: string): User | undefined {
    this.queryCount++;
    if (!code) return undefined;
    const cleanCode = code.trim().toUpperCase();
    const cleanStripped = cleanCode.replace(/[\/\-\_\s]/g, '');

    let user = this.usersByParticipantCode.get(cleanCode) || this.usersByParticipantCode.get(cleanStripped);
    if (user) {
      const uCode = (user.participantCode || '').trim().toUpperCase();
      const uCodeClean = uCode.replace(/[\/\-\_\s]/g, '');
      if (uCode === cleanCode || uCodeClean === cleanStripped) {
        return user;
      }
      this.usersByParticipantCode.delete(cleanCode);
      this.usersByParticipantCode.delete(cleanStripped);
      user = undefined;
    }

    return Array.from(this.users.values()).find(u => {
      const uCode = (u.participantCode || '').trim().toUpperCase();
      const uCodeClean = uCode.replace(/[\/\-\_\s]/g, '');
      const uName = (u.username || '').trim().toUpperCase();
      return uCode === cleanCode || uCodeClean === cleanStripped || uName === cleanCode;
    });
  }

  public getUserById(id: string): User | undefined {
    this.queryCount++;
    return this.users.get(id);
  }

  public getExamByToken(token: string): Exam | undefined {
    this.queryCount++;
    if (!token) return undefined;
    const rawUpper = token.trim().toUpperCase();
    const cleanToken = rawUpper.replace(/[\/\-\_\s]/g, '');

    // 1. Direct map lookup
    let exam = this.examsByToken.get(rawUpper) || this.examsByToken.get(cleanToken);
    if (exam) {
      // STRICT CHECK: The exam's current token MUST strictly match the searched token!
      const currentUpper = (exam.token || '').trim().toUpperCase();
      const currentClean = currentUpper.replace(/[\/\-\_\s]/g, '');
      if (currentUpper === rawUpper || currentClean === cleanToken) {
        return exam;
      }
      // Outdated token index entry detected! Purge it from map
      this.examsByToken.delete(rawUpper);
      this.examsByToken.delete(cleanToken);
      exam = undefined;
    }

    // 2. Scan exams matching exact token or cleaned token of their CURRENT token
    const found = Array.from(this.exams.values()).find(e => {
      if (!e.token) return false;
      const eUpper = e.token.trim().toUpperCase();
      const eClean = eUpper.replace(/[\/\-\_\s]/g, '');
      return eUpper === rawUpper || eClean === cleanToken;
    });

    if (found) {
      // Re-index to direct map
      this.examsByToken.set(rawUpper, found);
      this.examsByToken.set(cleanToken, found);
    }

    return found;
  }

  public getExamById(id: string): Exam | undefined {
    this.queryCount++;
    return this.exams.get(id);
  }

  public getAllExams(): Exam[] {
    this.queryCount++;
    return Array.from(this.exams.values());
  }

  public saveExam(exam: Exam): void {
    this.queryCount++;
    // Clean up old token mappings for this exam ID
    const existing = this.exams.get(exam.id);
    if (existing && existing.token) {
      const oldUpper = existing.token.trim().toUpperCase();
      const oldClean = oldUpper.replace(/[\/\-\_\s]/g, '');
      this.examsByToken.delete(oldUpper);
      this.examsByToken.delete(oldClean);
    }
    // Also sweep examsByToken to remove any other stale keys referencing this exam
    for (const [k, e] of this.examsByToken.entries()) {
      if (e.id === exam.id) {
        this.examsByToken.delete(k);
      }
    }

    this.exams.set(exam.id, exam);
    if (exam.token) {
      const upper = exam.token.trim().toUpperCase();
      const clean = upper.replace(/[\/\-\_\s]/g, '');
      this.examsByToken.set(upper, exam);
      this.examsByToken.set(clean, exam);
    }
    this.persistData();
    this.persistToBackend((p) => p.saveExam(exam));
  }

  public toggleExamActive(examId: string): Exam | undefined {
    this.queryCount++;
    const exam = this.exams.get(examId);
    if (exam) {
      exam.isActive = !exam.isActive;
      this.saveExam(exam);
    }
    return exam;
  }

  public deleteExam(examId: string): boolean {
    this.queryCount++;
    const exam = this.exams.get(examId);
    if (!exam) return false;

    for (const [key, e] of this.examsByToken.entries()) {
      if (e.id === examId) {
        this.examsByToken.delete(key);
      }
    }
    this.exams.delete(examId);
    this.questionsByExamId.delete(examId);

    // Clean up associated sessions and violation logs
    const sessionsToDelete: string[] = [];
    this.sessions.forEach((sess, id) => {
      if (sess.examId === examId) {
        sessionsToDelete.push(id);
        this.sessionsByParticipantExam.delete(`${sess.participantId}_${examId}`);
      }
    });

    sessionsToDelete.forEach(id => this.sessions.delete(id));
    this.violationLogs = this.violationLogs.filter(v => !sessionsToDelete.includes(v.sessionId));

    this.persistData();
    this.persistToBackend(async (p) => {
      await p.deleteSessions(sessionsToDelete);
      await p.deleteExam(examId);
    });
    return true;
  }

  public resetExamSessions(examId: string): number {
    return this.resetAllSessions(examId, true);
  }

  public resetAllSessions(examId?: string, clearDeviceLocks: boolean = true): number {
    this.queryCount++;
    let count = 0;
    const sessionsToDelete: string[] = [];

    this.sessions.forEach((sess, id) => {
      if (!examId || examId === 'ALL' || sess.examId === examId) {
        sessionsToDelete.push(id);
        this.sessionsByParticipantExam.delete(`${sess.participantId}_${sess.examId}`);
        count++;
      }
    });

    sessionsToDelete.forEach(id => this.sessions.delete(id));

    if (!examId || examId === 'ALL') {
      this.violationLogs = [];
    } else {
      this.violationLogs = this.violationLogs.filter(v => !sessionsToDelete.includes(v.sessionId));
    }

    if (clearDeviceLocks) {
      this.users.forEach(user => {
        if (user.role === 'PARTICIPANT') {
          delete user.activeDeviceId;
          delete user.ipAddress;
        }
      });
    }

    this.persistData();
    this.persistToBackend(async (p) => {
      await p.deleteSessions(sessionsToDelete);
      if (!examId || examId === 'ALL') await p.deleteViolations();
    });
    return count;
  }

  public unlockAllDevices(): number {
    this.queryCount++;
    let count = 0;
    const changedUsers: User[] = [];
    this.users.forEach(user => {
      if (user.role === 'PARTICIPANT' && (user.activeDeviceId || user.ipAddress)) {
        delete user.activeDeviceId;
        delete user.ipAddress;
        changedUsers.push(user);
        count++;
      }
    });

    // Clear activeDeviceId from all sessions so participants can continue or reconnect without losing answers
    this.sessions.forEach(session => {
      if (session.activeDeviceId || session.ipAddress) {
        delete session.activeDeviceId;
        delete session.ipAddress;
      }
    });

    this.persistData();
    if (changedUsers.length > 0) {
      this.persistToBackend((p) => p.saveUsers(changedUsers));
    }
    return count;
  }

  public unlockParticipantDevice(participantId: string): boolean {
    this.queryCount++;
    let unlocked = false;
    const user = this.users.get(participantId);
    if (user) {
      if (user.activeDeviceId || user.ipAddress) {
        unlocked = true;
      }
      delete user.activeDeviceId;
      delete user.ipAddress;
    }

    // Clear device lock on all participant sessions without deleting data or answers
    const changedSessions: StoredSession[] = [];
    this.sessions.forEach(session => {
      if (session.participantId === participantId) {
        if (session.activeDeviceId || session.ipAddress) {
          unlocked = true;
        }
        delete session.activeDeviceId;
        delete session.ipAddress;
        changedSessions.push(session);
      }
    });

    this.persistData();
    if (user) {
      this.persistToBackend((p) => p.saveUser(user));
    }
    changedSessions.forEach((session) => this.persistToBackend((p) => p.saveSession(session)));
    return unlocked;
  }

  public resetParticipantSession(participantId: string, examId?: string, unlockOnly: boolean = false): boolean {
    if (unlockOnly) {
      return this.unlockParticipantDevice(participantId);
    }

    this.queryCount++;
    let found = false;
    const sessionsToDelete: string[] = [];

    this.sessions.forEach((sess, id) => {
      if (sess.participantId === participantId && (!examId || sess.examId === examId)) {
        sessionsToDelete.push(id);
        this.sessionsByParticipantExam.delete(`${sess.participantId}_${sess.examId}`);
        found = true;
      }
    });

    const user = this.users.get(participantId);
    if (user) {
      delete user.activeDeviceId;
      delete user.ipAddress;
    }

    sessionsToDelete.forEach(id => this.sessions.delete(id));
    this.violationLogs = this.violationLogs.filter(v => !sessionsToDelete.includes(v.sessionId));

    this.persistData();
    this.persistToBackend(async (p) => {
      await p.deleteSessions(sessionsToDelete);
      if (user) await p.saveUser(user);
    });
    return found;
  }

  public getQuestionsByExamId(examId: string): Question[] {
    this.queryCount++;
    return this.questionsByExamId.get(examId) || [];
  }

  public saveQuestionsForExam(examId: string, questions: Question[]): void {
    this.queryCount++;
    this.questionsByExamId.set(examId, questions);
    const exam = this.exams.get(examId);
    if (exam) {
      exam.totalQuestions = questions.length;
      this.exams.set(examId, exam);
    }

    this.persistData();
    this.persistToBackend((p) => p.saveQuestions(examId, questions));
    if (exam) this.persistToBackend((p) => p.saveExam(exam));
  }

  public getSession(sessionId: string): StoredSession | undefined {
    this.queryCount++;
    return this.sessions.get(sessionId);
  }

  public getSessionsByParticipantAndExam(participantId: string, examId: string): StoredSession[] {
    this.queryCount++;
    const all = Array.from(this.sessions.values()).filter(
      s => s.participantId === participantId && s.examId === examId
    );
    return all.sort((a, b) => (a.attemptNumber || 1) - (b.attemptNumber || 1));
  }

  public getSessionByParticipantAndExam(participantId: string, examId: string): StoredSession | undefined {
    this.queryCount++;
    const userSessions = Array.from(this.sessions.values()).filter(
      s => s.participantId === participantId && s.examId === examId
    );
    if (userSessions.length === 0) return undefined;

    // Prefer IN_PROGRESS session if any exists
    const inProgress = userSessions.find(s => s.status === 'IN_PROGRESS');
    if (inProgress) return inProgress;

    // Otherwise return latest session attempt
    return userSessions.sort((a, b) => (b.attemptNumber || 1) - (a.attemptNumber || 1))[0];
  }

  public saveSession(session: StoredSession): void {
    this.queryCount++;
    this.sessions.set(session.sessionId, session);
    this.sessionsByParticipantExam.set(`${session.participantId}_${session.examId}`, session);
    this.persistData();
    // Jawaban & progres siswa langsung dikirim ke database permanen.
    this.persistToBackend((p) => p.saveSession(session));
  }

  public getAllSessions(): StoredSession[] {
    this.queryCount++;
    return Array.from(this.sessions.values());
  }

  public logViolation(violation: ViolationLog): void {
    this.queryCount++;
    this.violationLogs.unshift(violation);
    this.persistData();
    this.persistToBackend((p) => p.logViolation(violation));
  }

  public getViolationLogs(sessionId?: string): ViolationLog[] {
    this.queryCount++;
    if (sessionId) {
      return this.violationLogs.filter(v => v.sessionId === sessionId);
    }
    return this.violationLogs;
  }

  public getAllParticipants(): User[] {
    this.queryCount++;
    return Array.from(this.users.values()).filter(u => u.role === 'PARTICIPANT');
  }

  public createParticipant(participant: User): void {
    this.queryCount++;
    const existing = this.users.get(participant.id);
    if (existing) {
      for (const [k, u] of this.usersByToken.entries()) {
        if (u.id === participant.id) this.usersByToken.delete(k);
      }
      for (const [k, u] of this.usersByParticipantCode.entries()) {
        if (u.id === participant.id) this.usersByParticipantCode.delete(k);
      }
    }

    this.users.set(participant.id, participant);
    if (participant.token) {
      const upperToken = participant.token.trim().toUpperCase();
      this.usersByToken.set(upperToken, participant);
      this.usersByToken.set(upperToken.replace(/[\/\-\_\s]/g, ''), participant);
    }
    if (participant.participantCode) {
      const upperCode = participant.participantCode.trim().toUpperCase();
      this.usersByParticipantCode.set(upperCode, participant);
      this.usersByParticipantCode.set(upperCode.replace(/[\/\-\_\s]/g, ''), participant);
    }
    this.persistData();
    this.persistToBackend((p) => p.saveUser(participant));
  }

  public deleteParticipant(participantId: string): boolean {
    this.queryCount++;
    const user = this.users.get(participantId);
    if (!user || user.role === 'ADMIN') return false;

    if (user.token) {
      const upperToken = user.token.trim().toUpperCase();
      this.usersByToken.delete(upperToken);
      this.usersByToken.delete(upperToken.replace(/[\/\-\_\s]/g, ''));
    }
    if (user.participantCode) {
      const upperCode = user.participantCode.trim().toUpperCase();
      this.usersByParticipantCode.delete(upperCode);
      this.usersByParticipantCode.delete(upperCode.replace(/[\/\-\_\s]/g, ''));
    }

    this.users.delete(participantId);
    this.resetParticipantSession(participantId);
    this.persistData();
    this.persistToBackend((p) => p.deleteUser(participantId));
    return true;
  }

  public clearAllParticipants(): number {
    this.queryCount++;
    let count = 0;
    const idsToDelete: string[] = [];

    this.users.forEach((user, id) => {
      if (user.role === 'PARTICIPANT') {
        idsToDelete.push(id);
        if (user.token) {
          const upperToken = user.token.trim().toUpperCase();
          this.usersByToken.delete(upperToken);
          this.usersByToken.delete(upperToken.replace(/[\/\-\_\s]/g, ''));
        }
        if (user.participantCode) {
          const upperCode = user.participantCode.trim().toUpperCase();
          this.usersByParticipantCode.delete(upperCode);
          this.usersByParticipantCode.delete(upperCode.replace(/[\/\-\_\s]/g, ''));
        }
        count++;
      }
    });

    idsToDelete.forEach(id => this.users.delete(id));
    this.resetAllSessions('ALL', true);
    this.persistData();
    this.persistToBackend((p) => p.clearUsers());
    return count;
  }

  public wipeAllData(): { examsDeleted: number; participantsDeleted: number; questionsDeleted: number; sessionsDeleted: number } {
    this.queryCount++;
    const examsDeleted = this.exams.size;
    let questionsDeleted = 0;
    this.questionsByExamId.forEach((qs) => {
      questionsDeleted += qs.length;
    });
    const sessionsDeleted = this.sessions.size;

    let participantsDeleted = 0;
    const adminUser = this.users.get('usr_admin');

    this.users.forEach((u) => {
      if (u.role === 'PARTICIPANT') participantsDeleted++;
    });

    // 1. Create an automatic safety backup before wiping so data can always be recovered
    try {
      const backupPath = path.join(process.cwd(), 'db_backup_latest.json');
      const backupData = {
        users: Array.from(this.users.values()),
        exams: Array.from(this.exams.values()),
        questionsByExamId: Object.fromEntries(this.questionsByExamId.entries()),
        sessions: Array.from(this.sessions.values()),
        violationLogs: this.violationLogs,
        backedUpAt: new Date().toISOString(),
      };
      fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf-8');
      console.log('[DatabaseStore] Automatic safety backup saved to:', backupPath);
    } catch (e) {
      console.warn('[DatabaseStore] Safety backup warning:', e);
    }

    this.exams.clear();
    this.examsByToken.clear();
    this.questionsByExamId.clear();
    this.sessions.clear();
    this.sessionsByParticipantExam.clear();
    this.violationLogs = [];

    this.users.clear();
    this.usersByToken.clear();
    this.usersByParticipantCode.clear();

    if (adminUser) {
      this.users.set(adminUser.id, adminUser);
    } else {
      this.users.set('usr_admin', {
        id: 'usr_admin',
        username: 'ahmad',
        name: 'Ahmad (Administrator)',
        role: 'ADMIN',
      });
    }

    this.persistData();

    // Hapus data di database permanen, lalu simpan kembali akun admin.
    this.persistToBackend(async (p) => {
      await p.wipeAll();
      const admin = this.users.get('usr_admin');
      if (admin) await p.saveUser(admin);
    });

    return {
      examsDeleted,
      participantsDeleted,
      questionsDeleted,
      sessionsDeleted,
    };
  }

  public restoreSafetyBackup(): { success: boolean; message: string; restoredExams: number; restoredParticipants: number } {
    try {
      const backupPath = path.join(process.cwd(), 'db_backup_latest.json');
      if (!fs.existsSync(backupPath)) {
        return { success: false, message: 'File cadangan keselamatan (db_backup_latest.json) tidak ditemukan.', restoredExams: 0, restoredParticipants: 0 };
      }
      const raw = fs.readFileSync(backupPath, 'utf-8');
      const data = JSON.parse(raw);
      if (!data) {
        return { success: false, message: 'File cadangan kosong atau rusak.', restoredExams: 0, restoredParticipants: 0 };
      }

      let restoredExams = 0;
      let restoredParticipants = 0;

      if (Array.isArray(data.exams)) {
        data.exams.forEach((e: Exam) => {
          this.saveExam(e);
          restoredExams++;
        });
      }

      if (data.questionsByExamId) {
        Object.entries(data.questionsByExamId).forEach(([examId, qs]) => {
          this.saveQuestionsForExam(examId, qs as Question[]);
        });
      }

      if (Array.isArray(data.users)) {
        data.users.forEach((u: User) => {
          if (u.role === 'PARTICIPANT') {
            this.createParticipant(u);
            restoredParticipants++;
          }
        });
      }

      if (Array.isArray(data.sessions)) {
        data.sessions.forEach((s: StoredSession) => {
          this.saveSession(s);
        });
      }

      this.persistData(true);
      return {
        success: true,
        message: `Berhasil memulihkan ${restoredExams} ujian dan ${restoredParticipants} peserta dari file cadangan!`,
        restoredExams,
        restoredParticipants,
      };
    } catch (err: any) {
      return { success: false, message: `Gagal memulihkan cadangan: ${err.message}`, restoredExams: 0, restoredParticipants: 0 };
    }
  }

  public importParticipantsBatch(
    items: Array<{ name: string; participantCode: string; token?: string }>,
    clearExisting: boolean = false
  ): User[] {
    this.queryCount++;
    if (clearExisting) {
      this.clearAllParticipants();
    }

    const created: User[] = [];
    items.forEach((item, idx) => {
      const cleanName = (item.name || '').trim();
      const cleanCode = (item.participantCode || `P${String(idx + 1).padStart(3, '0')}`).trim().toUpperCase();
      const cleanToken = (item.token || cleanCode).trim().toUpperCase();
      if (!cleanName) return;

      const user: User = {
        id: `usr_${Date.now()}_${idx}_${Math.floor(Math.random() * 1000)}`,
        username: cleanCode.toLowerCase(),
        name: cleanName,
        role: 'PARTICIPANT',
        participantCode: cleanCode,
        token: cleanToken,
      };

      this.createParticipant(user);
      created.push(user);
    });

    this.persistData();
    return created;
  }

  public getDatabaseExport(): {
    users: User[];
    exams: Exam[];
    questionsByExamId: Record<string, Question[]>;
    timestamp: string;
  } {
    return {
      users: Array.from(this.users.values()),
      exams: Array.from(this.exams.values()),
      questionsByExamId: Object.fromEntries(this.questionsByExamId.entries()),
      timestamp: new Date().toISOString(),
    };
  }

  public restoreOrMergeDatabase(backupData: {
    users?: User[];
    exams?: Exam[];
    questionsByExamId?: Record<string, Question[]>;
    participants?: User[];
  }): { usersCount: number; examsCount: number; questionsCount: number } {
    this.queryCount++;

    // 1. Merge or restore participants & users
    const usersToMerge = (backupData.users || backupData.participants || []);
    if (Array.isArray(usersToMerge)) {
      usersToMerge.forEach((u) => {
        if (u && u.id) {
          this.users.set(u.id, u);
          if (u.token) {
            this.usersByToken.set(u.token.toUpperCase(), u);
          }
          if (u.participantCode) {
            this.usersByParticipantCode.set(u.participantCode.toUpperCase(), u);
          }
          this.persistToBackend((p) => p.saveUser(u));
        }
      });
    }

    // 2. Merge or restore exams
    if (Array.isArray(backupData.exams)) {
      backupData.exams.forEach((e) => {
        if (e && e.id) {
          this.exams.set(e.id, e);
          if (e.token) {
            this.examsByToken.set(e.token.toUpperCase(), e);
            const cleaned = e.token.trim().toUpperCase().replace(/[\/\-\_\s]/g, '');
            this.examsByToken.set(cleaned, e);
          }
          this.persistToBackend((p) => p.saveExam(e));
        }
      });
    }

    // 3. Merge or restore questions
    if (backupData.questionsByExamId && typeof backupData.questionsByExamId === 'object') {
      Object.entries(backupData.questionsByExamId).forEach(([examId, questions]) => {
        if (Array.isArray(questions)) {
          this.questionsByExamId.set(examId, questions);
          const exam = this.exams.get(examId);
          if (exam) {
            exam.totalQuestions = questions.length;
            this.exams.set(examId, exam);
            this.persistToBackend((p) => p.saveExam(exam));
          }
          this.persistToBackend((p) => p.saveQuestions(examId, questions));
        }
      });
    }

    this.persistData(true);

    let totalQ = 0;
    this.questionsByExamId.forEach((qs) => {
      totalQ += qs.length;
    });

    console.log(`[DatabaseStore] Restored/Merged state: ${this.users.size} users, ${this.exams.size} exams, ${totalQ} questions.`);

    return {
      usersCount: this.users.size,
      examsCount: this.exams.size,
      questionsCount: totalQ,
    };
  }
}

export const dbStore = new DatabaseStore();
