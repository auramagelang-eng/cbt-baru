import React, { useEffect, useState } from 'react';
import { ShieldCheck, LogOut, Clock } from 'lucide-react';
import { User } from '../types/cbt';

export interface ExamTimersInfo {
  timeLeftSeconds: number;
  questionTimeLeft: number;
  isPerQuestionTimed?: boolean;
  questionNumber?: number;
  totalQuestions?: number;
}

interface NavbarProps {
  user: User | null;
  onLogout: () => void;
  onOpenMetricsModal?: () => void;
  onOpenCloudflareTab?: () => void;
  isCfConnected?: boolean;
  isFullscreenActive?: boolean;
  examTimers?: ExamTimersInfo | null;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  onLogout,
  examTimers = null,
}) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Format seconds to HH:MM:SS or MM:SS
  const formatTimerDisplay = (seconds: number) => {
    if (seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <header className="bg-zinc-900 border-b border-zinc-800 text-zinc-100 sticky top-0 z-40 select-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-4">
        {/* Minimal Brand */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-xs">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <span className="font-bold text-sm tracking-tight text-white">CBT Portal</span>
        </div>

        {/* Center: Exam Timer only when Participant is in Exam */}
        {user?.role === 'PARTICIPANT' && examTimers && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-xs font-mono font-semibold">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-zinc-400 text-[11px] hidden sm:inline">Sisa Waktu:</span>
            <span className={examTimers.timeLeftSeconds < 300 ? 'text-rose-400 font-bold animate-pulse' : 'text-emerald-400 font-bold'}>
              {formatTimerDisplay(examTimers.timeLeftSeconds)}
            </span>
          </div>
        )}

        {/* User Info & Actions */}
        <div className="flex items-center gap-3">
          {/* Subtle online status indicator dot */}
          <span
            className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`}
            title={isOnline ? 'Online' : 'Offline'}
          />

          {user && (
            <div className="flex items-center gap-2.5 pl-2 border-l border-zinc-800">
              <span className="text-xs font-medium text-zinc-200 hidden sm:inline">
                {user.name}
              </span>

              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 rounded-md transition-colors cursor-pointer"
                title="Keluar"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Keluar</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
