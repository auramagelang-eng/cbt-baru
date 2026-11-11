import { ParticipantAnswer } from '../types/cbt';
import { api } from './api';

const OFFLINE_KEY_PREFIX = 'cbt_offline_answers_';

export class OfflineStorageManager {
  static getLocalAnswers(sessionId: string): Record<string, ParticipantAnswer> {
    try {
      const data = localStorage.getItem(`${OFFLINE_KEY_PREFIX}${sessionId}`);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }

  static setLocalAnswers(sessionId: string, answers: Record<string, ParticipantAnswer>): void {
    try {
      localStorage.setItem(`${OFFLINE_KEY_PREFIX}${sessionId}`, JSON.stringify(answers));
      this.markUnsynced(sessionId, true);
    } catch (e) {
      console.error('Gagal menyimpan ke LocalStorage', e);
    }
  }

  static updateLocalAnswer(sessionId: string, answer: ParticipantAnswer): Record<string, ParticipantAnswer> {
    const current = this.getLocalAnswers(sessionId);
    current[answer.questionId] = answer;
    this.setLocalAnswers(sessionId, current);
    return current;
  }

  static markUnsynced(sessionId: string, unsynced: boolean): void {
    if (unsynced) {
      localStorage.setItem(`cbt_has_unsynced_${sessionId}`, 'true');
    } else {
      localStorage.removeItem(`cbt_has_unsynced_${sessionId}`);
    }
  }

  static isUnsynced(sessionId: string): boolean {
    return localStorage.getItem(`cbt_has_unsynced_${sessionId}`) === 'true';
  }

  static async flushAnswersToServer(sessionId: string, currentQuestionIndex?: number): Promise<boolean> {
    const answers = this.getLocalAnswers(sessionId);
    if (!answers || Object.keys(answers).length === 0) return true;

    try {
      await api.post('/session/batch-save', {
        sessionId,
        answers,
        currentQuestionIndex,
      });
      this.markUnsynced(sessionId, false);
      return true;
    } catch (err) {
      console.warn('Gagal melakukan sync online, tersimpan di lokal', err);
      return false;
    }
  }

  /**
   * Fast beacon flush on browser page close / unload
   */
  static sendUnloadBeacon(sessionId: string): void {
    if (!this.isUnsynced(sessionId)) return;

    const answers = this.getLocalAnswers(sessionId);
    if (Object.keys(answers).length === 0) return;

    const token = localStorage.getItem('cbt_auth_token') || '';
    const blob = new Blob(
      [
        JSON.stringify({
          sessionId,
          answers,
        }),
      ],
      { type: 'application/json' }
    );

    navigator.sendBeacon(`/api/session/batch-save?token=${encodeURIComponent(token)}`, blob);
  }

  static clearLocalAnswers(sessionId: string): void {
    try {
      localStorage.removeItem(`${OFFLINE_KEY_PREFIX}${sessionId}`);
      localStorage.removeItem(`cbt_has_unsynced_${sessionId}`);
    } catch (e) {
      console.error('Gagal membersihkan cache offline', e);
    }
  }

  static clearAllOfflineCaches(): void {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach((key) => {
        if (
          key.startsWith(OFFLINE_KEY_PREFIX) ||
          key.startsWith('cbt_has_unsynced_') ||
          key.startsWith('cbt_session_')
        ) {
          localStorage.removeItem(key);
        }
      });
    } catch (e) {
      console.error('Gagal membersihkan seluruh cache offline', e);
    }
  }
}
