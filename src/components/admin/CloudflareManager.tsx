import React, { useState, useEffect } from 'react';
import {
  Cloud,
  Database,
  Link2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  UploadCloud,
  DownloadCloud,
  Copy,
  Check,
  ExternalLink,
  Layers,
  Users,
  FileQuestion,
  Award,
  Activity,
  Terminal,
  Key,
  Zap,
  Clock,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Server,
  Settings,
  Trash2,
  Info,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { CodeBlock } from '../ui/CodeBlock';
import { api } from '../../services/api';

interface CloudflareConfigState {
  enabled: boolean;
  mode: 'D1_DIRECT' | 'WORKER';
  accountEmail?: string;
  accountId: string;
  databaseId: string;
  apiToken: string;
  workerUrl: string;
  workerAuthSecret: string;
  autoSync: boolean;
  syncIntervalMinutes: number;
}

interface CloudflareStatusState {
  connected: boolean;
  mode: string;
  accountEmail?: string;
  latencyMs: number;
  lastSyncAt: string | null;
  tablesStatus: {
    exams: number;
    participants: number;
    questions: number;
    sessions: number;
    results: number;
    violations: number;
  };
  error?: string;
  isAutoSyncActive: boolean;
}

export const CloudflareManager: React.FC = () => {
  const [config, setConfig] = useState<CloudflareConfigState>({
    enabled: false,
    mode: 'D1_DIRECT',
    accountId: '',
    databaseId: '',
    apiToken: '',
    workerUrl: '',
    workerAuthSecret: '',
    autoSync: true,
    syncIntervalMinutes: 5,
  });

  const [status, setStatus] = useState<CloudflareStatusState | null>(null);
  const [localStats, setLocalStats] = useState<{
    examsCount: number;
    participantsCount: number;
    questionsCount: number;
  } | null>(null);

  const [schemaSql, setSchemaSql] = useState<string>('');
  const [workerCode, setWorkerCode] = useState<string>('');

  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isWiping, setIsWiping] = useState(false);
  const [autoToken, setAutoToken] = useState('');
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);

  const [alert, setAlert] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedWorker, setCopiedWorker] = useState(false);
  const [showSqlGuide, setShowSqlGuide] = useState(false);
  const [showWorkerGuide, setShowWorkerGuide] = useState(false);

  const handleAutoConnect = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!autoToken.trim()) {
      setAlert({ type: 'error', message: 'Masukkan string API Token Cloudflare Anda terlebih dahulu.' });
      return;
    }
    setIsAutoConnecting(true);
    setAlert(null);
    try {
      const res = await api.post('/cloudflare/auto-connect', { token: autoToken.trim() });
      setAlert({
        type: 'success',
        message: res.data.message || 'Berhasil menyambungkan ke Cloudflare D1 secara otomatis!',
      });
      setAutoToken('');
      await loadData();
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.response?.data?.error || 'Gagal menyambungkan ke Cloudflare API. Pastikan token aktif dan memiliki izin D1.',
      });
    } finally {
      setIsAutoConnecting(false);
    }
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [configRes, statusRes, statsRes, sqlRes, workerRes] = await Promise.allSettled([
        api.get('/cloudflare/config'),
        api.get('/cloudflare/status'),
        api.get('/database/stats'),
        api.get('/cloudflare/schema-sql'),
        api.get('/cloudflare/worker-code'),
      ]);

      if (configRes.status === 'fulfilled' && configRes.value.data.data) {
        setConfig((prev) => ({ ...prev, ...configRes.value.data.data }));
      }
      if (statusRes.status === 'fulfilled' && statusRes.value.data.data) {
        setStatus(statusRes.value.data.data);
      }
      if (statsRes.status === 'fulfilled' && statsRes.value.data.data) {
        setLocalStats(statsRes.value.data.data);
      }
      if (sqlRes.status === 'fulfilled' && sqlRes.value.data.sql) {
        setSchemaSql(sqlRes.value.data.sql);
      }
      if (workerRes.status === 'fulfilled' && workerRes.value.data.code) {
        setWorkerCode(workerRes.value.data.code);
      }
    } catch (e: any) {
      console.error('Failed to load Cloudflare settings:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(async () => {
      try {
        const res = await api.get('/cloudflare/status');
        setStatus(res.data.data);
      } catch {}
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setAlert(null);
    try {
      const res = await api.post('/cloudflare/config', config);
      setConfig(res.data.data);
      setAlert({
        type: 'success',
        message: 'Konfigurasi Cloudflare berhasil disimpan! Silakan klik "Uji Koneksi" untuk memverifikasi tautan.',
      });
      // Refresh status immediately
      const statusRes = await api.get('/cloudflare/status');
      setStatus(statusRes.data.data);
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.response?.data?.error || 'Gagal menyimpan konfigurasi Cloudflare.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setAlert(null);
    try {
      const res = await api.post('/cloudflare/test');
      const data = res.data.data;
      if (data.success) {
        setAlert({
          type: 'success',
          message: `${data.message} Latensi respon: ${data.latencyMs} ms. Tabel terdeteksi: ${
            data.tablesFound.length > 0 ? data.tablesFound.join(', ') : 'Belum ada tabel (Klik Inisialisasi Skema)'
          }`,
        });
      } else {
        setAlert({
          type: 'error',
          message: data.message || 'Koneksi ke Cloudflare gagal.',
        });
      }
      const statusRes = await api.get('/cloudflare/status');
      setStatus(statusRes.data.data);
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.response?.data?.error || 'Gagal terhubung ke Cloudflare API. Periksa Token & Account ID Anda.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleInitSchema = async () => {
    if (
      !confirm(
        'Inisialisasi Skema akan membuat tabel relasional di Cloudflare D1 (exams, questions, participants, sessions, results, participant_answers, violation_logs). Lanjutkan?'
      )
    ) {
      return;
    }

    setIsInitializing(true);
    setAlert(null);
    try {
      const res = await api.post('/cloudflare/init-schema');
      setAlert({
        type: 'success',
        message: res.data.message || 'Skema tabel relasional berhasil dibuat di Cloudflare D1!',
      });
      const statusRes = await api.get('/cloudflare/status');
      setStatus(statusRes.data.data);
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.response?.data?.error || 'Gagal membuat skema tabel di Cloudflare D1.',
      });
    } finally {
      setIsInitializing(false);
    }
  };

  const handlePushAll = async () => {
    if (
      !confirm(
        'Unggah seluruh data lokal saat ini (Bank Soal, Peserta, Sesi, dan Hasil Ujian) ke database Cloudflare D1? Data di Cloudflare akan diperbarui.'
      )
    ) {
      return;
    }

    setIsPushing(true);
    setAlert(null);
    try {
      const res = await api.post('/cloudflare/push-all');
      const d = res.data.data;
      setAlert({
        type: 'success',
        message: `Sinkronisasi Berhasil! Tersimpan ke Cloudflare D1: ${d.syncedExams} Ujian, ${d.syncedQuestions} Soal, ${d.syncedParticipants} Peserta, ${d.syncedSessions} Sesi, dan ${d.syncedViolations} Pelanggaran.`,
      });
      const statusRes = await api.get('/cloudflare/status');
      setStatus(statusRes.data.data);
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.response?.data?.error || 'Gagal mengunggah data ke Cloudflare D1.',
      });
    } finally {
      setIsPushing(false);
    }
  };

  const handlePullAll = async () => {
    if (
      !confirm(
        'Tarik seluruh data dari Cloudflare D1 ke dalam sistem CBT lokal ini? Ini akan memulihkan ujian, soal, peserta, dan hasil yang tersimpan di Cloudflare.'
      )
    ) {
      return;
    }

    setIsPulling(true);
    setAlert(null);
    try {
      const res = await api.post('/cloudflare/pull-all');
      setAlert({
        type: 'success',
        message: res.data.message || 'Data berhasil ditarik dan dipulihkan dari Cloudflare D1!',
      });
      const statsRes = await api.get('/database/stats');
      setLocalStats(statsRes.data.data);
      const statusRes = await api.get('/cloudflare/status');
      setStatus(statusRes.data.data);
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.response?.data?.error || 'Gagal menarik data dari Cloudflare D1.',
      });
    } finally {
      setIsPulling(false);
    }
  };

  const handleWipeCloudflare = async () => {
    if (
      !confirm(
        'PERINGATAN: Apakah Anda yakin ingin MENGHAPUS SEMUA DATA di database Cloudflare D1 (soal, peserta, sesi, hasil, dan log pelanggaran)? Tindakan ini tidak dapat dibatalkan.'
      )
    ) {
      return;
    }

    setIsWiping(true);
    setAlert(null);
    try {
      const res = await api.post('/cloudflare/wipe-all');
      setAlert({
        type: 'success',
        message: res.data.message || 'Semua data di database Cloudflare D1 berhasil dikosongkan total.',
      });
      const statsRes = await api.get('/database/stats');
      setLocalStats(statsRes.data.data);
      const statusRes = await api.get('/cloudflare/status');
      setStatus(statusRes.data.data);
    } catch (err: any) {
      setAlert({
        type: 'error',
        message: err.response?.data?.error || 'Gagal mengosongkan data Cloudflare D1.',
      });
    } finally {
      setIsWiping(false);
    }
  };

  const handleCopy = (text: string, type: 'sql' | 'worker') => {
    navigator.clipboard.writeText(text);
    if (type === 'sql') {
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2000);
    } else {
      setCopiedWorker(true);
      setTimeout(() => setCopiedWorker(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Hero Card */}
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-r from-amber-500/10 via-orange-500/10 to-amber-600/10 border border-amber-300 dark:border-amber-800/60 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/30">
              <Cloud className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-slate-900 dark:text-zinc-100">
                  Tautan Cloudflare Database (D1 & Edge Workers)
                </h3>
                <Badge variant={status?.connected ? 'emerald' : 'amber'} size="sm">
                  {status?.connected ? 'Tersambung (Online)' : 'Belum Terhubung'}
                </Badge>
              </div>
              <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1 max-w-2xl leading-relaxed">
                Menghubungkan aplikasi CBT dengan <strong>Cloudflare D1</strong> (Serverless Relational SQL SQLite di Edge) untuk menyimpan seluruh entitas ujian: <strong>Peserta</strong>, <strong>Bank Soal</strong>, <strong>Hasil Ujian</strong>, <strong>Sesi Ujian</strong>, <strong>Jawaban Detail</strong>, dan <strong>Log Pelanggaran</strong> secara terstruktur dan tahan restart server.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestConnection}
              isLoading={isTesting}
              className="flex items-center gap-1.5 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40"
            >
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span>Uji Koneksi</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handlePushAll}
              isLoading={isPushing}
              disabled={!status?.connected && !config.enabled}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>Unggah Semua ke Cloudflare</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Alert Banner */}
      {alert && (
        <div
          className={`p-4 rounded-xl border flex items-start gap-3 transition-all ${
            alert.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : alert.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              : 'bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-200'
          }`}
        >
          {alert.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          )}
          <div className="text-xs font-medium leading-relaxed flex-1">{alert.message}</div>
          <button
            onClick={() => setAlert(null)}
            className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 ml-2"
          >
            ×
          </button>
        </div>
      )}

      {/* Informational Callout */}
      <div className="p-3.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-3">
        <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-amber-950 dark:text-amber-100">
            Panduan Penting Penyimpanan Cloudflare D1
          </div>
          <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
            Data bank soal, peserta, dan hasil ujian tersimpan aman di <strong>Database Server & Edge D1</strong>. Untuk menyambungkan langsung ke Cloudflare D1 di akun <strong>dash.cloudflare.com</strong> Anda (agar tersimpan di cloud global Cloudflare), masukkan <strong>Account ID</strong>, <strong>Database ID</strong>, dan <strong>API Token</strong> resmi dari dashboard Cloudflare Anda pada form di bawah.
          </p>
        </div>
      </div>

      {/* Grid: Live Connection Status & Entity Row Counts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Connection Diagnostics Card */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-zinc-800">
            <span className="text-xs font-bold text-slate-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Link2 className="w-4 h-4 text-amber-500" />
              Status Tautan Cloudflare
            </span>
            <Badge variant={status?.connected ? 'emerald' : 'rose'} size="sm">
              {status?.connected ? 'Aktif' : 'Terputus / Belum Disetel'}
            </Badge>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center text-slate-600 dark:text-zinc-400">
              <span>Akun Cloudflare:</span>
              <span className="font-semibold text-amber-600 dark:text-amber-400 font-mono text-[11px]">
                {status?.accountEmail || config.accountEmail || 'aura.magelang@gmail.com'}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-600 dark:text-zinc-400">
              <span>Mode Koneksi:</span>
              <span className="font-semibold text-slate-900 dark:text-zinc-100">
                {config.mode === 'D1_DIRECT' ? 'Cloudflare D1 REST API' : 'Worker Proxy API'}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-600 dark:text-zinc-400">
              <span>Latensi Respon (Ping):</span>
              <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                {status?.latencyMs ? `${status.latencyMs} ms` : '-'}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-600 dark:text-zinc-400">
              <span>Auto-Sync Otomatis:</span>
              <span className="font-semibold">
                {config.autoSync ? (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                    Aktif (Tiap Submit/Save)
                  </span>
                ) : (
                  <span className="text-slate-400">Non-aktif</span>
                )}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-600 dark:text-zinc-400">
              <span>Sinkronisasi Terakhir:</span>
              <span className="font-mono text-[11px] text-slate-700 dark:text-zinc-300">
                {status?.lastSyncAt ? new Date(status.lastSyncAt).toLocaleTimeString('id-ID') : 'Belum pernah'}
              </span>
            </div>
          </div>
        </Card>

        {/* Database Comparison: Local vs Cloudflare D1 Card */}
        <Card className="p-4 space-y-3 md:col-span-2">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-zinc-800">
            <span className="text-xs font-bold text-slate-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Database className="w-4 h-4 text-emerald-500" />
              Perbandingan Entitas Relasional (Lokal vs Cloudflare D1)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={loadData}
                isLoading={isLoading}
                className="h-7 text-xs flex items-center gap-1"
                title="Muat ulang jumlah data"
              >
                <RefreshCw className="w-3 h-3" />
                Segarkan
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
            {/* Peserta */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700/60">
              <div className="text-[11px] text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-indigo-500" />
                Peserta Ujian
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
                  Lokal: {localStats?.participantsCount || 0}
                </span>
                <span className="font-mono font-bold text-sm text-indigo-600 dark:text-indigo-400">
                  CF: {status?.tablesStatus?.participants ?? 0}
                </span>
              </div>
            </div>

            {/* Bank Soal */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700/60">
              <div className="text-[11px] text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                <FileQuestion className="w-3.5 h-3.5 text-teal-500" />
                Bank Soal
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
                  Lokal: {localStats?.questionsCount || 0}
                </span>
                <span className="font-mono font-bold text-sm text-teal-600 dark:text-teal-400">
                  CF: {status?.tablesStatus?.questions ?? 0}
                </span>
              </div>
            </div>

            {/* Sesi & Ujian */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700/60">
              <div className="text-[11px] text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-amber-500" />
                Sesi Ujian
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
                  Lokal: {localStats?.examsCount || 0}
                </span>
                <span className="font-mono font-bold text-sm text-amber-600 dark:text-amber-400">
                  CF: {status?.tablesStatus?.exams ?? 0}
                </span>
              </div>
            </div>

            {/* Hasil Ujian */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700/60">
              <div className="text-[11px] text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                <Award className="w-3.5 h-3.5 text-emerald-500" />
                Hasil & Nilai
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-zinc-300">Tersimpan:</span>
                <span className="font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400">
                  CF: {status?.tablesStatus?.results ?? 0}
                </span>
              </div>
            </div>

            {/* Sesi Berjalan */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700/60">
              <div className="text-[11px] text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                <Activity className="w-3.5 h-3.5 text-sky-500" />
                Sesi Aktif
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-zinc-300">Attempts:</span>
                <span className="font-mono font-bold text-sm text-sky-600 dark:text-sky-400">
                  CF: {status?.tablesStatus?.sessions ?? 0}
                </span>
              </div>
            </div>

            {/* Log Pelanggaran */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700/60">
              <div className="text-[11px] text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-rose-500" />
                Pelanggaran
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-zinc-300">Anti-Cheat:</span>
                <span className="font-mono font-bold text-sm text-rose-600 dark:text-rose-400">
                  CF: {status?.tablesStatus?.violations ?? 0}
                </span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Sync Operations Action Bar */}
      <Card className="p-4 bg-slate-50/50 dark:bg-zinc-900/60 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 className="text-xs font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              Operasi Database & Sinkronisasi Data Relasional
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400">
              Jalankan inisialisasi tabel, unggah data saat ini, atau tarik cadangan dari Cloudflare D1
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleInitSchema}
              isLoading={isInitializing}
              className="flex items-center gap-1.5 text-xs"
              title="Buat tabel relasional di Cloudflare D1"
            >
              <Terminal className="w-3.5 h-3.5 text-indigo-500" />
              Inisialisasi Skema D1
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handlePullAll}
              isLoading={isPulling}
              className="flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-800"
              title="Tarik data dari Cloudflare D1 ke server lokal"
            >
              <DownloadCloud className="w-3.5 h-3.5 text-sky-500" />
              Tarik dari Cloudflare
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={handlePushAll}
              isLoading={isPushing}
              className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-white"
              title="Unggah semua data peserta, soal, dan hasil ke Cloudflare D1"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              Unggah Semua ke Cloudflare
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleWipeCloudflare}
              isLoading={isWiping}
              className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              title="Kosongkan seluruh data di Cloudflare D1"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
              Kosongkan D1
            </Button>
          </div>
        </div>
      </Card>

      {/* Auto-Connect with Token Card */}
      <Card className="p-5 space-y-4 border-amber-300 dark:border-amber-800/80 bg-gradient-to-r from-amber-500/5 via-transparent to-amber-500/5">
        <div className="flex items-center justify-between pb-3 border-b border-amber-200 dark:border-amber-900/60">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-zinc-100">
              Sambungkan Otomatis dengan API Token Cloudflare (1-Klik)
            </h4>
          </div>
          <Badge variant="amber" size="sm">Metode Tercepat</Badge>
        </div>

        <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
          Cukup tempelkan <strong>Secret API Token</strong> yang baru saja dibuat di Cloudflare Dashboard (bernama <code className="px-1 py-0.5 bg-slate-100 dark:bg-zinc-800 rounded font-mono font-bold">quiz</code>). Sistem akan otomatis mendeteksi Account ID Anda, menyiapkan database D1, membuat tabel relasional, dan menyinkronkan seluruh soal & peserta secara langsung.
        </p>

        <form onSubmit={handleAutoConnect} className="flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            value={autoToken}
            onChange={(e) => setAutoToken(e.target.value)}
            placeholder="Tempel string API Token Cloudflare di sini (contoh: xK89...)"
            className="flex-1 px-3.5 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <Button
            type="submit"
            variant="primary"
            isLoading={isAutoConnecting}
            className="bg-amber-600 hover:bg-amber-700 text-white text-xs shrink-0 flex items-center justify-center gap-1.5"
          >
            <Zap className="w-3.5 h-3.5" />
            Sambungkan Otomatis
          </Button>
        </form>
      </Card>

      {/* Configuration Form */}
      <Card className="p-5 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-slate-600 dark:text-zinc-400" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-zinc-200">
              Pengaturan Kredensial Cloudflare
            </h4>
          </div>
          <Badge variant={config.enabled ? 'emerald' : 'zinc'} size="sm">
            {config.enabled ? 'Integrasi Diaktifkan' : 'Integrasi Dimatikan'}
          </Badge>
        </div>

        <form onSubmit={handleSaveConfig} className="space-y-4">
          {/* Enable Toggle & Mode Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800/40 flex items-center justify-between">
              <div>
                <label className="text-xs font-bold text-slate-800 dark:text-zinc-200 block">
                  Aktifkan Integrasi Cloudflare
                </label>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                  Simpan data ujian & peserta ke Cloudflare
                </p>
              </div>
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500 cursor-pointer"
              />
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800/40 flex items-center justify-between">
              <div>
                <label className="text-xs font-bold text-slate-800 dark:text-zinc-200 block">
                  Simpan Otomatis (Auto-Sync)
                </label>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                  Sinkronkan otomatis setiap submit/perubahan
                </p>
              </div>
              <input
                type="checkbox"
                checked={config.autoSync}
                onChange={(e) => setConfig({ ...config, autoSync: e.target.checked })}
                className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500 cursor-pointer"
              />
            </div>
          </div>

          {/* Mode Selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 dark:text-zinc-300">
              Metode Koneksi Cloudflare:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label
                className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                  config.mode === 'D1_DIRECT'
                    ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200'
                    : 'border-slate-200 dark:border-zinc-700 hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="cf_mode"
                  value="D1_DIRECT"
                  checked={config.mode === 'D1_DIRECT'}
                  onChange={() => setConfig({ ...config, mode: 'D1_DIRECT' })}
                  className="mt-0.5 text-amber-600"
                />
                <div>
                  <div className="text-xs font-bold flex items-center gap-1.5">
                    Cloudflare D1 REST API <Badge variant="emerald" size="sm">Direkomendasikan</Badge>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                    Koneksi langsung ke database D1 menggunakan Account ID, Database ID & API Token resmi.
                  </div>
                </div>
              </label>

              <label
                className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                  config.mode === 'WORKER'
                    ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200'
                    : 'border-slate-200 dark:border-zinc-700 hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="cf_mode"
                  value="WORKER"
                  checked={config.mode === 'WORKER'}
                  onChange={() => setConfig({ ...config, mode: 'WORKER' })}
                  className="mt-0.5 text-amber-600"
                />
                <div>
                  <div className="text-xs font-bold">Cloudflare Worker API Endpoint</div>
                  <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                    Menggunakan Cloudflare Worker custom (URL endpoint + secret token) sebagai proxy edge.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* D1 Direct Fields */}
          {config.mode === 'D1_DIRECT' && (
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1 block">
                    Cloudflare Account ID:
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d"
                    value={config.accountId}
                    onChange={(e) => setConfig({ ...config, accountId: e.target.value })}
                    className="w-full text-xs font-mono p-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <span className="text-[10px] text-slate-400">Ditemukan di URL Cloudflare dashboard atau overview</span>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1 block">
                    Cloudflare D1 Database ID:
                  </label>
                  <input
                    type="text"
                    placeholder="Contoh: 8f49a623-1f29-4b19-94b2-0941d40c7493"
                    value={config.databaseId}
                    onChange={(e) => setConfig({ ...config, databaseId: e.target.value })}
                    className="w-full text-xs font-mono p-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <span className="text-[10px] text-slate-400">UUID database D1 yang Anda buat di Cloudflare</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1 block">
                  Cloudflare API Token (Bearer Token):
                </label>
                <div className="relative">
                  <input
                    type="password"
                    placeholder="Masukkan API Token dengan izin D1:Edit..."
                    value={config.apiToken}
                    onChange={(e) => setConfig({ ...config, apiToken: e.target.value })}
                    className="w-full text-xs font-mono p-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <span className="text-[10px] text-slate-400">
                  Dibuat di Cloudflare: My Profile &rarr; API Tokens &rarr; Create Token (Template: D1 / Permissions: Account: D1:Edit)
                </span>
              </div>
            </div>
          )}

          {/* Worker Fields */}
          {config.mode === 'WORKER' && (
            <div className="space-y-3 pt-2">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1 block">
                  Cloudflare Worker URL:
                </label>
                <input
                  type="text"
                  placeholder="https://cbt-database-worker.username.workers.dev"
                  value={config.workerUrl}
                  onChange={(e) => setConfig({ ...config, workerUrl: e.target.value })}
                  className="w-full text-xs font-mono p-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1 block">
                  Worker Auth Secret / Bearer Token (Opsional):
                </label>
                <input
                  type="password"
                  placeholder="Secret key pengaman akses Worker..."
                  value={config.workerAuthSecret}
                  onChange={(e) => setConfig({ ...config, workerAuthSecret: e.target.value })}
                  className="w-full text-xs font-mono p-2.5 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
          )}

          {/* Save Button */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-zinc-800">
            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              isLoading={isTesting}
              className="text-xs"
            >
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              Uji Koneksi
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={isSaving}
              className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Check className="w-3.5 h-3.5" />
              Simpan Konfigurasi
            </Button>
          </div>
        </form>
      </Card>

      {/* Panduan 1-Menit Setup Cloudflare D1 */}
      <Card className="p-5 space-y-4 bg-linear-to-b from-slate-50 to-white dark:from-zinc-900/60 dark:to-zinc-900 border-slate-200 dark:border-zinc-800">
        <h4 className="text-sm font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-2">
          <Server className="w-4 h-4 text-indigo-500" />
          Panduan Cepat Menghubungkan Cloudflare D1 (Langkah Demi Langkah)
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-white dark:bg-zinc-800/80 border border-slate-200 dark:border-zinc-700 space-y-1">
            <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold inline-flex items-center justify-center text-[10px]">
              1
            </span>
            <div className="font-bold text-slate-800 dark:text-zinc-200 mt-1">Buat D1 Database</div>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400">
              Buka dash.cloudflare.com &rarr; <em>Storage & Databases</em> &rarr; <em>D1 SQL Database</em> &rarr; <em>Create Database</em> (nama: <code>cbt-db</code>).
            </p>
          </div>

          <div className="p-3 rounded-xl bg-white dark:bg-zinc-800/80 border border-slate-200 dark:border-zinc-700 space-y-1">
            <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold inline-flex items-center justify-center text-[10px]">
              2
            </span>
            <div className="font-bold text-slate-800 dark:text-zinc-200 mt-1">Salin Account & Database ID</div>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400">
              Salin <strong>Account ID</strong> dan <strong>Database ID</strong> dari dashboard Cloudflare ke form pengaturan di atas.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-white dark:bg-zinc-800/80 border border-slate-200 dark:border-zinc-700 space-y-1">
            <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold inline-flex items-center justify-center text-[10px]">
              3
            </span>
            <div className="font-bold text-slate-800 dark:text-zinc-200 mt-1">Buat API Token</div>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400">
              Di <em>My Profile &rarr; API Tokens &rarr; Create Token</em>, pilih hak akses <strong>D1: Edit</strong> untuk akun Anda.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-white dark:bg-zinc-800/80 border border-slate-200 dark:border-zinc-700 space-y-1">
            <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold inline-flex items-center justify-center text-[10px]">
              4
            </span>
            <div className="font-bold text-slate-800 dark:text-zinc-200 mt-1">Inisialisasi & Simpan</div>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400">
              Klik <strong>Simpan Konfigurasi</strong>, lalu klik <strong>Inisialisasi Skema D1</strong> untuk membangun seluruh relasi tabel.
            </p>
          </div>
        </div>

        {/* Collapsible: Skrip Skema SQL Cloudflare D1 */}
        <div className="border border-slate-200 dark:border-zinc-700/80 rounded-xl overflow-hidden pt-1">
          <button
            type="button"
            onClick={() => setShowSqlGuide(!showSqlGuide)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800/50 cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-indigo-500" />
              Lihat Skrip SQL Relasional D1 (CREATE TABLE, FOREIGN KEYS & INDEKS)
            </span>
            {showSqlGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showSqlGuide && (
            <div className="p-4 border-t border-slate-200 dark:border-zinc-700/80 bg-slate-900 text-zinc-100 text-xs space-y-2">
              <div className="flex items-center justify-between pb-2">
                <span className="text-[11px] text-zinc-400">
                  Skrip DDL ini dieksekusi otomatis oleh tombol <em>Inisialisasi Skema D1</em> atau dapat dijalankan via Cloudflare Console / Wrangler CLI.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopy(schemaSql, 'sql')}
                  className="h-7 text-xs flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-600"
                >
                  {copiedSql ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedSql ? 'Tersalin!' : 'Salin SQL'}
                </Button>
              </div>
              <pre className="max-h-72 overflow-y-auto p-3 rounded-lg bg-zinc-950 font-mono text-[11px] text-zinc-300 leading-relaxed">
                {schemaSql}
              </pre>
            </div>
          )}
        </div>

        {/* Collapsible: Cloudflare Worker Alternative Script */}
        <div className="border border-slate-200 dark:border-zinc-700/80 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowWorkerGuide(!showWorkerGuide)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800/50 cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <ExternalLink className="w-3.5 h-3.5 text-amber-500" />
              Template Skrip Cloudflare Worker (Bagi yang menggunakan Worker Proxy)
            </span>
            {showWorkerGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showWorkerGuide && (
            <div className="p-4 border-t border-slate-200 dark:border-zinc-700/80 bg-slate-900 text-zinc-100 text-xs space-y-2">
              <div className="flex items-center justify-between pb-2">
                <span className="text-[11px] text-zinc-400">
                  Kode <code>worker.js</code> siap pakai untuk di-deploy ke Cloudflare Workers dengan D1 database binding <code>env.DB</code>.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopy(workerCode, 'worker')}
                  className="h-7 text-xs flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-600"
                >
                  {copiedWorker ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedWorker ? 'Tersalin!' : 'Salin Worker Code'}
                </Button>
              </div>
              <pre className="max-h-72 overflow-y-auto p-3 rounded-lg bg-zinc-950 font-mono text-[11px] text-amber-200 leading-relaxed">
                {workerCode}
              </pre>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};
