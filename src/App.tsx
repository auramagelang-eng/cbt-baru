import React, { useState, useEffect, useRef } from 'react';
import { User, Exam, ExamSessionPayload, ExamResult, ParticipantAnswer } from './types/cbt';
import { Navbar, ExamTimersInfo } from './components/Navbar';
import { TokenLoginForm } from './components/exam/TokenLoginForm';
import { PreExamInstruction } from './components/exam/PreExamInstruction';
import { ExamEngine } from './components/exam/ExamEngine';
import { ExamManager } from './components/admin/ExamManager';
import { ParticipantManager } from './components/admin/ParticipantManager';
import { LiveMonitor } from './components/admin/LiveMonitor';
import { ResultsAnalytics } from './components/admin/ResultsAnalytics';
import { CloudMetricsPanel } from './components/admin/CloudMetricsPanel';
import { DatabaseBackupModal } from './components/admin/DatabaseBackupModal';
import { CloudflareManager } from './components/admin/CloudflareManager';
import { Modal } from './components/ui/Modal';
import { Button } from './components/ui/Button';
import { Card } from './components/ui/Card';
import { Badge } from './components/ui/Badge';
import { api } from './services/api';
import { OfflineStorageManager } from './services/offlineStorage';
import { AntiCheatEngine } from './services/antiCheat';
import { BookOpen, Users, Activity, Award, CloudLightning, ShieldCheck, CheckCircle2, RotateCcw, Key, Database, Cloud, Trash2, AlertTriangle } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem('cbt_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [activeExam, setActiveExam] = useState<Exam | null>(() => {
    try {
      const saved = localStorage.getItem('cbt_active_exam');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [sessionPayload, setSessionPayload] = useState<ExamSessionPayload | null>(null);
  const [examResult, setExamResult] = useState<ExamResult | null>(null);

  const [examStep, setExamStep] = useState<'LOGIN' | 'INSTRUCTIONS' | 'TEST' | 'COMPLETED'>('LOGIN');
  const [adminTab, setAdminTab] = useState<'EXAMS' | 'PARTICIPANTS' | 'LIVE' | 'RESULTS' | 'METRICS' | 'CLOUDFLARE'>('EXAMS');
  const [cfConnected, setCfConnected] = useState<boolean>(false);
  const [activeExamTimers, setActiveExamTimers] = useState<ExamTimersInfo | null>(null);

  // Admin login dialog state
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminLoginError, setAdminLoginError] = useState('');
  const [isMetricsModalOpen, setIsMetricsModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);

  // Total Reset / Wipe All Data modal state
  const [isWipeModalOpen, setIsWipeModalOpen] = useState(false);
  const [isWiping, setIsWiping] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState('');
  const [wipeSuccessMsg, setWipeSuccessMsg] = useState<string | null>(null);

  const [isStartingSession, setIsStartingSession] = useState(false);

  const handleWipeAllData = async () => {
    if (wipeConfirmText.trim() !== 'HAPUS') {
      alert('Ketik HAPUS terlebih dahulu untuk mengonfirmasi reset data.');
      return;
    }
    setIsWiping(true);
    try {
      const res = await api.post('/database/wipe-all');
      OfflineStorageManager.clearAllOfflineCaches();
      setWipeSuccessMsg(res.data?.message || 'Seluruh data berhasil dihapus bersih dari Cloudflare D1 & Server.');
      setTimeout(() => {
        setIsWipeModalOpen(false);
        setWipeSuccessMsg(null);
        setWipeConfirmText('');
        window.location.reload();
      }, 1200);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Gagal menghapus total data');
    } finally {
      setIsWiping(false);
    }
  };

  const handleRestoreSafetyBackup = async () => {
    setIsWiping(true);
    try {
      const res = await api.post('/database/restore-backup');
      alert(res.data?.message || 'Data berhasil dipulihkan dari cadangan keselamatan!');
      setIsWipeModalOpen(false);
      window.location.reload();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Tidak ada file cadangan yang ditemukan');
    } finally {
      setIsWiping(false);
    }
  };

  // Check Cloudflare status on admin load (Server & Cloudflare are sole authority, no browser override)
  useEffect(() => {
    if (user?.role === 'ADMIN') {
      api.get('/cloudflare/status')
        .then((res) => {
          if (res.data?.data?.connected) {
            setCfConnected(true);
          }
        })
        .catch(() => {});
    }
  }, [user]);

  // Restore session state on page refresh for participants
  useEffect(() => {
    if (user?.role === 'ADMIN') {
      setExamStep('LOGIN');
      return;
    }

    if (user?.role === 'PARTICIPANT' && activeExam) {
      resumeExamOnRefresh(activeExam);
    }
  }, []);

  const resumeExamOnRefresh = async (examToResume: Exam) => {
    setIsStartingSession(true);
    try {
      let devId = localStorage.getItem('cbt_device_id');
      if (!devId) {
        devId = 'dev_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
        localStorage.setItem('cbt_device_id', devId);
      }

      const res = await api.post('/session/start', {
        examId: examToResume.id,
        deviceId: devId,
      });

      const payload = res.data.data;

      // Merge local storage answers into session payload
      const localAnswers = OfflineStorageManager.getLocalAnswers(payload.sessionId);
      if (localAnswers && Object.keys(localAnswers).length > 0) {
        payload.answers = { ...(payload.answers || {}), ...localAnswers };
      }

      setSessionPayload(payload);

      if (payload.status === 'COMPLETED' || payload.status === 'AUTO_SUBMITTED') {
        const maxScore = payload.maxScore || 100;
        const score = payload.score || 0;
        const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

        setExamResult({
          sessionId: payload.sessionId,
          participantId: user!.id,
          participantName: user!.name,
          participantCode: user!.participantCode || user!.id,
          examTitle: examToResume.title,
          score,
          maxScore,
          percentage,
          isPassed: percentage >= (examToResume.passPercentage || 70),
          submittedAt: new Date().toISOString(),
          violationsCount: payload.violationsCount || 0,
          status: payload.status,
        });
        setExamStep('COMPLETED');
      } else {
        setExamStep('TEST');
      }
    } catch (err) {
      console.log('Sesi ujian tidak dapat dipulihkan secara otomatis (mungkin telah di-reset oleh pengawas):', err);
      // Clean up local storage if session was reset
      localStorage.removeItem('cbt_active_exam');
      setActiveExam(null);
      setExamStep('LOGIN');
    } finally {
      setIsStartingSession(false);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminLoginError('');
    try {
      const res = await api.post('/auth/admin-login', {
        username: adminUsername,
        password: adminPassword,
      });

      const { user: adminUser, token } = res.data;
      localStorage.setItem('cbt_auth_token', token);
      localStorage.setItem('cbt_user', JSON.stringify(adminUser));

      setUser(adminUser);
      setIsAdminModalOpen(false);
    } catch (err: any) {
      setAdminLoginError(err.response?.data?.error || 'Username atau Password Admin salah.');
    }
  };

  const handleParticipantVerified = (verifiedUser: User, verifiedExam: Exam) => {
    // Isolate participant answers: clear any lingering answers from previous user on this device
    OfflineStorageManager.clearAllOfflineCaches();
    localStorage.setItem('cbt_user', JSON.stringify(verifiedUser));
    localStorage.setItem('cbt_active_exam', JSON.stringify(verifiedExam));
    setUser(verifiedUser);
    setActiveExam(verifiedExam);
    setSessionPayload(null);
    setExamResult(null);
    setExamStep('INSTRUCTIONS');
  };

  const handleStartExamSession = async () => {
    if (!user || !activeExam) return;
    setIsStartingSession(true);

    try {
      await AntiCheatEngine.requestFullscreen();
    } catch {
      // ignore
    }

    try {
      let devId = localStorage.getItem('cbt_device_id');
      if (!devId) {
        devId = 'dev_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
        localStorage.setItem('cbt_device_id', devId);
      }

      const res = await api.post('/session/start', {
        examId: activeExam.id,
        deviceId: devId,
      });

      const payload = res.data.data;

      // Merge local storage answers into session payload
      const localAnswers = OfflineStorageManager.getLocalAnswers(payload.sessionId);
      if (localAnswers && Object.keys(localAnswers).length > 0) {
        payload.answers = { ...(payload.answers || {}), ...localAnswers };
      }

      setSessionPayload(payload);

      if (payload.status === 'COMPLETED' || payload.status === 'AUTO_SUBMITTED') {
        const maxScore = payload.maxScore || 100;
        const score = payload.score || 0;
        const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

        setExamResult({
          sessionId: payload.sessionId,
          participantId: user.id,
          participantName: user.name,
          participantCode: user.participantCode || user.id,
          examTitle: activeExam.title,
          score,
          maxScore,
          percentage,
          isPassed: percentage >= (activeExam.passPercentage || 70),
          submittedAt: new Date().toISOString(),
          violationsCount: payload.violationsCount || 0,
          status: payload.status,
        });
        setExamStep('COMPLETED');
      } else {
        setExamStep('TEST');
      }
    } catch (err: any) {
      console.error('Gagal memuat single-payload sesi ujian', err);
      const msg = err.response?.data?.message || err.response?.data?.error || 'Gagal memulai sesi ujian. Periksa koneksi atau status sesi Anda.';
      alert(msg);
      if (err.response?.status === 401 || err.response?.data?.tokenExpired) {
        localStorage.removeItem('cbt_auth_token');
        localStorage.removeItem('cbt_active_exam');
        localStorage.removeItem('cbt_user');
        setUser(null);
        setActiveExam(null);
        setExamStep('LOGIN');
      }
    } finally {
      setIsStartingSession(false);
    }
  };

  const handleSubmitExam = async (sessionId: string, currentAnswers?: Record<string, ParticipantAnswer>) => {
    try {
      const res = await api.post('/session/submit', { sessionId, answers: currentAnswers });
      setExamResult(res.data.result);

      // Clean local cache and save server evaluated answers (with AI grades & feedback)
      OfflineStorageManager.clearLocalAnswers(sessionId);
      const serverAnswers = res.data.answers || {};

      setSessionPayload((prev) => (prev ? { ...prev, answers: serverAnswers, status: 'COMPLETED' } : prev));
      setExamStep('COMPLETED');
    } catch (err) {
      console.error('Gagal mengirim hasil ujian', err);
    }
  };

  // Check if any essay answer is awaiting background AI grading refinement
  const [isSyncingAi, setIsSyncingAi] = useState(false);
  const [forceAiCompleted, setForceAiCompleted] = useState(false);
  const aiPollCountRef = useRef(0);

  const hasPendingAiGrading = Boolean(
    !forceAiCompleted &&
    examStep === 'COMPLETED' &&
    sessionPayload?.questions?.some((q) => {
      if (q.type !== 'ESSAY') return false;
      const ans = sessionPayload.answers[q.id];
      return ans?.essayAnswer && ans.essayAnswer.trim() !== '' && ans.aiGraded === false;
    })
  );

  const handleManualSync = async () => {
    if (!sessionPayload?.sessionId) return;
    setIsSyncingAi(true);
    try {
      const res = await api.get(`/session/my-result/${sessionPayload.sessionId}`);
      const data = res.data.data;
      if (data && data.answers) {
        setSessionPayload((prev) => (prev ? { ...prev, answers: data.answers } : prev));
        setExamResult((prev) =>
          prev
            ? {
                ...prev,
                score: data.score,
                maxScore: data.maxScore,
                percentage: data.percentage,
                isPassed: data.isPassed,
              }
            : prev
        );
      }
      setForceAiCompleted(true);
    } catch (e) {
      console.error('Error syncing AI grading status:', e);
      setForceAiCompleted(true);
    } finally {
      setIsSyncingAi(false);
    }
  };

  // Background sync for AI essay evaluations so student sees finalized marks without refresh
  useEffect(() => {
    if (!hasPendingAiGrading || !sessionPayload?.sessionId) return;

    aiPollCountRef.current = 0;

    const interval = setInterval(async () => {
      aiPollCountRef.current += 1;
      try {
        const res = await api.get(`/session/my-result/${sessionPayload.sessionId}`);
        const data = res.data.data;
        if (data && data.answers) {
          setSessionPayload((prev) => (prev ? { ...prev, answers: data.answers } : prev));
          setExamResult((prev) =>
            prev
              ? {
                  ...prev,
                  score: data.score,
                  maxScore: data.maxScore,
                  percentage: data.percentage,
                  isPassed: data.isPassed,
                }
              : prev
          );

          // If server reports no pending AI tasks, finish polling
          if (data.hasPendingAiGrading === false) {
            setForceAiCompleted(true);
            clearInterval(interval);
          }
        }
      } catch (e) {
        console.error('Error polling AI grading status:', e);
      }

      // Safety timeout: after 4 polls (~10 seconds), finalize UI so student is never stuck
      if (aiPollCountRef.current >= 4) {
        setForceAiCompleted(true);
        clearInterval(interval);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [hasPendingAiGrading, sessionPayload?.sessionId]);

  const handleLogout = () => {
    OfflineStorageManager.clearAllOfflineCaches();
    localStorage.removeItem('cbt_auth_token');
    localStorage.removeItem('cbt_user');
    localStorage.removeItem('cbt_active_exam');
    setUser(null);
    setActiveExam(null);
    setSessionPayload(null);
    setExamResult(null);
    setActiveExamTimers(null);
    setExamStep('LOGIN');
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 text-slate-900 dark:text-zinc-100 flex flex-col font-sans">
      <Navbar
        user={user}
        onLogout={handleLogout}
        onOpenMetricsModal={() => setIsMetricsModalOpen(true)}
        onOpenCloudflareTab={() => setAdminTab('CLOUDFLARE')}
        isCfConnected={cfConnected}
        isFullscreenActive={examStep === 'TEST'}
        examTimers={examStep === 'TEST' ? activeExamTimers : null}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6">
        {/* --- 1. ADMIN DASHBOARD FLOW --- */}
        {user?.role === 'ADMIN' ? (
          <div className="space-y-6">
            {/* Admin Header & Tabs */}
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-zinc-800">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emerald-500" />
                    Panel Pengawas & Administrator CBT
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">Kelola ujian, peserta, pemantauan real-time, dan metrik server</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsWipeModalOpen(true)}
                    className="px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800/80 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-rose-100 dark:hover:bg-rose-900 transition-colors shadow-xs cursor-pointer"
                    title="Hapus total semua bank soal, peserta, sesi, dan hasil ujian dari Cloudflare D1 & Server"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                    <span>Reset & Hapus Total</span>
                  </button>

                  <button
                    onClick={() => setAdminTab('CLOUDFLARE')}
                    className="px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800/80 text-amber-800 dark:text-amber-300 text-xs font-semibold flex items-center gap-1.5 hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors shadow-xs cursor-pointer"
                    title="Buka panel database Cloudflare D1"
                  >
                    <Cloud className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    <span>Cloudflare D1</span>
                    <span className={`w-2 h-2 rounded-full ${cfConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`}></span>
                  </button>
                </div>
              </div>

              {/* Navigation Tabs */}
              <div className="flex flex-wrap gap-2 pt-4">
                {[
                  { id: 'EXAMS', label: 'Bank & Sesi Ujian', icon: BookOpen },
                  { id: 'PARTICIPANTS', label: 'Daftar Peserta (36+)', icon: Users },
                  { id: 'LIVE', label: 'Pemantauan Real-Time', icon: Activity },
                  { id: 'RESULTS', label: 'Hasil & Analisis', icon: Award },
                  { id: 'CLOUDFLARE', label: 'Database Cloudflare (D1)', icon: Cloud },
                  { id: 'METRICS', label: 'Metrik Cloud Run', icon: CloudLightning },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = adminTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setAdminTab(tab.id as any)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                        isActive
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Tab View */}
            {adminTab === 'EXAMS' && <ExamManager />}
            {adminTab === 'PARTICIPANTS' && <ParticipantManager />}
            {adminTab === 'LIVE' && <LiveMonitor />}
            {adminTab === 'RESULTS' && <ResultsAnalytics />}
            {adminTab === 'CLOUDFLARE' && <CloudflareManager />}
            {adminTab === 'METRICS' && <CloudMetricsPanel />}
          </div>
        ) : (
          /* --- 2. PARTICIPANT CBT FLOW --- */
          <div>
            {examStep === 'LOGIN' && (
              <TokenLoginForm
                onSuccess={handleParticipantVerified}
                onAdminLoginClick={() => setIsAdminModalOpen(true)}
              />
            )}

            {examStep === 'INSTRUCTIONS' && user && activeExam && (
              <PreExamInstruction
                user={user}
                exam={activeExam}
                onStartExam={handleStartExamSession}
                isLoading={isStartingSession}
              />
            )}

            {examStep === 'TEST' && sessionPayload && (
              <ExamEngine
                sessionPayload={sessionPayload}
                onSubmitExam={handleSubmitExam}
                onTimerTick={setActiveExamTimers}
              />
            )}

            {examStep === 'COMPLETED' && examResult && (
              <div className="max-w-xl mx-auto py-12 px-4 text-center">
                <Card className="border-slate-200 dark:border-zinc-800 shadow-xl">
                  <div className="w-16 h-16 rounded-3xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-4 shadow-inner">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>

                  <h2 className="text-2xl font-bold text-slate-900 dark:text-zinc-100 mb-1">
                    Ujian Berhasil Diselesaikan!
                  </h2>
                  <p className="text-xs text-slate-500 mb-6">
                    Jawaban Anda telah aman tersimpan di server.
                  </p>

                  {hasPendingAiGrading && (
                    <div className="mb-6 p-3.5 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 rounded-2xl text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-indigo-900 dark:text-indigo-200 shadow-xs animate-fade-in">
                      <div className="flex items-center gap-3">
                        <div className="w-4 h-4 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin shrink-0" />
                        <div>
                          <p className="font-bold text-[12px] flex items-center gap-1.5">
                            <span>Evaluasi AI Gemini Sedang Memproses di Latar Belakang</span>
                          </p>
                          <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-0.5 leading-relaxed">
                            Jawaban Anda sudah aman dikumpulkan. Analisis penalaran jawaban uraian sedang berjalan otomatis tanpa membebani server. Skor akan langsung sinkron begitu selesai.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleManualSync}
                        disabled={isSyncingAi}
                        className="px-3 py-1.5 text-[11px] font-bold bg-white dark:bg-zinc-800 text-indigo-700 dark:text-indigo-300 rounded-xl border border-indigo-200 dark:border-indigo-800 shadow-xs hover:bg-indigo-100 dark:hover:bg-zinc-700 cursor-pointer shrink-0 self-end sm:self-auto transition-colors"
                      >
                        {isSyncingAi ? 'Sinkronisasi...' : 'Sinkronkan Sekarang'}
                      </button>
                    </div>
                  )}

                  <div className="p-4 bg-slate-50 dark:bg-zinc-800/60 rounded-2xl border border-slate-200/60 dark:border-zinc-700/60 space-y-3 mb-6 text-xs text-left">
                    <div className="flex justify-between border-b border-slate-200/50 dark:border-zinc-700/50 pb-2">
                      <span className="text-slate-500">Nama Peserta:</span>
                      <span className="font-bold text-slate-900 dark:text-zinc-100">{examResult.participantName}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200/50 dark:border-zinc-700/50 pb-2">
                      <span className="text-slate-500">Judul Ujian:</span>
                      <span className="font-semibold text-slate-900 dark:text-zinc-100">{examResult.examTitle}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200/50 dark:border-zinc-700/50 pb-2">
                      <span className="text-slate-500">Total Poin Skor:</span>
                      <span className="font-mono font-bold text-slate-900 dark:text-zinc-100">
                        {examResult.score} / {examResult.maxScore}
                      </span>
                    </div>
                    <div className="flex justify-between items-center pt-1">
                      <span className="text-slate-500">Nilai Persentase:</span>
                      <span className="font-mono font-bold text-lg text-emerald-600 dark:text-emerald-400">
                        {examResult.percentage}%
                      </span>
                    </div>
                  </div>

                  {sessionPayload?.exam?.showAnswerKeys !== false && sessionPayload?.questions && (
                    <div className="mb-6 border-t border-slate-200 dark:border-zinc-800 pt-4 text-left">
                      <h3 className="font-bold text-xs text-slate-800 dark:text-zinc-200 mb-3 flex items-center gap-1.5">
                        <Key className="w-4 h-4 text-emerald-600" />
                        <span>Koreksi & Pembahasan Hasil Ujian</span>
                      </h3>
                      <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                        {sessionPayload.questions.map((q, idx) => {
                          const userAns = sessionPayload.answers[q.id];
                          const selectedOpt = q.options?.find((o) => o.id === userAns?.selectedOptionId);
                          const correctOpt = q.options?.find((o) => o.id === q.correctOptionId);
                          const isCorrect = userAns?.selectedOptionId && userAns.selectedOptionId === q.correctOptionId;
                          const isEssay = q.type === 'ESSAY';
                          const isShortAnswer = q.type === 'SHORT_ANSWER';
                          const isShortCorrect = isShortAnswer && ((userAns?.essayScore ?? 0) > 0);
                          const essayScore = userAns?.essayScore ?? 0;

                          return (
                            <div key={q.id} className="p-3 bg-slate-50 dark:bg-zinc-800/60 rounded-xl border border-slate-200/80 dark:border-zinc-700/80 text-xs space-y-2">
                              <div className="font-bold text-slate-800 dark:text-zinc-200 flex items-start justify-between gap-2">
                                <span>{idx + 1}. {q.questionText.replace(/```[\s\S]*?```/g, '').substring(0, 100)}...</span>
                                {isShortAnswer ? (
                                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 ${isShortCorrect ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'}`}>
                                    {isShortCorrect ? `✓ Benar (+${q.points} Poin)` : '✗ Salah (0 Poin)'}
                                  </span>
                                ) : !isEssay ? (
                                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 ${isCorrect ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'}`}>
                                    {isCorrect ? `✓ Benar (+${q.points} Poin)` : '✗ Salah (0 Poin)'}
                                  </span>
                                ) : (
                                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 font-mono ${essayScore > 0 ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300' : 'bg-slate-200 text-slate-700 dark:bg-zinc-700 dark:text-zinc-300'}`}>
                                    Nilai: {essayScore} / {q.points} Poin
                                  </span>
                                )}
                              </div>

                              {isShortAnswer ? (
                                <div className="text-[11px] space-y-1.5 pt-0.5">
                                  <div className="text-slate-600 dark:text-zinc-300">
                                    Isian Anda:{' '}
                                    <strong className={isShortCorrect ? 'text-emerald-600 dark:text-emerald-400 font-mono' : 'text-rose-600 dark:text-rose-400 font-mono'}>
                                      {userAns?.shortAnswer || userAns?.essayAnswer || '(Belum diisi)'}
                                    </strong>
                                  </div>
                                  <div className="text-emerald-700 dark:text-emerald-400 font-semibold font-mono">
                                    Kunci Jawaban Benar: <strong>{q.shortAnswerKey || (q.shortAnswerKeys || []).join(' | ') || '-'}</strong>
                                  </div>
                                </div>
                              ) : !isEssay ? (
                                <div className="text-[11px] space-y-1 pt-0.5">
                                  <div className="text-slate-600 dark:text-zinc-300">
                                    Jawaban Anda:{' '}
                                    <strong className={isCorrect ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                                      {selectedOpt ? selectedOpt.optionText : '(Belum dijawab)'}
                                    </strong>
                                  </div>
                                  {!isCorrect && correctOpt && (
                                    <div className="text-emerald-700 dark:text-emerald-400 font-semibold">
                                      Kunci Jawaban Benar: <strong>{correctOpt.optionText}</strong>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-[11px] space-y-2 pt-0.5">
                                  <div className="bg-white dark:bg-zinc-900 p-2 rounded-lg border border-slate-200/80 dark:border-zinc-700">
                                    <span className="text-slate-500 font-medium block text-[10px] mb-0.5">Jawaban Anda:</span>
                                    <span className="text-slate-900 dark:text-zinc-100 italic">
                                      {userAns?.essayAnswer || '(Tidak ada jawaban / kosong)'}
                                    </span>
                                  </div>

                                  {/* AI Gemini Evaluation Card */}
                                  <div className={`p-2.5 rounded-lg border space-y-1.5 ${
                                    userAns?.aiGraded !== false
                                      ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900/60'
                                      : 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50'
                                  }`}>
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold flex items-center gap-1.5 text-[11px]">
                                        {userAns?.aiGraded !== false ? (
                                          <span className="text-indigo-800 dark:text-indigo-300">🤖 Koreksi AI Gemini</span>
                                        ) : (
                                          <span className="text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                                            <div className="w-2.5 h-2.5 rounded-full border-2 border-amber-600 border-t-transparent animate-spin" />
                                            <span>⚡ Skor Sementara (AI Gemini sedang menyempurnakan...)</span>
                                          </span>
                                        )}
                                      </span>
                                      <span className="font-mono font-bold text-slate-800 dark:text-zinc-200">
                                        Skor: {essayScore} / {q.points}
                                      </span>
                                    </div>

                                    <p className="text-slate-700 dark:text-zinc-300 text-[11px] leading-relaxed">
                                      {userAns?.aiFeedback || (userAns?.essayAnswer ? 'Jawaban telah tersimpan dan dinilai.' : 'Jawaban uraian kosong / belum diisi.')}
                                    </p>

                                    {userAns?.aiConceptualStrengths && userAns.aiConceptualStrengths.length > 0 && (
                                      <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
                                        ✓ <strong>Konsep Tepat:</strong> {userAns.aiConceptualStrengths.join(', ')}
                                      </div>
                                    )}

                                    {userAns?.aiMissingConcepts && userAns.aiMissingConcepts.length > 0 && (
                                      <div className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                                        ⚠ <strong>Perlu Dilengkapi:</strong> {userAns.aiMissingConcepts.join(', ')}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <Button variant="outline" className="w-full" onClick={handleLogout}>
                    <RotateCcw className="w-4 h-4" />
                    Kembali ke Halaman Utama
                  </Button>
                </Card>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Admin Login Dialog */}
      <Modal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
        title="Login Pengawas / Admin CBT"
      >
        <form onSubmit={handleAdminLogin} className="space-y-4 text-xs">
          {adminLoginError && (
            <div className="p-3 rounded-lg bg-rose-50 text-rose-700 border border-rose-200">
              {adminLoginError}
            </div>
          )}

          <div>
            <label className="block font-semibold mb-1">Username Admin</label>
            <input
              type="text"
              required
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
              placeholder="Masukkan Username Admin..."
              className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">Password Admin</label>
            <input
              type="password"
              required
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Masukkan Password Admin..."
              className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100"
            />
          </div>

          <Button type="submit" variant="primary" className="w-full py-2.5">
            Masuk ke Panel Pengawas
          </Button>
        </form>
      </Modal>

      {/* Cloud Metrics Modal Detail */}
      <Modal
        isOpen={isMetricsModalOpen}
        onClose={() => setIsMetricsModalOpen(false)}
        title="Detail Performa Cloud Run Server"
        maxWidth="lg"
      >
        <CloudMetricsPanel />
      </Modal>

      {/* Database Persistence & Auto-Restore Modal */}
      <DatabaseBackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
      />

      {/* Wipe All Data Confirmation Modal */}
      <Modal
        isOpen={isWipeModalOpen}
        onClose={() => !isWiping && setIsWipeModalOpen(false)}
        title="Reset & Hapus Total Semua Data"
      >
        <div className="space-y-4 text-xs">
          {wipeSuccessMsg ? (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 mx-auto" />
              <div className="font-bold text-sm">Reset Berhasil!</div>
              <p>{wipeSuccessMsg}</p>
            </div>
          ) : (
            <>
              <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-sm text-rose-900 dark:text-rose-100">
                    Peringatan Tindakan Permanen!
                  </div>
                  <p className="leading-relaxed">
                    Tindakan ini akan <strong>MENGHAPUS BERSIH</strong> seluruh:
                  </p>
                  <ul className="list-disc pl-4 space-y-0.5 text-rose-800 dark:text-rose-300">
                    <li>Semua Bank & Sesi Soal Ujian</li>
                    <li>Semua Akun & Data Peserta Ujian</li>
                    <li>Semua Sesi Ujian & Riwayat Jawaban</li>
                    <li>Semua Rekap Hasil & Nilai Kelulusan</li>
                  </ul>
                  <div className="pt-2">
                    <label className="block text-[11px] font-semibold text-rose-900 dark:text-rose-200 mb-1">
                      Ketik <span className="font-mono bg-rose-200/60 dark:bg-rose-900/60 px-1 py-0.5 rounded font-bold">HAPUS</span> untuk mengonfirmasi reset:
                    </label>
                    <input
                      type="text"
                      value={wipeConfirmText}
                      onChange={(e) => setWipeConfirmText(e.target.value)}
                      placeholder="Ketik HAPUS di sini..."
                      className="w-full px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-rose-500"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row justify-between items-center gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={handleRestoreSafetyBackup}
                  disabled={isWiping}
                  className="text-amber-700 dark:text-amber-300 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 text-xs w-full sm:w-auto"
                >
                  Pulihkan Cadangan Sebelumnya
                </Button>
                <div className="flex justify-end gap-2 w-full sm:w-auto">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsWipeModalOpen(false);
                      setWipeConfirmText('');
                    }}
                    disabled={isWiping}
                  >
                    Batal
                  </Button>
                  <Button
                    variant="danger"
                    onClick={handleWipeAllData}
                    disabled={isWiping || wipeConfirmText.trim() !== 'HAPUS'}
                    className={`text-white flex items-center gap-1.5 ${
                      wipeConfirmText.trim() === 'HAPUS'
                        ? 'bg-rose-600 hover:bg-rose-700'
                        : 'bg-rose-300 dark:bg-rose-900/40 cursor-not-allowed opacity-60'
                    }`}
                  >
                    {isWiping ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Sedang Menghapus...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        <span>Ya, Hapus Total Semua Data</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
