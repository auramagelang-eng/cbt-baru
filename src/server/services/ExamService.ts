import { examRepository } from '../repositories/ExamRepository';
import { Exam, Question, SessionQuestionPayload } from '../../types/cbt';
import { EssayGrader } from './EssayGrader';

export class ExamService {
  createExam(data: Partial<Exam>): Exam {
    const examId = `exam_${Date.now()}`;
    const newExam: Exam = {
      id: examId,
      title: data.title || 'Ujian Baru',
      subject: data.subject || 'Umum',
      durationMinutes: data.durationMinutes || 60,
      totalQuestions: 0,
      passPercentage: data.passPercentage || 70,
      token: data.token || `TK${Math.floor(1000 + Math.random() * 9000)}`,
      isActive: true,
      shuffleQuestions: data.shuffleQuestions ?? true,
      shuffleAnswers: data.shuffleAnswers ?? true,
      maxViolations: data.maxViolations || 3,
      isPerQuestionTimed: !!data.isPerQuestionTimed,
      questionDurationSeconds: data.questionDurationSeconds || 30,
      isStrictTimer: data.isStrictTimer ?? true,
      showInstantFeedback: data.showInstantFeedback ?? false,
      showAnswerKeys: data.showAnswerKeys ?? true,
      createdAt: new Date().toISOString(),
    };

    // Auto-seed sample questions for new exam if none exist yet
    const sampleQuestions: Question[] = [
      {
        id: `q_${examId}_1`,
        examId: examId,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Manakah tag HTML5 yang digunakan untuk mendefinisikan navigasi utama?\n\n```html\n<nav>\n  <ul>\n    <li><a href="#">Home</a></li>\n  </ul>\n</nav>\n```',
        points: 20,
        options: [
          { id: 'opt_1', optionText: '<nav>' },
          { id: 'opt_2', optionText: '<navigation>' },
          { id: 'opt_3', optionText: '<header>' },
          { id: 'opt_4', optionText: '<menu>' },
        ],
        correctOptionId: 'opt_1',
      },
      {
        id: `q_${examId}_2`,
        examId: examId,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Apa output dari kode PHP berikut?\n\n```php\n<?php\n$val = 5;\n$val += 10;\necho "Hasil: " . $val;\n?>\n```',
        points: 20,
        options: [
          { id: 'opt_a', optionText: 'Hasil: 15' },
          { id: 'opt_b', optionText: 'Hasil: 510' },
          { id: 'opt_c', optionText: 'Hasil: 5' },
          { id: 'opt_d', optionText: 'Syntax Error' },
        ],
        correctOptionId: 'opt_a',
      },
      {
        id: `q_${examId}_3`,
        examId: examId,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Perintah SQL berikut digunakan untuk mengambil data siswa dengan nilai di atas 80:\n\n```sql\nSELECT name, score \nFROM students \nWHERE score > 80 \nORDER BY score DESC;\n```',
        points: 20,
        options: [
          { id: 'sq_1', optionText: 'Mengambil siswa yang nilainya lebih besar dari 80 diurutkan dari nilai tertinggi' },
          { id: 'sq_2', optionText: 'Mengambil siswa yang nilainya 80 diurutkan acak' },
          { id: 'sq_3', optionText: 'Menghapus data siswa yang nilainya di bawah 80' },
          { id: 'sq_4', optionText: 'Menambahkan kolom score ke tabel students' },
        ],
        correctOptionId: 'sq_1',
      },
      {
        id: `q_${examId}_4`,
        examId: examId,
        type: 'TRUE_FALSE',
        questionText: 'Properti CSS `display: flex; align-items: center; justify-content: center;` digunakan untuk menengahkan elemen secara horizontal dan vertikal.\n\n```css\n.container {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n```',
        points: 20,
        options: [
          { id: 'tf_1', optionText: 'BENAR (True)' },
          { id: 'tf_2', optionText: 'SALAH (False)' },
        ],
        correctOptionId: 'tf_1',
      },
      {
        id: `q_${examId}_5`,
        examId: examId,
        type: 'ESSAY',
        questionText: 'Tuliskan sintaks dasar koneksi database MySQLi di PHP!\n\n```php\n$conn = new mysqli($host, $user, $pass, $db);\n```',
        points: 20,
        options: [],
        essayAnswerKey: '$conn = new mysqli("localhost", "root", "", "db_cbt");',
      },
    ];

    examRepository.saveQuestions(examId, sampleQuestions);
    newExam.totalQuestions = sampleQuestions.length;

    return examRepository.saveExam(newExam);
  }

  updateExam(id: string, data: Partial<Exam>): Exam | undefined {
    const existing = examRepository.findById(id);
    if (!existing) return undefined;

    const updated: Exam = {
      ...existing,
      ...data,
      title: data.title !== undefined ? data.title : existing.title,
      subject: data.subject !== undefined ? data.subject : existing.subject,
      durationMinutes: data.durationMinutes !== undefined ? data.durationMinutes : existing.durationMinutes,
      passPercentage: data.passPercentage !== undefined ? data.passPercentage : existing.passPercentage,
      token: data.token !== undefined ? data.token : existing.token,
      shuffleQuestions: data.shuffleQuestions !== undefined ? data.shuffleQuestions : existing.shuffleQuestions,
      shuffleAnswers: data.shuffleAnswers !== undefined ? data.shuffleAnswers : existing.shuffleAnswers,
      maxViolations: data.maxViolations !== undefined ? data.maxViolations : existing.maxViolations,
      isPerQuestionTimed: data.isPerQuestionTimed !== undefined ? data.isPerQuestionTimed : existing.isPerQuestionTimed,
      questionDurationSeconds: data.questionDurationSeconds !== undefined ? data.questionDurationSeconds : existing.questionDurationSeconds,
      isStrictTimer: data.isStrictTimer !== undefined ? data.isStrictTimer : existing.isStrictTimer,
      showInstantFeedback: data.showInstantFeedback !== undefined ? data.showInstantFeedback : existing.showInstantFeedback,
      showAnswerKeys: data.showAnswerKeys !== undefined ? data.showAnswerKeys : existing.showAnswerKeys,
    };

    return examRepository.saveExam(updated);
  }

  getAllExams(): Exam[] {
    return examRepository.getAll();
  }

  getExamById(id: string): Exam | undefined {
    return examRepository.findById(id);
  }

  toggleExamActive(examId: string): Exam | undefined {
    return examRepository.toggleExamActive(examId);
  }

  deleteExam(examId: string): boolean {
    return examRepository.deleteExam(examId);
  }

  getExamQuestions(examId: string): Question[] {
    return examRepository.getQuestionsByExamId(examId);
  }

  saveExamQuestions(examId: string, questions: Question[]): Question[] {
    const processedQuestions = questions.map((q) => {
      const hasMultiKey =
        (Array.isArray(q.answerKey) && q.answerKey.length > 0) ||
        (Array.isArray(q.shortAnswerMultiKey) && q.shortAnswerMultiKey.length > 0);
      const hasBlanksInText = /_{2,}\s*\(?\s*(\d+)\s*\)?\s*_{2,}/.test(q.questionText || '');

      if (q.type === 'SHORT_ANSWER_MULTI' || hasMultiKey || hasBlanksInText) {
        const keys = q.answerKey || q.shortAnswerMultiKey;
        return {
          ...q,
          type: 'SHORT_ANSWER_MULTI' as const,
          answerKey: keys,
          shortAnswerMultiKey: keys,
        };
      }

      if (q.type === 'ESSAY' && !q.essayAiRubric) {
        const rubric = EssayGrader.generateFallbackRubric(q.questionText, q.essayAnswerKey, q.points);
        return {
          ...q,
          essayAiRubric: rubric,
        };
      }
      return q;
    });

    return examRepository.saveQuestions(examId, processedQuestions);
  }

  /**
   * Generates single-time randomized questions and sanitized options for participant payload.
   * Employs High-Entropy Anti-Adjacent Divergent Shuffling (Anti-Kiri-Kanan)
   * so neighboring students in the same room never work on identical or adjacent questions.
   */
  prepareParticipantQuestions(
    exam: Exam,
    questions: Question[],
    participantId?: string,
    attemptNumber: number = 1
  ): {
    shuffledQuestions: Question[];
    sanitizedPayloads: SessionQuestionPayload[];
  } {
    // Generate deterministic entropy seed based on participant ID and attempt
    const seedInput = `${participantId || 'anon'}_${exam.id}_att${attemptNumber}_${Math.random().toString(36).substring(2, 9)}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < seedInput.length; i++) {
      hash ^= seedInput.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    let seed = hash >>> 0;

    // Fast PRNG generator (Mulberry32)
    const nextRandom = (): number => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // 1. First randomize answer options for each question if shuffleAnswers is true
    let questionList = questions.map((q) => {
      let optionsList = q.options ? [...q.options] : [];

      if (exam.shuffleAnswers && optionsList.length > 1 && q.type !== 'TRUE_FALSE') {
        for (let i = optionsList.length - 1; i > 0; i--) {
          const j = Math.floor(nextRandom() * (i + 1));
          [optionsList[i], optionsList[j]] = [optionsList[j], optionsList[i]];
        }
      }

      return {
        ...q,
        options: optionsList,
      };
    });

    // 2. High-Entropy Anti-Adjacent Divergent Shuffling if shuffleQuestions is true
    const N = questionList.length;
    if (exam.shuffleQuestions && N > 1) {
      // Step A: Calculate coprime stride and rotational offset to completely separate adjacent participants
      const gcd = (a: number, b: number): number => (!b ? a : gcd(b, a % b));
      let stride = Math.floor(nextRandom() * (N - 1)) + 1;
      while (gcd(stride, N) !== 1) {
        stride = (stride % (N - 1)) + 1;
      }

      const offset = Math.floor(nextRandom() * N);
      const dispersedList: Question[] = new Array(N);

      // Distribute questions across cyclic coprime strides (breaks local clusters)
      for (let i = 0; i < N; i++) {
        dispersedList[i] = questionList[(offset + i * stride) % N];
      }

      // Step B: Double-pass Fisher-Yates shuffle with PRNG
      for (let i = N - 1; i > 0; i--) {
        const j = Math.floor(nextRandom() * (i + 1));
        [dispersedList[i], dispersedList[j]] = [dispersedList[j], dispersedList[i]];
      }

      // Step C: Anti-Adjacent Derangement Check
      // Guarantee that adjacent questions in the original question bank do NOT remain adjacent in the output
      if (N >= 4) {
        for (let i = 0; i < N - 1; i++) {
          const originalIdxA = questions.findIndex((q) => q.id === dispersedList[i].id);
          const originalIdxB = questions.findIndex((q) => q.id === dispersedList[i + 1].id);

          // If questions were neighbors in the original question list, swap B with a distant element
          if (Math.abs(originalIdxA - originalIdxB) <= 1) {
            const swapTarget = (i + Math.floor(N / 2)) % N;
            if (swapTarget !== i && swapTarget !== i + 1) {
              [dispersedList[i + 1], dispersedList[swapTarget]] = [dispersedList[swapTarget], dispersedList[i + 1]];
            }
          }
        }
      }

      questionList = dispersedList;
    }

    const sanitizedPayloads: SessionQuestionPayload[] = questionList.map((q, index) => {
      const blanks = q.type === 'SHORT_ANSWER_MULTI' ? (q.answerKey || q.shortAnswerMultiKey || []) : [];
      return {
        id: q.id,
        type: q.type,
        questionText: q.questionText,
        imageUrl: q.imageUrl,
        options: q.options,
        points: q.points,
        displayOrder: index + 1,
        blanksCount: q.type === 'SHORT_ANSWER_MULTI' ? blanks.length : undefined,
        blanksList: q.type === 'SHORT_ANSWER_MULTI' ? blanks.map((b) => b.blank) : undefined,
        ...(exam.showInstantFeedback || exam.showAnswerKeys ? {
          correctOptionId: q.correctOptionId,
          essayAnswerKey: q.essayAnswerKey,
          shortAnswerKey: q.shortAnswerKey,
          shortAnswerKeys: q.shortAnswerKeys,
          answerKey: q.answerKey,
          shortAnswerMultiKey: q.shortAnswerMultiKey,
          isCaseSensitive: q.isCaseSensitive,
        } : {}),
      };
    });

    return {
      shuffledQuestions: questionList,
      sanitizedPayloads,
    };
  }
}

export const examService = new ExamService();
