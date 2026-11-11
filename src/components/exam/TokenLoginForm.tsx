import React, { useState } from 'react';
import { KeyRound, ShieldAlert, UserCheck } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { api } from '../../services/api';
import { User, Exam } from '../../types/cbt';

interface TokenLoginFormProps {
  onSuccess: (user: User, exam: Exam, token: string) => void;
  onAdminLoginClick: () => void;
}

export const TokenLoginForm: React.FC<TokenLoginFormProps> = ({
  onSuccess,
  onAdminLoginClick,
}) => {
  const [participantToken, setParticipantToken] = useState('');
  const [examToken, setExamToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const getDeviceId = () => {
    let devId = localStorage.getItem('cbt_device_id');
    if (!devId) {
      devId = 'dev_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
      localStorage.setItem('cbt_device_id', devId);
    }
    return devId;
  };

  const handleVerifyToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);

    try {
      const res = await api.post('/auth/participant-verify', {
        token: participantToken.trim(),
        examToken: examToken.trim(),
        deviceId: getDeviceId(),
      });

      const { user, exam, token } = res.data;
      localStorage.setItem('cbt_auth_token', token);
      localStorage.setItem('cbt_user', JSON.stringify(user));
      onSuccess(user, exam, token);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Token Peserta atau Token Ujian tidak valid.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="border-slate-200 dark:border-zinc-800 shadow-lg">
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-3 shadow-inner">
              <KeyRound className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100">Verifikasi Ujian CBT</h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
              Masukkan Token Peserta dan Token Ujian untuk memulai ujian
            </p>
          </div>

          {errorMsg && (
            <div className="mb-4 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleVerifyToken} className="space-y-4">

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                Token Peserta
              </label>
              <input
                type="text"
                required
                value={participantToken}
                onChange={(e) => setParticipantToken(e.target.value)}
                placeholder="Masukkan Token Peserta..."
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-emerald-500 uppercase tracking-wide font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                Token Ujian
              </label>
              <input
                type="text"
                required
                value={examToken}
                onChange={(e) => setExamToken(e.target.value)}
                placeholder="Masukkan Token Ujian..."
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-emerald-500 uppercase tracking-wide font-mono"
              />
            </div>

            <Button type="submit" variant="primary" className="w-full py-2.5" isLoading={isLoading}>
              <UserCheck className="w-4 h-4" />
              Verifikasi & Masuk Ujian
            </Button>
          </form>

          <div className="mt-6 text-center pt-4 border-t border-slate-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={onAdminLoginClick}
              className="text-xs text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 font-medium underline cursor-pointer"
            >
              Masuk sebagai Pengawas / Admin Ujian
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
};
