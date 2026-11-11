import React, { useState, useEffect } from 'react';
import { HardDrive, Cpu, Database, Activity, Zap, CheckCircle2, CloudLightning, ShieldCheck } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { api } from '../../services/api';
import { ServerMetrics } from '../../types/cbt';

export const CloudMetricsPanel: React.FC = () => {
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);

  const fetchMetrics = async () => {
    try {
      const res = await api.get('/metrics');
      setMetrics(res.data.data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, []);

  if (!metrics) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <CloudLightning className="w-5 h-5 text-amber-500" />
            Metrik Efisiensi & Performa Cloud Run
          </h2>
          <p className="text-xs text-slate-500">
            Arsitektur Stateless Server, Single-Payload Load, dan Debounced Batch Save
          </p>
        </div>
        <Badge variant="emerald" size="md">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          Cloud Native & High Efficiency
        </Badge>
      </div>

      {/* Main Metric Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-slate-200 dark:border-zinc-800">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-400">Penggunaan Memory Server</div>
              <div className="text-xl font-bold font-mono text-slate-900 dark:text-zinc-100">
                {metrics.memoryUsageMB} MB RAM
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 border-t border-slate-100 dark:border-zinc-800 pt-2">
            Sangat hemat resource memory (sangat aman untuk Cloud Run free tier).
          </p>
        </Card>

        <Card className="border-slate-200 dark:border-zinc-800">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-teal-100 dark:bg-teal-950 text-teal-600 dark:text-teal-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-400">Cache Hit Ratio</div>
              <div className="text-xl font-bold font-mono text-teal-600 dark:text-teal-400">
                {metrics.cacheHitRatioPercentage}%
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 border-t border-slate-100 dark:border-zinc-800 pt-2">
            Informasi soal & konfigurasi disajikan langsung dari memory cache.
          </p>
        </Card>

        <Card className="border-slate-200 dark:border-zinc-800">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-400">Request Dihemat (Single Payload & Batch)</div>
              <div className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400">
                +{metrics.savedNetworkRequestsCount} Request
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 border-t border-slate-100 dark:border-zinc-800 pt-2">
            Menghindari polling per-soal sehingga server bebas dari kemacetan request.
          </p>
        </Card>
      </div>

      {/* Detail Breakdown */}
      <Card title="Prinsip Optimasi Yang Diterapkan" subtitle="Evaluasi arsitektur berdasarkan standar Google AI Studio Cloud">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-3 bg-slate-50 dark:bg-zinc-800/60 rounded-xl space-y-1 border border-slate-200/80 dark:border-zinc-700/80">
            <div className="font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              1. Single-Payload Soal Delivery
            </div>
            <p className="text-slate-500 dark:text-zinc-400 leading-relaxed pl-5">
              Seluruh data peserta, konfigurasi, soal, pilihan, dan urutan acak dikirim dalam 1 response awal. Aplikasi bekerja 100% lokal selama pengerjaan.
            </p>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-zinc-800/60 rounded-xl space-y-1 border border-slate-200/80 dark:border-zinc-700/80">
            <div className="font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              2. Debounced Auto-Save & Offline Sync
            </div>
            <p className="text-slate-500 dark:text-zinc-400 leading-relaxed pl-5">
              Jawaban dikirim secara batch dengan idle delay 3.5 detik. Jika koneksi terputus, jawaban tetap aman di LocalStorage hingga jaringan pulih.
            </p>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-zinc-800/60 rounded-xl space-y-1 border border-slate-200/80 dark:border-zinc-700/80">
            <div className="font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              3. Timer Dihitung Di Browser
            </div>
            <p className="text-slate-500 dark:text-zinc-400 leading-relaxed pl-5">
              Countdown waktu dihitung secara presisi di browser tanpa request sinkronisasi per detik. Server hanya memverifikasi timestamp saat submit.
            </p>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-zinc-800/60 rounded-xl space-y-1 border border-slate-200/80 dark:border-zinc-700/80">
            <div className="font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              4. Randomisasi Tunggal
            </div>
            <p className="text-slate-500 dark:text-zinc-400 leading-relaxed pl-5">
              Acak urutan soal & pilihan jawaban dihitung SATU KALI saat sesi ujian dibuat. Beban CPU server sangat rendah.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};
