import ExcelJS from 'exceljs';
import { sessionRepository } from '../repositories/SessionRepository';
import { examService } from './ExamService';
import { userRepository } from '../repositories/UserRepository';
import { StoredSession, dbStore } from '../db';
import { ExamSessionPayload, ParticipantAnswer, ViolationLog, ExamResult, ShortAnswerMultiItem, ShortAnswerMultiBreakdownItem, Question } from '../../types/cbt';
import { EssayGrader } from './EssayGrader';
import { gradingQueueService } from './GradingQueueService';

export function evaluateShortAnswerCorrectness(
  studentAns: string,
  key?: string,
  keysList?: string[],
  caseSensitive: boolean = false
): boolean {
  if (!studentAns || typeof studentAns !== 'string' || !studentAns.trim()) return false;
  const cleanStudent = studentAns.trim();
  const rawCandidates: string[] = [];

  if (Array.isArray(keysList)) {
    rawCandidates.push(...keysList.map(k => typeof k === 'object' && k ? ((k as any).answer || (k as any).kunci || '') : String(k)));
  }
  if (key) {
    const keyStr = String(key);
    if (keyStr.includes('|')) {
      rawCandidates.push(...keyStr.split('|').map((s) => s.trim()));
    } else {
      rawCandidates.push(keyStr.trim());
    }
  }

  const candidates = rawCandidates.filter((c) => c && c.length > 0);
  if (candidates.length === 0) return false;

  const stripQuotes = (s: string) => s.replace(/^['"`]+|['"`]+$/g, '').trim();
  const stripTrailingSemicolon = (s: string) => s.replace(/;+\s*$/, '').trim();

  const normalize = (str: string, stripPunct = false) => {
    let s = (str || '').trim().replace(/\s+/g, ' ');
    if (stripPunct) {
      s = stripQuotes(s);
      s = stripTrailingSemicolon(s);
      s = stripQuotes(s);
    }
    return caseSensitive ? s : s.toLowerCase();
  };

  const normalizeCode = (s: string) =>
    s.replace(/\s*([\+\-\*\/\%\=\<\>\!\,\[\]\(\)\;])\s*/g, '$1');

  const normStudentExact = normalize(cleanStudent, false);
  const normStudentPunct = normalize(cleanStudent, true);

  return candidates.some((cand) => {
    const candExact = normalize(cand, false);
    const candPunct = normalize(cand, true);

    if (candExact === normStudentExact) return true;
    if (candPunct === normStudentPunct) return true;
    if (candPunct === normStudentExact) return true;
    if (candExact === normStudentPunct) return true;
    if (normalizeCode(normStudentPunct) === normalizeCode(candPunct)) return true;

    return false;
  });
}

export interface MultiBlankEvalResult {
  correctCount: number;
  totalBlanks: number;
  earnedScore: number;
  breakdown: ShortAnswerMultiBreakdownItem[];
  readableSummary: string;
  extractedAnswers?: Record<number | string, string>;
}

export function extractAnswersFromSummary(summary: string): Record<number, string> {
  const result: Record<number, string> = {};
  if (!summary || typeof summary !== 'string') return result;
  // Match patterns like (1) answer or [1] answer or Blank 1: answer
  const regex = /(?:\(|\[|Blank\s*)(\d+)(?:\)|\]|\:|\s*=)\s*([^;,\n\r]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(summary)) !== null) {
    const num = parseInt(match[1], 10);
    const val = (match[2] || '').trim();
    if (!isNaN(num) && val) {
      result[num] = val;
    }
  }
  return result;
}

export function getEffectiveQuestion(q: Question, examQuestions?: Question[]): Question {
  const masterQ = examQuestions?.find((item) => item.id === q.id);
  const base = masterQ ? { ...q, ...masterQ } : q;

  // Preserve explicit SHORT_ANSWER: never coerce single short answer to SHORT_ANSWER_MULTI!
  const isExplicitShortSingle = base.type === 'SHORT_ANSWER' || masterQ?.type === 'SHORT_ANSWER';
  if (isExplicitShortSingle) {
    const rawSingleKey =
      base.shortAnswerKey ??
      masterQ?.shortAnswerKey ??
      (base as any).correctAnswer ??
      (masterQ as any)?.correctAnswer ??
      (base as any).answer ??
      (masterQ as any)?.answer ??
      (base as any).key ??
      (masterQ as any)?.key ??
      (base as any).kunci ??
      (masterQ as any)?.kunci ??
      (base as any).shortAnswer ??
      (masterQ as any)?.shortAnswer;

    const shortKeyVal = rawSingleKey !== undefined && rawSingleKey !== null ? String(rawSingleKey).trim() : '';
    let shortKeys = base.shortAnswerKeys || masterQ?.shortAnswerKeys;
    if (!shortKeys && shortKeyVal) {
      if (shortKeyVal.includes('|')) {
        shortKeys = shortKeyVal.split('|').map((s) => s.trim()).filter(Boolean);
      } else {
        shortKeys = [shortKeyVal];
      }
    }

    return {
      ...base,
      type: 'SHORT_ANSWER',
      shortAnswerKey: shortKeyVal || undefined,
      shortAnswerKeys: shortKeys,
    };
  }

  const hasMultiKey =
    (Array.isArray(base.answerKey) && base.answerKey.length > 0 && typeof base.answerKey[0] === 'object' && 'blank' in base.answerKey[0]) ||
    (Array.isArray(base.shortAnswerMultiKey) && base.shortAnswerMultiKey.length > 0 && typeof base.shortAnswerMultiKey[0] === 'object' && 'blank' in base.shortAnswerMultiKey[0]) ||
    (Array.isArray(masterQ?.answerKey) && (masterQ?.answerKey?.length || 0) > 0 && typeof masterQ?.answerKey?.[0] === 'object' && 'blank' in (masterQ?.answerKey?.[0] || {})) ||
    (Array.isArray(masterQ?.shortAnswerMultiKey) && (masterQ?.shortAnswerMultiKey?.length || 0) > 0 && typeof masterQ?.shortAnswerMultiKey?.[0] === 'object' && 'blank' in (masterQ?.shortAnswerMultiKey?.[0] || {}));
  const hasBlanksInText = /_{2,}\s*\(?\s*(\d+)\s*\)?\s*_{2,}/.test(base.questionText || '');

  if (base.type === 'SHORT_ANSWER_MULTI' || masterQ?.type === 'SHORT_ANSWER_MULTI' || hasMultiKey || (hasBlanksInText && !base.shortAnswerKey && !masterQ?.shortAnswerKey)) {
    const keys = base.answerKey || base.shortAnswerMultiKey || masterQ?.answerKey || masterQ?.shortAnswerMultiKey;
    return {
      ...base,
      type: 'SHORT_ANSWER_MULTI',
      answerKey: keys,
      shortAnswerMultiKey: keys,
    };
  }

  return base;
}

export function evaluateShortAnswerMulti(
  studentAnswers: Record<number | string, string> | undefined,
  answerKey: ShortAnswerMultiItem[] | undefined,
  maxPoints: number,
  caseSensitive: boolean = false,
  fallbackSummaryText?: string
): MultiBlankEvalResult {
  if (!answerKey || answerKey.length === 0) {
    return {
      correctCount: 0,
      totalBlanks: 0,
      earnedScore: 0,
      breakdown: [],
      readableSummary: '',
      extractedAnswers: {},
    };
  }

  const extracted = fallbackSummaryText ? extractAnswersFromSummary(fallbackSummaryText) : {};
  const mergedAnswers: Record<number | string, string> = { ...extracted, ...(studentAnswers || {}) };

  const normalize = (str: string) => {
    let s = (str || '').trim().replace(/\s+/g, ' ');
    return caseSensitive ? s : s.toLowerCase();
  };

  const stripQuotes = (s: string) => s.replace(/^['"](.*)['"]$/, '$1').trim();

  const normalizeCodeExpr = (str: string) => {
    return stripQuotes(normalize(str))
      .replace(/["']/g, "'")
      .replace(/\s*([\+\-\*\/\%\=\<\>\!\,\[\]\(\)\;])\s*/g, '$1')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&');
  };

  let correctCount = 0;
  const breakdown: ShortAnswerMultiBreakdownItem[] = [];
  const summaryParts: string[] = [];

  for (const item of answerKey) {
    const rawStudent =
      mergedAnswers[item.blank] ??
      mergedAnswers[String(item.blank)] ??
      (studentAnswers ? (studentAnswers[item.blank] ?? studentAnswers[String(item.blank)]) : undefined) ??
      extracted[item.blank] ??
      '';
    const cleanStudent = String(rawStudent || '').trim();

    const candidates: string[] = [item.answer];
    if (Array.isArray(item.alternatives)) {
      candidates.push(...item.alternatives);
    }
    if (item.answer.includes('|')) {
      candidates.push(...item.answer.split('|').map((s) => s.trim()));
    }

    const normStudent = normalize(cleanStudent);
    const unquotedStudent = stripQuotes(normStudent);
    const normCodeStudent = normalizeCodeExpr(cleanStudent);

    const isMatch =
      cleanStudent.length > 0 &&
      candidates.some((cand) => {
        const normCand = normalize(cand);
        const unquotedCand = stripQuotes(normCand);
        const normCodeCand = normalizeCodeExpr(cand);

        if (normStudent === normCand || normCodeStudent === normCodeCand || unquotedStudent === unquotedCand) {
          return true;
        }

        // Handle variable with or without leading $ (e.g. "$total" vs "total")
        if (normCand.startsWith('$') && normStudent === normCand.substring(1)) {
          return true;
        }
        if (normStudent.startsWith('$') && normStudent.substring(1) === normCand) {
          return true;
        }

        // Commutative multiplication check e.g. "$angka * $i" vs "$i * $angka"
        if (cand.includes('*')) {
          const parts = cand.split('*').map((p) => normalizeCodeExpr(p));
          if (parts.length === 2) {
            const rev = `${parts[1]}*${parts[0]}`;
            if (normCodeStudent === rev) return true;
          }
        }
        return false;
      });

    if (isMatch) {
      correctCount++;
    }

    breakdown.push({
      blank: item.blank,
      studentAnswer: cleanStudent,
      isCorrect: isMatch,
      correctAnswer: item.answer,
    });

    summaryParts.push(`(${item.blank}) ${cleanStudent || '-'}`);
  }

  const totalBlanks = answerKey.length;
  const earnedScore = totalBlanks > 0 ? Math.round(((correctCount / totalBlanks) * maxPoints) * 100) / 100 : 0;

  return {
    correctCount,
    totalBlanks,
    earnedScore,
    breakdown,
    readableSummary: summaryParts.join('; '),
    extractedAnswers: mergedAnswers,
  };
}

export class SessionService {
  /**
   * Initializes or fetches existing exam session for participant.
   * Sends EVERYTHING in ONE single response payload.
   */
  getOrStartSession(participantId: string, examId: string, deviceId?: string): { payload?: ExamSessionPayload; error?: string } | null {
    const participant = userRepository.findById(participantId);
    const exam = examService.getExamById(examId);

    if (!participant || !exam) return null;
    if (!exam.isActive) {
      return { error: 'Ujian ini sedang dinonaktifkan oleh Pengawas.' };
    }

    const allSessions = dbStore.getSessionsByParticipantAndExam(participantId, examId);
    const activeSession = allSessions.find(s => s.status === 'IN_PROGRESS');
    const completedSessions = allSessions.filter(s => s.status !== 'IN_PROGRESS');
    const maxAttempts = exam.maxAttempts || 3;

    let session: StoredSession;

    if (activeSession) {
      session = activeSession;
      if (session.activeDeviceId && deviceId && session.activeDeviceId !== deviceId) {
        return {
          error: 'Sesi ujian ini sedang aktif di perangkat/browser lain. Tidak dapat mengakses dari 2 perangkat secara bersamaan. Silakan minta Pengawas Ujian untuk MEMBUKA KUNCI PERANGKAT (UNLOCK) agar dapat melanjutkan ujian tanpa kehilangan data.',
        };
      }
      if (!session.activeDeviceId && deviceId) {
        session.activeDeviceId = deviceId;
      }
    } else {
      // Check if participant has exceeded maxAttempts
      if (completedSessions.length >= maxAttempts) {
        // Return latest completed session
        session = completedSessions[completedSessions.length - 1];
      } else {
        // Start a new attempt
        const questions = examService.getExamQuestions(examId);
        const nextAttemptNumber = completedSessions.length + 1;
        const { shuffledQuestions } = examService.prepareParticipantQuestions(exam, questions, participantId, nextAttemptNumber);

        const startTime = Date.now();
        const endTime = startTime + exam.durationMinutes * 60 * 1000;

        session = {
          sessionId: `sess_${participantId}_${examId}_att${nextAttemptNumber}_${Date.now()}`,
          examId,
          participantId,
          attemptNumber: nextAttemptNumber,
          startTime,
          endTime,
          shuffledQuestions,
          answers: {},
          violationsCount: 0,
          status: 'IN_PROGRESS',
          activeDeviceId: deviceId,
        };

        sessionRepository.saveSession(session);
      }
    }

    if (deviceId) {
      participant.activeDeviceId = deviceId;
    }

    // Refresh and synchronize shuffled questions with latest exam master questions (so edited questions/types propagate immediately)
    const examQuestions = examService.getExamQuestions(examId);
    session.shuffledQuestions = (session.shuffledQuestions || []).map((rawQ) => getEffectiveQuestion(rawQ, examQuestions));

    // Build single payload
    const sanitizedQuestions = (session.shuffledQuestions || []).map((q, idx) => {
      const multiKeys = q.answerKey || q.shortAnswerMultiKey;
      let blanksList: number[] | undefined = undefined;
      if (q.type === 'SHORT_ANSWER_MULTI') {
        if (Array.isArray(multiKeys) && multiKeys.length > 0) {
          blanksList = multiKeys.map(k => k.blank).sort((a, b) => a - b);
        } else {
          const set = new Set<number>();
          const r = /_{2,}\s*\(?\s*(\d+)\s*\)?\s*_{2,}/g;
          let m: RegExpExecArray | null;
          while ((m = r.exec(q.questionText)) !== null) {
            const n = parseInt(m[1], 10);
            if (!isNaN(n)) set.add(n);
          }
          blanksList = set.size > 0 ? Array.from(set).sort((a, b) => a - b) : [1, 2, 3, 4, 5];
        }
      }

      return {
        id: q.id,
        type: q.type,
        questionText: q.questionText,
        options: q.options,
        points: q.points,
        displayOrder: idx + 1,
        blanksList,
        blanksCount: blanksList ? blanksList.length : undefined,
        ...(exam.showInstantFeedback || exam.showAnswerKeys !== false ? {
          correctOptionId: q.correctOptionId,
          essayAnswerKey: q.essayAnswerKey,
          shortAnswerKey: q.shortAnswerKey,
          shortAnswerKeys: q.shortAnswerKeys,
          answerKey: q.answerKey || q.shortAnswerMultiKey,
          shortAnswerMultiKey: q.answerKey || q.shortAnswerMultiKey,
          isCaseSensitive: q.isCaseSensitive,
        } : {}),
      };
    });

    return {
      payload: {
        sessionId: session.sessionId,
        attemptNumber: session.attemptNumber || 1,
        totalAttempts: completedSessions.length + (session.status === 'IN_PROGRESS' ? 1 : 0),
        maxAttempts: maxAttempts,
        exam: {
          id: exam.id,
          title: exam.title,
          subject: exam.subject,
          durationMinutes: exam.durationMinutes,
          maxViolations: exam.maxViolations,
          maxAttempts: maxAttempts,
          isPerQuestionTimed: exam.isPerQuestionTimed,
          questionDurationSeconds: exam.questionDurationSeconds,
          isStrictTimer: exam.isStrictTimer,
          showInstantFeedback: exam.showInstantFeedback,
          showAnswerKeys: exam.showAnswerKeys,
          passPercentage: exam.passPercentage,
        },
        participant: {
          id: participant.id,
          name: participant.name,
          participantCode: participant.participantCode || participant.id,
        },
        startTime: session.startTime,
        endTime: session.endTime,
        questions: sanitizedQuestions,
        answers: session.answers || {},
        violationsCount: session.violationsCount || 0,
        status: session.status,
      }
    };
  }

  /**
   * Batch save participant answers and track active question index.
   * Runs real-time background AI grading during the quiz so essay answers
   * (e.g. Question #1) are evaluated immediately while the student continues to the next questions.
   */
  batchSaveAnswers(sessionId: string, answersMap: Record<string, ParticipantAnswer>, currentQuestionIndex?: number): { success: boolean; count: number } {
    const session = sessionRepository.findById(sessionId);
    if (!session || session.status !== 'IN_PROGRESS') {
      return { success: false, count: 0 };
    }

    const answerKeys = Object.keys(answersMap);
    if (answerKeys.length > 1) {
      dbStore.savedRequestsCount += (answerKeys.length - 1);
    }

    // Merge answers safely, preserving any evaluation / grade fields already present
    const examQuestions = examService.getExamQuestions(session.examId);
    const updatedAnswers = { ...session.answers };
    for (const [qId, incoming] of Object.entries(answersMap)) {
      const existing = updatedAnswers[qId];
      const rawQ = session.shuffledQuestions.find((item) => item.id === qId);
      const q = rawQ ? getEffectiveQuestion(rawQ, examQuestions) : undefined;

      const baseAns: ParticipantAnswer = {
        ...existing,
        ...incoming,
        questionId: qId,
        // Ensure grading attributes are NEVER lost or overwritten with undefined
        essayScore: existing?.essayScore ?? incoming.essayScore,
        aiFeedback: existing?.aiFeedback ?? incoming.aiFeedback,
        aiGraded: existing?.aiGraded ?? incoming.aiGraded,
        aiConceptualStrengths: existing?.aiConceptualStrengths ?? incoming.aiConceptualStrengths,
        aiMissingConcepts: existing?.aiMissingConcepts ?? incoming.aiMissingConcepts,
        matchPercentage: existing?.matchPercentage ?? incoming.matchPercentage,
        lastGradedText: existing?.lastGradedText ?? incoming.lastGradedText,
        updatedAt: incoming.updatedAt || Date.now(),
      };

      // REAL-TIME AUTO-GRADING FOR SHORT_ANSWER_MULTI, SHORT_ANSWER OR BACKGROUND ESSAY GRADING:
      if (q && q.type === 'SHORT_ANSWER_MULTI') {
        const studentMulti = incoming.multiShortAnswers ?? existing?.multiShortAnswers;
        const answerKey = q.answerKey || q.shortAnswerMultiKey;
        const fallbackText = incoming.shortAnswer || incoming.essayAnswer || existing?.shortAnswer || existing?.essayAnswer;
        const evalRes = evaluateShortAnswerMulti(studentMulti, answerKey, q.points, q.isCaseSensitive, fallbackText);

        const mergedMulti = studentMulti && Object.keys(studentMulti).length > 0 ? studentMulti : (evalRes.extractedAnswers || {});
        baseAns.multiShortAnswers = mergedMulti;
        baseAns.multiAnswersBreakdown = evalRes.breakdown;
        baseAns.shortAnswer = evalRes.readableSummary || incoming.shortAnswer || '';
        baseAns.essayAnswer = evalRes.readableSummary || incoming.essayAnswer || '';
        baseAns.essayScore = evalRes.earnedScore;
        baseAns.aiGraded = true;
        baseAns.matchPercentage = evalRes.totalBlanks > 0 ? Math.round((evalRes.correctCount / evalRes.totalBlanks) * 100) : 0;
        baseAns.aiFeedback = `${evalRes.correctCount}/${evalRes.totalBlanks} isian tepat (+${evalRes.earnedScore} Poin).`;
        baseAns.lastGradedText = JSON.stringify(mergedMulti || {});
      } else if (q && q.type === 'SHORT_ANSWER') {
        const studentAns = (incoming.shortAnswer ?? incoming.essayAnswer ?? '').trim();
        const isCorrect = evaluateShortAnswerCorrectness(
          studentAns,
          q.shortAnswerKey,
          q.shortAnswerKeys,
          q.isCaseSensitive
        );
        baseAns.shortAnswer = studentAns;
        baseAns.essayAnswer = studentAns;
        baseAns.essayScore = isCorrect ? q.points : 0;
        baseAns.aiGraded = true;
        baseAns.matchPercentage = isCorrect ? 100 : 0;
        baseAns.aiFeedback = isCorrect
          ? `Jawaban isian singkat tepat (+${q.points} Poin).`
          : (studentAns ? 'Jawaban isian singkat belum tepat.' : 'Jawaban isian singkat kosong.');
        baseAns.lastGradedText = studentAns;
      } else if (q && q.type === 'ESSAY') {
        const incomingEssay = (incoming.essayAnswer || '').trim();
        const previousGradedText = existing?.lastGradedText;

        if (!incomingEssay) {
          baseAns.essayScore = 0;
          baseAns.aiFeedback = 'Jawaban uraian kosong / belum diisi.';
          baseAns.aiGraded = true;
          baseAns.matchPercentage = 0;
          baseAns.lastGradedText = '';
        } else if (!existing?.aiGraded || previousGradedText !== incomingEssay) {
          // Answer is either new or edited:
          // 1. Calculate instant local provisional score so it always has a valid score ready
          const localResult = EssayGrader.gradeEssayLocal(
            incomingEssay,
            q.essayAnswerKey,
            q.questionText,
            q.points,
            q.essayAiRubric
          );

          baseAns.essayScore = (existing?.aiGraded && previousGradedText === incomingEssay)
            ? existing.essayScore 
            : localResult.score;
          baseAns.aiFeedback = (existing?.aiFeedback && previousGradedText === incomingEssay)
            ? existing.aiFeedback 
            : 'Jawaban tersimpan. Evaluasi AI sedang berjalan di latar belakang...';
          baseAns.aiGraded = (existing?.aiGraded && previousGradedText === incomingEssay);
          baseAns.aiConceptualStrengths = localResult.conceptualStrengths;
          baseAns.aiMissingConcepts = localResult.missingConcepts;
          baseAns.matchPercentage = localResult.matchPercentage;
          baseAns.lastGradedText = incomingEssay;

          // 2. Trigger asynchronous background AI evaluation immediately while student works on subsequent questions
          gradingQueueService.enqueue(sessionId, q, incomingEssay);
        }
      }

      updatedAnswers[qId] = baseAns;
    }
    session.answers = updatedAnswers;

    if (currentQuestionIndex !== undefined) {
      session.currentQuestionIndex = currentQuestionIndex;
    }

    // Live calculate session score
    let liveScore = 0;
    for (const rawQ of session.shuffledQuestions) {
      const q = getEffectiveQuestion(rawQ, examQuestions);
      const a = session.answers[q.id];
      if (q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE') {
        if (a && a.selectedOptionId === q.correctOptionId) {
          liveScore += q.points;
        }
      } else if (q.type === 'SHORT_ANSWER_MULTI') {
        const multi = a?.multiShortAnswers;
        const answerKey = q.answerKey || q.shortAnswerMultiKey;
        const evalRes = evaluateShortAnswerMulti(multi, answerKey, q.points, q.isCaseSensitive, a?.shortAnswer || a?.essayAnswer);
        liveScore += evalRes.earnedScore;
      } else if (q.type === 'SHORT_ANSWER') {
        const studentAns = (a?.shortAnswer ?? a?.essayAnswer ?? '').trim();
        if (evaluateShortAnswerCorrectness(studentAns, q.shortAnswerKey, q.shortAnswerKeys, q.isCaseSensitive)) {
          liveScore += q.points;
        }
      } else {
        liveScore += (a?.essayScore ?? 0);
      }
    }
    session.score = liveScore;

    sessionRepository.saveSession(session);
    return { success: true, count: answerKeys.length };
  }

  getActiveSessionsInfo() {
    const sessions = sessionRepository.getAllSessions();
    return sessions.map(s => {
      const exam = examService.getExamById(s.examId);
      const participant = userRepository.findById(s.participantId);
      const totalQuestions = s.shuffledQuestions?.length || 0;
      
      let answeredCount = 0;
      if (s.answers) {
        for (const key in s.answers) {
          const a = s.answers[key];
          if (
            a.selectedOptionId ||
            (a.shortAnswer && a.shortAnswer.trim() !== '') ||
            (a.essayAnswer && a.essayAnswer.trim() !== '') ||
            (a.multiShortAnswers && Object.values(a.multiShortAnswers).some(v => (v || '').trim() !== ''))
          ) {
            answeredCount++;
          }
        }
      }

      let currentQuestionIndex = s.currentQuestionIndex || (answeredCount < totalQuestions ? answeredCount + 1 : totalQuestions);
      if (currentQuestionIndex < 1) currentQuestionIndex = 1;
      if (currentQuestionIndex > totalQuestions) currentQuestionIndex = totalQuestions;

      const currentQuestion = s.shuffledQuestions && s.shuffledQuestions[currentQuestionIndex - 1];
      const previewText = currentQuestion?.questionText
        ? currentQuestion.questionText.slice(0, 150)
        : '';

      return {
        sessionId: s.sessionId,
        examId: s.examId,
        examTitle: exam?.title || 'Ujian',
        participantId: s.participantId,
        participantName: participant?.name || 'Peserta',
        participantCode: participant?.participantCode || s.participantId,
        status: s.status,
        currentQuestionIndex,
        totalQuestions,
        answeredCount,
        currentQuestionText: previewText,
        score: s.score,
        maxScore: s.maxScore,
        violationsCount: s.violationsCount,
      };
    });
  }

  /**
   * Log anti-cheat violation and handle auto-submit if threshold reached.
   */
  async logViolation(sessionId: string, type: ViolationLog['type'], details?: string): Promise<{ violationsCount: number; autoSubmitted: boolean }> {
    const session = sessionRepository.findById(sessionId);
    if (!session) return { violationsCount: 0, autoSubmitted: false };

    // Enforce 3-second server debounce to eliminate rapid-fire duplicate violation increments
    const existingLogs = sessionRepository.getViolationLogs(sessionId);
    if (existingLogs && existingLogs.length > 0) {
      const lastLog = existingLogs[existingLogs.length - 1];
      const timeDiff = Date.now() - new Date(lastLog.timestamp).getTime();
      if (timeDiff < 3000) {
        return {
          violationsCount: session.violationsCount,
          autoSubmitted: session.status === 'AUTO_SUBMITTED',
        };
      }
    }

    session.violationsCount += 1;

    const participant = userRepository.findById(session.participantId);
    const violation: ViolationLog = {
      id: `viol_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sessionId,
      participantName: participant?.name || 'Peserta',
      type,
      details: details || `Terdeteksi pelanggaran ${type}`,
      timestamp: new Date().toISOString(),
    };

    sessionRepository.logViolation(violation);

    let autoSubmitted = false;
    const exam = examService.getExamById(session.examId);
    const maxViolations = exam?.maxViolations || 3;

    if (session.violationsCount >= maxViolations && session.status === 'IN_PROGRESS') {
      await this.evaluateAndSubmitExam(sessionId, 'AUTO_SUBMITTED');
      autoSubmitted = true;
    } else {
      sessionRepository.saveSession(session);
    }

    return {
      violationsCount: session.violationsCount,
      autoSubmitted,
    };
  }

  /**
   * Submits exam, computes scores, and finalizes session using AI essay grading.
   */
  async evaluateAndSubmitExam(sessionId: string, status: 'COMPLETED' | 'AUTO_SUBMITTED' = 'COMPLETED'): Promise<ExamResult | null> {
    const session = sessionRepository.findById(sessionId);
    if (!session) return null;

    const exam = examService.getExamById(session.examId);
    const participant = userRepository.findById(session.participantId);
    if (!exam || !participant) return null;

    // Fast idempotent return if already completed (prevent duplicate work if students click rapidly or network retries)
    if (session.status === 'COMPLETED' || session.status === 'AUTO_SUBMITTED') {
      const percentage = session.maxScore > 0 ? Math.round((session.score / session.maxScore) * 100) : 0;
      return {
        sessionId: session.sessionId,
        examId: session.examId,
        participantId: session.participantId,
        participantName: participant.name,
        participantCode: participant.participantCode || session.participantId,
        examTitle: exam.title,
        score: session.score,
        maxScore: session.maxScore,
        percentage,
        isPassed: percentage >= exam.passPercentage,
        submittedAt: session.submittedAt || new Date().toISOString(),
        violationsCount: session.violationsCount || 0,
        status: session.status,
      };
    }

    // Fast instant score calculation (PG + Heuristic Essay in memory < 1ms)
    let totalScore = 0;
    let maxPossibleScore = 0;

    const examQuestions = examService.getExamQuestions(session.examId);
    session.shuffledQuestions = (session.shuffledQuestions || []).map((rawQ) => getEffectiveQuestion(rawQ, examQuestions));

    for (const rawQuestion of session.shuffledQuestions) {
      const question = getEffectiveQuestion(rawQuestion, examQuestions);
      maxPossibleScore += question.points;
      let ans = session.answers[question.id];

      if (question.type === 'MULTIPLE_CHOICE' || question.type === 'TRUE_FALSE') {
        if (ans && ans.selectedOptionId === question.correctOptionId) {
          totalScore += question.points;
        }
      } else if (question.type === 'SHORT_ANSWER_MULTI') {
        if (!ans) {
          ans = {
            questionId: question.id,
            shortAnswer: '',
            essayAnswer: '',
            multiShortAnswers: {},
            isFlagged: false,
            updatedAt: Date.now(),
          };
          session.answers[question.id] = ans;
        }
        const answerKey = question.answerKey || question.shortAnswerMultiKey;
        const evalRes = evaluateShortAnswerMulti(
          ans.multiShortAnswers,
          answerKey,
          question.points,
          question.isCaseSensitive,
          ans.shortAnswer || ans.essayAnswer
        );
        const mergedMulti = ans.multiShortAnswers && Object.keys(ans.multiShortAnswers).length > 0 ? ans.multiShortAnswers : (evalRes.extractedAnswers || {});
        ans.multiShortAnswers = mergedMulti;
        ans.essayScore = evalRes.earnedScore;
        ans.multiAnswersBreakdown = evalRes.breakdown;
        ans.shortAnswer = evalRes.readableSummary || ans.shortAnswer || '';
        ans.essayAnswer = evalRes.readableSummary || ans.essayAnswer || '';
        ans.aiGraded = true;
        ans.matchPercentage = evalRes.totalBlanks > 0 ? Math.round((evalRes.correctCount / evalRes.totalBlanks) * 100) : 0;
        ans.aiFeedback = `${evalRes.correctCount}/${evalRes.totalBlanks} isian tepat (+${evalRes.earnedScore} Poin).`;
        ans.lastGradedText = JSON.stringify(mergedMulti || {});

        totalScore += evalRes.earnedScore;
        session.answers[question.id] = ans;
      } else if (question.type === 'SHORT_ANSWER') {
        if (!ans) {
          ans = {
            questionId: question.id,
            shortAnswer: '',
            essayAnswer: '',
            isFlagged: false,
            updatedAt: Date.now(),
          };
          session.answers[question.id] = ans;
        }
        const studentAns = (ans.shortAnswer ?? ans.essayAnswer ?? '').trim();
        const isCorrect = evaluateShortAnswerCorrectness(
          studentAns,
          question.shortAnswerKey,
          question.shortAnswerKeys,
          question.isCaseSensitive
        );
        ans.shortAnswer = studentAns;
        ans.essayAnswer = studentAns;
        ans.essayScore = isCorrect ? question.points : 0;
        ans.aiFeedback = isCorrect
          ? `Jawaban isian singkat tepat (+${question.points} Poin).`
          : (studentAns ? 'Jawaban isian singkat belum tepat.' : 'Jawaban isian singkat kosong.');
        ans.aiGraded = true;
        ans.matchPercentage = isCorrect ? 100 : 0;
        ans.lastGradedText = studentAns;

        if (isCorrect) {
          totalScore += question.points;
        }
        session.answers[question.id] = ans;
      } else if (question.type === 'ESSAY') {
        if (!ans) {
          ans = {
            questionId: question.id,
            essayAnswer: '',
            isFlagged: false,
            updatedAt: Date.now(),
          };
          session.answers[question.id] = ans;
        }

        const essayText = ans.essayAnswer ? ans.essayAnswer.trim() : '';

        if (!essayText) {
          // Empty essay: instant 0 score, no AI queue needed
          ans.essayScore = 0;
          ans.aiFeedback = 'Jawaban uraian kosong / belum diisi.';
          ans.aiGraded = true;
          ans.matchPercentage = 0;
          ans.lastGradedText = '';
        } else if (ans && ans.aiGraded && ans.essayScore !== undefined && ans.lastGradedText === essayText) {
          // ALREADY GRADED DURING QUIZ IN BACKGROUND: Use finalized score instantly
          totalScore += ans.essayScore;
        } else {
          // If still in-flight or submitted at the very last moment, finalize instantly with standard rubric analyzer
          const localResult = EssayGrader.gradeEssayLocal(
            essayText,
            question.essayAnswerKey,
            question.questionText,
            question.points,
            question.essayAiRubric
          );

          ans.essayScore = ans?.essayScore !== undefined && ans.lastGradedText === essayText 
            ? ans.essayScore 
            : localResult.score;
          ans.aiFeedback = ans?.aiFeedback || localResult.feedback || 'Jawaban telah dievaluasi berdasarkan analisis rubrik esai terstandar.';
          ans.aiGraded = true;
          ans.aiConceptualStrengths = ans?.aiConceptualStrengths || localResult.conceptualStrengths;
          ans.aiMissingConcepts = ans?.aiMissingConcepts || localResult.missingConcepts;
          ans.matchPercentage = ans?.matchPercentage ?? localResult.matchPercentage;
          ans.lastGradedText = essayText;
          totalScore += ans.essayScore;
        }
        session.answers[question.id] = ans;
      }
    }

    const percentage = maxPossibleScore > 0 ? Math.round((totalScore / maxPossibleScore) * 100) : 0;
    const isPassed = percentage >= exam.passPercentage;

    session.status = status;
    session.score = totalScore;
    session.maxScore = maxPossibleScore;
    session.submittedAt = new Date().toISOString();

    sessionRepository.saveSession(session);

    // Fetch all completed attempts for this participant and exam to construct attemptsHistory
    const allSessions = dbStore.getSessionsByParticipantAndExam(participant.id, exam.id);
    const completedSessions = allSessions.filter(s => s.status !== 'IN_PROGRESS');

    const attemptsHistory = completedSessions.map(s => {
      const sScore = s.score || 0;
      const sMaxScore = s.maxScore || 100;
      const sPercentage = sMaxScore > 0 ? Math.round((sScore / sMaxScore) * 100) : 0;
      return {
        attemptNumber: s.attemptNumber || 1,
        sessionId: s.sessionId,
        examId: s.examId,
        score: sScore,
        maxScore: sMaxScore,
        percentage: sPercentage,
        isPassed: sPercentage >= exam.passPercentage,
        submittedAt: s.submittedAt || new Date().toISOString(),
        violationsCount: s.violationsCount || 0,
        status: s.status,
      };
    });

    // Determine best attempt
    const bestAttempt = [...attemptsHistory].sort((a, b) => b.percentage - a.percentage)[0] || {
      attemptNumber: session.attemptNumber || 1,
      score: totalScore,
      maxScore: maxPossibleScore,
      percentage,
      isPassed,
      submittedAt: session.submittedAt,
      violationsCount: session.violationsCount,
      status: session.status,
    };

    return {
      sessionId: session.sessionId,
      examId: exam.id,
      participantId: participant.id,
      participantName: participant.name,
      participantCode: participant.participantCode || participant.id,
      examTitle: exam.title,
      score: bestAttempt.score,
      maxScore: bestAttempt.maxScore,
      percentage: bestAttempt.percentage,
      isPassed: bestAttempt.isPassed,
      submittedAt: bestAttempt.submittedAt,
      violationsCount: bestAttempt.violationsCount,
      status: bestAttempt.status,
      attemptNumber: bestAttempt.attemptNumber,
      totalAttemptsCount: completedSessions.length,
      maxAttemptsAllowed: exam.maxAttempts || 3,
      attemptsHistory,
    };
  }

  getResults(examId?: string): ExamResult[] {
    const sessions = sessionRepository.getAllSessions();
    const completedSessions = sessions.filter(s => s.status !== 'IN_PROGRESS' && (!examId || s.examId === examId));

    // Group by participantId + examId
    const grouped = new Map<string, StoredSession[]>();
    completedSessions.forEach(s => {
      const key = `${s.participantId}_${s.examId}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(s);
    });

    const results: ExamResult[] = [];

    grouped.forEach((userSessions) => {
      if (userSessions.length === 0) return;
      const firstSess = userSessions[0];
      const exam = examService.getExamById(firstSess.examId);
      const participant = userRepository.findById(firstSess.participantId);
      const maxAttempts = exam?.maxAttempts || 3;
      const passPercentage = exam?.passPercentage || 70;

      const attemptsHistory = userSessions
        .map(s => {
          const score = s.score || 0;
          const maxScore = s.maxScore || 100;
          const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
          return {
            attemptNumber: s.attemptNumber || 1,
            sessionId: s.sessionId,
            examId: s.examId,
            score,
            maxScore,
            percentage,
            isPassed: percentage >= passPercentage,
            submittedAt: s.submittedAt || new Date().toISOString(),
            violationsCount: s.violationsCount || 0,
            status: s.status,
          };
        })
        .sort((a, b) => a.attemptNumber - b.attemptNumber);

      // Select highest score (Nilai Tertinggi)
      const bestAttempt = [...attemptsHistory].sort((a, b) => b.percentage - a.percentage)[0];

      results.push({
        sessionId: bestAttempt.sessionId,
        examId: firstSess.examId,
        participantId: firstSess.participantId,
        participantName: participant?.name || 'Peserta',
        participantCode: participant?.participantCode || firstSess.participantId,
        examTitle: exam?.title || 'Ujian',
        score: bestAttempt.score,
        maxScore: bestAttempt.maxScore,
        percentage: bestAttempt.percentage,
        isPassed: bestAttempt.isPassed,
        submittedAt: bestAttempt.submittedAt,
        violationsCount: bestAttempt.violationsCount,
        status: bestAttempt.status,
        attemptNumber: bestAttempt.attemptNumber,
        totalAttemptsCount: attemptsHistory.length,
        maxAttemptsAllowed: maxAttempts,
        attemptsHistory,
      });
    });

    return results.sort((a, b) => a.participantCode.localeCompare(b.participantCode));
  }

  resetParticipantSession(participantId: string, examId?: string, unlockOnly: boolean = false): boolean {
    return dbStore.resetParticipantSession(participantId, examId, unlockOnly);
  }

  unlockParticipantDevice(participantId: string): boolean {
    return dbStore.unlockParticipantDevice(participantId);
  }

  /**
   * Force end a single active participant's exam session from real-time monitoring.
   * Evaluates all answered multiple-choice and essay questions, calculates final scores,
   * saves all participant answers, and marks session as COMPLETED.
   */
  async forceEndSession(sessionId: string): Promise<ExamResult | null> {
    const session = sessionRepository.findById(sessionId);
    if (!session) return null;
    return await this.evaluateAndSubmitExam(sessionId, 'COMPLETED');
  }

  /**
   * Force end a participant session by participantId (convenient lookup).
   */
  async forceEndParticipant(participantId: string, examId?: string): Promise<ExamResult | null> {
    const allSessions = sessionRepository.getAllSessions();
    const session = allSessions.find(
      s => s.participantId === participantId && s.status === 'IN_PROGRESS' && (!examId || s.examId === examId)
    );
    if (!session) return null;
    return await this.evaluateAndSubmitExam(session.sessionId, 'COMPLETED');
  }

  /**
   * Force end all currently active sessions (or for a given examId).
   * Evaluates and submits each session, finalizing all student scores and answers.
   */
  async forceEndAllSessions(examId?: string): Promise<{ count: number; results: ExamResult[] }> {
    const allSessions = sessionRepository.getAllSessions();
    const activeSessions = allSessions.filter(
      s => s.status === 'IN_PROGRESS' && (!examId || examId === 'ALL' || s.examId === examId)
    );

    const results: ExamResult[] = [];
    for (const session of activeSessions) {
      const res = await this.evaluateAndSubmitExam(session.sessionId, 'COMPLETED');
      if (res) results.push(res);
    }

    return { count: results.length, results };
  }

  resetExamSessions(examId: string): number {
    return dbStore.resetExamSessions(examId);
  }

  resetAllSessions(examId?: string, clearDeviceLocks: boolean = true): number {
    return dbStore.resetAllSessions(examId, clearDeviceLocks);
  }

  unlockAllDevices(): number {
    return dbStore.unlockAllDevices();
  }

  /**
   * Generates a 3-sheet Excel workbook (Percobaan 1, Percobaan 2, Percobaan 3)
   * with question columns, answer key row, and color-coded student answers.
   */
  async generateAttemptsAnalysisWorkbook(examId: string): Promise<ExcelJS.Workbook> {
    const exam = examService.getExamById(examId);
    if (!exam) {
      throw new Error(`Ujian dengan ID '${examId}' tidak ditemukan.`);
    }

    const questions = examService.getExamQuestions(examId);
    const allParticipants = userRepository.getAllParticipants();
    const allSessions = sessionRepository.getAllSessions().filter(s => s.examId === examId);

    // Map unique participants
    const participantMap = new Map<string, { id: string; name: string; participantCode: string }>();
    allParticipants.forEach(p => {
      participantMap.set(p.id, {
        id: p.id,
        name: p.name,
        participantCode: p.participantCode || p.id,
      });
    });

    // Also include any participant in sessions not in allParticipants
    allSessions.forEach(s => {
      if (!participantMap.has(s.participantId)) {
        const u = userRepository.findById(s.participantId);
        participantMap.set(s.participantId, {
          id: s.participantId,
          name: u?.name || 'Peserta',
          participantCode: u?.participantCode || s.participantId,
        });
      }
    });

    const participantList = Array.from(participantMap.values()).sort((a, b) =>
      a.participantCode.localeCompare(b.participantCode, undefined, { numeric: true })
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CBT Cloud Engine';
    workbook.created = new Date();

    // Create 3 sheets: Percobaan 1, Percobaan 2, Percobaan 3
    for (let attemptNum = 1; attemptNum <= 3; attemptNum++) {
      const sheetName = `Percobaan ${attemptNum}`;
      const ws = workbook.addWorksheet(sheetName, {
        views: [{ state: 'frozen', xSplit: 7, ySplit: 6 }]
      });

      // Page Title & Header Info
      ws.mergeCells('A1:G1');
      const titleCell = ws.getCell('A1');
      titleCell.value = `HASIL ANALISIS BUTIR SOAL & JAWABAN SISWA - PERCOBAAN #${attemptNum}`;
      titleCell.font = { bold: true, size: 13, color: { argb: 'FF0F172A' } };

      ws.mergeCells('A2:G2');
      const subTitle = ws.getCell('A2');
      subTitle.value = `Mata Uji: ${exam.title} | Token: ${exam.token} | KKM: ${exam.passPercentage}% | Waktu Ekspor: ${new Date().toLocaleString('id-ID')}`;
      subTitle.font = { size: 9.5, color: { argb: 'FF475569' } };

      ws.mergeCells('A3:G3');
      const legendCell = ws.getCell('A3');
      legendCell.value = `PANDUAN WARNA: [Hijau = Benar / Nilai Tinggi] | [Kuning = Nilai Parsial / Toleransi] | [Merah = Salah / Kosong]`;
      legendCell.font = { size: 9, italic: true, bold: true, color: { argb: 'FF0284C7' } };

      // Row 5: Column Headers
      const headerRow = ws.getRow(5);
      const headerValues: any[] = [
        'No',
        'Kode / NISN',
        'Nama Peserta',
        'Nilai Akhir (%)',
        'Skor Diperoleh',
        'Status',
        'Waktu Selesai',
      ];

      questions.forEach((q, idx) => {
        const qTypeLabel = q.type === 'ESSAY' ? 'Uraian' : (q.type === 'SHORT_ANSWER' ? 'Isian' : (q.type === 'TRUE_FALSE' ? 'B/S' : 'PG'));
        const cleanText = (q.questionText || '').replace(/```[\s\S]*?```/g, ' ').replace(/\r?\n/g, ' ').trim();
        const shortText = cleanText.length > 70 ? cleanText.slice(0, 67) + '...' : cleanText;
        headerValues.push(`Soal ${idx + 1} (${qTypeLabel}, ${q.points} Poin)\n${shortText}`);
      });

      headerRow.values = headerValues;
      headerRow.height = 48;
      headerRow.eachCell({ includeEmpty: false }, (cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9.5 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF0F766E' } // Deep teal
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF94A3B8' } },
          bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
          left: { style: 'thin', color: { argb: 'FF94A3B8' } },
          right: { style: 'thin', color: { argb: 'FF94A3B8' } },
        };
      });

      // Row 6: KUNCI JAWABAN (Under the question headers)
      const keyRow = ws.getRow(6);
      const keyValues: any[] = [
        'KUNCI JAWABAN / ACUAN SOAL', '', '', '', '', '', ''
      ];

      questions.forEach((q) => {
        if (q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE') {
          const corrOpt = q.options?.find(o => o.id === q.correctOptionId);
          const optIdx = q.options?.findIndex(o => o.id === q.correctOptionId) ?? -1;
          const letter = optIdx >= 0 ? String.fromCharCode(65 + optIdx) : '';
          const optText = corrOpt?.optionText || q.correctOptionId || '-';
          keyValues.push(`Kunci: ${letter ? `${letter}. ` : ''}${optText}`);
        } else if (q.type === 'SHORT_ANSWER_MULTI') {
          const multiKeys = q.answerKey || q.shortAnswerMultiKey || [];
          const text = multiKeys.map(k => `(${k.blank}) ${k.answer}`).join('\n');
          keyValues.push(`Kunci Isian (${multiKeys.length} Blank):\n${text || '-'}`);
        } else if (q.type === 'SHORT_ANSWER') {
          const keyText = q.shortAnswerKey || (q.shortAnswerKeys || []).join(' | ') || '-';
          keyValues.push(`Kunci Isian:\n${keyText}`);
        } else {
          const keyText = q.essayAnswerKey || q.essayAiRubric?.idealAnswer || '(Toleransi Logika Siswa)';
          keyValues.push(`Kunci Acuan:\n${keyText.replace(/\r?\n/g, ' ').slice(0, 100)}`);
        }
      });

      keyRow.values = keyValues;
      ws.mergeCells('A6:G6');
      keyRow.height = 36;
      keyRow.eachCell({ includeEmpty: false }, (cell) => {
        cell.font = { bold: true, color: { argb: 'FF0369A1' }, size: 9.5 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0F2FE' } // Soft sky blue
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF94A3B8' } },
          bottom: { style: 'medium', color: { argb: 'FF0284C7' } },
          left: { style: 'thin', color: { argb: 'FF94A3B8' } },
          right: { style: 'thin', color: { argb: 'FF94A3B8' } },
        };
      });
      ws.getCell('A6').alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

      // Rows 7+: Participant answers
      participantList.forEach((participant, pIdx) => {
        const rowIdx = 7 + pIdx;
        const studentRow = ws.getRow(rowIdx);

        // Find session for this participant and attemptNum
        const session = allSessions.find(
          s => s.participantId === participant.id && (s.attemptNumber || 1) === attemptNum
        );

        const hasAttempt = !!session && session.status !== 'IN_PROGRESS';
        const score = session?.score || 0;
        const maxScore = session?.maxScore || (questions.reduce((acc, q) => acc + q.points, 0) || 100);
        const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
        const isPassed = percentage >= exam.passPercentage;
        const timeStr = session?.submittedAt ? new Date(session.submittedAt).toLocaleString('id-ID') : '-';

        const rowValues: any[] = [
          pIdx + 1,
          participant.participantCode,
          participant.name,
          hasAttempt ? `${percentage}%` : '(Belum Ikut)',
          hasAttempt ? `${score} / ${maxScore}` : '-',
          hasAttempt ? (isPassed ? 'LULUS' : 'REMIDI') : '-',
          timeStr,
        ];

        questions.forEach((q) => {
          if (!hasAttempt) {
            rowValues.push('-');
            return;
          }

          const ans = session.answers?.[q.id];
          if (q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE') {
            if (!ans || !ans.selectedOptionId) {
              rowValues.push('(Tidak Dijawab)');
            } else {
              const optIdx = q.options?.findIndex(o => o.id === ans.selectedOptionId) ?? -1;
              const letter = optIdx >= 0 ? String.fromCharCode(65 + optIdx) : '';
              const opt = q.options?.find(o => o.id === ans.selectedOptionId);
              const isCorrect = ans.selectedOptionId === q.correctOptionId;
              rowValues.push(`${isCorrect ? '✓' : '✗'} ${letter ? `${letter}. ` : ''}${opt?.optionText || ans.selectedOptionId}`);
            }
          } else if (q.type === 'SHORT_ANSWER_MULTI') {
            const answerKey = q.answerKey || q.shortAnswerMultiKey;
            const evalRes = evaluateShortAnswerMulti(
              ans?.multiShortAnswers,
              answerKey,
              q.points,
              q.isCaseSensitive
            );
            if (!ans || !ans.multiShortAnswers || Object.keys(ans.multiShortAnswers).length === 0) {
              rowValues.push(`(Tidak Dijawab)\n[Nilai: 0 / ${q.points}]`);
            } else {
              const details = evalRes.breakdown.map(b => `(${b.blank}) ${b.isCorrect ? '✓' : '✗'} ${b.studentAnswer || '-'}`).join('\n');
              rowValues.push(`[Nilai: ${evalRes.earnedScore} / ${q.points}]\n${details}`);
            }
          } else if (q.type === 'SHORT_ANSWER') {
            const studentText = (ans?.shortAnswer ?? ans?.essayAnswer ?? '').trim();
            const isCorrect = evaluateShortAnswerCorrectness(
              studentText,
              q.shortAnswerKey,
              q.shortAnswerKeys,
              q.isCaseSensitive
            );
            if (!studentText) {
              rowValues.push(`(Tidak Dijawab)\n[Nilai: 0 / ${q.points}]`);
            } else {
              rowValues.push(`${isCorrect ? '✓' : '✗'} ${studentText}\n[Nilai: ${isCorrect ? q.points : 0} / ${q.points}]`);
            }
          } else {
            // ESSAY: Include complete student answer, score, and AI notes
            if (!ans || !ans.essayAnswer || ans.essayAnswer.trim() === '') {
              rowValues.push(`(Tidak Dijawab)\n[Nilai: 0 / ${q.points}]`);
            } else {
              const essayScore = ans.essayScore ?? 0;
              const feedbackText = ans.aiFeedback ? `\nCatatan AI: ${ans.aiFeedback}` : '';
              rowValues.push(`${ans.essayAnswer}\n\n[Nilai: ${essayScore} / ${q.points}]${feedbackText}`);
            }
          }
        });

        studentRow.values = rowValues;
        studentRow.height = 36;

        // Style participant info cells (Col 1 to 7)
        for (let col = 1; col <= 7; col++) {
          const cell = studentRow.getCell(col);
          cell.alignment = {
            vertical: 'middle',
            horizontal: col === 3 ? 'left' : 'center',
            wrapText: true
          };
          cell.font = {
            size: 9,
            bold: col === 4 || col === 6,
            color: col === 6 ? (hasAttempt ? (isPassed ? { argb: 'FF15803D' } : { argb: 'FFB91C1C' }) : { argb: 'FF64748B' }) : { argb: 'FF1E293B' }
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: pIdx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF' }
          };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          };
        }

        // Style question answer cells (Col 8+) with requested color blocks
        questions.forEach((q, qIdx) => {
          const colNum = 8 + qIdx;
          const cell = studentRow.getCell(colNum);
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          };

          if (!hasAttempt) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            cell.font = { color: { argb: 'FF94A3B8' }, italic: true, size: 9 };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            return;
          }

          const ans = session.answers?.[q.id];

          if (q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE') {
            cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            if (!ans || !ans.selectedOptionId) {
              // Unanswered: MERAH
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
              cell.font = { color: { argb: 'FF721C24' }, bold: true, size: 9 };
            } else {
              const isCorrect = ans.selectedOptionId === q.correctOptionId;
              if (isCorrect) {
                // Benar: HIJAU
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } };
                cell.font = { color: { argb: 'FF155724' }, bold: true, size: 9 };
              } else {
                // Salah: MERAH
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
                cell.font = { color: { argb: 'FF721C24' }, size: 9 };
              }
            }
          } else if (q.type === 'SHORT_ANSWER') {
            cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            const studentText = (ans?.shortAnswer ?? ans?.essayAnswer ?? '').trim();
            const isCorrect = evaluateShortAnswerCorrectness(
              studentText,
              q.shortAnswerKey,
              q.shortAnswerKeys,
              q.isCaseSensitive
            );
            if (!studentText) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
              cell.font = { color: { argb: 'FF721C24' }, bold: true, size: 9 };
            } else if (isCorrect) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } };
              cell.font = { color: { argb: 'FF155724' }, bold: true, size: 9 };
            } else {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
              cell.font = { color: { argb: 'FF721C24' }, size: 9 };
            }
          } else {
            // ESSAY: Adjust height and colors
            studentRow.height = Math.max(studentRow.height, 58);
            cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };

            const essayScore = ans?.essayScore ?? 0;
            const maxPoints = q.points || 10;
            const ratio = maxPoints > 0 ? essayScore / maxPoints : 0;

            if (!ans || !ans.essayAnswer || ans.essayAnswer.trim() === '' || essayScore === 0) {
              // Salah / 0 poin / kosong: MERAH
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8D7DA' } };
              cell.font = { color: { argb: 'FF721C24' }, size: 9 };
            } else if (ratio >= 0.8) {
              // Nilai tinggi (>= 80%): HIJAU
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } };
              cell.font = { color: { argb: 'FF155724' }, size: 9 };
            } else {
              // Nilai parsial / toleransi logika: KUNING
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
              cell.font = { color: { argb: 'FF856404' }, size: 9 };
            }
          }
        });
      });

      // Set optimal column widths
      ws.getColumn(1).width = 6;  // No
      ws.getColumn(2).width = 16; // Kode / NISN
      ws.getColumn(3).width = 28; // Nama Peserta
      ws.getColumn(4).width = 16; // Nilai (%)
      ws.getColumn(5).width = 14; // Skor
      ws.getColumn(6).width = 15; // Status
      ws.getColumn(7).width = 20; // Waktu Selesai

      questions.forEach((q, qIdx) => {
        const col = ws.getColumn(8 + qIdx);
        col.width = q.type === 'ESSAY' ? 46 : 26;
      });
    }

    return workbook;
  }

  /**
   * Recalculates and re-grades essay submissions for all or specified sessions
   * using the latest smart, requirement-aware rubric evaluator.
   */
  async regradeEssaySubmissions(examId?: string, sessionId?: string): Promise<{
    updatedCount: number;
    sessionsUpdated: { sessionId: string; oldScore: number; newScore: number }[];
  }> {
    const allSessions = sessionRepository.getAllSessions();
    const targetSessions = allSessions.filter((s) => {
      if (sessionId && s.sessionId !== sessionId) return false;
      if (examId && s.examId !== examId) return false;
      return true;
    });

    const sessionsUpdated: { sessionId: string; oldScore: number; newScore: number }[] = [];

    for (const session of targetSessions) {
      const exam = examService.getExamById(session.examId);
      const questions = examService.getExamQuestions(session.examId);

      let totalScore = 0;
      let hasEssayRecalculated = false;
      const oldScore = session.score;

      session.shuffledQuestions = (session.shuffledQuestions || []).map((sq) => getEffectiveQuestion(sq, questions));

      for (const rawQ of questions) {
        const q = getEffectiveQuestion(rawQ, questions);
        const ans = session.answers[q.id];

        if (q.type === 'SHORT_ANSWER_MULTI') {
          const multi = ans?.multiShortAnswers;
          const answerKey = q.answerKey || q.shortAnswerMultiKey;
          const evalRes = evaluateShortAnswerMulti(
            multi,
            answerKey,
            q.points,
            q.isCaseSensitive,
            ans?.shortAnswer || ans?.essayAnswer
          );

          if (ans) {
            const mergedMulti = multi && Object.keys(multi).length > 0 ? multi : (evalRes.extractedAnswers || {});
            ans.multiShortAnswers = mergedMulti;
            ans.multiAnswersBreakdown = evalRes.breakdown;
            ans.shortAnswer = evalRes.readableSummary || ans.shortAnswer || '';
            ans.essayAnswer = evalRes.readableSummary || ans.essayAnswer || '';
            ans.essayScore = evalRes.earnedScore;
            ans.aiGraded = true;
            ans.matchPercentage = evalRes.totalBlanks > 0 ? Math.round((evalRes.correctCount / evalRes.totalBlanks) * 100) : 0;
            ans.aiFeedback = `${evalRes.correctCount}/${evalRes.totalBlanks} isian tepat (+${evalRes.earnedScore} Poin).`;
            ans.lastGradedText = JSON.stringify(mergedMulti || {});
            // Clear any stale CLI / Essay error messages
            ans.aiConceptualStrengths = undefined;
            ans.aiMissingConcepts = undefined;
            hasEssayRecalculated = true;
          }
          totalScore += evalRes.earnedScore;
        } else if (q.type === 'SHORT_ANSWER') {
          const studentAns = (ans?.shortAnswer ?? ans?.essayAnswer ?? '').trim();
          const isCorrect = evaluateShortAnswerCorrectness(
            studentAns,
            q.shortAnswerKey,
            q.shortAnswerKeys,
            q.isCaseSensitive
          );
          if (ans) {
            ans.shortAnswer = studentAns;
            ans.essayAnswer = studentAns;
            ans.essayScore = isCorrect ? q.points : 0;
            ans.aiFeedback = isCorrect
              ? `Jawaban isian singkat tepat (+${q.points} Poin).`
              : (studentAns ? 'Jawaban isian singkat belum tepat.' : 'Jawaban isian singkat kosong.');
            ans.aiGraded = true;
            ans.matchPercentage = isCorrect ? 100 : 0;
            ans.lastGradedText = studentAns;
            ans.aiConceptualStrengths = undefined;
            ans.aiMissingConcepts = undefined;
            hasEssayRecalculated = true;
          }
          if (isCorrect) {
            totalScore += q.points;
          }
        } else if (q.type === 'ESSAY') {
          const essayText = ans?.essayAnswer ? ans.essayAnswer.trim() : '';
          if (!essayText) {
            if (ans) {
              ans.essayScore = 0;
              ans.aiFeedback = 'Jawaban uraian kosong / belum diisi.';
              ans.aiGraded = true;
              ans.matchPercentage = 0;
            }
          } else {
            const localResult = EssayGrader.gradeEssayLocal(
              essayText,
              q.essayAnswerKey,
              q.questionText,
              q.points,
              q.essayAiRubric
            );
            if (ans) {
              ans.essayScore = localResult.score;
              ans.aiFeedback = localResult.feedback;
              ans.aiGraded = true;
              ans.aiConceptualStrengths = localResult.conceptualStrengths;
              ans.aiMissingConcepts = localResult.missingConcepts;
              ans.matchPercentage = localResult.matchPercentage;
              ans.lastGradedText = essayText;
              hasEssayRecalculated = true;
            }
            totalScore += localResult.score;
          }
        } else {
          // MULTIPLE_CHOICE or TRUE_FALSE
          if (ans && ans.selectedOptionId && ans.selectedOptionId === q.correctOptionId) {
            totalScore += q.points;
          }
        }
      }

      if (hasEssayRecalculated || session.score !== totalScore) {
        session.score = totalScore;
        sessionRepository.saveSession(session);
        sessionsUpdated.push({
          sessionId: session.sessionId,
          oldScore,
          newScore: totalScore,
        });
      }
    }

    return {
      updatedCount: sessionsUpdated.length,
      sessionsUpdated,
    };
  }
}

export const sessionService = new SessionService();

