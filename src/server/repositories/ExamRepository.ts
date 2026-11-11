import { dbStore } from '../db';
import { Exam, Question } from '../../types/cbt';
import { cacheEngine } from '../cache';
import { cloudflareService } from '../services/CloudflareService';

export class ExamRepository {
  findByToken(token: string): Exam | undefined {
    if (!token) return undefined;
    const cleanToken = token.trim().toUpperCase().replace(/[\/\-\_\s]/g, '');
    const cacheKey = `exam_token_${cleanToken}`;
    const cached = cacheEngine.get<Exam>(cacheKey);
    if (cached) {
      const cachedClean = (cached.token || '').trim().toUpperCase().replace(/[\/\-\_\s]/g, '');
      if (cachedClean === cleanToken) {
        return cached;
      }
      cacheEngine.delete(cacheKey);
    }

    const exam = dbStore.getExamByToken(token);
    if (exam) {
      const examClean = (exam.token || '').trim().toUpperCase().replace(/[\/\-\_\s]/g, '');
      if (examClean === cleanToken) {
        cacheEngine.set(cacheKey, exam, 300);
        return exam;
      }
      return undefined;
    }
    return undefined;
  }

  findById(id: string): Exam | undefined {
    const cacheKey = `exam_id_${id}`;
    const cached = cacheEngine.get<Exam>(cacheKey);
    if (cached) return cached;

    const exam = dbStore.getExamById(id);
    if (exam) {
      cacheEngine.set(cacheKey, exam, 300);
    }
    return exam;
  }

  getAll(): Exam[] {
    const cacheKey = `exams_all`;
    const cached = cacheEngine.get<Exam[]>(cacheKey);
    if (cached) return cached;

    const exams = dbStore.getAllExams();
    cacheEngine.set(cacheKey, exams, 60);
    return exams;
  }

  getQuestionsByExamId(examId: string): Question[] {
    const cacheKey = `questions_exam_${examId}`;
    const cached = cacheEngine.get<Question[]>(cacheKey);
    if (cached) return cached;

    const questions = dbStore.getQuestionsByExamId(examId);
    cacheEngine.set(cacheKey, questions, 300);
    return questions;
  }

  saveExam(exam: Exam): Exam {
    dbStore.saveExam(exam);
    cacheEngine.delete(`exams_all`);
    cacheEngine.delete(`exam_id_${exam.id}`);
    cacheEngine.deleteByPrefix('exam_token_');
    cloudflareService.syncExam(exam);
    return exam;
  }

  toggleExamActive(examId: string): Exam | undefined {
    const exam = dbStore.toggleExamActive(examId);
    cacheEngine.delete(`exams_all`);
    cacheEngine.delete(`exam_id_${examId}`);
    cacheEngine.deleteByPrefix('exam_token_');
    if (exam) {
      cloudflareService.syncExam(exam);
    }
    return exam;
  }

  deleteExam(examId: string): boolean {
    const success = dbStore.deleteExam(examId);
    cacheEngine.delete(`exams_all`);
    cacheEngine.delete(`exam_id_${examId}`);
    cacheEngine.deleteByPrefix('exam_token_');
    if (success) {
      cloudflareService.deleteExam(examId);
    }
    return success;
  }

  saveQuestions(examId: string, questions: Question[]): Question[] {
    dbStore.saveQuestionsForExam(examId, questions);
    cacheEngine.delete(`questions_exam_${examId}`);
    cloudflareService.syncQuestions(examId, questions);
    return questions;
  }
}

export const examRepository = new ExamRepository();
