import { userRepository } from '../repositories/UserRepository';
import { examRepository } from '../repositories/ExamRepository';
import { sessionRepository } from '../repositories/SessionRepository';
import { dbStore } from '../db';
import { User, Exam } from '../../types/cbt';

export class AuthService {
  adminLogin(username: string, password: string): { user: User; token: string } | null {
    if (username === 'ahmad' && password === 'ahmad6193') {
      const user = userRepository.findById('usr_admin');
      if (user) {
        return {
          user,
          token: 'token_admin_secret_key_123',
        };
      }
    }
    return null;
  }

  participantLogin(
    participantToken: string,
    examToken: string,
    deviceId?: string,
    fullName?: string
  ): { user?: User; exam?: Exam; token?: string; error?: string } {
    const participant = userRepository.findByToken(participantToken);
    if (!participant) {
      return { error: 'Token Peserta tidak ditemukan / tidak valid' };
    }

    if (fullName && fullName.trim().length > 0) {
      participant.name = fullName.trim();
      dbStore.persistData();
    }

    const cleanExamToken = examToken.trim().toUpperCase().replace(/[\/\-\_\s]/g, '');
    const exam = examRepository.findByToken(examToken);
    if (!exam || !exam.isActive) {
      return { error: 'Token Ujian tidak ditemukan atau ujian sedang tidak aktif' };
    }

    const currentExamTokenClean = (exam.token || '').trim().toUpperCase().replace(/[\/\-\_\s]/g, '');
    if (currentExamTokenClean !== cleanExamToken) {
      return { error: 'Token Ujian tidak valid atau telah diganti oleh Pengawas Ujian. Silakan minta Token Ujian terbaru.' };
    }

    // Check existing sessions for this participant and exam
    const allSessions = dbStore.getSessionsByParticipantAndExam(participant.id, exam.id);
    const activeSession = allSessions.find(s => s.status === 'IN_PROGRESS');
    const completedSessions = allSessions.filter(s => s.status !== 'IN_PROGRESS');
    const maxAttempts = exam.maxAttempts || 3;

    if (activeSession) {
      if (activeSession.activeDeviceId && deviceId && activeSession.activeDeviceId !== deviceId) {
        return {
          error: 'Akun / Token Peserta ini SEDANG TERPAKAI di perangkat/browser lain. Satu akun hanya bisa digunakan pada 1 perangkat secara bersamaan. Silakan minta Pengawas Ujian untuk MEMBUKA KUNCI PERANGKAT (UNLOCK) agar dapat melanjutkan ujian tanpa kehilangan data jawaban.',
        };
      }
    } else if (completedSessions.length >= maxAttempts) {
      return {
        error: `Peserta ini telah menyelesaikan batas maksimal (${maxAttempts}x) percobaan ujian.`,
      };
    } else if (participant.activeDeviceId && deviceId && participant.activeDeviceId !== deviceId) {
      return {
        error: 'Akun / Token Peserta ini SEDANG DIGUNAKAN di perangkat/browser lain. Minta Pengawas Ujian untuk MEMBUKA KUNCI PERANGKAT (UNLOCK) agar Anda dapat login kembali.',
      };
    }

    if (deviceId) {
      participant.activeDeviceId = deviceId;
      if (activeSession) {
        activeSession.activeDeviceId = deviceId;
      }
    }

    return {
      user: participant,
      exam,
      token: `token_participant:${participant.id}:${exam.id}:${currentExamTokenClean}`,
    };
  }
}

export const authService = new AuthService();
