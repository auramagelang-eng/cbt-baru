import React, { useState, useEffect } from 'react';
import { Maximize, ShieldAlert, CheckCircle2, Clock, FileText, AlertTriangle, Play, Smartphone, Edit2, Check, X, ExternalLink, Monitor, ShieldCheck, Timer } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { User, Exam } from '../../types/cbt';
import { AntiCheatEngine } from '../../services/antiCheat';

interface PreExamInstructionProps {
  user: User;
  exam: Exam;
  onStartExam: () => void;
  isLoading: boolean;
}

export const PreExamInstruction: React.FC<PreExamInstructionProps> = ({
  user,
  exam,
  onStartExam,
  isLoading,
}) => {
  const isSupported = AntiCheatEngine.isFullscreenSupported();
  const [isFullscreenReady, setIsFullscreenReady] = useState(() => AntiCheatEngine.isFullscreenActive());
  const [isEditingName, setIsEditingName] = useState(false);
  const [displayName, setDisplayName] = useState(user.name);
  const [showWindowsFallback, setShowWindowsFallback] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const [isAttemptingFullscreen, setIsAttemptingFullscreen] = useState(false);
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
  const isMobileDevice = AntiCheatEngine.isMobileDevice();

  useEffect(() => {
    const checkFullscreenState = () => {
      const active = AntiCheatEngine.isFullscreenActive();
      setIsFullscreenReady(active);
      if (active) {
        setShowWindowsFallback(false);
        setFullscreenError(null);
      }
    };

    checkFullscreenState();

    document.addEventListener('fullscreenchange', checkFullscreenState);
    document.addEventListener('webkitfullscreenchange', checkFullscreenState);
    document.addEventListener('mozfullscreenchange', checkFullscreenState);
    document.addEventListener('MSFullscreenChange', checkFullscreenState);
    window.addEventListener('resize', checkFullscreenState);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        setTimeout(checkFullscreenState, 150);
        setTimeout(checkFullscreenState, 450);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('fullscreenchange', checkFullscreenState);
      document.removeEventListener('webkitfullscreenchange', checkFullscreenState);
      document.removeEventListener('mozfullscreenchange', checkFullscreenState);
      document.removeEventListener('MSFullscreenChange', checkFullscreenState);
      window.removeEventListener('resize', checkFullscreenState);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSaveName = () => {
    if (displayName.trim()) {
      user.name = displayName.trim();
      localStorage.setItem('cbt_user', JSON.stringify(user));
    }
    setIsEditingName(false);
  };

  const handleEnableFullscreen = async () => {
    setFullscreenError(null);
    try {
      await AntiCheatEngine.requestFullscreen();
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 120));
    const active = AntiCheatEngine.isFullscreenActive();
    setIsFullscreenReady(active);
    if (active) {
      setShowWindowsFallback(false);
    } else {
      setShowWindowsFallback(true);
      setFullscreenError('Tidak dapat mengaktifkan otomatis. Silakan tekan tombol F11 di keyboard Anda.');
    }
  };

  const handleStartExamWithFullscreen = async () => {
    setFullscreenError(null);
    setIsAttemptingFullscreen(true);

    try {
      // 1. If already active or mobile device or focus mode active, start immediately
      if (AntiCheatEngine.isFullscreenActive() || AntiCheatEngine.isMobileWithoutFullscreen()) {
        setIsFullscreenReady(true);
        onStartExam();
        return;
      }

      // 2. Direct synchronous user-gesture request to enter fullscreen
      await AntiCheatEngine.requestFullscreen();

      // 3. Allow brief tick for browser rendering engine to finish fullscreen transition
      await new Promise((resolve) => setTimeout(resolve, 150));

      const isNowFullscreen = AntiCheatEngine.isFullscreenActive();

      if (isNowFullscreen || AntiCheatEngine.isMobileWithoutFullscreen()) {
        setIsFullscreenReady(true);
        setShowWindowsFallback(false);
        setFullscreenError(null);
        onStartExam();
      } else {
        // If in iframe or mobile touch device where browser denied HTML5 fullscreen API,
        // automatically activate Focus Mode so the student is never blocked
        if (AntiCheatEngine.isMobileDevice() || AntiCheatEngine.isInsideIframe()) {
          AntiCheatEngine.setFocusMode(true);
          setIsFullscreenReady(true);
          onStartExam();
          return;
        }

        // Fullscreen request rejected or prevented by browser/iframe policy on desktop
        setIsFullscreenReady(false);
        setShowWindowsFallback(true);
        setFullscreenError(
          'Layar Penuh otomatis tidak diizinkan oleh peramban Anda. Anda dapat menekan F11 pada keyboard atau klik "Mulai Ujian dengan Mode Fokus Aman" di bawah.'
        );
      }
    } finally {
      setIsAttemptingFullscreen(false);
    }
  };

  const handleOpenNewTab = () => {
    window.open(window.location.href, '_blank', 'noopener,noreferrer');
  };

  const handleBypassFullscreen = () => {
    AntiCheatEngine.setFocusMode(true);
    setIsFullscreenReady(true);
    setShowWindowsFallback(false);
    setFullscreenError(null);
    onStartExam();
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <Card className="border-slate-200 dark:border-zinc-800 shadow-md">
        <div className="border-b border-slate-100 dark:border-zinc-800 pb-5 mb-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <Badge variant="emerald" size="md" className="mb-2">
              Siap Mengerjakan Ujian
            </Badge>
            <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100">{exam.title}</h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Mata Pelajaran: {exam.subject}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 bg-slate-50 dark:bg-zinc-800/60 p-3 rounded-xl border border-slate-200/60 dark:border-zinc-700/60 text-xs">
            <div className="flex items-center gap-1.5 text-slate-700 dark:text-zinc-300">
              <Clock className="w-4 h-4 text-emerald-500" />
              <span>Sesi Ujian: <strong>{exam.durationMinutes}</strong> Menit</span>
            </div>
            <span className="text-slate-300">|</span>
            <div className="flex items-center gap-1.5 text-slate-700 dark:text-zinc-300">
              <Timer className="w-4 h-4 text-amber-500" />
              <span>Waktu Per Soal: <strong>{exam.questionDurationSeconds || Math.round((exam.durationMinutes * 60) / Math.max(1, exam.totalQuestions))}</strong> Detik</span>
            </div>
            <span className="text-slate-300">|</span>
            <div className="flex items-center gap-1.5 text-slate-700 dark:text-zinc-300">
              <FileText className="w-4 h-4 text-teal-500" />
              <span><strong>{exam.totalQuestions}</strong> Soal</span>
            </div>
          </div>
        </div>

        {/* NOTIFIKASI MODE LAYAR PENUH (FULLSCREEN) */}
        <div className={`p-4 rounded-xl border mb-6 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isFullscreenReady
            ? 'bg-emerald-50/90 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900/60 text-emerald-900 dark:text-emerald-200 shadow-xs'
            : 'bg-amber-50/90 border-amber-300 dark:bg-amber-950/40 dark:border-amber-800 text-amber-900 dark:text-amber-200 shadow-sm'
        }`}>
          <div className="flex items-start sm:items-center gap-3">
            <div className={`p-2.5 rounded-xl shrink-0 ${
              isFullscreenReady
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 animate-pulse'
            }`}>
              <Maximize className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm flex flex-wrap items-center gap-2">
                <span>Notifikasi Mode Layar Penuh (Fullscreen):</span>
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  isFullscreenReady
                    ? 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-200'
                    : 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200'
                }`}>
                  {isFullscreenReady ? '✓ Layar Penuh Aktif' : '⚠️ Belum Aktif (Wajib Diaktifkan)'}
                </span>
              </div>
              <p className="text-[11px] mt-1 opacity-90 leading-relaxed">
                {isFullscreenReady
                  ? 'Perangkat Anda telah berada dalam mode layar penuh. Ujian terlindungi dengan sistem anti-kecurangan penuh.'
                  : 'Ujian CBT ini mewajibkan mode Layar Penuh. Klik tombol "Aktifkan Layar Penuh" atau tekan tombol F11 sebelum memulai ujian.'}
              </p>
            </div>
          </div>

          {!isFullscreenReady && (
            <Button
              variant="warning"
              size="sm"
              onClick={handleEnableFullscreen}
              className="shrink-0 font-bold shadow-xs whitespace-nowrap self-start sm:self-auto flex items-center gap-1.5 cursor-pointer"
            >
              <Maximize className="w-4 h-4" />
              Aktifkan Layar Penuh
            </Button>
          )}
        </div>

        <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 rounded-xl p-4 mb-6">
          <h3 className="text-xs font-semibold text-emerald-900 dark:text-emerald-300 uppercase tracking-wide mb-2">
            Identitas Peserta Ujian
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-slate-500 block">Nama Peserta</span>
              {isEditingName ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="px-2 py-1 rounded border border-emerald-400 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 text-xs focus:ring-1 focus:ring-emerald-500"
                    placeholder="Masukkan Nama Asli..."
                    autoFocus
                  />
                  <button
                    onClick={handleSaveName}
                    className="p-1 rounded bg-emerald-600 text-white hover:bg-emerald-700"
                    title="Simpan Nama"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => { setDisplayName(user.name); setIsEditingName(false); }}
                    className="p-1 rounded bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-zinc-700 dark:text-zinc-200"
                    title="Batal"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900 dark:text-zinc-100">{user.name}</span>
                  <button
                    onClick={() => setIsEditingName(true)}
                    className="p-1 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 cursor-pointer"
                    title="Edit Nama Lengkap"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
            <div>
              <span className="text-slate-500 block">Kode Peserta</span>
              <span className="font-semibold font-mono text-slate-900 dark:text-zinc-100">{user.participantCode}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Status Sistem</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Terverifikasi
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500" />
            Aturan & Anti-Kecurangan Otomatis
          </h3>

          <ul className="space-y-2.5 text-xs text-slate-600 dark:text-zinc-300">
            <li className="flex items-start gap-2 bg-slate-50 dark:bg-zinc-800/40 p-2.5 rounded-lg border border-slate-200/50 dark:border-zinc-700/50">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>
                <strong>Mode Layar Penuh / Utuh:</strong> Aplikasi berjalan dalam tampilan terfokus.
                {!isSupported && <span className="text-emerald-600 dark:text-emerald-400 ml-1 font-semibold">(Mode Optimal Seluler/Perangkat Aktif)</span>}
              </span>
            </li>
            <li className="flex items-start gap-2 bg-slate-50 dark:bg-zinc-800/40 p-2.5 rounded-lg border border-slate-200/50 dark:border-zinc-700/50">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <span><strong>Deteksi Pindah Tab & Aplikasi:</strong> Dilarang berpindah tab browser atau meminimalkan layar.</span>
            </li>
            <li className="flex items-start gap-2 bg-slate-50 dark:bg-zinc-800/40 p-2.5 rounded-lg border border-slate-200/50 dark:border-zinc-700/50">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span><strong>Proteksi Maksimal (Maks 3 Pelanggaran):</strong> Klik kanan, Copy, Paste, dan shortcut developer diblokir. <strong>3 Kali Pelanggaran = Ujian Selesai Otomatis!</strong></span>
            </li>
          </ul>
        </div>

        {/* Windows / Browser Fullscreen Troubleshooting Card */}
        {showWindowsFallback && !isFullscreenReady && (
          <div className="mb-6 p-4 rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs space-y-3 animate-fade-in">
            <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
              <Monitor className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Panduan Layar Penuh Windows (Firefox / Chrome / Edge)</span>
            </div>
            <p className="text-slate-700 dark:text-zinc-300 leading-relaxed">
              Jika browser atau jendela iframe Windows Anda membatasi izin Fullscreen otomatis:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <div className="p-2.5 rounded-lg bg-white dark:bg-zinc-800/80 border border-amber-200/70 dark:border-amber-900/50 space-y-1">
                <span className="font-semibold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
                  ⌨️ Tekan tombol <strong>F11</strong> di Keyboard
                </span>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                  Tombol F11 akan langsung mengaktifkan mode layar penuh bawaan Windows secara instan.
                </p>
              </div>

              {isInIframe && (
                <div className="p-2.5 rounded-lg bg-white dark:bg-zinc-800/80 border border-amber-200/70 dark:border-amber-900/50 space-y-1">
                  <span className="font-semibold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
                    🌐 Buka di Tab Baru
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                    Buka halaman di jendela tab mandiri agar izin layar penuh tidak terhalang iframe.
                  </p>
                  <button
                    onClick={handleOpenNewTab}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                  >
                    Buka Tab Baru Sekarang <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {(isInIframe || isMobileDevice) && (
              <div className="pt-2 flex items-center justify-between border-t border-amber-200/60 dark:border-amber-800/40">
                <span className="text-[11px] text-slate-500">Perangkat sentuh / peramban khusus?</span>
                <button
                  onClick={handleBypassFullscreen}
                  className="text-xs font-bold text-amber-800 dark:text-amber-300 hover:underline cursor-pointer"
                >
                  Lanjutkan dengan Tampilan Fokus &rarr;
                </button>
              </div>
            )}
          </div>
        )}

        {fullscreenError && (
          <div className="mb-5 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs flex items-start gap-3 shadow-xs">
            <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-2 flex-1">
              <div>
                <p className="font-bold text-sm">Mode Layar Penuh Wajib Diaktifkan!</p>
                <p className="text-xs leading-relaxed opacity-95 mt-0.5">
                  {fullscreenError}
                </p>
              </div>
              {(isInIframe || isMobileDevice) && (
                <button
                  type="button"
                  onClick={handleBypassFullscreen}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs cursor-pointer transition-colors"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Mulai Ujian dengan Mode Fokus Aman (Layar Sentuh)
                </button>
              )}
            </div>
          </div>
        )}

        <div className="border-t border-slate-100 dark:border-zinc-800 pt-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-slate-500">
            {isFullscreenReady ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                {isSupported ? <CheckCircle2 className="w-4 h-4" /> : <Smartphone className="w-4 h-4 text-emerald-500" />}
                {isSupported ? 'Mode Layar Penuh Siap' : 'Mode Tampilan Seluler / Terfokus Siap'}
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-4 h-4" /> Mode Layar Penuh wajib aktif sebelum ujian dimulai
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
            {!isFullscreenReady && (
              <Button
                variant="outline"
                size="md"
                onClick={handleEnableFullscreen}
                className="w-full sm:w-auto text-xs font-semibold flex items-center gap-1.5"
                title="Aktifkan layar penuh sekarang atau gunakan F11"
              >
                <Maximize className="w-4 h-4 text-emerald-600" />
                Uji Layar Penuh (F11)
              </Button>
            )}

            <Button
              variant="primary"
              size="md"
              onClick={handleStartExamWithFullscreen}
              isLoading={isLoading || isAttemptingFullscreen}
              className="w-full sm:w-auto py-2.5 px-6 font-bold shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2"
            >
              <Play className="w-4 h-4 fill-current" />
              {isFullscreenReady ? 'Mulai Ujian Sekarang' : 'Mulai Ujian (Otomatis Layar Penuh)'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};
