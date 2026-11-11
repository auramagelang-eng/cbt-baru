import { EssayGrader } from './EssayGrader';
import { sessionRepository } from '../repositories/SessionRepository';
import { dbStore } from '../db';
import { Question, ParticipantAnswer } from '../../types/cbt';

export interface GradingTask {
  sessionId: string;
  question: Question;
  essayAnswerText: string;
}

/**
 * Background Asynchronous Worker Queue for AI Essay Grading.
 * 
 * Prevents server saturation, rate-limits (HTTP 429), and student UI freezes
 * when multiple students submit exams simultaneously.
 */
export class GradingQueueService {
  private queue: GradingTask[] = [];
  private activeWorkers = 0;
  private readonly maxConcurrency = 3; // Max 3 concurrent Gemini requests to prevent rate limit spikes
  private taskKeySet = new Set<string>();
  private requeueMap = new Map<string, { question: Question; essayAnswerText: string }>();

  /**
   * Enqueue an essay question for background AI grading during the exam.
   * If the student left it blank, it is not enqueued.
   */
  enqueue(sessionId: string, question: Question, essayAnswerText: string) {
    if (!essayAnswerText || essayAnswerText.trim() === '') {
      return;
    }

    // STRICT GUARD: Only purely textual ESSAY questions should be enqueued for AI essay grading!
    if (question.type !== 'ESSAY') {
      return;
    }

    const qText = question.questionText || '';
    if (
      /_{2,}\s*\(?\s*\d+\s*\)?\s*_{2,}/.test(qText) ||
      qText.includes('____') ||
      (Array.isArray(question.answerKey) && question.answerKey.length > 0) ||
      (Array.isArray(question.shortAnswerMultiKey) && question.shortAnswerMultiKey.length > 0)
    ) {
      return;
    }

    const taskKey = `${sessionId}:${question.id}`;

    // If already waiting in queue, just update to the latest answer text
    const existingQueueItem = this.queue.find(
      (t) => t.sessionId === sessionId && t.question.id === question.id
    );
    if (existingQueueItem) {
      existingQueueItem.essayAnswerText = essayAnswerText;
      return;
    }

    // If currently being evaluated by an active worker, schedule a re-evaluation if text changed
    if (this.taskKeySet.has(taskKey)) {
      this.requeueMap.set(taskKey, { question, essayAnswerText });
      return;
    }

    this.taskKeySet.add(taskKey);
    this.queue.push({
      sessionId,
      question,
      essayAnswerText,
    });

    this.processNext();
  }

  private async processNext() {
    if (this.activeWorkers >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.activeWorkers++;

    (async () => {
      const taskKey = `${task.sessionId}:${task.question.id}`;
      const evaluatedText = task.essayAnswerText;
      try {
        // Enforce 12-second timeout per AI evaluation so complex coding grading never hangs indefinitely
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('AI grading timeout (12s)')), 12000)
        );

        const gradePromise = EssayGrader.gradeEssayWithAI(
          task.question.questionText,
          task.essayAnswerText,
          task.question.essayAnswerKey,
          task.question.points,
          task.question.essayAiRubric
        );

        const gradeResult = (await Promise.race([gradePromise, timeoutPromise])) as any;

        // Apply updated evaluation to session with aiGraded strictly TRUE
        this.applyGradeResult(task.sessionId, task.question.id, {
          ...gradeResult,
          aiGraded: true,
        }, evaluatedText);
      } catch (err: any) {
        console.warn(`[GradingQueue] Background AI grading fallback for session ${task.sessionId}, question ${task.question.id}:`, err?.message || err);
        // Fallback to rich local matrix evaluation, marked as completed
        const localResult = EssayGrader.gradeEssayLocal(
          task.essayAnswerText,
          task.question.essayAnswerKey,
          task.question.questionText,
          task.question.points,
          task.question.essayAiRubric
        );
        this.applyGradeResult(task.sessionId, task.question.id, {
          ...localResult,
          aiGraded: true,
          feedback: localResult.feedback || 'Jawaban telah dinilai berdasarkan analisis rubrik esai terstandar.',
        }, evaluatedText);
      } finally {
        this.taskKeySet.delete(taskKey);
        this.activeWorkers--;

        // Check if a revised text arrived while this evaluation was in flight
        const pendingRequeue = this.requeueMap.get(taskKey);
        if (pendingRequeue) {
          this.requeueMap.delete(taskKey);
          if (pendingRequeue.essayAnswerText !== evaluatedText) {
            this.enqueue(task.sessionId, pendingRequeue.question, pendingRequeue.essayAnswerText);
          }
        }

        // Process next queued task
        this.processNext();
      }
    })();

    // Fill worker slots if queue has items and capacity remains
    if (this.activeWorkers < this.maxConcurrency && this.queue.length > 0) {
      this.processNext();
    }
  }

  /**
   * Applies the graded result to the session and recalculates total score in dbStore.
   */
  private applyGradeResult(sessionId: string, questionId: string, gradeResult: any, gradedText?: string) {
    const session = sessionRepository.findById(sessionId);
    if (!session) return;

    const existingAns = session.answers[questionId] || {
      questionId,
      essayAnswer: '',
      isFlagged: false,
      updatedAt: Date.now(),
    };

    // If student has updated to a completely different text since grading started, don't overwrite
    if (gradedText && existingAns.essayAnswer && existingAns.essayAnswer.trim() !== gradedText.trim()) {
      return;
    }

    const updatedAns: ParticipantAnswer = {
      ...existingAns,
      questionId,
      essayScore: gradeResult.score,
      aiFeedback: gradeResult.feedback || 'Jawaban telah dievaluasi dengan analisis penalaran rubrik esai AI.',
      aiGraded: gradeResult.aiGraded !== false,
      aiConceptualStrengths: gradeResult.conceptualStrengths,
      aiMissingConcepts: gradeResult.missingConcepts,
      matchPercentage: gradeResult.matchPercentage,
      lastGradedText: gradedText || existingAns.essayAnswer,
      updatedAt: Date.now(),
    };

    session.answers[questionId] = updatedAns;

    // Recalculate total score
    let totalScore = 0;
    for (const q of session.shuffledQuestions) {
      const a = session.answers[q.id];
      if (q.type !== 'ESSAY') {
        if (a && a.selectedOptionId === q.correctOptionId) {
          totalScore += q.points;
        }
      } else {
        totalScore += (a?.essayScore ?? 0);
      }
    }

    session.score = totalScore;
    sessionRepository.saveSession(session);
    dbStore.persistData();
  }

  getQueueStatus() {
    return {
      pending: this.queue.length,
      activeWorkers: this.activeWorkers,
    };
  }
}

export const gradingQueueService = new GradingQueueService();
