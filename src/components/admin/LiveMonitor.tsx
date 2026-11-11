import React, { useState, useEffect } from 'react';
import { Activity, ShieldAlert, CheckCircle2, Clock, Users, RefreshCw, RotateCcw, AlertTriangle, StopCircle, X, Check, Unlock } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { api } from '../../services/api';
import { ViolationLog, ExamResult } from '../../types/cbt';

export interface LiveActiveSession {
  sessionId: string;
  examId: string;
  examTitle: string;
  participantId: string;
  participantName: string;
  participantCode: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'AUTO_SUBMITTED';
  currentQuestionIndex: number;
  totalQuestions: number;
  answeredCount: number;
  currentQuestionText: string;
  score?: number;
  maxScore?: number;
  violationsCount: number;
}

const formatQuestionPreview = (text: string) => {
  if (!text) return '';
  return text.replace(new RegExp('```[\\s\\S]*?```', 'g'), '[Kode Program]');
};

export const LiveMonitor: React.FC = () => {
  const [violations, setViolations] = useState<ViolationLog[]>([]);
  const [results, setResults] = useState<ExamResult[]>([]);
  const [activeSessions, setActiveSessions] = useState<LiveActiveSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isResettingAll, setIsResettingAll] = useState(false);
  const [forceEndingSessionId, setForceEndingSessionId] = useState<string | null>(null);
  const [isForceEndingAll, setIsForceEndingAll] = useState(false);
  const [actionAlert, setActionAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const isMountedRef = React.useRef(true);
  const pollTimerRef = React.useRef<any>(null);

  const fetchLiveData = async (showLoadingIndicator = false) => {
    if (showLoadingIndicator) setIsRefreshing(true);
    try {
      const [violRes, resRes, activeRes] = await Promise.all([
        api.get('/violations'),
        api.get('/results'),
        api.get('/session/live-active'),
      ]);
      
      if (violRes.data?.data) {
        setViolations(violRes.data.data);
      }
      if (resRes.data?.data) {
        setResults(resRes.data.data);
      }
      if (activeRes.data?.data) {
        setActiveSessions(activeRes.data.data);
      }
      setLastSyncTime(new Date());
    } catch (e) {
      console.warn('Gagal memperbarui status live (akan dicoba lagi pada poll berikutnya):', e);
      // Retain existing state! Never clear to empty array on transient error!
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;

    const runPoll = async () => {
      await fetchLiveData();
      if (isMountedRef.current) {
        pollTimerRef.current = setTimeout(runPoll, 4000);
      }
    };

    runPoll();

    return () => {
      isMountedRef.current = false;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  const handleForceEndParticipant = async (sessionId: string, participantName: string, participantCode: string) => {
    const confirmMsg = `Konfirmasi FORCE END (Selesaikan Paksa):\n\n` +
      `Peserta: ${participantName} (${participantCode})\n\n` +
      `• Ujian peserta akan langsung diselesaikan saat ini juga.\n` +
      `• Seluruh data pekerjaan (pilihan ganda & esai) akan langsung dinilai.\n` +
      `• Nilai dan seluruh hasil akan disimpan permanen ke database.\n\n` +
      `Lanjutkan Force End untuk peserta ini?`;

    if (!window.confirm(confirmMsg)) return;

    setForceEndingSessionId(sessionId);
    try {
      const res = await api.post('/session/force-end', { sessionId });
      const resultData = res.data?.result;
      const scoreMsg = resultData ? ` [Nilai: ${resultData.score}/${resultData.maxScore} (${resultData.percentage}%)]` : '';
      setActionAlert({
        type: 'success',
        message: `Ujian ${participantName} berhasil diselesaikan paksa!${scoreMsg}. Seluruh pekerjaan siswa telah disimpan permanen.`,
      });
      await fetchLiveData();
    } catch (e: any) {
      console.error('Gagal force end peserta', e);
      setActionAlert({
        type: 'error',
        message: e.response?.data?.error || 'Gagal menyelesaikan paksa sesi ujian.',
      });
    } finally {
      setForceEndingSessionId(null);
    }
  };

  const handleForceEndAllSessions = async () => {
    const activeCount = activeSessions.filter((s) => s.status === 'IN_PROGRESS').length;
    if (activeCount === 0) {
      alert('Tidak ada sesi peserta yang sedang aktif mengerjakan ujian.');
      return;
    }

    const confirmMsg = `PERHATIAN: Konfirmasi FORCE END SEMUA SESI AKTIF (${activeCount} Peserta):\n\n` +
      `• Seluruh ${activeCount} peserta yang sedang mengerjakan ujian akan diselesaikan serentak.\n` +
      `• Semua data jawaban yang telah diisi akan dinilai otomatis dan disimpan permanen.\n` +
      `• Layar siswa akan langsung beralih ke halaman hasil ujian.\n\n` +
      `Apakah Anda yakin ingin menyelesaikan semua sesi peserta sekarang?`;

    if (!window.confirm(confirmMsg)) return;

    setIsForceEndingAll(true);
    try {
      const res = await api.post('/session/force-end-all', {});
      setActionAlert({
        type: 'success',
        message: res.data?.message || `Berhasil menyelesaikan paksa ${activeCount} sesi peserta. Seluruh nilai & data pekerjaan telah tersimpan.`,
      });
      await fetchLiveData();
    } catch (e: any) {
      console.error('Gagal force end semua sesi', e);
      setActionAlert({
        type: 'error',
        message: e.response?.data?.error || 'Gagal menyelesaikan paksa semua sesi peserta.',
      });
    } finally {
      setIsForceEndingAll(false);
    }
  };

  const handleUnlockParticipant = async (participantId: string, participantName: string) => {
    try {
      const res = await api.post('/session/unlock-participant', { participantId });
      setActionAlert({
        type: 'success',
        message: res.data?.message || `Kunci perangkat ${participantName} berhasil dibuka! Seluruh data jawaban siswa tetap aman tersimpan.`,
      });
      await fetchLiveData();
    } catch (e: any) {
      console.error('Gagal membuka kunci perangkat', e);
      setActionAlert({
        type: 'error',
        message: e.response?.data?.error || 'Gagal membuka kunci perangkat peserta.',
      });
    }
  };

  const handleUnlockAllDevices = async () => {
    if (window.confirm('Buka kunci (unlock) perangkat untuk semua peserta ujian?\n\nPeserta yang berpindah laptop/browser akan dapat langsung login kembali tanpa kehilangan data pengerjaan.')) {
      try {
        const res = await api.post('/session/unlock-devices', {});
        setActionAlert({
          type: 'success',
          message: res.data?.message || 'Semua kunci perangkat berhasil dibuka! Seluruh data jawaban peserta tetap aman.',
        });
        await fetchLiveData();
      } catch (e: any) {
        console.error('Gagal membuka semua kunci perangkat', e);
        setActionAlert({
          type: 'error',
          message: e.response?.data?.error || 'Gagal membuka kunci perangkat.',
        });
      }
    }
  };

  const handleResetParticipant = async (participantId: string, participantName: string) => {
    if (window.confirm(
      `Buka Kunci Perangkat untuk ${participantName}?\n\n` +
      `✓ Kunci login perangkat akan dibuka agar siswa dapat login dari browser/laptop baru.\n` +
      `✓ SELURUH DATA JAWABAN & SKOR SISWA TETAP AMAN (TIDAK AKAN DIHAPUS).\n\n` +
      `Lanjutkan buka kunci perangkat?`
    )) {
      try {
        const res = await api.post('/session/unlock-participant', { participantId });
        setActionAlert({
          type: 'success',
          message: res.data?.message || `Kunci perangkat ${participantName} berhasil dibuka! Seluruh data jawaban tetap aman tersimpan.`,
        });
        await fetchLiveData();
      } catch (e: any) {
        console.error('Gagal membuka kunci perangkat peserta', e);
        setActionAlert({
          type: 'error',
          message: e.response?.data?.error || 'Gagal membuka kunci perangkat peserta.',
        });
      }
    }
  };

  const handleResetAllSessions = async () => {
    const activeCount = activeSessions.length;
    const completedCount = results.length;
    const msg = `PERHATIAN: Apakah Anda yakin ingin MERESET SEMUA SESI UJIAN untuk kelas baru?\n\n` +
      `• ${activeCount} sesi aktif & ${completedCount} hasil pengerjaan akan dihapus.\n` +
      `• Log pelanggaran anti-cheat akan dibersihkan.\n` +
      `• Kunci perangkat login akan dibebaskan agar kelas baru dapat langsung login.\n\n` +
      `Lanjutkan reset untuk sesi kelas baru?`;

    if (window.confirm(msg)) {
      setIsResettingAll(true);
      try {
        const res = await api.post('/session/reset-all', { examId: 'ALL', clearDeviceLocks: true });
        setActionAlert({
          type: 'success',
          message: res.data.message || 'Semua sesi ujian berhasil di-reset untuk kelas baru!',
        });
        await fetchLiveData();
      } catch (e: any) {
        console.error('Gagal mereset semua sesi ujian', e);
        setActionAlert({
          type: 'error',
          message: e.response?.data?.error || 'Gagal mereset sesi ujian',
        });
      } finally {
        setIsResettingAll(false);
      }
    }
  };

  const activeCount = activeSessions.filter((s) => s.status === 'IN_PROGRESS').length;

  return (
    <div className="space-y-6">
      {/* Header & Clean Toolbar */}
      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-500 animate-pulse shrink-0" />
              Pemantauan Sesi Ujian Real-Time
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Monitor aktivitas pengerjaan peserta, kelola Force End nilai, & pantau integritas anti-cheat</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Force End All Button */}
            <button
              type="button"
              onClick={handleForceEndAllSessions}
              disabled={isForceEndingAll || activeCount === 0}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-colors shadow-2xs whitespace-nowrap cursor-pointer ${
                activeCount > 0
                  ? 'border-rose-300 dark:border-rose-800/80 bg-rose-50 hover:bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
                  : 'border-slate-200 dark:border-zinc-800 bg-slate-50 text-slate-400 dark:bg-zinc-800/50 dark:text-zinc-500 cursor-not-allowed'
              }`}
              title="Selesaikan paksa seluruh sesi ujian peserta yang sedang aktif dan simpan semua data nilainya"
            >
              <StopCircle className={`w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0 ${isForceEndingAll ? 'animate-spin' : ''}`} />
              <span>{isForceEndingAll ? 'Menyelesaikan Semua...' : `Force End Semua Sesi (${activeCount})`}</span>
            </button>

            {/* Unlock All Devices Button */}
            <button
              type="button"
              onClick={handleUnlockAllDevices}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-teal-300 dark:border-teal-800/80 bg-teal-50 hover:bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300 shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
              title="Buka kunci seluruh perangkat peserta tanpa menghapus data jawaban ujian"
            >
              <Unlock className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
              <span>Buka Kunci Perangkat</span>
            </button>

            {/* Reset All Button */}
            <button
              type="button"
              onClick={handleResetAllSessions}
              disabled={isResettingAll}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-amber-300 dark:border-amber-800/80 bg-amber-50 hover:bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className={`w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 ${isResettingAll ? 'animate-spin' : ''}`} />
              <span>{isResettingAll ? 'Mereset Sesi...' : 'Reset Sesi untuk Kelas Baru'}</span>
            </button>

            {/* Refresh Button & Live Status */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono hidden sm:inline">
                Update: {lastSyncTime.toLocaleTimeString()}
              </span>
              <button
                type="button"
                onClick={() => fetchLiveData(true)}
                disabled={isRefreshing}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-700/60 shadow-2xs transition-colors cursor-pointer whitespace-nowrap disabled:opacity-60"
                title="Perbarui data realtime"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-500' : ''}`} />
                <span>{isRefreshing ? 'Menyinkronkan...' : 'Refresh Status'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Action Alert Banner */}
        {actionAlert && (
          <div
            className={`mt-4 p-3 rounded-xl border flex items-center justify-between gap-3 text-xs animate-in fade-in duration-200 ${
              actionAlert.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {actionAlert.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              )}
              <span className="font-semibold">{actionAlert.message}</span>
            </div>
            <button
              onClick={() => setActionAlert(null)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 p-0.5 rounded cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Active Participants Question Tracker Section */}
      <Card
        title={`Status Soal & Progres Pengerjaan Peserta (${activeCount} Aktif)`}
        subtitle="Pantau nomor soal & progres jawaban secara live. Gunakan 'Force End' untuk mengakhiri dan menyimpan nilai siswa secara instan."
      >
        {activeCount === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            Belum ada peserta yang sedang aktif memuat atau mengerjakan soal saat ini.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeSessions
              .filter((s) => s.status === 'IN_PROGRESS')
              .map((s) => (
                <div
                  key={s.sessionId}
                  className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 shadow-xs space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate">
                      <span className="font-bold text-slate-900 dark:text-zinc-100 text-xs block truncate">
                        {s.participantName} ({s.participantCode})
                      </span>
                      <span className="text-[10px] text-slate-500 dark:text-zinc-400 block truncate">{s.examTitle}</span>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 shrink-0 border border-amber-300 dark:border-amber-800">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                      Soal #{s.currentQuestionIndex} / {s.totalQuestions}
                    </span>
                  </div>

                  {s.currentQuestionText && (
                    <div className="p-2 rounded-lg bg-slate-50 dark:bg-zinc-800/60 text-[11px] text-slate-700 dark:text-zinc-300 line-clamp-2 border border-slate-100 dark:border-zinc-800">
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">Soal #{s.currentQuestionIndex}:</span>{' '}
                      {formatQuestionPreview(s.currentQuestionText)}
                    </div>
                  )}

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-semibold">
                      <span>Progres Terjawab:</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-mono">
                        {s.answeredCount} / {s.totalQuestions} Soal
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${s.totalQuestions > 0 ? (s.answeredCount / s.totalQuestions) * 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 text-[10px] text-slate-400 border-t border-slate-100 dark:border-zinc-800">
                    <span>
                      Pelanggaran: <strong className={s.violationsCount > 0 ? 'text-rose-600' : 'text-slate-600'}>{s.violationsCount}x</strong>
                    </span>
                    <div className="flex items-center gap-1.5">
                      {/* Buka Kunci / Unlock Device Button */}
                      <button
                        type="button"
                        onClick={() => handleUnlockParticipant(s.participantId, s.participantName)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-teal-50 hover:bg-teal-100 dark:bg-teal-950 dark:hover:bg-teal-900/60 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-700 transition-colors cursor-pointer shadow-2xs"
                        title="Buka kunci perangkat peserta ini agar bisa lanjut ujian tanpa menghapus data jawaban"
                      >
                        <Unlock className="w-3 h-3 text-teal-600" />
                        <span>Buka Kunci</span>
                      </button>

                      {/* Force End Single Participant Button */}
                      <button
                        type="button"
                        onClick={() => handleForceEndParticipant(s.sessionId, s.participantName, s.participantCode)}
                        disabled={forceEndingSessionId === s.sessionId}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                        title="Selesaikan paksa ujian peserta ini dan simpan seluruh nilai/pekerjaan"
                      >
                        <StopCircle className={`w-3 h-3 shrink-0 ${forceEndingSessionId === s.sessionId ? 'animate-spin' : ''}`} />
                        <span>{forceEndingSessionId === s.sessionId ? 'Menyimpan...' : 'Force End'}</span>
                      </button>

                      {/* Reset Sesi Button (Safe Device Unlock) */}
                      <button
                        type="button"
                        onClick={() => handleResetParticipant(s.participantId, s.participantName)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-slate-600 dark:text-zinc-400 hover:text-amber-700 dark:hover:text-amber-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                        title="Buka kunci perangkat peserta tanpa menghapus data jawaban"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Reset Device</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Violation Live Feed (2 Columns) */}
        <div className="lg:col-span-2 space-y-4">
          <Card title="Log Pelanggaran Anti-Cheat (Terbaru)" subtitle="Deteksi otomatis pindah tab, lepas fokus, dan hotkey">
            {violations.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                Belum ada pelanggaran terdeteksi. Seluruh peserta mengerjakan dengan tertib.
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[450px] overflow-y-auto pr-1">
                {violations.map((v) => (
                  <div
                    key={v.id}
                    className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200/80 dark:border-zinc-700/80 flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-zinc-100">{v.participantName}</span>
                        <Badge variant="rose" size="sm">{v.type}</Badge>
                      </div>
                      <p className="text-slate-600 dark:text-zinc-300">{v.details}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(v.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Real-time Status Stats (1 Column) */}
        <div className="space-y-4">
          <Card title="Status Peserta Ujian">
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
                <span className="text-slate-700 dark:text-zinc-300">Selesai Normal</span>
                <span className="font-bold text-emerald-600 text-sm">{results.filter(r => r.status === 'COMPLETED').length} Peserta</span>
              </div>

              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center justify-between">
                <span className="text-slate-700 dark:text-zinc-300">Auto-Submit (Pelanggaran)</span>
                <span className="font-bold text-rose-600 text-sm">{results.filter(r => r.status === 'AUTO_SUBMITTED').length} Peserta</span>
              </div>

              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-between">
                <span className="text-slate-700 dark:text-zinc-300">Total Pelanggaran Dicatat</span>
                <span className="font-bold text-amber-600 text-sm">{violations.length} Kali</span>
              </div>
            </div>
          </Card>

          {/* List of auto-submitted / completed participants with quick reset option */}
          {results.length > 0 && (
            <Card title="Status Peserta Selesai / Diskualifikasi">
              <div className="space-y-2 max-h-[220px] overflow-y-auto text-xs pr-1">
                {results.map((r) => (
                  <div key={r.sessionId} className="p-2 rounded-lg bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-zinc-700 flex items-center justify-between gap-2">
                    <div className="truncate">
                      <span className="font-bold text-slate-800 dark:text-zinc-200 block truncate">{r.participantName} ({r.participantCode})</span>
                      <span className="text-[10px] text-slate-500">Nilai: {r.percentage}% • Pelanggaran: {r.violationsCount}x</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleResetParticipant(r.participantId, r.participantName)}
                      className="px-2 py-1 rounded bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300 font-semibold text-[10px] flex items-center gap-1 hover:bg-teal-200 shrink-0 cursor-pointer"
                      title="Buka kunci perangkat peserta tanpa menghapus data nilai"
                    >
                      <Unlock className="w-3 h-3" />
                      <span>Buka Kunci</span>
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
