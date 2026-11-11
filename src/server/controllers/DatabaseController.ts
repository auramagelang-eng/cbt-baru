import { Request, Response } from 'express';
import { dbStore } from '../db';
import { cloudflareService } from '../services/CloudflareService';

export class DatabaseController {
  /**
   * Export full database state (for backup download)
   */
  static exportBackup(req: Request, res: Response) {
    try {
      const data = dbStore.getDatabaseExport();
      res.json({
        success: true,
        data,
      });
    } catch (err: any) {
      console.error('[DatabaseController] exportBackup failed:', err);
      res.status(500).json({ error: 'Gagal mengekspor data database' });
    }
  }

  /**
   * Sync / merge backup data from client browser vault
   */
  static syncBackup(req: Request, res: Response) {
    try {
      const { exams, questionsByExamId, participants, users } = req.body;
      const result = dbStore.restoreOrMergeDatabase({
        exams,
        questionsByExamId,
        participants,
        users,
      });

      res.json({
        success: true,
        message: 'Database berhasil disinkronkan dan disimpan permanen',
        data: result,
      });
    } catch (err: any) {
      console.error('[DatabaseController] syncBackup failed:', err);
      res.status(500).json({ error: 'Gagal menyinkronkan data database' });
    }
  }

  /**
   * Get summary stats of currently stored questions, exams, and participants
   */
  static getStats(req: Request, res: Response) {
    try {
      const exams = dbStore.getAllExams();
      const participants = dbStore.getAllParticipants();
      let totalQuestions = 0;
      exams.forEach((e) => {
        totalQuestions += (e.totalQuestions || 0);
      });

      res.json({
        success: true,
        data: {
          examsCount: exams.length,
          participantsCount: participants.length,
          questionsCount: totalQuestions,
        },
      });
    } catch (err: any) {
      console.error('[DatabaseController] getStats failed:', err);
      res.status(500).json({ error: 'Gagal memuat status database' });
    }
  }

  /**
   * Total Wipe / Reset of all exams, questions, participants, sessions, results
   * both in Server Memory and in Cloudflare D1
   */
  static async wipeAllData(req: Request, res: Response) {
    try {
      const dbResult = dbStore.wipeAllData();
      const cfResult = await cloudflareService.wipeAllData(true);

      res.json({
        success: true,
        message: 'Seluruh data (Bank Soal, Peserta, Sesi Ujian, dan Hasil) berhasil dihapus bersih dari Cloudflare D1 dan Server!',
        data: {
          ...dbResult,
          cloudflare: cfResult,
        },
      });
    } catch (err: any) {
      console.error('[DatabaseController] wipeAllData failed:', err);
      res.status(500).json({ error: err.message || 'Gagal menghapus total seluruh data' });
    }
  }

  /**
   * Restore database from automatic safety backup
   */
  static async restoreBackup(req: Request, res: Response) {
    try {
      const result = dbStore.restoreSafetyBackup();
      if (!result.success) {
        return res.status(404).json({ error: result.message });
      }
      // Re-sync restored data to Cloudflare
      await cloudflareService.pushAllLocalData().catch((e) => {
        console.warn('Re-sync to Cloudflare warning:', e.message);
      });
      res.json(result);
    } catch (err: any) {
      console.error('[DatabaseController] restoreBackup failed:', err);
      res.status(500).json({ error: err.message || 'Gagal memulihkan cadangan data' });
    }
  }
}
