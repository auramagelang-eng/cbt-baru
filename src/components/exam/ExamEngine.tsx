import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Clock, ShieldAlert, Flag, ChevronLeft, ChevronRight, CheckCircle2, CloudUpload, RefreshCw, AlertTriangle, Send, Lock, Timer, Code2, Wifi, Sparkles, Maximize, ShieldCheck } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { FormattedText } from '../ui/CodeBlock';
import { ExamSessionPayload, ParticipantAnswer } from '../../types/cbt';
import { OfflineStorageManager } from '../../services/offlineStorage';
import { AntiCheatEngine, ViolationHandler } from '../../services/antiCheat';
import { AntiCheatOverlay } from './AntiCheatOverlay';
import { api } from '../../services/api';

export interface ExamTimersInfo {
  timeLeftSeconds: number;
  questionTimeLeft: number;
  isPerQuestionTimed?: boolean;
  questionNumber?: number;
  totalQuestions?: number;
}

interface ExamEngineProps {
  sessionPayload: ExamSessionPayload;
  onSubmitExam: (sessionId: string, answers?: Record<string, ParticipantAnswer>) => Promise<void>;
  onTimerTick?: (timers: ExamTimersInfo) => void;
}

export const ExamEngine: React.FC<ExamEngineProps> = ({ sessionPayload, onSubmitExam, onTimerTick }) => {
  const { sessionId, exam, participant, endTime, questions } = sessionPayload;

  const isPerQuestionTimed = !!exam.isPerQuestionTimed;
  const isStrictTimer = Boolean(exam.isStrictTimer || exam.isPerQuestionTimed);
  const perQuestionDuration = exam.questionDurationSeconds || Math.max(30, Math.floor((exam.durationMinutes * 60) / Math.max(1, questions.length)));

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, ParticipantAnswer>>(() => {
    const local = OfflineStorageManager.getLocalAnswers(sessionId);
    return {
      ...(sessionPayload.answers || {}),
      ...local,
    };
  });

  const [syncStatus, setSyncStatus] = useState<'synced' | 'saving' | 'unsynced'>('synced');
  const [timeLeftSeconds, setTimeLeftSeconds] = useState<number>(() => {
    return Math.max(0, Math.floor((endTime - Date.now()) / 1000));
  });

  // Per-question countdown timer state
  const [questionTimeLeft, setQuestionTimeLeft] = useState<number>(perQuestionDuration);

  // Auto-next timer & visual feedback toast state
  const autoNextTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [autoAdvanceToast, setAutoAdvanceToast] = useState<string | null>(null);

  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Anti-cheat Violation Overlay state
  const [violationsCount, setViolationsCount] = useState(sessionPayload.violationsCount || 0);
  const [latestViolation, setLatestViolation] = useState<{ type: string; details: string } | null>(null);
  const [isViolationModalOpen, setIsViolationModalOpen] = useState(false);

  // Real-time fullscreen detection state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => AntiCheatEngine.isFullscreenActive());

  useEffect(() => {
    const checkFs = () => {
      setIsFullscreen(AntiCheatEngine.isFullscreenActive());
    };
    checkFs();

    document.addEventListener('fullscreenchange', checkFs);
    document.addEventListener('webkitfullscreenchange', checkFs);
    document.addEventListener('mozfullscreenchange', checkFs);
    document.addEventListener('MSFullscreenChange', checkFs);
    window.addEventListener('resize', checkFs);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        setTimeout(checkFs, 150);
        setTimeout(checkFs, 450);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('fullscreenchange', checkFs);
      document.removeEventListener('webkitfullscreenchange', checkFs);
      document.removeEventListener('mozfullscreenchange', checkFs);
      document.removeEventListener('MSFullscreenChange', checkFs);
      window.removeEventListener('resize', checkFs);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleReturnToFullscreen = async () => {
    try {
      await AntiCheatEngine.requestFullscreen();
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    let active = AntiCheatEngine.isFullscreenActive();
    if (!active) {
      // If native fullscreen was blocked/denied by browser or iframe, auto-activate Focus Mode
      AntiCheatEngine.setFocusMode(true);
      active = true;
    }
    setIsFullscreen(active);
    setIsViolationModalOpen(false);
  };

  const handleContinueWithFocusMode = () => {
    AntiCheatEngine.setFocusMode(true);
    setIsFullscreen(true);
    setIsViolationModalOpen(false);
  };

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const overallTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentQuestion = questions[currentIndex];

  // Stable refs to prevent unnecessary effect/interval re-creations and timer glitching
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const currentIndexRef = useRef(currentIndex);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const isSubmittingRef = useRef(isSubmitting);
  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  const handleFinalSubmit = useCallback(
    async (_isAuto = false, finalAnswers?: Record<string, ParticipantAnswer>) => {
      if (isSubmittingRef.current) return;
      isSubmittingRef.current = true;
      setIsSubmitting(true);
      try {
        if (autoNextTimeoutRef.current) {
          clearTimeout(autoNextTimeoutRef.current);
          autoNextTimeoutRef.current = null;
        }
        setAutoAdvanceToast(null);
        const currentAns = finalAnswers || answersRef.current;
        OfflineStorageManager.setLocalAnswers(sessionId, currentAns);

        // Submit immediately with full answers for instant scoring
        await onSubmitExam(sessionId, currentAns);
        OfflineStorageManager.clearLocalAnswers(sessionId);
      } catch (err) {
        console.error('Gagal mengirim ujian:', err);
      } finally {
        setIsSubmitting(false);
        isSubmittingRef.current = false;
      }
    },
    [sessionId, onSubmitExam]
  );

  const handleQuestionTimeExpired = useCallback(() => {
    if (autoNextTimeoutRef.current) {
      clearTimeout(autoNextTimeoutRef.current);
      autoNextTimeoutRef.current = null;
    }
    setAutoAdvanceToast(null);

    setCurrentIndex((prevIndex) => {
      if (prevIndex < questions.length - 1) {
        return prevIndex + 1;
      } else {
        // Last question expired in per-question timed mode -> Auto Submit immediately
        handleFinalSubmit(true);
        return prevIndex;
      }
    });
  }, [questions.length, handleFinalSubmit]);

  const handleQuestionTimeExpiredRef = useRef(handleQuestionTimeExpired);
  useEffect(() => {
    handleQuestionTimeExpiredRef.current = handleQuestionTimeExpired;
  }, [handleQuestionTimeExpired]);

  // Clean up auto-next timer on index change
  useEffect(() => {
    if (autoNextTimeoutRef.current) {
      clearTimeout(autoNextTimeoutRef.current);
      autoNextTimeoutRef.current = null;
    }
    setAutoAdvanceToast(null);
  }, [currentIndex]);

  // --- 1. OVERALL EXAM COUNTDOWN TIMER ---
  // Runs continuously every second without stopping or stuttering during typing or answer deletion
  useEffect(() => {
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      setTimeLeftSeconds(remaining);

      if (remaining <= 0) {
        if (overallTimerRef.current) {
          clearInterval(overallTimerRef.current);
          overallTimerRef.current = null;
        }
        handleFinalSubmit(true);
      }
    };

    updateCountdown();
    overallTimerRef.current = setInterval(updateCountdown, 1000);

    return () => {
      if (overallTimerRef.current) {
        clearInterval(overallTimerRef.current);
        overallTimerRef.current = null;
      }
    };
  }, [endTime, handleFinalSubmit]);

  // --- 2. PER-QUESTION COUNTDOWN TIMER ---
  // Decoupled from answers and keystrokes: continues uninterrupted while participant types or edits answers
  useEffect(() => {
    // Reset timer whenever currentIndex changes
    setQuestionTimeLeft(perQuestionDuration);

    const qTimer = setInterval(() => {
      setQuestionTimeLeft((prev) => {
        if (prev <= 1) {
          if (isPerQuestionTimed) {
            clearInterval(qTimer);
            // Auto advance or submit when per-question time expires in strict mode
            handleQuestionTimeExpiredRef.current();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(qTimer);
  }, [currentIndex, isPerQuestionTimed, perQuestionDuration]);

  // Synchronize timer updates with parent Navbar / App
  useEffect(() => {
    if (onTimerTick) {
      onTimerTick({
        timeLeftSeconds,
        questionTimeLeft,
        isPerQuestionTimed,
        questionNumber: currentIndex + 1,
        totalQuestions: questions.length,
      });
    }
  }, [timeLeftSeconds, questionTimeLeft, currentIndex, questions.length, isPerQuestionTimed, onTimerTick]);

  // --- 3. DEBOUNCED / BATCH SAVE ANSWER ENGINE (3.5s) ---
  const saveAnswersDebounced = useCallback((updatedAnswers: Record<string, ParticipantAnswer>, activeIndex?: number) => {
    setSyncStatus('saving');
    OfflineStorageManager.setLocalAnswers(sessionId, updatedAnswers);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const indexToFlush = activeIndex !== undefined ? activeIndex : currentIndexRef.current;
    debounceTimerRef.current = setTimeout(async () => {
      const success = await OfflineStorageManager.flushAnswersToServer(sessionId, indexToFlush + 1);
      setSyncStatus(success ? 'synced' : 'unsynced');
    }, 3500);
  }, [sessionId]);

  // Sync active question index whenever question selection changes
  useEffect(() => {
    OfflineStorageManager.flushAnswersToServer(sessionId, currentIndex + 1);
  }, [currentIndex, sessionId]);

  // --- 4. BROWSER UNLOAD / BEACON FLUSH ---
  useEffect(() => {
    const handleBeforeUnload = () => {
      OfflineStorageManager.sendUnloadBeacon(sessionId);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [sessionId]);

  // --- 4.5 FORCE-END REAL-TIME MONITORING CHECK ---
  // Detects if the proctor has force-ended the exam session from the admin panel
  useEffect(() => {
    let isMounted = true;
    const checkSessionStatus = async () => {
      if (isSubmitting) return;
      try {
        const res = await api.get(`/session/status/${sessionId}`);
        if (!isMounted) return;
        if (res.data?.isFinished || res.data?.status === 'COMPLETED' || res.data?.status === 'AUTO_SUBMITTED') {
          setIsSubmitting(true);
          const currentLocal = OfflineStorageManager.getLocalAnswers(sessionId);
          const combined = { ...answersRef.current, ...currentLocal };
          onSubmitExam(sessionId, combined);
        }
      } catch {
        // network silent ignore
      }
    };

    const interval = setInterval(checkSessionStatus, 4000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [sessionId, isSubmitting, onSubmitExam]);

  // --- 5. ANTI-CHEAT ENGINE INIT ---
  // Initialized once per session, decoupled from answers state to prevent listener churn during typing
  useEffect(() => {
    const handleViolation: ViolationHandler = (type, details, count, autoSubmitted) => {
      setViolationsCount(count);
      setLatestViolation({ type, details });
      setIsViolationModalOpen(true);

      if (autoSubmitted) {
        setTimeout(() => {
          onSubmitExam(sessionId, answersRef.current);
        }, 1500);
      }
    };

    const antiCheat = new AntiCheatEngine(sessionId, handleViolation);
    antiCheat.activate();

    return () => {
      antiCheat.deactivate();
    };
  }, [sessionId, onSubmitExam]);

  // Handlers for Option & Essay selection
  const handleSelectOption = (questionId: string, optionId: string) => {
    // If instant feedback mode is active and user already selected an answer, lock option selection to prevent cheat trial-and-error
    if (sessionPayload.exam.showInstantFeedback && answers[questionId]?.selectedOptionId) {
      return;
    }

    const current = answers[questionId] || {
      questionId,
      isFlagged: false,
      updatedAt: Date.now(),
    };

    const updated = {
      ...answers,
      [questionId]: {
        ...current,
        selectedOptionId: optionId,
        updatedAt: Date.now(),
      },
    };

    setAnswers(updated);
    saveAnswersDebounced(updated);

    // Auto next with visual feedback
    if (autoNextTimeoutRef.current) {
      clearTimeout(autoNextTimeoutRef.current);
      autoNextTimeoutRef.current = null;
    }

    if (currentIndex < questions.length - 1) {
      setAutoAdvanceToast('Jawaban Tersimpan! Berpindah ke soal berikutnya...');
      autoNextTimeoutRef.current = setTimeout(() => {
        setAutoAdvanceToast(null);
        setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1));
      }, 700);
    } else {
      // Last question reached
      setAutoAdvanceToast('Jawaban Terakhir Tersimpan! Soal selesai, sistem otomatis mengumpulkan ujian...');
      autoNextTimeoutRef.current = setTimeout(() => {
        setAutoAdvanceToast(null);
        handleFinalSubmit(true, updated);
      }, 800);
    }
  };

  const handleEssayChange = (questionId: string, text: string) => {
    const current = answers[questionId] || {
      questionId,
      isFlagged: false,
      updatedAt: Date.now(),
    };

    const updated = {
      ...answers,
      [questionId]: {
        ...current,
        essayAnswer: text,
        updatedAt: Date.now(),
      },
    };

    setAnswers(updated);
    saveAnswersDebounced(updated);
  };

  const handleShortAnswerChange = (questionId: string, text: string) => {
    const current = answers[questionId] || {
      questionId,
      isFlagged: false,
      updatedAt: Date.now(),
    };

    const updated = {
      ...answers,
      [questionId]: {
        ...current,
        shortAnswer: text,
        essayAnswer: text,
        updatedAt: Date.now(),
      },
    };

    setAnswers(updated);
    saveAnswersDebounced(updated);
  };

  const handleMultiShortAnswerChange = (questionId: string, blankNum: number, value: string) => {
    const current = answers[questionId] || {
      questionId,
      isFlagged: false,
      updatedAt: Date.now(),
    };

    const currentMulti = current.multiShortAnswers || {};
    const updatedMulti = {
      ...currentMulti,
      [blankNum]: value,
      [String(blankNum)]: value,
    };

    // Format readable summary string e.g. "(1) POST; (2) jumlah; (3) hitung"
    const summaryStr = Object.entries(updatedMulti)
      .filter(([k]) => !isNaN(Number(k))) // prevent duplicate entries when string and number keys coexist
      .sort(([a], [b]) => Number(a) - Number(b))
      .filter(([, v]) => String(v || '').trim().length > 0)
      .map(([k, v]) => `(${k}) ${String(v || '').trim()}`)
      .join('; ');

    const updated = {
      ...answers,
      [questionId]: {
        ...current,
        multiShortAnswers: updatedMulti,
        shortAnswer: summaryStr,
        essayAnswer: summaryStr,
        updatedAt: Date.now(),
      },
    };

    setAnswers(updated);
    saveAnswersDebounced(updated);
  };

  const handleClearAllMultiShortAnswers = (questionId: string) => {
    const current = answers[questionId] || {
      questionId,
      isFlagged: false,
      updatedAt: Date.now(),
    };

    const updated = {
      ...answers,
      [questionId]: {
        ...current,
        multiShortAnswers: {},
        shortAnswer: '',
        essayAnswer: '',
        updatedAt: Date.now(),
      },
    };

    setAnswers(updated);
    saveAnswersDebounced(updated);
  };

  const handleToggleFlag = (questionId: string) => {
    if (isStrictTimer) return; // Disallow flag in strict timed mode

    const current = answers[questionId] || {
      questionId,
      isFlagged: false,
      updatedAt: Date.now(),
    };

    const updated = {
      ...answers,
      [questionId]: {
        ...current,
        isFlagged: !current.isFlagged,
        updatedAt: Date.now(),
      },
    };

    setAnswers(updated);
    saveAnswersDebounced(updated);
  };

  // Format Timer HH:MM:SS or MM:SS
  const formatTime = (totalSecs: number) => {
    if (totalSecs < 0) totalSecs = 0;
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    if (h > 0) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Stats calculation
  const answerList = Object.values(answers) as ParticipantAnswer[];
  const answeredCount = answerList.filter(
    (a) =>
      a.selectedOptionId ||
      (a.shortAnswer && a.shortAnswer.trim() !== '') ||
      (a.essayAnswer && a.essayAnswer.trim() !== '') ||
      (a.multiShortAnswers && Object.values(a.multiShortAnswers).some((v) => (v || '').trim() !== ''))
  ).length;
  const flaggedCount = answerList.filter(a => a.isFlagged).length;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 dark:bg-zinc-950 p-2 sm:p-6 select-none font-sans text-slate-900 dark:text-zinc-100">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Geometric Balance Header */}
        <header className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-md shadow-emerald-200 dark:shadow-none">
              Q
            </div>
            <div>
              <h1 className="font-bold text-base sm:text-lg leading-tight text-slate-900 dark:text-zinc-100">{exam.title}</h1>
              <p className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">
                {exam.subject} • Peserta: <span className="text-slate-700 dark:text-zinc-300 font-bold">{participant.name} ({participant.participantCode})</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Fullscreen Status Badge & Recovery Button */}
            {isFullscreen ? (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <Maximize className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                Layar Penuh
              </span>
            ) : (
              <button
                onClick={handleReturnToFullscreen}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-xs animate-bounce cursor-pointer"
                title="Klik untuk mengaktifkan kembali mode layar penuh"
              >
                <Maximize className="w-3.5 h-3.5" />
                Aktifkan Layar Penuh
              </button>
            )}

            {/* Sync Status Badge */}
            <div className="hidden md:flex items-center text-xs font-medium">
              {syncStatus === 'synced' && (
                <Badge variant="emerald" size="sm">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Tersinkron di Server</span>
                </Badge>
              )}
              {syncStatus === 'saving' && (
                <Badge variant="amber" size="sm">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-500" />
                  <span>Auto-Syncing...</span>
                </Badge>
              )}
              {syncStatus === 'unsynced' && (
                <Badge variant="rose" size="sm">
                  <CloudUpload className="w-3.5 h-3.5 text-rose-500" />
                  <span>Lokal (Offline)</span>
                </Badge>
              )}
            </div>

            {/* Dual Timers: Waktu Per Soal & Waktu Kesemua (Sesi Ujian) */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* 1. Timer Per Soal */}
              <div
                className={`px-3 py-1.5 rounded-xl border flex flex-col items-center min-w-[90px] sm:min-w-[105px] ${
                  questionTimeLeft <= 10 && isPerQuestionTimed
                    ? 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800 animate-pulse'
                    : questionTimeLeft <= 15
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'
                    : 'bg-zinc-900 text-amber-400 border-zinc-800'
                }`}
                title={`Sisa waktu pengerjaan untuk soal #${currentIndex + 1}`}
              >
                <span className="text-[9px] uppercase font-bold tracking-wider flex items-center gap-1 opacity-90">
                  <Timer className={`w-3 h-3 ${questionTimeLeft <= 10 && isPerQuestionTimed ? 'animate-spin' : ''}`} />
                  <span>Waktu Soal #{currentIndex + 1}</span>
                </span>
                <span className="font-mono font-bold text-xs sm:text-sm tabular-nums">
                  {formatTime(questionTimeLeft)}
                </span>
              </div>

              {/* 2. Timer Kesemua / Sesi Ujian */}
              <div
                className={`px-3 py-1.5 rounded-xl border font-mono flex flex-col items-center min-w-[95px] sm:min-w-[110px] ${
                  timeLeftSeconds < 300
                    ? 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800 animate-pulse'
                    : 'bg-zinc-900 text-emerald-400 border-zinc-800'
                }`}
                title="Sisa total waktu sesi ujian"
              >
                <span className="text-[9px] uppercase tracking-wider text-slate-400 font-medium flex items-center gap-1">
                  <Clock className="w-3 h-3 text-emerald-400" />
                  <span>Sisa Sesi Ujian</span>
                </span>
                <span className="tabular-nums font-mono text-xs sm:text-sm font-bold">{formatTime(timeLeftSeconds)}</span>
              </div>
            </div>

            <Button variant="danger" size="sm" onClick={() => setIsSubmitModalOpen(true)}>
              <Send className="w-3.5 h-3.5" />
              Selesai Ujian
            </Button>
          </div>
        </header>

        {/* NOTIFIKASI AKTIFKAN FULLSCREEN JIKA KELUAR ATAU TIDAK AKTIF */}
        {!isFullscreen && (
          <div className="bg-amber-500 text-white px-4 py-3 rounded-2xl text-xs font-semibold flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md animate-in slide-in-from-top duration-150">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 shrink-0 text-white animate-pulse" />
              <div>
                <span className="font-bold text-sm block sm:inline">Peringatan: Mode Layar Penuh Tidak Aktif!</span>
                <span className="sm:ml-1 text-[11px] opacity-95">
                  Anda wajib mengaktifkan mode Layar Penuh selama ujian berlangsung. Aktivitas di luar layar penuh dicatat sebagai pelanggaran anti-kecurangan.
                </span>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleReturnToFullscreen}
              className="bg-white text-amber-900 border-none hover:bg-amber-100 font-bold shrink-0 shadow-xs cursor-pointer self-start sm:self-auto flex items-center gap-1.5"
            >
              <Maximize className="w-3.5 h-3.5" />
              Kembali ke Layar Penuh
            </Button>
          </div>
        )}

        {/* Main Interface Layout */}
        <main className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
          {/* Left / Middle Panel: Active Question View (3 Columns) */}
          <section className="lg:col-span-3 space-y-4">
            <Card className="border-slate-200 dark:border-zinc-800 shadow-sm p-6">
              {/* Question Header Banner */}
              <div className="flex items-center gap-4 mb-6 pb-4 border-b border-slate-100 dark:border-zinc-800">
                <span className="text-4xl sm:text-5xl font-black text-slate-300 dark:text-zinc-700 font-mono">
                  {String(currentIndex + 1).padStart(2, '0')}.
                </span>
                <div className="h-px flex-grow bg-slate-200 dark:bg-zinc-800"></div>

                {isPerQuestionTimed ? (
                  <Badge variant="amber" size="sm">
                    <Lock className="w-3.5 h-3.5 text-amber-500" />
                    <span>Mode Berwaktu Per-Soal ({questionTimeLeft}s)</span>
                  </Badge>
                ) : (
                  <label className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-3.5 py-1.5 rounded-full border border-amber-200 dark:border-amber-800/80 cursor-pointer hover:bg-amber-100/80">
                    <input
                      type="checkbox"
                      checked={!!answers[currentQuestion.id]?.isFlagged}
                      onChange={() => handleToggleFlag(currentQuestion.id)}
                      className="rounded border-amber-400 text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                    />
                    <Flag className="w-3.5 h-3.5 fill-current" />
                    RAGU-RAGU
                  </label>
                )}
              </div>

              {/* Question Text with Code Formatting */}
              <div className="mb-6">
                <div className="text-base sm:text-lg font-medium text-slate-800 dark:text-zinc-100 leading-relaxed">
                  <FormattedText text={currentQuestion.questionText} />
                </div>
              </div>

              {/* Question Image Attachment (if present) */}
              {currentQuestion.imageUrl && (
                <div className="mb-6 p-2.5 rounded-2xl bg-slate-50 dark:bg-zinc-950/80 border border-slate-200 dark:border-zinc-800/80 flex flex-col items-center">
                  <img
                    src={currentQuestion.imageUrl}
                    alt={`Ilustrasi Soal #${currentIndex + 1}`}
                    className="max-h-80 sm:max-h-96 w-auto max-w-full rounded-xl object-contain shadow-xs"
                  />
                </div>
              )}

              {/* Option Choice Inputs / Short Answer / Essay */}
              {currentQuestion.type === 'MULTIPLE_CHOICE' || currentQuestion.type === 'TRUE_FALSE' ? (
                <div className="space-y-3">
                  {currentQuestion.options.map((opt, optIndex) => {
                    const isSelected = answers[currentQuestion.id]?.selectedOptionId === opt.id;
                    const optionLabel = String.fromCharCode(65 + optIndex); // A, B, C, D
                    const showFeedback = sessionPayload.exam.showInstantFeedback && !!answers[currentQuestion.id]?.selectedOptionId;
                    const isCorrect = currentQuestion.correctOptionId === opt.id;
                    const isAnswerLocked = sessionPayload.exam.showInstantFeedback && !!answers[currentQuestion.id]?.selectedOptionId;

                    let borderBgClass = isSelected
                      ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40 text-slate-900 dark:text-emerald-100 font-semibold ring-1 ring-emerald-500/20'
                      : 'border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-emerald-400/50 dark:hover:border-zinc-700 text-slate-700 dark:text-zinc-300';

                    if (showFeedback) {
                      if (isCorrect) {
                        borderBgClass = 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/50 text-emerald-950 dark:text-emerald-100 font-semibold ring-2 ring-emerald-400';
                      } else if (isSelected) {
                        borderBgClass = 'border-rose-500 bg-rose-50/80 dark:bg-rose-950/50 text-rose-950 dark:text-rose-100 font-semibold';
                      }
                    }

                    return (
                      <label
                        key={opt.id}
                        onClick={() => handleSelectOption(currentQuestion.id, opt.id)}
                        className={`flex items-start p-4 rounded-xl border-2 transition-all shadow-xs group relative ${
                          isAnswerLocked ? 'cursor-not-allowed opacity-90' : 'cursor-pointer'
                        } ${borderBgClass}`}
                      >
                        <div
                          className={`w-8 h-8 rounded-full border-2 flex items-center justify-center mr-4 font-bold text-xs shrink-0 transition-colors ${
                            showFeedback && isCorrect
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : showFeedback && isSelected && !isCorrect
                              ? 'border-rose-600 bg-rose-600 text-white'
                              : isSelected
                              ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                              : 'border-slate-300 dark:border-zinc-700 text-slate-500 group-hover:border-emerald-500'
                          }`}
                        >
                          {optionLabel}
                        </div>
                        <div className="text-sm pt-1 leading-relaxed flex-1">
                          <FormattedText text={opt.optionText} />

                          {opt.imageUrl && (
                            <div className="mt-2">
                              <img
                                src={opt.imageUrl}
                                alt={`Gambar Opsi ${optionLabel}`}
                                className="max-h-36 w-auto rounded-lg border border-slate-200 dark:border-zinc-700 object-contain bg-white dark:bg-zinc-950 p-1"
                              />
                            </div>
                          )}

                          {showFeedback && isCorrect && (
                            <div className="mt-1 text-xs text-emerald-700 dark:text-emerald-300 font-bold flex items-center gap-1">
                              <span>✓ Jawaban Benar! (+{currentQuestion.points} Poin) - Terkunci</span>
                            </div>
                          )}
                          {showFeedback && isSelected && !isCorrect && (
                            <div className="mt-1 text-xs text-rose-700 dark:text-rose-300 font-bold flex items-center gap-1">
                              <span>✗ Jawaban Salah - Terkunci</span>
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : currentQuestion.type === 'SHORT_ANSWER_MULTI' ? (
                (() => {
                  const blanksList: number[] = (() => {
                    if (Array.isArray(currentQuestion.blanksList) && currentQuestion.blanksList.length > 0) {
                      return currentQuestion.blanksList;
                    }
                    const keys = currentQuestion.answerKey || currentQuestion.shortAnswerMultiKey;
                    if (Array.isArray(keys) && keys.length > 0) {
                      return keys.map((k) => k.blank).sort((a, b) => a - b);
                    }
                    const set = new Set<number>();
                    const r = /_{2,}\s*\(?\s*(\d+)\s*\)?\s*_{2,}/g;
                    let m: RegExpExecArray | null;
                    while ((m = r.exec(currentQuestion.questionText)) !== null) {
                      const n = parseInt(m[1], 10);
                      if (!isNaN(n)) set.add(n);
                    }
                    return set.size > 0 ? Array.from(set).sort((a, b) => a - b) : [1, 2, 3, 4, 5];
                  })();

                  const currentMultiAnswers = answers[currentQuestion.id]?.multiShortAnswers || {};
                  const filledCount = blanksList.filter((b) => (currentMultiAnswers[b] ?? currentMultiAnswers[String(b)] ?? '').trim() !== '').length;

                  return (
                    <div className="space-y-4">
                      {/* Header bar for Multi-Blank */}
                      <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200">
                        <div className="flex items-center gap-2">
                          <Code2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                          <span className="font-bold text-xs sm:text-sm">
                            Lengkapi Isian Kode ({blanksList.length} Bagian Blank)
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-amber-200/60 dark:bg-amber-900/50 text-amber-900 dark:text-amber-100 border border-amber-300 dark:border-amber-700">
                            {filledCount} / {blanksList.length} Terisi • {currentQuestion.points} Poin
                          </span>
                          {filledCount > 0 && (
                            <button
                              type="button"
                              onClick={() => handleClearAllMultiShortAnswers(currentQuestion.id)}
                              className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline font-semibold cursor-pointer"
                            >
                              Bersihkan Semua
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Responsive Grid of Blank Inputs */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {blanksList.map((blankNum) => {
                          const val = currentMultiAnswers[blankNum] ?? currentMultiAnswers[String(blankNum)] ?? '';
                          const isFilled = val.trim().length > 0;

                          return (
                            <div
                              key={blankNum}
                              className={`p-3.5 rounded-xl border-2 transition-all shadow-2xs ${
                                isFilled
                                  ? 'border-emerald-500/60 bg-emerald-50/40 dark:bg-emerald-950/20'
                                  : 'border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus-within:border-amber-500'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <label className="text-xs font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
                                  <span className="w-5 h-5 rounded-full bg-amber-500 text-white font-mono font-black text-[11px] flex items-center justify-center">
                                    {blankNum}
                                  </span>
                                  <span>Bagian ({blankNum})</span>
                                </label>
                                {isFilled ? (
                                  <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Terisi
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-slate-400 dark:text-zinc-500">
                                    Belum diisi
                                  </span>
                                )}
                              </div>

                              <div className="relative">
                                <input
                                  type="text"
                                  value={val}
                                  onChange={(e) => handleMultiShortAnswerChange(currentQuestion.id, blankNum, e.target.value)}
                                  placeholder={`Jawaban bagian (${blankNum})...`}
                                  className="w-full p-2.5 pl-3 pr-16 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-slate-900 dark:text-zinc-100 text-xs sm:text-sm font-mono focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-hidden transition-all"
                                  autoComplete="off"
                                  autoCorrect="off"
                                  autoCapitalize="off"
                                  spellCheck="false"
                                />
                                {isFilled && (
                                  <button
                                    type="button"
                                    onClick={() => handleMultiShortAnswerChange(currentQuestion.id, blankNum, '')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500 text-[10px] px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                                    title="Hapus isian ini"
                                  >
                                    Hapus
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Explanatory Footer */}
                      <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 dark:text-zinc-400 pt-1 gap-2">
                        <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium text-[11px]">
                          <Sparkles className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Nilai dihitung proporsional per-blank yang dijawab benar. Huruf besar/kecil & spasi operator ditoleransi secara otomatis.
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : currentQuestion.type === 'SHORT_ANSWER' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 flex items-center gap-1.5">
                      <Code2 className="w-4 h-4 text-emerald-600" />
                      <span>Jawaban Isian Singkat / Lengkapi Potongan Kode:</span>
                    </label>
                    <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800">
                      Isian Singkat • {currentQuestion.points} Poin
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      value={answers[currentQuestion.id]?.shortAnswer ?? answers[currentQuestion.id]?.essayAnswer ?? ''}
                      onChange={(e) => handleShortAnswerChange(currentQuestion.id, e.target.value)}
                      placeholder="Ketik kata, fungsi, atau baris kode jawaban Anda di sini..."
                      className="w-full p-4 pl-4 pr-20 rounded-xl border-2 border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm sm:text-base font-mono focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 shadow-xs transition-all leading-relaxed"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck="false"
                    />
                    {(answers[currentQuestion.id]?.shortAnswer || answers[currentQuestion.id]?.essayAnswer) && (
                      <button
                        type="button"
                        onClick={() => handleShortAnswerChange(currentQuestion.id, '')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 text-xs px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors font-medium"
                        title="Hapus isian"
                      >
                        Bersihkan
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 dark:text-zinc-400 pt-1 gap-2">
                    <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">
                      <Sparkles className="w-3.5 h-3.5 shrink-0" />
                      <span>Koreksi instan otomatis: Sistem mencocokkan isian Anda dengan kunci jawaban saat dikumpulkan.</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-600 dark:text-zinc-400">
                    Tuliskan Jawaban Uraian / Essay Anda:
                  </label>
                  <textarea
                    rows={6}
                    value={answers[currentQuestion.id]?.essayAnswer || ''}
                    onChange={(e) => handleEssayChange(currentQuestion.id, e.target.value)}
                    placeholder="Ketik jawaban lengkap atau kueri/kode di sini..."
                    className="w-full p-4 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-emerald-500 font-mono leading-relaxed"
                  />
                  <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 dark:text-zinc-400 pt-1 gap-2">
                    <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Koreksi otomatis latar belakang: Jawaban esai dinilai langsung saat Anda beralih ke soal berikutnya</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">
                      {(answers[currentQuestion.id]?.essayAnswer || '').trim().split(/\s+/).filter(Boolean).length} kata
                    </span>
                  </div>
                </div>
              )}

              {/* Feedback Banner for Auto-Next / Answer Saved */}
              {autoAdvanceToast && (
                <div className="mt-4 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold flex items-center justify-between shadow-xs animate-fade-in">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 animate-pulse" />
                    <span>{autoAdvanceToast}</span>
                  </div>
                  {currentIndex < questions.length - 1 && (
                    <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300 font-mono">
                      <span>Mengalihkan...</span>
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin" />
                    </div>
                  )}
                </div>
              )}

              {/* Navigation Controls */}
              <div className="mt-10 pt-4 border-t border-slate-100 dark:border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (autoNextTimeoutRef.current) clearTimeout(autoNextTimeoutRef.current);
                    setAutoAdvanceToast(null);
                    !isStrictTimer && setCurrentIndex((prev) => Math.max(0, prev - 1));
                  }}
                  disabled={currentIndex === 0 || isStrictTimer || isSubmitting}
                  className={isStrictTimer ? 'opacity-40 cursor-not-allowed' : ''}
                >
                  {isStrictTimer ? <Lock className="w-3.5 h-3.5 text-amber-500 mr-1" /> : <ChevronLeft className="w-4 h-4" />}
                  {isStrictTimer ? 'Sebelumnya (Terkunci)' : 'Sebelumnya'}
                </Button>

                <div className="text-xs text-slate-500 font-medium flex flex-col items-center gap-1 text-center">
                  {isStrictTimer ? (
                    <>
                      <span className="text-amber-600 dark:text-amber-400 font-semibold flex items-center justify-center gap-1">
                        <Timer className="w-3.5 h-3.5" />
                        Soal {currentIndex + 1} dari {questions.length} (Strict Timer Aktif)
                      </span>
                      <p className="text-[10px] text-slate-500 dark:text-zinc-400 font-medium">
                        {currentQuestion.type === 'ESSAY' || currentQuestion.type === 'SHORT_ANSWER' || currentQuestion.type === 'SHORT_ANSWER_MULTI'
                          ? 'Ketik isian/jawaban lalu klik tombol Simpan & Lanjut di sebelah kanan.'
                          : 'Pilih opsi jawaban untuk langsung berpindah ke soal berikutnya.'}
                      </p>
                    </>
                  ) : (
                    <span>Soal {currentIndex + 1} dari {questions.length}</span>
                  )}
                </div>

                {(() => {
                  const isLastQuestion = currentIndex === questions.length - 1;

                  if (isLastQuestion) {
                    return (
                      <Button
                        variant="primary"
                        onClick={() => {
                          if (autoNextTimeoutRef.current) clearTimeout(autoNextTimeoutRef.current);
                          setAutoAdvanceToast(null);
                          handleFinalSubmit(false);
                        }}
                        disabled={isSubmitting}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-900/10 font-bold"
                      >
                        {isSubmitting ? (
                          <>
                            <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                            Menyelesaikan...
                          </>
                        ) : (
                          <>
                            Selesai & Kumpulkan Ujian
                            <CheckCircle2 className="w-4 h-4 ml-1" />
                          </>
                        )}
                      </Button>
                    );
                  }

                  // Not last question
                  if (currentQuestion.type === 'ESSAY' || currentQuestion.type === 'SHORT_ANSWER' || currentQuestion.type === 'SHORT_ANSWER_MULTI') {
                    return (
                      <Button
                        variant="primary"
                        onClick={() => {
                          if (autoNextTimeoutRef.current) clearTimeout(autoNextTimeoutRef.current);
                          setAutoAdvanceToast(null);

                          // Instantly flush current answers including short answer / multi / essay to server
                          OfflineStorageManager.setLocalAnswers(sessionId, answers);
                          OfflineStorageManager.flushAnswersToServer(sessionId, currentIndex + 2);

                          setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1));
                        }}
                        disabled={isSubmitting}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-900/10"
                      >
                        Simpan & Soal Selanjutnya
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    );
                  }

                  if (isStrictTimer) {
                    return (
                      <Button
                        variant="secondary"
                        disabled={true}
                        className="opacity-60 cursor-not-allowed text-xs"
                      >
                        <Lock className="w-3.5 h-3.5 mr-1 text-amber-500" />
                        Pilih Jawaban di Atas
                      </Button>
                    );
                  }

                  return (
                    <Button
                      variant="primary"
                      onClick={() => {
                        if (autoNextTimeoutRef.current) clearTimeout(autoNextTimeoutRef.current);
                        setAutoAdvanceToast(null);
                        setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1));
                      }}
                      disabled={isSubmitting}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-900/10"
                    >
                      Selanjutnya
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  );
                })()}
              </div>
            </Card>
          </section>

          {/* Right Sidebar: Question Map & Integrity Panel (1 Column) */}
          <aside className="space-y-4">
            {/* Question Map */}
            <Card title="Peta Soal" subtitle={`Terjawab: ${answeredCount} / ${questions.length}`}>
              {isStrictTimer && (
                <div className="p-2.5 mb-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300 font-medium flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Strict Timer: Navigasi manual & lompat soal dinonaktifkan.</span>
                </div>
              )}

              <div className="grid grid-cols-5 gap-2 mb-4">
                {questions.map((q, idx) => {
                  const ans = answers[q.id];
                  const isAnswered = ans && (
                    ans.selectedOptionId ||
                    (ans.shortAnswer && ans.shortAnswer.trim() !== '') ||
                    (ans.essayAnswer && ans.essayAnswer.trim() !== '') ||
                    (ans.multiShortAnswers && Object.values(ans.multiShortAnswers).some(v => String(v || '').trim() !== ''))
                  );
                  const isFlagged = ans?.isFlagged;
                  const isCurrent = idx === currentIndex;

                  let boxClass = 'bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400 border-slate-200 dark:border-zinc-700';

                  if (isFlagged) {
                    boxClass = 'bg-amber-400 text-slate-900 font-bold border-amber-500';
                  } else if (isAnswered) {
                    boxClass = 'bg-emerald-600 text-white font-bold border-emerald-700';
                  }

                  if (isCurrent) {
                    boxClass += ' border-2 border-slate-900 dark:border-emerald-400 ring-2 ring-emerald-400/30';
                  }

                  return (
                    <button
                      key={q.id}
                      onClick={() => {
                        if (!isStrictTimer) {
                          OfflineStorageManager.setLocalAnswers(sessionId, answers);
                          OfflineStorageManager.flushAnswersToServer(sessionId, idx + 1);
                          setCurrentIndex(idx);
                        }
                      }}
                      disabled={isStrictTimer}
                      className={`h-10 rounded font-bold text-xs flex items-center justify-center transition-all ${boxClass} ${
                        isStrictTimer ? 'cursor-not-allowed opacity-75' : 'cursor-pointer hover:scale-105'
                      }`}
                    >
                      {String(idx + 1).padStart(2, '0')}
                    </button>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="pt-3 border-t border-slate-100 dark:border-zinc-800 space-y-2 text-xs text-slate-600 dark:text-zinc-400">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-emerald-600 rounded-sm"></div> Terjawab
                </div>
                {!isStrictTimer && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-amber-400 rounded-sm"></div> Ragu-Ragu ({flaggedCount})
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-slate-100 dark:bg-zinc-800 border rounded-sm"></div> Belum Diisi
                </div>
              </div>
            </Card>

            {/* Integrity Monitor Sidebar Panel */}
            <Card title="Pengawasan & Integritas">
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Wifi className="w-3.5 h-3.5 text-emerald-500" /> KONEKSI
                  </span>
                  <span className="font-bold text-emerald-600">SECURE • 14ms</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500">FULLSCREEN</span>
                  <span className="font-bold text-emerald-500">AKTIF</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500">FOCUS TRACKING</span>
                  <span className="font-bold text-emerald-500">SECURE</span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-zinc-800">
                  <span className="text-slate-500">PELANGGARAN</span>
                  <span className={`font-bold ${violationsCount > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                    {violationsCount} / {exam.maxViolations} MAX
                  </span>
                </div>
              </div>
            </Card>
          </aside>
        </main>
      </div>

      {/* Full-screen Fast Submitting Overlay */}
      {isSubmitting && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex flex-col items-center justify-center p-4 text-center select-none animate-fade-in">
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-8 max-w-md w-full shadow-2xl space-y-4 flex flex-col items-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-500">
              <RefreshCw className="w-7 h-7 animate-spin" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-zinc-100">
                Menyelesaikan & Menghitung Skor Ujian
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
                Koreksi otomatis dan kalkulasi nilai sedang diproses. Hasil akan langsung ditampilkan...
              </p>
            </div>
            <div className="w-full bg-slate-100 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 animate-pulse w-3/4 rounded-full"></div>
            </div>
          </div>
        </div>
      )}

      {/* Final Submit Confirmation Modal */}
      <Modal
        isOpen={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        title="Konfirmasi Selesai Ujian"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsSubmitModalOpen(false)}>
              Batal
            </Button>
            <Button variant="danger" onClick={() => handleFinalSubmit(false)} isLoading={isSubmitting}>
              Selesai & Kirim Ujian
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600 dark:text-zinc-300">
          <p>Apakah Anda yakin ingin menyelesaikan ujian ini?</p>
          <div className="p-3 bg-slate-50 dark:bg-zinc-800/80 rounded-xl space-y-1 text-xs">
            <div>Total Soal: <strong>{questions.length}</strong></div>
            <div>Jawaban Terisi: <strong className="text-emerald-600">{answeredCount}</strong></div>
            <div>Ragu-ragu: <strong className="text-amber-600">{flaggedCount}</strong></div>
            <div>Belum Diisi: <strong className="text-rose-600">{questions.length - answeredCount}</strong></div>
          </div>
          {questions.length - answeredCount > 0 && (
            <p className="text-xs text-rose-600 font-medium flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" /> Masih ada {questions.length - answeredCount} soal yang belum Anda jawab.
            </p>
          )}
        </div>
      </Modal>

      {/* Blocker screen when participant is outside fullscreen or split screen */}
      {!isFullscreen && !isViolationModalOpen && !isSubmitting && (
        <div className="fixed inset-0 z-50 bg-zinc-950/95 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-amber-300 dark:border-amber-700/80 rounded-2xl p-6 max-w-md w-full text-center space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="w-16 h-16 rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400 flex items-center justify-center mx-auto shadow-inner">
              <Maximize className="w-8 h-8 animate-pulse" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-zinc-100">
                {AntiCheatEngine.isSplitScreenDetected()
                  ? 'Pembagian Layar (Split-Screen) Terdeteksi!'
                  : 'Mode Layar Penuh Terlepas!'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
                {AntiCheatEngine.isSplitScreenDetected()
                  ? 'Dilarang membagi layar menjadi 2 jendela kanan-kiri. Ujian wajib dikerjakan dalam mode 1 Layar Penuh (Fullscreen).'
                  : 'Untuk mencegah kecurangan dan menjaga integritas ujian, pengerjaan soal dijeda sementara sampai Anda kembali ke mode Layar Penuh (Fullscreen).'}
              </p>
            </div>
            <div className="space-y-2">
              <Button
                variant="warning"
                size="lg"
                onClick={handleReturnToFullscreen}
                className="w-full py-3 text-sm font-bold shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Maximize className="w-4 h-4" />
                Kembali ke Layar Penuh Sekarang
              </Button>
              {/* Only allow Focus Mode fallback if NOT on desktop split screen and mobile/iframe */}
              {(AntiCheatEngine.isMobileDevice() || AntiCheatEngine.isInsideIframe()) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleContinueWithFocusMode}
                  className="w-full py-2.5 text-xs font-semibold text-slate-700 dark:text-zinc-200 border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  Lanjutkan dengan Mode Fokus (Layar Sentuh / Iframe)
                </Button>
              )}
            </div>
            <p className="text-[11px] text-slate-400 dark:text-zinc-500">
              Pengguna desktop/laptop juga dapat menekan tombol <strong>F11</strong> pada keyboard untuk layar penuh instan.
            </p>
          </div>
        </div>
      )}

      {/* Anti-Cheat Violation Modal Overlay */}
      <AntiCheatOverlay
        isOpen={isViolationModalOpen}
        onClose={() => setIsViolationModalOpen(false)}
        violation={latestViolation}
        violationsCount={violationsCount}
        maxViolations={exam.maxViolations}
        onFullscreenRestored={() => setIsFullscreen(AntiCheatEngine.isFullscreenActive())}
      />
    </div>
  );
};
