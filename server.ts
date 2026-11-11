import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { AuthController } from './src/server/controllers/AuthController';
import { ExamController } from './src/server/controllers/ExamController';
import { SessionController } from './src/server/controllers/SessionController';
import { MetricsController } from './src/server/controllers/MetricsController';
import { DatabaseController } from './src/server/controllers/DatabaseController';
import { CloudflareController } from './src/server/controllers/CloudflareController';
import { authMiddleware } from './src/server/middlewares/authMiddleware';
import { rateLimiter } from './src/server/middlewares/rateLimiter';
import { dbStore } from './src/server/db';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Middleware to count incoming HTTP requests for performance metrics
  app.use((req, res, next) => {
    if (req.url.startsWith('/api')) {
      dbStore.totalRequests += 1;
    }
    next();
  });

  // Apply rate limiter to API routes (high capacity for 36+ concurrent CBT participants)
  app.use('/api', rateLimiter(5000, 60000));

  // --- API ROUTES ---
  // Health & Server Performance Metrics
  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
  app.get('/api/metrics', MetricsController.getMetrics);

  // Authentication
  app.post('/api/auth/admin-login', AuthController.adminLogin);
  app.post('/api/auth/participant-verify', AuthController.participantTokenLogin);

  // Exam Management (Admin)
  app.get('/api/exams', authMiddleware('ADMIN'), ExamController.getAllExams);
  app.get('/api/exams/:id', authMiddleware('ADMIN'), ExamController.getExamDetail);
  app.post('/api/exams', authMiddleware('ADMIN'), ExamController.createExam);
  app.put('/api/exams/:id', authMiddleware('ADMIN'), ExamController.updateExam);
  app.post('/api/exams/:id/questions', authMiddleware('ADMIN'), ExamController.saveQuestions);
  app.patch('/api/exams/:id/toggle-active', authMiddleware('ADMIN'), ExamController.toggleActive);
  app.delete('/api/exams/:id', authMiddleware('ADMIN'), ExamController.deleteExam);

  // AI Grading Rubric & Matrix Generation
  app.post('/api/ai/generate-essay-rubric', authMiddleware('ADMIN'), ExamController.generateEssayRubric);

  // Database Persistence & Total Reset (Admin)
  app.get('/api/database/backup', authMiddleware('ADMIN'), DatabaseController.exportBackup);
  app.post('/api/database/sync-backup', authMiddleware('ADMIN'), DatabaseController.syncBackup);
  app.get('/api/database/stats', authMiddleware('ADMIN'), DatabaseController.getStats);
  app.post('/api/database/wipe-all', authMiddleware('ADMIN'), DatabaseController.wipeAllData);
  app.post('/api/database/restore-backup', authMiddleware('ADMIN'), DatabaseController.restoreBackup);

  // Cloudflare D1 / Worker Database Integration & Real-Time Sync (Admin)
  app.get('/api/cloudflare/config', authMiddleware('ADMIN'), CloudflareController.getConfig);
  app.post('/api/cloudflare/config', authMiddleware('ADMIN'), CloudflareController.saveConfig);
  app.post('/api/cloudflare/test', authMiddleware('ADMIN'), CloudflareController.testConnection);
  app.post('/api/cloudflare/auto-connect', authMiddleware('ADMIN'), CloudflareController.autoConnect);
  app.post('/api/cloudflare/init-schema', authMiddleware('ADMIN'), CloudflareController.initSchema);
  app.get('/api/cloudflare/status', authMiddleware('ADMIN'), CloudflareController.getStatus);
  app.post('/api/cloudflare/push-all', authMiddleware('ADMIN'), CloudflareController.pushAll);
  app.post('/api/cloudflare/pull-all', authMiddleware('ADMIN'), CloudflareController.pullAll);
  app.post('/api/cloudflare/wipe-all', authMiddleware('ADMIN'), DatabaseController.wipeAllData);
  app.get('/api/cloudflare/schema-sql', authMiddleware('ADMIN'), CloudflareController.getSchemaSql);
  app.get('/api/cloudflare/worker-code', authMiddleware('ADMIN'), CloudflareController.getWorkerCode);

  // Participant & Token Management (Admin)
  app.get('/api/participants', authMiddleware('ADMIN'), ExamController.getParticipants);
  app.post('/api/participants', authMiddleware('ADMIN'), ExamController.createSingleParticipant);
  app.post('/api/participants/batch', authMiddleware('ADMIN'), ExamController.createParticipantBatch);
  app.post('/api/participants/import-class', authMiddleware('ADMIN'), ExamController.importClassParticipants);
  app.post('/api/participants/clear-all', authMiddleware('ADMIN'), ExamController.clearAllParticipants);
  app.delete('/api/participants/:id', authMiddleware('ADMIN'), ExamController.deleteParticipant);

  // CBT Exam Session (Participant & Single Payload Load)
  app.post('/api/session/start', authMiddleware('PARTICIPANT'), SessionController.startOrGetSession);
  app.post('/api/session/batch-save', authMiddleware('PARTICIPANT'), SessionController.batchSaveAnswers);
  app.post('/api/session/violation', authMiddleware('PARTICIPANT'), SessionController.logViolation);
  app.post('/api/session/submit', authMiddleware('PARTICIPANT'), SessionController.submitExam);
  app.get('/api/session/my-result/:sessionId', authMiddleware('PARTICIPANT'), SessionController.getMySessionResult);
  app.get('/api/session/status/:sessionId', authMiddleware('PARTICIPANT'), SessionController.checkSessionStatus);

  // Force End Sesi Ujian (Admin Real-Time Monitoring)
  app.post('/api/session/force-end', authMiddleware('ADMIN'), SessionController.forceEndSession);
  app.post('/api/session/force-end-all', authMiddleware('ADMIN'), SessionController.forceEndAllSessions);

  // Reset Sesi Ujian & Peserta (Admin)
  app.post('/api/session/reset-participant', authMiddleware('ADMIN'), SessionController.resetParticipantSession);
  app.post('/api/session/unlock-participant', authMiddleware('ADMIN'), SessionController.unlockParticipantDevice);
  app.post('/api/session/unlock-device', authMiddleware('ADMIN'), SessionController.unlockParticipantDevice);
  app.post('/api/session/reset-device', authMiddleware('ADMIN'), SessionController.unlockParticipantDevice);
  app.post('/api/session/reset-exam', authMiddleware('ADMIN'), SessionController.resetExamSessions);
  app.post('/api/session/reset-all', authMiddleware('ADMIN'), SessionController.resetAllSessions);
  app.post('/api/session/unlock-devices', authMiddleware('ADMIN'), SessionController.unlockAllDevices);

  // Results & Real-time Anti-Cheat Monitoring (Admin)
  app.get('/api/results', authMiddleware('ADMIN'), SessionController.getExamResults);
  app.get('/api/results/export-attempts-xlsx', authMiddleware('ADMIN'), SessionController.exportAttemptsAnalysisExcel);
  app.get('/api/results/session/:sessionId', authMiddleware('ADMIN'), SessionController.getSessionAnswersDetail);
  app.post('/api/results/regrade-essays', authMiddleware('ADMIN'), SessionController.regradeEssaySubmissions);
  app.get('/api/violations', authMiddleware('ADMIN'), SessionController.getViolationLogs);
  app.get('/api/session/live-active', authMiddleware('ADMIN'), SessionController.getLiveActiveSessions);

  // --- VITE / STATIC SERVING ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CBT Cloud Engine] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
