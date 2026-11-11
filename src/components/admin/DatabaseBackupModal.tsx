import React, { useState, useEffect, useRef } from 'react';
import {
  Database,
  Download,
  Upload,
  RefreshCw,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  HardDrive,
  Laptop,
  Layers,
  Users,
  FileQuestion,
  HelpCircle,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { api } from '../../services/api';

interface DatabaseBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataRestored?: () => void;
}

export const DatabaseBackupModal: React.FC<DatabaseBackupModalProps> = ({
  isOpen,
  onClose,
  onDataRestored,
}) => {
  const [serverStats, setServerStats] = useState<{
    examsCount: number;
    participantsCount: number;
    questionsCount: number;
    storage?: {
      mode?: string;
      pendingWrites?: number;
      failedWrites?: number;
    } | null;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshStats = async () => {
    setIsLoading(true);
    setStatusMessage(null);
    try {
      // Satu-satunya sumber data adalah database server (Supabase).
      // Browser tidak lagi menyimpan salinan bank soal/peserta.
      const res = await api.get('/database/stats');
      setServerStats(res.data.data);
    } catch (err: any) {
      console.error('Failed to load database stats:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshStats();
    }
  }, [isOpen]);

  const handleExportBackup = async () => {
    try {
      // Backup diambil dari database server, bukan dari localStorage browser.
      const res = await api.get('/database/backup');
      const json = JSON.stringify(res.data?.data ?? res.data, null, 2);
      const url = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
      const anchor = document.createElement('a');
      anchor.setAttribute('href', url);
      anchor.setAttribute('download', `cbt_database_backup_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setStatusMessage({
        type: 'success',
        text: 'File cadangan berhasil diunduh langsung dari database server.',
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: 'Gagal mengunduh file cadangan: ' + (err.response?.data?.error || err.message),
      });
    }
  };

  const handleForceSync = async () => {
    setIsSyncing(true);
    setStatusMessage(null);
    try {
      await api.get('/database/stats');
      setStatusMessage({
        type: 'success',
        text: 'Data terbaru berhasil dibaca langsung dari database server.',
      });
      await refreshStats();
      if (onDataRestored) onDataRestored();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: 'Gagal sinkronisasi: ' + (err.message || 'Terjadi kesalahan server'),
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setStatusMessage(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      // Pemulihan dikirim ke server; server menulis ke database permanen.
      await api.post('/database/sync-backup', {
        exams: parsed.exams || [],
        questionsByExamId: parsed.questionsByExamId || {},
        participants: parsed.participants || [],
      });

      setStatusMessage({
        type: 'success',
        text: 'Berhasil memulihkan database dari file cadangan! Seluruh soal dan peserta telah tersimpan.',
      });

      await refreshStats();
      if (onDataRestored) onDataRestored();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: 'Gagal memulihkan database: Format file JSON cadangan tidak valid.',
      });
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Pencadangan & Pemulihan Database CBT"
      size="xl"
    >
      <div className="space-y-6 text-xs">
        {/* Reassuring Banner */}
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 flex items-start gap-3">
          <ShieldCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-bold text-emerald-900 dark:text-emerald-200 text-sm">
              Data Dibaca &amp; Disimpan Hanya di Database
            </h4>
            <p className="text-emerald-800 dark:text-emerald-300/90 leading-relaxed text-xs">
              Aplikasi <strong>tidak lagi menyimpan bank soal atau peserta di browser</strong>. Semua perubahan langsung ditulis ke database (Supabase) dan setiap tampilan dibaca ulang dari database, sehingga soal yang sudah dihapus tidak muncul kembali dan soal baru tidak hilang saat server restart.
            </p>
          </div>
        </div>

        {/* Status Message */}
        {statusMessage && (
          <div
            className={`p-3 rounded-xl border flex items-center gap-2 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-300'
                : 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-300'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-medium">{statusMessage.text}</span>
          </div>
        )}

        {/* Comparison Grid: Server vs Browser Vault */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Server Storage Card */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700/60 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-700 pb-2.5">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="font-bold text-slate-800 dark:text-zinc-200">Database Server</span>
              </div>
              <Badge variant="blue">Aktif di Server</Badge>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex justify-between items-center text-slate-600 dark:text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" /> Total Sesi Ujian:
                </span>
                <span className="font-mono font-bold text-slate-900 dark:text-zinc-100">
                  {serverStats ? `${serverStats.examsCount} Ujian` : '...'}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-600 dark:text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <FileQuestion className="w-3.5 h-3.5" /> Total Bank Soal:
                </span>
                <span className="font-mono font-bold text-slate-900 dark:text-zinc-100">
                  {serverStats ? `${serverStats.questionsCount} Soal` : '...'}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-600 dark:text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Total Peserta:
                </span>
                <span className="font-mono font-bold text-slate-900 dark:text-zinc-100">
                  {serverStats ? `${serverStats.participantsCount} Peserta` : '...'}
                </span>
              </div>
            </div>
          </div>

          {/* Status Penyimpanan (tanpa salinan di browser) */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700/60 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-700 pb-2.5">
              <div className="flex items-center gap-2">
                <Laptop className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="font-bold text-slate-800 dark:text-zinc-200">Status Penyimpanan</span>
              </div>
              <Badge variant={serverStats?.storage?.mode === 'supabase' ? 'emerald' : 'amber'}>
                {serverStats?.storage?.mode === 'supabase' ? 'Supabase Aktif' : 'Database Belum Aktif'}
              </Badge>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex justify-between items-center text-slate-600 dark:text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" /> Mode Penyimpanan:
                </span>
                <span className="font-mono font-bold text-slate-900 dark:text-zinc-100">
                  {serverStats?.storage?.mode || '...'}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-600 dark:text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <FileQuestion className="w-3.5 h-3.5" /> Tulisan Tertunda:
                </span>
                <span className="font-mono font-bold text-slate-900 dark:text-zinc-100">
                  {serverStats?.storage?.pendingWrites ?? 0}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-600 dark:text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" /> Tulisan Gagal:
                </span>
                <span className="font-mono font-bold text-slate-900 dark:text-zinc-100">
                  {serverStats?.storage?.failedWrites ?? 0}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="pt-2 border-t border-slate-200 dark:border-zinc-700 space-y-3">
          <h4 className="font-bold text-slate-800 dark:text-zinc-200">Aksi Database & Pencadangan:</h4>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button
              variant="outline"
              onClick={handleForceSync}
              isLoading={isSyncing}
              className="flex items-center justify-center gap-2 py-2.5"
            >
              <RefreshCw className="w-4 h-4" />
              Sinkronkan Sekarang
            </Button>

            <Button
              variant="secondary"
              onClick={handleExportBackup}
              className="flex items-center justify-center gap-2 py-2.5"
            >
              <Download className="w-4 h-4" />
              Unduh Backup (JSON)
            </Button>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                isLoading={isLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 border-dashed"
              >
                <Upload className="w-4 h-4" />
                Pulihkan dari File
              </Button>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="p-3 bg-slate-100 dark:bg-zinc-800/80 rounded-xl text-[11px] text-slate-600 dark:text-zinc-400 space-y-1">
          <div className="font-semibold text-slate-700 dark:text-zinc-300 flex items-center gap-1">
            <HelpCircle className="w-3.5 h-3.5" /> Tips Penggunaan Cadangan:
          </div>
          <p>
            • Disarankan mengklik <strong>Unduh Backup (JSON)</strong> setelah selesai membuat bank soal besar atau mengimpor daftar peserta kelas baru sebagai arsip aman di laptop Anda.
          </p>
          <p>
            • Jika Anda berganti komputer/laptop pengawas, cukup buka aplikasi dan klik <strong>Pulihkan dari File</strong> untuk langsung mengisi seluruh bank soal dan akun peserta ke laptop baru.
          </p>
        </div>
      </div>
    </Modal>
  );
};
