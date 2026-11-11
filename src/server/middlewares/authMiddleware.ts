import { Request, Response, NextFunction } from 'express';
import { userRepository } from '../repositories/UserRepository';
import { examRepository } from '../repositories/ExamRepository';
import { dbStore } from '../db';
import { User } from '../../types/cbt';

export interface AuthenticatedRequest extends Request {
  user?: User;
}

export function authMiddleware(requiredRole?: 'ADMIN' | 'PARTICIPANT') {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized', message: 'Token otentikasi tidak ditemukan' });
      return;
    }

    const token = authHeader.split(' ')[1];

    if (token.startsWith('token_admin')) {
      const admin = userRepository.findById('usr_admin');
      if (admin) {
        req.user = admin;
        return next();
      }
    }

    if (token.startsWith('token_participant:') || token.startsWith('token_participant_')) {
      let userId = '';
      let examId = '';
      let authorizedToken = '';

      if (token.startsWith('token_participant:')) {
        const parts = token.split(':');
        userId = parts[1];
        examId = parts[2] || '';
        authorizedToken = parts[3] || '';
      } else {
        const parts = token.split('_');
        userId = `${parts[2]}_${parts[3]}`;
      }

      const user = userRepository.findById(userId);
      if (user) {
        if (requiredRole && requiredRole !== user.role) {
          res.status(403).json({ error: 'Forbidden', message: 'Akses ditolak' });
          return;
        }

        // If authorized for a specific exam token, verify token has not been changed
        if (examId && authorizedToken) {
          const exam = examRepository.findById(examId);
          if (exam && exam.token) {
            const currentClean = exam.token.trim().toUpperCase().replace(/[\/\-\_\s]/g, '');
            if (currentClean !== authorizedToken) {
              const sessions = dbStore.getSessionsByParticipantAndExam(user.id, examId);
              const hasActiveSession = sessions.some(s => s.status === 'IN_PROGRESS');

              // If session not actively started yet, block access with clear notification
              if (!hasActiveSession) {
                res.status(401).json({
                  error: 'Token Ujian Telah Diganti',
                  message: 'Token Ujian telah diperbarui oleh Pengawas. Silakan verifikasi ulang dengan Token Ujian terbaru.',
                  tokenExpired: true,
                });
                return;
              }
            }
          }
        }

        req.user = user;
        return next();
      }
    }

    res.status(401).json({ error: 'Unauthorized', message: 'Token tidak valid' });
  };
}
