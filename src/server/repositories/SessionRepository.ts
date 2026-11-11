import { dbStore, StoredSession } from '../db';
import { ViolationLog } from '../../types/cbt';
import { cloudflareService } from '../services/CloudflareService';

export class SessionRepository {
  findById(sessionId: string): StoredSession | undefined {
    return dbStore.getSession(sessionId);
  }

  findByParticipantAndExam(participantId: string, examId: string): StoredSession | undefined {
    return dbStore.getSessionByParticipantAndExam(participantId, examId);
  }

  saveSession(session: StoredSession): StoredSession {
    dbStore.saveSession(session);
    cloudflareService.syncSession(session);
    return session;
  }

  getAllSessions(): StoredSession[] {
    return dbStore.getAllSessions();
  }

  findAll(): StoredSession[] {
    return dbStore.getAllSessions();
  }

  logViolation(violation: ViolationLog): void {
    dbStore.logViolation(violation);
    cloudflareService.syncViolation(violation);
  }

  getViolationLogs(sessionId?: string): ViolationLog[] {
    return dbStore.getViolationLogs(sessionId);
  }
}

export const sessionRepository = new SessionRepository();
