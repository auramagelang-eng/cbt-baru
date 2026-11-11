import express, { NextFunction, Request, Response, RequestHandler } from 'express';
import path from 'path';
import { AuthController } from './controllers/AuthController';
import { ExamController } from './controllers/ExamController';
import { SessionController } from './controllers/SessionController';
import { MetricsController } from './controllers/MetricsController';
import { DatabaseController } from './controllers/DatabaseController';
import { CloudflareController } from './controllers/CloudflareController';
import { authMiddleware } from './middlewares/authMiddleware';
import { rateLimiter } from './middlewares/rateLimiter';
import { dbStore } from './db';
import { supabaseStore } from './supabase';

/**
 * Handler wrapper: menangkap error dari handler sync maupun async.
 *
 * Dashboard admin tidak boleh "mati" hanya karena satu query gagal, dan proses
 * server (terutama instance Vercel yang dipakai banyak request) tidak boleh
 * crash. Semua error diteruskan ke error handler JSON di bawah.
 */
type AnyHandler = (req: any, res: any, next: NextFunction) => unknown;

const safe = (handler: AnyHandler): RequestHandler => {
  return (req, res, next) => {
    try {
      const result = handler(req, res, next);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
};

export interface CreateAppOptions {
  /**
   * Middleware Vite HMR untuk mode development lokal.
   * Sengaja DIINJEKSI dari server.ts (bukan di-import di sini) supaya bundel
   * serverless Vercel tidak ikut menarik paket `vite` + esbuild native.
   */
  devMiddleware?: RequestHandler;
}

let processGuardsInstalled = false;

/** Jangan biarkan rejection tak tertangani mematikan proses / instance server. */
function installProcessGuards(): void {
  if (processGuardsInstalled) return;
  processGuardsInstalled = true;

  process.on('unhandledRejection', (reason) => {
    console.error('[Server] Unhandled promise rejection (diabaikan agar server tetap hidup):', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[Server] Uncaught exception (diabaikan agar server tetap hidup):', err);
  });
}

/**
 * Membuat aplikasi Express lengkap dengan seluruh route API,
 * penyimpanan permanen Supabase, dan penanganan error global.
 */
export async function createApp(options: CreateAppOptions = {}): Promise<express.Express> {
  installProcessGuards();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Vercel: filesystem read-only & sementara -> simpan hanya ke Supabase.
  if (process.env.VERCEL) {
    dbStore.setDiskPersistence(false);
  }

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Middleware to count incoming HTTP requests for performance metrics
  app.use((req, res, next) => {
    if (req.url.startsWith('/api')) {
      dbStore.totalRequests += 1;
    }
    next();
  });

  /**
   * Siapkan database sebelum request pertama.
   * `ensureReady` melakukan hydrate cache dari Supabase (sekali per instance).
   * `refreshIfStale` menyegarkan cache dari instance lain (maks. 10 detik sekali).
   *
   * Kegagalan di sini TIDAK memblokir API: aplikasi tetap melayani dari cache
   * dan antrean retry, sehingga ujian yang sedang berjalan tidak terhenti.
   */
  app.use('/api', (req, res, next) => {
    void (async () => {
      try {
        await supabaseStore.ensureReady();
        await supabaseStore.refreshIfStale();
      } catch (err) {
        console.warn('[Server] Sinkronisasi database dilewati:', err);
      }
      next();
    })();
  });

  // Apply rate limiter to API routes
  app.use('/api', rateLimiter(5000, 60000));

  /**
   * Cegah kehilangan data secara diam-diam.
   *
   * Di Vercel filesystem bersifat read-only dan setiap request bisa mendarat di
   * instance yang berbeda, jadi tanpa Supabase semua tulisan hanya singgah di
   * memori satu instance lalu hilang (inilah penyebab soal "hilang lagi").
   * Lebih baik menolak dengan pesan jelas daripada membalas "berhasil".
   */
  app.use('/api', (req, res, next) => {
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (!isWrite) return next();
    // Login tidak menulis data, dan jawaban peserta sudah ditangani khusus
    // (aplikasi peserta menyimpan ulang jawaban saat menerima 503).
    if (req.path.startsWith('/auth/')) return next();

    const status = supabaseStore.getStatus();
    if (status.durable || dbStore.isDiskPersistenceEnabled()) return next();

    res.status(503).json({
      error: `Perubahan TIDAK tersimpan: ${status.message}`,
      storage: status,
    });
  });

  // --- API ROUTES ---

  // Health & Server Performance Metrics
  // `data` menampilkan jumlah baris yang sedang dipegang cache (hasil hydrate dari
  // Supabase). Berguna untuk memastikan tabel sudah terisi setelah deploy.
  app.get('/api/health', (req, res) => {
    let questions = 0;
    dbStore.getAllExams().forEach((exam) => {
      questions += dbStore.getQuestionsByExamId(exam.id).length;
    });

    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      // Penanda versi: dipakai untuk memastikan domain sudah menjalankan commit
      // terbaru dari GitHub, bukan deployment lama yang masih tersimpan.
      build: {
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
        commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE || null,
        environment: process.env.VERCEL_ENV || 'local',
      },
      storage: {
        ...supabaseStore.getStatus(),
        data: {
          users: dbStore.getAllParticipants().length + 1, // + admin
          exams: dbStore.getAllExams().length,
          questions,
          sessions: dbStore.getAllSessions().length,
          violations: dbStore.getViolationLogs().length,
        },
      },
    });
  });
  app.get('/api/metrics', safe(MetricsController.getMetrics));

  // Authentication
  app.post('/api/auth/admin-login', safe(AuthController.adminLogin));
  app.post('/api/auth/participant-verify', safe(AuthController.participantTokenLogin));

  // Exam Management (Admin)
  app.get('/api/exams', authMiddleware('ADMIN'), safe(ExamController.getAllExams));
  app.get('/api/exams/:id', authMiddleware('ADMIN'), safe(ExamController.getExamDetail));
  app.post('/api/exams', authMiddleware('ADMIN'), safe(ExamController.createExam));
  app.put('/api/exams/:id', authMiddleware('ADMIN'), safe(ExamController.updateExam));
  app.post('/api/exams/:id/questions', authMiddleware('ADMIN'), safe(ExamController.saveQuestions));
  app.patch('/api/exams/:id/toggle-active', authMiddleware('ADMIN'), safe(ExamController.toggleActive));
  app.delete('/api/exams/:id', authMiddleware('ADMIN'), safe(ExamController.deleteExam));

  // AI Grading Rubric & Matrix Generation
  app.post(
    '/api/ai/generate-essay-rubric',
    authMiddleware('ADMIN'),
    safe(ExamController.generateEssayRubric)
  );

  // Database Persistence & Total Reset (Admin)
  app.get('/api/database/backup', authMiddleware('ADMIN'), safe(DatabaseController.exportBackup));
  app.post('/api/database/sync-backup', authMiddleware('ADMIN'), safe(DatabaseController.syncBackup));
  app.get('/api/database/stats', authMiddleware('ADMIN'), safe(DatabaseController.getStats));
  app.post('/api/database/wipe-all', authMiddleware('ADMIN'), safe(DatabaseController.wipeAllData));
  app.post(
    '/api/database/restore-backup',
    authMiddleware('ADMIN'),
    safe(DatabaseController.restoreBackup)
  );

  // Cloudflare D1 / Worker Database Integration & Real-Time Sync (Admin)
  app.get('/api/cloudflare/config', authMiddleware('ADMIN'), safe(CloudflareController.getConfig));
  app.post('/api/cloudflare/config', authMiddleware('ADMIN'), safe(CloudflareController.saveConfig));
  app.post('/api/cloudflare/test', authMiddleware('ADMIN'), safe(CloudflareController.testConnection));
  app.post(
    '/api/cloudflare/auto-connect',
    authMiddleware('ADMIN'),
    safe(CloudflareController.autoConnect)
  );
  app.post(
    '/api/cloudflare/init-schema',
    authMiddleware('ADMIN'),
    safe(CloudflareController.initSchema)
  );
  app.get('/api/cloudflare/status', authMiddleware('ADMIN'), safe(CloudflareController.getStatus));
  app.post('/api/cloudflare/push-all', authMiddleware('ADMIN'), safe(CloudflareController.pushAll));
  app.post('/api/cloudflare/pull-all', authMiddleware('ADMIN'), safe(CloudflareController.pullAll));
  app.post('/api/cloudflare/wipe-all', authMiddleware('ADMIN'), safe(DatabaseController.wipeAllData));
  app.get(
    '/api/cloudflare/schema-sql',
    authMiddleware('ADMIN'),
    safe(CloudflareController.getSchemaSql)
  );
  app.get(
    '/api/cloudflare/worker-code',
    authMiddleware('ADMIN'),
    safe(CloudflareController.getWorkerCode)
  );

  // Participant & Token Management (Admin)
  app.get('/api/participants', authMiddleware('ADMIN'), safe(ExamController.getParticipants));
  app.post(
    '/api/participants',
    authMiddleware('ADMIN'),
    safe(ExamController.createSingleParticipant)
  );
  app.post(
    '/api/participants/batch',
    authMiddleware('ADMIN'),
    safe(ExamController.createParticipantBatch)
  );
  app.post(
    '/api/participants/import-class',
    authMiddleware('ADMIN'),
    safe(ExamController.importClassParticipants)
  );
  app.post(
    '/api/participants/clear-all',
    authMiddleware('ADMIN'),
    safe(ExamController.clearAllParticipants)
  );
  app.delete(
    '/api/participants/:id',
    authMiddleware('ADMIN'),
    safe(ExamController.deleteParticipant)
  );

  // CBT Exam Session (Participant & Single Payload Load)
  app.post(
    '/api/session/start',
    authMiddleware('PARTICIPANT'),
    safe(SessionController.startOrGetSession)
  );
  app.post(
    '/api/session/batch-save',
    authMiddleware('PARTICIPANT'),
    safe(SessionController.batchSaveAnswers)
  );
  app.post(
    '/api/session/violation',
    authMiddleware('PARTICIPANT'),
    safe(SessionController.logViolation)
  );
  app.post('/api/session/submit', authMiddleware('PARTICIPANT'), safe(SessionController.submitExam));
  app.get(
    '/api/session/my-result/:sessionId',
    authMiddleware('PARTICIPANT'),
    safe(SessionController.getMySessionResult)
  );
  app.get(
    '/api/session/status/:sessionId',
    authMiddleware('PARTICIPANT'),
    safe(SessionController.checkSessionStatus)
  );

  // Force End Sesi Ujian (Admin Real-Time Monitoring)
  app.post(
    '/api/session/force-end',
    authMiddleware('ADMIN'),
    safe(SessionController.forceEndSession)
  );
  app.post(
    '/api/session/force-end-all',
    authMiddleware('ADMIN'),
    safe(SessionController.forceEndAllSessions)
  );

  // Reset Sesi Ujian & Peserta (Admin)
  app.post(
    '/api/session/reset-participant',
    authMiddleware('ADMIN'),
    safe(SessionController.resetParticipantSession)
  );
  app.post(
    '/api/session/unlock-participant',
    authMiddleware('ADMIN'),
    safe(SessionController.unlockParticipantDevice)
  );
  app.post(
    '/api/session/unlock-device',
    authMiddleware('ADMIN'),
    safe(SessionController.unlockParticipantDevice)
  );
  app.post(
    '/api/session/reset-device',
    authMiddleware('ADMIN'),
    safe(SessionController.unlockParticipantDevice)
  );
  app.post(
    '/api/session/reset-exam',
    authMiddleware('ADMIN'),
    safe(SessionController.resetExamSessions)
  );
  app.post('/api/session/reset-all', authMiddleware('ADMIN'), safe(SessionController.resetAllSessions));
  app.post(
    '/api/session/unlock-devices',
    authMiddleware('ADMIN'),
    safe(SessionController.unlockAllDevices)
  );

  // Results & Real-time Anti-Cheat Monitoring (Admin)
  app.get('/api/results', authMiddleware('ADMIN'), safe(SessionController.getExamResults));
  app.get(
    '/api/results/export-attempts-xlsx',
    authMiddleware('ADMIN'),
    safe(SessionController.exportAttemptsAnalysisExcel)
  );
  app.get(
    '/api/results/session/:sessionId',
    authMiddleware('ADMIN'),
    safe(SessionController.getSessionAnswersDetail)
  );
  app.post(
    '/api/results/regrade-essays',
    authMiddleware('ADMIN'),
    safe(SessionController.regradeEssaySubmissions)
  );
  app.get('/api/violations', authMiddleware('ADMIN'), safe(SessionController.getViolationLogs));
  app.get(
    '/api/session/live-active',
    authMiddleware('ADMIN'),
    safe(SessionController.getLiveActiveSessions)
  );

  // 404 khusus API dalam bentuk JSON (bukan HTML) agar UI tidak error parsing.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Endpoint API tidak ditemukan', path: req.originalUrl });
  });

  // --- VITE / STATIC SERVING ---
  if (process.env.NODE_ENV !== 'production') {
    if (options.devMiddleware) {
      app.use(options.devMiddleware);
    } else {
      console.warn('[Server] Mode development tanpa middleware Vite (jalankan lewat server.ts).');
    }
  } else {
    // Di Vercel aset statis dilayani CDN; blok ini hanya untuk `npm start` lokal.
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  /**
   * Error handler terakhir: SELALU membalas JSON, tidak pernah membiarkan
   * request menggantung. Dashboard admin akan menerima pesan jelas dan bisa
   * memuat ulang tanpa kehilangan data yang sudah tersimpan.
   */
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error(`[Server] Error pada ${req.method} ${req.originalUrl}:`, err?.stack || err);
    if (res.headersSent) return next(err);
    res.status(err?.status || 500).json({
      error: err?.message || 'Terjadi kesalahan pada server. Silakan coba lagi.',
      path: req.originalUrl,
    });
  });

  return app;
}
