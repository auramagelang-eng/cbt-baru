import { z } from 'zod';

export const TokenLoginSchema = z.object({
  token: z.string().min(1, 'Token wajib diisi'),
  examToken: z.string().min(1, 'Token Ujian wajib diisi'),
  deviceId: z.string().optional(),
  fullName: z.string().optional(),
});

/**
 * Payload satu jawaban peserta.
 *
 * PENTING: `.catchall(z.unknown())` wajib ada. Tanpa itu Zod membuang field
 * yang tidak dideklarasikan — termasuk `multiShortAnswers` (jawaban isian
 * banyak blank) dan field hasil penilaian AI. Akibatnya jawaban siswa hilang
 * sebelum sempat disimpan. `.catchall` membuat semua field tambahan tetap
 * tersimpan apa adanya.
 */
const AnswerPayloadSchema = z
  .object({
    questionId: z.string(),
    selectedOptionId: z.string().optional(),
    essayAnswer: z.string().optional(),
    shortAnswer: z.string().optional(),
    // Jawaban isian banyak blank, contoh: { "1": "POST", "2": "jumlah" }
    multiShortAnswers: z.record(z.string(), z.string()).optional(),
    isFlagged: z.boolean(),
    updatedAt: z.number(),
  })
  .catchall(z.unknown());

export const BatchSaveAnswersSchema = z.object({
  sessionId: z.string().min(1),
  currentQuestionIndex: z.number().optional(),
  answers: z.record(z.string(), AnswerPayloadSchema),
});

export const LogViolationSchema = z.object({
  sessionId: z.string().min(1),
  type: z.enum(['TAB_SWITCH', 'FULLSCREEN_EXIT', 'BLUR', 'CONTEXT_MENU', 'KEY_SHORTCUT']),
  details: z.string().optional(),
});

export const SubmitExamSchema = z.object({
  sessionId: z.string().min(1),
  answers: z.record(z.string(), AnswerPayloadSchema).optional(),
});

export const CreateExamSchema = z.object({
  title: z.string().min(2, 'Judul minimal 2 karakter'),
  subject: z.string().min(2, 'Mata pelajaran minimal 2 karakter'),
  durationMinutes: z.number().min(1),
  passPercentage: z.number().min(0).max(100),
  token: z.string().min(2, 'Token minimal 2 karakter'),
  shuffleQuestions: z.boolean(),
  shuffleAnswers: z.boolean(),
  maxViolations: z.number().min(1).max(10),
  isPerQuestionTimed: z.boolean().optional(),
  questionDurationSeconds: z.number().optional(),
  isStrictTimer: z.boolean().optional(),
  showInstantFeedback: z.boolean().optional(),
  showAnswerKeys: z.boolean().optional(),
});

export const UpdateExamSchema = CreateExamSchema.partial();
