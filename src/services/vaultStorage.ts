import { Exam, Question, User } from '../types/cbt';
import { api } from './api';

export interface DatabaseBackupPayload {
  version: number;
  timestamp: string;
  source: string;
  exams: Exam[];
  questionsByExamId: Record<string, Question[]>;
  participants: User[];
}

const STORAGE_KEY = 'cbt_persistent_vault_v1';
const AUTO_SYNC_KEY = 'cbt_vault_last_sync';

export class VaultStorage {
  /**
   * Retrieves the current local vault state from browser localStorage.
   */
  static getVaultState(): DatabaseBackupPayload {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          version: parsed.version || 1,
          timestamp: parsed.timestamp || new Date().toISOString(),
          source: parsed.source || 'browser_local_storage',
          exams: Array.isArray(parsed.exams) ? parsed.exams : [],
          questionsByExamId: parsed.questionsByExamId && typeof parsed.questionsByExamId === 'object' ? parsed.questionsByExamId : {},
          participants: Array.isArray(parsed.participants) ? parsed.participants : [],
        };
      }
    } catch (e) {
      console.warn('[VaultStorage] Failed to parse local vault:', e);
    }

    return {
      version: 1,
      timestamp: new Date().toISOString(),
      source: 'browser_local_storage',
      exams: [],
      questionsByExamId: {},
      participants: [],
    };
  }

  /**
   * Persists the current state to browser localStorage.
   */
  static saveVaultState(state: Partial<DatabaseBackupPayload>): void {
    try {
      const current = this.getVaultState();
      const updated: DatabaseBackupPayload = {
        ...current,
        ...state,
        timestamp: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('[VaultStorage] Failed to save vault to localStorage:', e);
    }
  }

  /**
   * Saves questions for an exam into the local browser vault.
   */
  static saveExamQuestions(examId: string, questions: Question[]): void {
    const current = this.getVaultState();
    const updatedQuestions = {
      ...current.questionsByExamId,
      [examId]: questions,
    };
    
    // Also update totalQuestions in exam object if present
    const updatedExams = current.exams.map((e) => (e.id === examId ? { ...e, totalQuestions: questions.length } : e));

    this.saveVaultState({
      questionsByExamId: updatedQuestions,
      exams: updatedExams,
    });
  }

  /**
   * Gets questions for an exam from the local browser vault.
   */
  static getExamQuestions(examId: string): Question[] | null {
    const current = this.getVaultState();
    return current.questionsByExamId[examId] || null;
  }

  /**
   * Saves participants to the local browser vault.
   */
  static saveParticipants(participants: User[]): void {
    const onlyParticipants = participants.filter((p) => p.role === 'PARTICIPANT');
    this.saveVaultState({
      participants: onlyParticipants,
    });
  }

  /**
   * Saves or updates a list of exams to the local browser vault.
   */
  static saveExams(exams: Exam[]): void {
    this.saveVaultState({ exams });
  }

  /**
   * Adds or updates a single exam in the local browser vault.
   */
  static saveSingleExam(exam: Exam): void {
    const current = this.getVaultState();
    const existingIndex = current.exams.findIndex((e) => e.id === exam.id);
    let updatedExams: Exam[];
    if (existingIndex >= 0) {
      updatedExams = [...current.exams];
      updatedExams[existingIndex] = exam;
    } else {
      updatedExams = [...current.exams, exam];
    }
    this.saveVaultState({ exams: updatedExams });
  }

  /**
   * Deletes an exam and its questions from the local browser vault.
   */
  static deleteExam(examId: string): void {
    const current = this.getVaultState();
    const updatedExams = current.exams.filter((e) => e.id !== examId);
    const updatedQuestions = { ...current.questionsByExamId };
    delete updatedQuestions[examId];
    this.saveVaultState({ exams: updatedExams, questionsByExamId: updatedQuestions });
  }

  /**
   * Removes a single participant from the local browser vault.
   */
  static deleteParticipant(participantId: string): void {
    const current = this.getVaultState();
    const updated = current.participants.filter((p) => p.id !== participantId);
    this.saveVaultState({ participants: updated });
  }

  /**
   * Completely clears the local browser vault
   */
  static clearVault(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(AUTO_SYNC_KEY);
      console.log('[VaultStorage] Browser vault cleared.');
    } catch (e) {
      console.warn('[VaultStorage] Error clearing vault:', e);
    }
  }

  /**
   * Synchronizes data status with server (Server & Cloudflare are authoritative)
   */
  static async syncWithServer(): Promise<{ synced: boolean; message: string; details?: any }> {
    try {
      const statsRes = await api.get('/database/stats');
      if (statsRes.data?.data) {
        localStorage.setItem(AUTO_SYNC_KEY, new Date().toISOString());
      }
      return { synced: true, message: 'Status database tersinkronisasi dengan server & Cloudflare.' };
    } catch (err: any) {
      return { synced: false, message: 'Gagal memeriksa status server.' };
    }
  }

  /**
   * Export database as downloadable JSON file
   */
  static exportBackupFile(): void {
    const vault = this.getVaultState();
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(vault, null, 2));
    const downloadAnchor = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `cbt_database_backup_${dateStr}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  /**
   * Import database from JSON object and push to server
   */
  static async importBackupData(data: DatabaseBackupPayload): Promise<boolean> {
    if (!data || (!data.exams && !data.participants && !data.questionsByExamId)) {
      throw new Error('Format file backup JSON tidak valid');
    }

    // Save to local vault
    this.saveVaultState({
      exams: data.exams || [],
      questionsByExamId: data.questionsByExamId || {},
      participants: data.participants || [],
    });

    // Send to server
    await api.post('/database/sync-backup', {
      exams: data.exams || [],
      questionsByExamId: data.questionsByExamId || {},
      participants: data.participants || [],
    });

    return true;
  }
}
