import { dbStore, StoredSession } from '../db';
import { ViolationLog } from '../../types/cbt';

export class SessionRepository {
  findById(sessionId: string): StoredSession | undefined {
    return dbStore.getSession(sessionId);
  }

  findByParticipantAndExam(participantId: string, examId: string): StoredSession | undefined {
    return dbStore.getSessionByParticipantAndExam(participantId, examId);
  }

  saveSession(session: StoredSession): StoredSession {
    dbStore.saveSession(session);
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
  }

  getViolationLogs(sessionId?: string): ViolationLog[] {
    return dbStore.getViolationLogs(sessionId);
  }
}

export const sessionRepository = new SessionRepository();
