import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { sessionService, getEffectiveQuestion } from '../services/SessionService';
import { examService } from '../services/ExamService';
import { sessionRepository } from '../repositories/SessionRepository';
import { BatchSaveAnswersSchema, LogViolationSchema, SubmitExamSchema } from '../dto';

export class SessionController {
  /**
   * Single-payload endpoint: Returns student data, exam info, configuration,
   * all questions, and all options in a SINGLE HTTP response.
   */
  static startOrGetSession(req: AuthenticatedRequest, res: Response) {
    const user = req.user;
    const { examId, deviceId } = req.body;

    if (!user || !examId) {
      res.status(400).json({ error: 'Data user atau examId tidak lengkap' });
      return;
    }

    const result = sessionService.getOrStartSession(user.id, examId, deviceId);
    if (!result) {
      res.status(404).json({ error: 'Ujian atau peserta tidak ditemukan' });
      return;
    }

    if (result.error) {
      res.status(403).json({ error: result.error });
      return;
    }

    res.json({
      message: 'Sesi Ujian Berhasil Dimuat (Single Payload Loaded)',
      data: result.payload,
    });
  }

  /**
   * Debounced / Batch answer sync endpoint.
   */
  static batchSaveAnswers(req: AuthenticatedRequest, res: Response) {
    const parseResult = BatchSaveAnswersSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Data jawaban tidak valid', details: parseResult.error.format() });
      return;
    }

    const { sessionId, answers, currentQuestionIndex } = parseResult.data;
    const result = sessionService.batchSaveAnswers(sessionId, answers, currentQuestionIndex);

    if (!result.success) {
      const session = sessionRepository.findById(sessionId);
      res.status(200).json({
        message: 'Sesi ujian telah diselesaikan atau tidak aktif',
        savedCount: 0,
        isFinished: session ? session.status !== 'IN_PROGRESS' : true,
        sessionStatus: session?.status || 'COMPLETED',
      });
      return;
    }

    res.json({ message: 'Jawaban berhasil disinkronkan', savedCount: result.count, isFinished: false });
  }

  /**
   * Anti-cheat violation reporting endpoint.
   */
  static async logViolation(req: AuthenticatedRequest, res: Response) {
    const parseResult = LogViolationSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Format pelanggaran tidak valid' });
      return;
    }

    const { sessionId, type, details } = parseResult.data;
    const result = await sessionService.logViolation(sessionId, type, details);

    res.json({
      message: 'Pelanggaran dicatat',
      violationsCount: result.violationsCount,
      autoSubmitted: result.autoSubmitted,
    });
  }

  /**
   * Final exam submission endpoint.
   */
  static async submitExam(req: AuthenticatedRequest, res: Response) {
    const parseResult = SubmitExamSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Session ID wajib diisi' });
      return;
    }

    const { sessionId, answers } = parseResult.data;
    if (answers && Object.keys(answers).length > 0) {
      sessionService.batchSaveAnswers(sessionId, answers);
    }
    const result = await sessionService.evaluateAndSubmitExam(sessionId, 'COMPLETED');

    if (!result) {
      res.status(404).json({ error: 'Sesi ujian tidak ditemukan' });
      return;
    }

    const session = sessionRepository.findById(sessionId);

    res.json({
      message: 'Ujian Berhasil Disimpan & Dihitung',
      result,
      answers: session?.answers || {},
    });
  }

  /**
   * Participant endpoint to get their own updated session result
   * (used for live auto-update as background AI grading finishes).
   */
  static getMySessionResult(req: AuthenticatedRequest, res: Response) {
    const user = req.user;
    const sessionId = req.params.sessionId;
    if (!user || !sessionId) {
      res.status(400).json({ error: 'Parameter tidak valid' });
      return;
    }

    const session = sessionRepository.findById(sessionId);
    if (!session || session.participantId !== user.id) {
      res.status(404).json({ error: 'Sesi ujian tidak ditemukan' });
      return;
    }

    const exam = examService.getExamById(session.examId);
    const percentage = session.maxScore > 0 ? Math.round((session.score / session.maxScore) * 100) : 0;
    const isPassed = exam ? percentage >= exam.passPercentage : true;

    const hasPendingAiGrading = Object.values(session.answers || {}).some(
      a => a.essayAnswer && a.essayAnswer.trim() !== '' && a.aiGraded === false
    );

    res.json({
      data: {
        sessionId: session.sessionId,
        score: session.score,
        maxScore: session.maxScore,
        percentage,
        isPassed,
        status: session.status,
        submittedAt: session.submittedAt,
        answers: session.answers,
        hasPendingAiGrading,
      },
    });
  }

  /**
   * Get detailed session answers with AI feedback for admin review.
   */
  static getSessionAnswersDetail(req: AuthenticatedRequest, res: Response) {
    const sessionId = req.params.sessionId;
    const session = sessionRepository.findById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Sesi ujian tidak ditemukan' });
      return;
    }

    const examQuestions = examService.getExamQuestions(session.examId);
    const updatedQuestions = (session.shuffledQuestions || []).map((q) => getEffectiveQuestion(q, examQuestions));

    res.json({
      data: {
        sessionId: session.sessionId,
        participantId: session.participantId,
        examId: session.examId,
        score: session.score,
        maxScore: session.maxScore,
        status: session.status,
        submittedAt: session.submittedAt,
        violationsCount: session.violationsCount,
        questions: updatedQuestions,
        answers: session.answers,
      },
    });
  }

  /**
   * Admin monitoring & results endpoints.
   */
  static getExamResults(req: AuthenticatedRequest, res: Response) {
    const examId = req.query.examId as string | undefined;
    const results = sessionService.getResults(examId);
    res.json({ data: results });
  }

  /**
   * Export detailed 3-sheet Excel spreadsheet with attempts 1, 2, 3,
   * question headers, answer keys, and color-coded student responses.
   */
  static async exportAttemptsAnalysisExcel(req: AuthenticatedRequest, res: Response) {
    try {
      const examId = req.query.examId as string;
      if (!examId) {
        res.status(400).json({ error: 'Exam ID wajib disertakan untuk ekspor analisis' });
        return;
      }

      const exam = examService.getExamById(examId);
      if (!exam) {
        res.status(404).json({ error: 'Ujian tidak ditemukan' });
        return;
      }

      const workbook = await sessionService.generateAttemptsAnalysisWorkbook(examId);
      const safeTitle = (exam.title || 'Ujian').replace(/[^a-zA-Z0-9]/g, '_');
      const safeDate = new Date().toISOString().slice(0, 10);
      const filename = `Analisis_3_Percobaan_${safeTitle}_${safeDate}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const buffer = await workbook.xlsx.writeBuffer();
      res.send(Buffer.from(buffer));
    } catch (err: any) {
      console.error('Error generating 3-sheet Excel export:', err);
      res.status(500).json({ error: err?.message || 'Gagal menghasilkan file Excel analisis 3 percobaan' });
    }
  }

  static getLiveActiveSessions(req: AuthenticatedRequest, res: Response) {
    const activeSessions = sessionService.getActiveSessionsInfo();
    res.json({ data: activeSessions });
  }

  static getViolationLogs(req: AuthenticatedRequest, res: Response) {
    const sessionId = req.query.sessionId as string | undefined;
    const logs = sessionRepository.getViolationLogs(sessionId);
    res.json({ data: logs });
  }

  static unlockParticipantDevice(req: AuthenticatedRequest, res: Response) {
    const { participantId } = req.body;
    if (!participantId) {
      res.status(400).json({ error: 'Participant ID wajib diisi' });
      return;
    }
    const success = sessionService.unlockParticipantDevice(participantId);
    res.json({
      message: 'Kunci perangkat peserta berhasil dibuka. Seluruh data jawaban & progres ujian tetap aman tersimpan.',
      success,
    });
  }

  static resetParticipantSession(req: AuthenticatedRequest, res: Response) {
    const { participantId, examId, unlockOnly } = req.body;
    if (!participantId) {
      res.status(400).json({ error: 'Participant ID wajib diisi' });
      return;
    }
    if (unlockOnly) {
      const success = sessionService.unlockParticipantDevice(participantId);
      res.json({
        message: 'Kunci perangkat peserta berhasil dibuka. Seluruh data jawaban & progres ujian tetap aman tersimpan.',
        success,
      });
      return;
    }
    const success = sessionService.resetParticipantSession(participantId, examId);
    res.json({ message: 'Sesi ujian peserta berhasil di-reset', success });
  }

  static async forceEndSession(req: AuthenticatedRequest, res: Response) {
    const { sessionId, participantId, examId } = req.body;
    if (!sessionId && !participantId) {
      res.status(400).json({ error: 'Session ID atau Participant ID wajib diisi' });
      return;
    }

    let result = null;
    if (sessionId) {
      result = await sessionService.forceEndSession(sessionId);
    } else if (participantId) {
      result = await sessionService.forceEndParticipant(participantId, examId);
    }

    if (!result) {
      res.status(404).json({ error: 'Sesi ujian aktif tidak ditemukan atau sudah selesai' });
      return;
    }

    res.json({
      message: `Ujian ${result.participantName} (${result.participantCode}) berhasil diselesaikan paksa (Force End). Semua jawaban dan nilai (${result.score} poin / ${result.percentage}%) telah disimpan permanen.`,
      result,
    });
  }

  static async forceEndAllSessions(req: AuthenticatedRequest, res: Response) {
    const { examId } = req.body;
    const { count, results } = await sessionService.forceEndAllSessions(examId);
    res.json({
      message: `Berhasil menyelesaikan paksa ${count} sesi peserta. Seluruh nilai dan hasil pekerjaan siswa telah disimpan dengan aman ke database.`,
      count,
      results,
    });
  }

  static checkSessionStatus(req: AuthenticatedRequest, res: Response) {
    const sessionId = req.params.sessionId;
    if (!sessionId) {
      res.status(400).json({ error: 'Session ID wajib diisi' });
      return;
    }

    const session = sessionRepository.findById(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Sesi tidak ditemukan' });
      return;
    }

    res.json({
      sessionId: session.sessionId,
      status: session.status,
      score: session.score,
      maxScore: session.maxScore,
      violationsCount: session.violationsCount,
      isFinished: session.status !== 'IN_PROGRESS',
    });
  }

  static resetExamSessions(req: AuthenticatedRequest, res: Response) {
    const { examId } = req.body;
    if (!examId) {
      res.status(400).json({ error: 'Exam ID wajib diisi' });
      return;
    }
    const count = sessionService.resetExamSessions(examId);
    res.json({ message: `Berhasil mereset ${count} sesi peserta untuk ujian ini`, count });
  }

  static resetAllSessions(req: AuthenticatedRequest, res: Response) {
    const { examId, clearDeviceLocks = true } = req.body;
    const count = sessionService.resetAllSessions(examId, clearDeviceLocks);
    res.json({
      message: `Berhasil mereset ${count} sesi ujian, membebaskan kunci login perangkat, dan membersihkan pemantauan serta analitik untuk sesi kelas baru.`,
      count,
    });
  }

  static unlockAllDevices(req: AuthenticatedRequest, res: Response) {
    const count = sessionService.unlockAllDevices();
    res.json({
      message: `Berhasil membuka kunci perangkat untuk ${count} peserta.`,
      count,
    });
  }

  static async regradeEssaySubmissions(req: AuthenticatedRequest, res: Response) {
    try {
      const { examId, sessionId } = req.body;
      const result = await sessionService.regradeEssaySubmissions(examId, sessionId);
      res.json({
        message: `Berhasil menghitung ulang penilaian esai untuk ${result.updatedCount} sesi ujian.`,
        data: result,
      });
    } catch (err: any) {
      console.error('Error in regradeEssaySubmissions controller:', err);
      res.status(500).json({ error: err?.message || 'Gagal menghitung ulang nilai esai' });
    }
  }
}
