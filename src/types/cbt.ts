export type UserRole = 'ADMIN' | 'PARTICIPANT';

export interface User {
  id: string;
  username: string;
  name: string;
  originalName?: string;
  role: UserRole;
  participantCode?: string;
  token?: string;
  activeDeviceId?: string;
  ipAddress?: string;
  activeStatus?: {
    status: 'IN_PROGRESS' | 'COMPLETED' | 'AUTO_SUBMITTED';
    currentQuestionIndex: number;
    totalQuestions: number;
    answeredCount: number;
    score?: number;
    maxScore?: number;
    violationsCount: number;
  };
}

export type QuestionType = 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'ESSAY' | 'SHORT_ANSWER' | 'SHORT_ANSWER_MULTI';

export interface QuestionOption {
  id: string;
  optionText: string;
  imageUrl?: string;
}

export interface ShortAnswerMultiItem {
  blank: number;
  answer: string;
  alternatives?: string[];
}

export interface ShortAnswerMultiBreakdownItem {
  blank: number;
  studentAnswer: string;
  isCorrect: boolean;
  correctAnswer: string;
}

export interface KeyConceptItem {
  concept: string;
  weightPercentage: number;
  description?: string;
}

export interface CorrectVariationItem {
  pattern: string;
  description?: string;
}

export interface CommonMistakeItem {
  pattern: string;
  scorePercentage: number;
  reason: string;
}

export interface EssayAiRubric {
  idealAnswer: string;
  keyConcepts: KeyConceptItem[];
  correctVariations: CorrectVariationItem[];
  commonMistakes: CommonMistakeItem[];
  summaryExplanation?: string;
  generatedAt?: string;
}

export interface Question {
  id: string;
  examId: string;
  type: QuestionType;
  questionText: string;
  imageUrl?: string;
  options: QuestionOption[];
  correctOptionId?: string; // Hidden from participant response
  essayAnswerKey?: string; // Hidden from participant response
  essayAiRubric?: EssayAiRubric; // AI-generated grading matrix & prediction variations
  shortAnswerKey?: string; // Kunci jawaban isian singkat (misal: "echo" atau alternatif "echo | print")
  shortAnswerKeys?: string[]; // Daftar alternatif jawaban benar
  answerKey?: ShortAnswerMultiItem[]; // Kunci jawaban isian banyak blank (SHORT_ANSWER_MULTI)
  shortAnswerMultiKey?: ShortAnswerMultiItem[]; // Alias untuk fleksibilitas
  isCaseSensitive?: boolean; // Pembedaan huruf besar/kecil (default false)
  points: number;
}

export interface Exam {
  id: string;
  title: string;
  subject: string;
  durationMinutes: number;
  totalQuestions: number;
  passPercentage: number;
  token: string;
  isActive: boolean;
  shuffleQuestions: boolean;
  shuffleAnswers: boolean;
  maxViolations: number;
  maxAttempts?: number;
  isPerQuestionTimed?: boolean;
  questionDurationSeconds?: number;
  isStrictTimer?: boolean;
  showInstantFeedback?: boolean;
  showAnswerKeys?: boolean;
  createdAt: string;
}

export interface ParticipantAnswer {
  questionId: string;
  selectedOptionId?: string;
  essayAnswer?: string;
  shortAnswer?: string;
  multiShortAnswers?: Record<number, string>; // e.g. { 1: "POST", 2: "jumlah", 3: "hitung", 4: ">", 5: "$total" }
  multiAnswersBreakdown?: ShortAnswerMultiBreakdownItem[];
  essayScore?: number;
  aiFeedback?: string;
  aiGraded?: boolean;
  aiConceptualStrengths?: string[];
  aiMissingConcepts?: string[];
  matchPercentage?: number;
  lastGradedText?: string;
  isFlagged: boolean;
  updatedAt: number;
}

export interface SessionQuestionPayload {
  id: string;
  type: QuestionType;
  questionText: string;
  imageUrl?: string;
  options: QuestionOption[];
  points: number;
  displayOrder: number;
  blanksCount?: number;
  blanksList?: number[];
  correctOptionId?: string;
  essayAnswerKey?: string;
  shortAnswerKey?: string;
  shortAnswerKeys?: string[];
  answerKey?: ShortAnswerMultiItem[];
  shortAnswerMultiKey?: ShortAnswerMultiItem[];
  isCaseSensitive?: boolean;
}

export interface ExamSessionPayload {
  sessionId: string;
  attemptNumber?: number;
  totalAttempts?: number;
  maxAttempts?: number;
  exam: {
    id: string;
    title: string;
    subject: string;
    durationMinutes: number;
    maxViolations: number;
    maxAttempts?: number;
    isPerQuestionTimed?: boolean;
    questionDurationSeconds?: number;
    isStrictTimer?: boolean;
    showInstantFeedback?: boolean;
    showAnswerKeys?: boolean;
    passPercentage?: number;
  };
  participant: {
    id: string;
    name: string;
    participantCode: string;
  };
  startTime: number;
  endTime: number;
  questions: SessionQuestionPayload[];
  answers: Record<string, ParticipantAnswer>;
  violationsCount: number;
  status?: 'IN_PROGRESS' | 'COMPLETED' | 'AUTO_SUBMITTED';
  score?: number;
  maxScore?: number;
}

export interface ViolationLog {
  id: string;
  sessionId: string;
  participantName: string;
  type: 'TAB_SWITCH' | 'FULLSCREEN_EXIT' | 'BLUR' | 'CONTEXT_MENU' | 'KEY_SHORTCUT';
  details: string;
  timestamp: string;
}

export interface AttemptDetail {
  attemptNumber: number;
  sessionId: string;
  examId?: string;
  score: number;
  maxScore: number;
  percentage: number;
  isPassed: boolean;
  submittedAt: string;
  violationsCount: number;
  status: 'COMPLETED' | 'AUTO_SUBMITTED' | 'IN_PROGRESS';
}

export interface ExamResult {
  sessionId: string;
  examId?: string;
  participantId: string;
  participantName: string;
  participantCode: string;
  examTitle: string;
  score: number;
  maxScore: number;
  percentage: number;
  isPassed: boolean;
  submittedAt: string;
  violationsCount: number;
  status: 'COMPLETED' | 'AUTO_SUBMITTED' | 'IN_PROGRESS';
  attemptNumber?: number;
  totalAttemptsCount?: number;
  maxAttemptsAllowed?: number;
  attemptsHistory?: AttemptDetail[];
}

export interface ServerMetrics {
  memoryUsageMB: number;
  cacheHitRatioPercentage: number;
  totalDbQueries: number;
  totalApiRequests: number;
  avgResponseTimeMs: number;
  activeSessionsCount: number;
  savedNetworkRequestsCount: number; // Estimate of saved per-question API requests
}
