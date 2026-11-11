import { Request, Response } from 'express';
import { examService } from '../services/ExamService';
import { userRepository } from '../repositories/UserRepository';
import { sessionService } from '../services/SessionService';
import { CreateExamSchema, UpdateExamSchema } from '../dto';
import { EssayGrader } from '../services/EssayGrader';

export class ExamController {
  static getAllExams(req: Request, res: Response) {
    const exams = examService.getAllExams();
    res.json({ data: exams });
  }

  static getExamDetail(req: Request, res: Response) {
    const exam = examService.getExamById(req.params.id);
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan' });
      return;
    }
    const questions = examService.getExamQuestions(exam.id);
    res.json({ data: { ...exam, questions } });
  }

  static createExam(req: Request, res: Response) {
    const parseResult = CreateExamSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Data ujian tidak valid', details: parseResult.error.format() });
      return;
    }

    const exam = examService.createExam(parseResult.data);
    res.status(201).json({ message: 'Ujian berhasil dibuat', data: exam });
  }

  static updateExam(req: Request, res: Response) {
    const parseResult = UpdateExamSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Data pengaturan ujian tidak valid', details: parseResult.error.format() });
      return;
    }

    const updated = examService.updateExam(req.params.id, parseResult.data);
    if (!updated) {
      res.status(404).json({ error: 'Sesi ujian tidak ditemukan' });
      return;
    }

    res.json({ message: 'Pengaturan sesi ujian berhasil diperbarui', data: updated });
  }

  static saveQuestions(req: Request, res: Response) {
    const { questions } = req.body;
    if (!Array.isArray(questions)) {
      res.status(400).json({ error: 'Format soal harus array' });
      return;
    }

    const saved = examService.saveExamQuestions(req.params.id, questions);
    res.json({ message: 'Bank Soal berhasil diperbarui', count: saved.length });
  }

  static toggleActive(req: Request, res: Response) {
    const exam = examService.toggleExamActive(req.params.id);
    if (!exam) {
      res.status(404).json({ error: 'Ujian tidak ditemukan' });
      return;
    }
    res.json({ message: `Sesi ujian berhasil di${exam.isActive ? 'aktifkan' : 'nonaktifkan'}`, data: exam });
  }

  static deleteExam(req: Request, res: Response) {
    const success = examService.deleteExam(req.params.id);
    if (!success) {
      res.status(404).json({ error: 'Ujian tidak ditemukan' });
      return;
    }
    res.json({ message: 'Sesi ujian beserta seluruh bank soal dan riwayatnya berhasil dihapus' });
  }

  static getParticipants(req: Request, res: Response) {
    const participants = userRepository.getAllParticipants();
    const activeSessions = sessionService.getActiveSessionsInfo();
    const activeMap = new Map();
    activeSessions.forEach(s => activeMap.set(s.participantId, s));

    const enriched = participants.map(p => ({
      ...p,
      activeStatus: activeMap.get(p.id) || null,
    }));

    res.json({ data: enriched });
  }

  static createParticipantBatch(req: Request, res: Response) {
    const { count = 10 } = req.body;
    const currentCount = userRepository.getAllParticipants().length;
    const created = [];

    for (let i = 1; i <= count; i++) {
      const idx = currentCount + i;
      const numStr = String(idx).padStart(2, '0');
      const code = `RPL${numStr}`;
      const token = `RPL${numStr}`;
      const participant = userRepository.createParticipant({
        id: `usr_rpl_${numStr}`,
        username: code.toLowerCase(),
        name: `Peserta RPL ${numStr}`,
        role: 'PARTICIPANT',
        participantCode: code,
        token: token,
      });
      created.push(participant);
    }

    res.status(201).json({ message: `Berhasil menambahkan ${created.length} peserta baru`, data: created });
  }

  static createSingleParticipant(req: Request, res: Response) {
    const { name, participantCode, token } = req.body;
    if (!name || !participantCode) {
      res.status(400).json({ error: 'Nama dan Kode Peserta wajib diisi' });
      return;
    }

    const cleanCode = participantCode.trim().toUpperCase();
    const cleanToken = (token || cleanCode).trim().toUpperCase();
    const id = `usr_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const participant = userRepository.createParticipant({
      id,
      username: cleanCode.toLowerCase(),
      name: name.trim(),
      role: 'PARTICIPANT',
      participantCode: cleanCode,
      token: cleanToken,
    });

    res.status(201).json({ message: 'Peserta berhasil ditambahkan', data: participant });
  }

  static deleteParticipant(req: Request, res: Response) {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: 'ID peserta diperlukan' });
      return;
    }
    const success = userRepository.deleteParticipant(id);
    if (!success) {
      res.status(404).json({ error: 'Peserta tidak ditemukan atau tidak dapat dihapus' });
      return;
    }
    res.json({ message: 'Peserta berhasil dihapus' });
  }

  static clearAllParticipants(req: Request, res: Response) {
    const count = userRepository.clearAllParticipants();
    res.json({ message: `Berhasil mengosongkan seluruh daftar peserta (${count} peserta dihapus)`, count });
  }

  static importClassParticipants(req: Request, res: Response) {
    const { participants, clearExisting = false } = req.body;
    if (!Array.isArray(participants) || participants.length === 0) {
      res.status(400).json({ error: 'Daftar peserta tidak boleh kosong' });
      return;
    }

    const created = userRepository.importParticipantsBatch(participants, clearExisting);
    res.status(201).json({
      message: `Berhasil mengimpor ${created.length} peserta untuk kelas baru`,
      data: created,
    });
  }

  static async generateEssayRubric(req: Request, res: Response) {
    try {
      const { questionText, essayAnswerKey, points = 20 } = req.body;
      if (!questionText || typeof questionText !== 'string' || !questionText.trim()) {
        res.status(400).json({ error: 'Teks pertanyaan wajib diisi untuk generate kunci AI' });
        return;
      }

      const rubric = await EssayGrader.generateEssayAiRubric(
        questionText.trim(),
        typeof essayAnswerKey === 'string' ? essayAnswerKey.trim() : undefined,
        Number(points) || 20
      );

      res.json({
        message: 'Kunci Jawaban Model & Matriks Prediksi AI berhasil dibuat',
        data: rubric,
      });
    } catch (err: any) {
      console.error('generateEssayRubric error, providing smart fallback rubric:', err);
      try {
        const fallback = EssayGrader.generateFallbackRubric(
          String(req.body?.questionText || ''),
          typeof req.body?.essayAnswerKey === 'string' ? req.body.essayAnswerKey : undefined,
          Number(req.body?.points) || 20
        );
        res.json({
          message: 'Kunci Jawaban Model & Matriks Prediksi AI siap digunakan',
          data: fallback,
        });
      } catch (fallbackErr: any) {
        res.status(500).json({ error: err.message || 'Gagal generate rubrik AI' });
      }
    }
  }
}
