import React, { useEffect } from 'react';
import { ShieldAlert, Maximize, AlertOctagon, ShieldCheck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { AntiCheatEngine } from '../../services/antiCheat';

interface AntiCheatOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  violation: { type: string; details: string } | null;
  violationsCount: number;
  maxViolations: number;
  onFullscreenRestored?: () => void;
}

export const AntiCheatOverlay: React.FC<AntiCheatOverlayProps> = ({
  isOpen,
  onClose,
  violation,
  violationsCount,
  maxViolations,
  onFullscreenRestored,
}) => {
  const isThresholdReached = violationsCount >= maxViolations;
  const isFullscreenExit = violation?.type === 'FULLSCREEN_EXIT';

  useEffect(() => {
    AntiCheatEngine.setModalOpen(isOpen);
  }, [isOpen]);

  const handleReturnToFullscreen = async () => {
    try {
      await AntiCheatEngine.requestFullscreen();
    } catch {
      // Ignore request failure
    }

    // If native fullscreen was blocked by browser/device policy or iframe,
    // automatically activate Focus Mode so student can continue without being stuck in a violation loop
    if (!AntiCheatEngine.isFullscreenActive()) {
      AntiCheatEngine.setFocusMode(true);
    }

    AntiCheatEngine.setModalOpen(false);
    if (onFullscreenRestored) {
      onFullscreenRestored();
    }
    onClose();
  };

  const handleContinueWithFocusMode = () => {
    AntiCheatEngine.setFocusMode(true);
    AntiCheatEngine.setModalOpen(false);
    if (onFullscreenRestored) {
      onFullscreenRestored();
    }
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={isThresholdReached ? onClose : handleReturnToFullscreen}
      title={
        isThresholdReached
          ? 'Pelanggaran Maksimal - Auto Submit'
          : isFullscreenExit
          ? 'Pelanggaran: Keluar dari Layar Penuh!'
          : 'Peringatan Anti-Kecurangan'
      }
      maxWidth="md"
      disableCloseButton={!isThresholdReached}
      disableEscClose={!isThresholdReached}
      footer={
        !isThresholdReached ? (
          <div className="w-full space-y-2">
            <Button
              variant="warning"
              size="lg"
              onClick={handleReturnToFullscreen}
              className="w-full py-3 font-bold flex items-center justify-center gap-2 shadow-md shadow-amber-500/20 cursor-pointer"
            >
              <Maximize className="w-5 h-5" />
              Kembali ke Layar Penuh & Lanjutkan Ujian
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleContinueWithFocusMode}
              className="w-full py-2 text-xs font-semibold text-slate-600 dark:text-zinc-300 border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              Lanjutkan dengan Mode Fokus (Jika Layar Penuh Diblokir Browser)
            </Button>
            <p className="text-[11px] text-center text-slate-500 dark:text-zinc-400">
              Pengguna Windows juga dapat menekan tombol <strong>F11</strong> di keyboard.
            </p>
          </div>
        ) : null
      }
    >
      <div className="space-y-4 text-center py-2">
        <div
          className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto ${
            isThresholdReached
              ? 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400'
              : 'bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400'
          }`}
        >
          {isThresholdReached ? (
            <AlertOctagon className="w-8 h-8" />
          ) : isFullscreenExit ? (
            <Maximize className="w-8 h-8 animate-pulse text-amber-600 dark:text-amber-400" />
          ) : (
            <ShieldAlert className="w-8 h-8" />
          )}
        </div>

        <div>
          <h4 className="text-base font-bold text-slate-900 dark:text-zinc-100">
            {isThresholdReached
              ? 'Ujian Anda Dihentikan Otomatis'
              : isFullscreenExit
              ? 'Terdeteksi Keluar dari Mode Layar Penuh!'
              : 'Aktivitas Mencurigakan Terdeteksi!'}
          </h4>
          <p className="text-xs text-slate-600 dark:text-zinc-300 mt-1 font-medium">
            {violation?.details || 'Terdeteksi keluar dari layar ujian.'}
          </p>
        </div>

        {/* Primary Action Button directly inside dialog for immediate return */}
        {!isThresholdReached && isFullscreenExit && (
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/80 text-center space-y-2.5">
            <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
              Untuk melanjutkan pengerjaan soal ujian, klik tombol di bawah ini:
            </p>
            <div className="space-y-2">
              <Button
                variant="warning"
                size="lg"
                onClick={handleReturnToFullscreen}
                className="w-full py-3 text-sm font-bold shadow-md shadow-amber-500/25 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Maximize className="w-5 h-5" />
                Kembali ke Layar Penuh Sekarang
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleContinueWithFocusMode}
                className="w-full py-2 text-xs font-semibold text-slate-700 dark:text-zinc-200 border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                Lanjutkan dengan Mode Fokus (Jika Layar Penuh Bermasalah)
              </Button>
            </div>
          </div>
        )}

        <div className="p-3 bg-slate-50 dark:bg-zinc-800/80 rounded-xl border border-slate-200/80 dark:border-zinc-700/80 text-xs">
          <div className="flex items-center justify-between font-semibold">
            <span>Jumlah Pelanggaran Tercatat:</span>
            <span className="text-rose-600 dark:text-rose-400 font-bold font-mono text-sm">
              {violationsCount} / {maxViolations}
            </span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-zinc-700 h-2 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${isThresholdReached ? 'bg-rose-600' : 'bg-amber-500'}`}
              style={{ width: `${Math.min(100, (violationsCount / maxViolations) * 100)}%` }}
            />
          </div>
        </div>

        {isThresholdReached ? (
          <p className="text-xs text-rose-600 font-medium">
            Sistem telah melakukan Auto-Submit pada ujian Anda. Jawaban hingga titik ini telah disimpan dengan aman di server.
          </p>
        ) : (
          <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed">
            Peringatan: Jika pelanggaran mencapai {maxViolations} kali, sistem akan mematikan ujian dan melakukan Auto-Submit secara otomatis!
          </p>
        )}
      </div>
    </Modal>
  );
};
