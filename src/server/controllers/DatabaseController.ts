import { Request, Response } from 'express';
import { dbStore } from '../db';
import { flushPersistence, supabaseStore } from '../supabase';

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
  static async syncBackup(req: Request, res: Response) {
    try {
      const { exams, questionsByExamId, participants, users } = req.body;
      const result = dbStore.restoreOrMergeDatabase({
        exams,
        questionsByExamId,
        participants,
        users,
      });

      // Pastikan salinan dari vault browser benar-benar masuk ke Supabase.
      const persisted = await flushPersistence();

      res.json({
        success: true,
        message: 'Database berhasil disinkronkan dan disimpan permanen',
        data: result,
        persisted,
      });
    } catch (err: any) {
      console.error('[DatabaseController] syncBackup failed:', err);
      res.status(500).json({ error: 'Gagal menyinkronkan data database' });
    }
  }

  /**
   * Get summary stats of currently stored questions, exams, and participants
   */
  static async getStats(req: Request, res: Response) {
    try {
      // Statistik dibaca ulang dari database, bukan dari cache yang mungkin basi.
      await supabaseStore.refreshIfStale(0);
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
          storage: supabaseStore.getStatus(),
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
      const persisted = await flushPersistence();

      res.json({
        success: true,
        message: 'Seluruh data (Bank Soal, Peserta, Sesi Ujian, dan Hasil) berhasil dihapus bersih dari database permanen!',
        data: {
          ...dbResult,
          persisted,
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
      // Tidak ada lagi cadangan file: seluruh data dimuat ulang dari database.
      const snapshot = await supabaseStore.loadAll();
      dbStore.hydrate(snapshot);
      res.json({
        success: true,
        message: `Data dimuat ulang dari database: ${snapshot.exams.length} ujian, ${snapshot.users.filter((u) => u.role === 'PARTICIPANT').length} peserta.`,
        restoredExams: snapshot.exams.length,
        restoredParticipants: snapshot.users.filter((u) => u.role === 'PARTICIPANT').length,
        persisted: true,
      });
    } catch (err: any) {
      console.error('[DatabaseController] restoreBackup failed:', err);
      res.status(500).json({ error: err.message || 'Gagal memuat ulang data dari database' });
    }
  }
}
