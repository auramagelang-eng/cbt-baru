import React, { useState, useEffect, useMemo } from 'react';
import { Award, CheckCircle2, XCircle, FileSpreadsheet, RefreshCw, RotateCcw, ArrowUpDown, ArrowUp, ArrowDown, Search, Eye, X, History, Filter, Download, Layers } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { FormattedText } from '../ui/CodeBlock';
import { api } from '../../services/api';
import { ExamResult, AttemptDetail, Exam } from '../../types/cbt';

type SortField = 'participantCode' | 'participantName' | 'examTitle' | 'totalAttemptsCount' | 'percentage' | 'isPassed' | 'violationsCount' | 'submittedAt';

export const ResultsAnalytics: React.FC = () => {
  const [results, setResults] = useState<ExamResult[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('participantCode');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedResultModal, setSelectedResultModal] = useState<ExamResult | null>(null);
  const [selectedSessionDetail, setSelectedSessionDetail] = useState<{
    sessionId: string;
    questions: any[];
    answers: Record<string, any>;
    score: number;
    maxScore: number;
  } | null>(null);
  const [isLoadingSessionDetail, setIsLoadingSessionDetail] = useState(false);
  const [isExportingDetailed, setIsExportingDetailed] = useState(false);
  const [showExamSelectorModal, setShowExamSelectorModal] = useState(false);
  const [selectedModalExamId, setSelectedModalExamId] = useState<string>('');
  const [isRegrading, setIsRegrading] = useState(false);
  const [regradeNotice, setRegradeNotice] = useState<string | null>(null);

  const fetchSessionDetail = async (sessionId: string) => {
    setIsLoadingSessionDetail(true);
    try {
      const res = await api.get(`/results/session/${sessionId}`);
      setSelectedSessionDetail(res.data.data);
    } catch (e) {
      console.error('Gagal mengambil detail sesi', e);
    } finally {
      setIsLoadingSessionDetail(false);
    }
  };

  const handleRegradeAllEssays = async () => {
    if (!window.confirm('Hitung ulang seluruh nilai esai pada ujian ini menggunakan mesin penilaian sintaks & kesesuaian soal terbaru? Skor akan dikalkulasi ulang secara akurat.')) {
      return;
    }
    setIsRegrading(true);
    setRegradeNotice(null);
    try {
      const examId = selectedExamId !== 'ALL' ? selectedExamId : undefined;
      const res = await api.post('/results/regrade-essays', { examId });
      setRegradeNotice(res.data.message || 'Penilaian esai berhasil dihitung ulang.');
      await fetchResultsAndExams();
      if (selectedSessionDetail) {
        await fetchSessionDetail(selectedSessionDetail.sessionId);
      }
    } catch (err: any) {
      console.error('Error recalculating essays:', err);
      alert(err?.response?.data?.error || 'Gagal menghitung ulang nilai esai');
    } finally {
      setIsRegrading(false);
    }
  };

  const handleRegradeSingleSession = async (sessionId: string) => {
    setIsRegrading(true);
    setRegradeNotice(null);
    try {
      const res = await api.post('/results/regrade-essays', { sessionId });
      setRegradeNotice(res.data.message || 'Lembar esai sesi ini berhasil dikoreksi ulang.');
      await fetchResultsAndExams();
      await fetchSessionDetail(sessionId);
    } catch (err: any) {
      console.error('Error recalculating single session:', err);
      alert(err?.response?.data?.error || 'Gagal mengoreksi ulang esai');
    } finally {
      setIsRegrading(false);
    }
  };

  const fetchResultsAndExams = async () => {
    setIsLoading(true);
    try {
      const [resResults, resExams] = await Promise.all([
        api.get('/results'),
        api.get('/exams'),
      ]);
      setResults(resResults.data.data || []);
      setExams(resExams.data.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchResultsAndExams();
  }, []);

  const handleResetResult = async (participantId: string, name: string, examId?: string) => {
    if (window.confirm(`Reset hasil dan sesi ujian untuk ${name}?\n\nHasil pengerjaan peserta pada ujian ini akan dihapus dan peserta dapat mengulang ujian kembali.`)) {
      try {
        await api.post('/session/reset-participant', { participantId, examId });
        await fetchResultsAndExams();
      } catch (e) {
        console.error('Gagal mereset hasil peserta', e);
      }
    }
  };

  const handleResetExamResults = async () => {
    const isAll = selectedExamId === 'ALL';
    const targetExam = exams.find(e => e.id === selectedExamId);
    const label = isAll ? 'SEMUA UJIAN' : `Ujian "${targetExam?.title || selectedExamId}"`;
    const count = filteredByExamResults.length;

    const msg = `PERHATIAN: Apakah Anda yakin ingin MERESET HASIL UJIAN untuk ${label}?\n\n` +
      `• ${count} riwayat pengerjaan & nilai peserta akan dibersihkan.\n` +
      `• Kunci login perangkat akan dibebaskan agar kelas baru dapat login.\n` +
      `• Disarankan untuk mengekspor Excel (.csv) terlebih dahulu jika membutuhkan arsip nilai.\n\n` +
      `Lanjutkan reset hasil untuk kelas baru?`;

    if (window.confirm(msg)) {
      try {
        const res = await api.post('/session/reset-all', {
          examId: selectedExamId,
          clearDeviceLocks: true,
        });
        alert(res.data.message || 'Hasil dan sesi ujian berhasil di-reset!');
        await fetchResultsAndExams();
      } catch (e: any) {
        console.error('Gagal mereset hasil ujian', e);
        alert(e.response?.data?.error || 'Gagal mereset hasil');
      }
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const filteredByExamResults = useMemo(() => {
    if (selectedExamId === 'ALL') {
      return results;
    }
    return results.filter(r => r.examId === selectedExamId);
  }, [results, selectedExamId]);

  const filteredAndSortedResults = useMemo(() => {
    return filteredByExamResults
      .filter(r => {
        const q = searchQuery.toLowerCase();
        return (
          r.participantName.toLowerCase().includes(q) ||
          r.participantCode.toLowerCase().includes(q) ||
          r.examTitle.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        let valA: any = a[sortField];
        let valB: any = b[sortField];

        if (sortField === 'totalAttemptsCount') {
          valA = a.totalAttemptsCount || 1;
          valB = b.totalAttemptsCount || 1;
        }

        if (typeof valA === 'string') {
          const comp = valA.localeCompare(valB as string);
          return sortDirection === 'asc' ? comp : -comp;
        }
        if (typeof valA === 'boolean') {
          const comp = (valA ? 1 : 0) - (valB ? 1 : 0);
          return sortDirection === 'asc' ? comp : -comp;
        }

        const comp = (valA || 0) - (valB || 0);
        return sortDirection === 'asc' ? comp : -comp;
      });
  }, [filteredByExamResults, searchQuery, sortField, sortDirection]);

  const handleExportExcel = () => {
    if (filteredAndSortedResults.length === 0) {
      alert('Belum ada data hasil ujian untuk diekspor!');
      return;
    }

    // 1. Data Sheet: Rekapitulasi Nilai Siswa
    const headers = [
      'No',
      'Kode Peserta',
      'Nama Peserta',
      'Judul Ujian',
      'Jml Percobaan',
      'Nilai Attempt 1 (%)',
      'Nilai Attempt 2 (%)',
      'Nilai Attempt 3 (%)',
      'Nilai Tertinggi (%)',
      'Skor Diperoleh',
      'Skor Maksimal',
      'Status Kelulusan',
      'Total Pelanggaran',
      'Waktu Submit Terakhir'
    ];

    const rows = filteredAndSortedResults.map((r, idx) => {
      const history = r.attemptsHistory || [];
      const att1 = history.find(h => h.attemptNumber === 1)?.percentage ?? '-';
      const att2 = history.find(h => h.attemptNumber === 2)?.percentage ?? '-';
      const att3 = history.find(h => h.attemptNumber === 3)?.percentage ?? '-';

      return [
        idx + 1,
        r.participantCode,
        r.participantName,
        r.examTitle,
        r.totalAttemptsCount || 1,
        att1,
        att2,
        att3,
        r.percentage,
        r.score,
        r.maxScore,
        r.isPassed ? 'LULUS' : 'REMIDI (TIDAK LULUS)',
        r.violationsCount,
        new Date(r.submittedAt).toLocaleString('id-ID'),
      ];
    });

    const worksheetData = [
      ['REKAPITULASI HASIL NILAI UJIAN CBT'],
      [`Filter Ujian: ${selectedExamId === 'ALL' ? 'Semua Sesi Ujian' : exams.find(e => e.id === selectedExamId)?.title || selectedExamId}`],
      [`Tanggal Ekspor: ${new Date().toLocaleString('id-ID')}`],
      [`Total Siswa: ${filteredAndSortedResults.length} Peserta | Lulus: ${passed} | Remidi: ${failed} | Rata-rata: ${avgScore}%`],
      [], // Empty row
      headers,
      ...rows,
    ];

    const wsResults = XLSX.utils.aoa_to_sheet(worksheetData);

    // Column widths auto-fitting
    wsResults['!cols'] = [
      { wch: 6 },  // No
      { wch: 18 }, // Kode Peserta
      { wch: 28 }, // Nama Peserta
      { wch: 30 }, // Judul Ujian
      { wch: 15 }, // Jml Percobaan
      { wch: 18 }, // Attempt 1
      { wch: 18 }, // Attempt 2
      { wch: 18 }, // Attempt 3
      { wch: 18 }, // Nilai Tertinggi
      { wch: 14 }, // Skor Diperoleh
      { wch: 14 }, // Skor Maksimal
      { wch: 22 }, // Status
      { wch: 18 }, // Pelanggaran
      { wch: 22 }, // Waktu Submit
    ];

    // 2. Summary Sheet: Statistik Hasil Ujian
    const summaryData = [
      ['RINGKASAN STATISTIK EVALUASI CBT'],
      [],
      ['Indikator', 'Nilai'],
      ['Total Peserta Mengerjakan', total],
      ['Peserta Lulus (>= KKM)', passed],
      ['Peserta Remidi (< KKM)', failed],
      ['Tingkat Kelulusan (%)', `${passRate}%`],
      ['Rata-Rata Nilai Keseluruhan (%)', `${avgScore}%`],
      ['Nilai Tertinggi (%)', `${Math.max(...filteredByExamResults.map(r => r.percentage), 0)}%`],
      ['Nilai Terendah (%)', `${total > 0 ? Math.min(...filteredByExamResults.map(r => r.percentage)) : 0}%`],
      ['Tanggal Laporan Dibuat', new Date().toLocaleString('id-ID')],
    ];

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [
      { wch: 32 },
      { wch: 24 },
    ];

    // Create workbook and append sheets
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, wsResults, 'Rekap Nilai Siswa');
    XLSX.utils.book_append_sheet(workbook, wsSummary, 'Ringkasan Statistik');

    // Generate and download genuine Excel .xlsx file
    const safeDate = new Date().toISOString().slice(0, 10);
    const selectedTitleClean = selectedExamId === 'ALL' ? 'Semua_Ujian' : (exams.find(e => e.id === selectedExamId)?.title || 'Ujian').replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `Rekap_Nilai_CBT_${selectedTitleClean}_${safeDate}.xlsx`;

    XLSX.writeFile(workbook, fileName);
  };

  /**
   * Unduh file spreadsheet Excel (.xlsx) dengan 3 sheet (Percobaan 1, 2, 3),
   * baris kunci jawaban di bawah soal, serta pewarnaan sel hijau (benar) dan merah (salah).
   */
  const handleExportDetailedAttempts = async (examId: string) => {
    setIsExportingDetailed(true);
    try {
      const res = await api.get(`/results/export-attempts-xlsx?examId=${encodeURIComponent(examId)}`, {
        responseType: 'blob',
      });

      const targetExam = exams.find(e => e.id === examId);
      const safeTitle = (targetExam?.title || 'Ujian').replace(/[^a-zA-Z0-9]/g, '_');
      const safeDate = new Date().toISOString().slice(0, 10);
      const fileName = `Analisis_3_Percobaan_${safeTitle}_${safeDate}.xlsx`;

      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setShowExamSelectorModal(false);
    } catch (err: any) {
      console.error('Gagal mengunduh ekspor detail 3 percobaan:', err);
      alert(err?.response?.data?.error || 'Gagal menghasilkan file Excel analisis 3 percobaan. Pastikan sesi ujian valid.');
    } finally {
      setIsExportingDetailed(false);
    }
  };

  const handleTriggerDetailedExport = () => {
    if (selectedExamId !== 'ALL') {
      handleExportDetailedAttempts(selectedExamId);
    } else if (exams.length === 1) {
      handleExportDetailedAttempts(exams[0].id);
    } else if (exams.length > 1) {
      setSelectedModalExamId(exams[0].id);
      setShowExamSelectorModal(true);
    } else {
      alert('Tidak ada ujian yang terdaftar untuk diekspor.');
    }
  };

  const total = filteredByExamResults.length;
  const passed = filteredByExamResults.filter(r => r.isPassed).length;
  const failed = total - passed;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const avgScore = total > 0 ? Math.round(filteredByExamResults.reduce((acc, r) => acc + r.percentage, 0) / total) : 0;

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-400 opacity-60 ml-1 inline" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 ml-1 inline font-bold" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 ml-1 inline font-bold" />
    );
  };

  return (
    <div className="space-y-6">
      {/* Header & Clean Toolbar */}
      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              Hasil & Analisis Ujian
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Rekapitulasi nilai akhir (Nilai Tertinggi dari max 3x percobaan) & ekspor spreadsheet Excel (.xlsx)
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            {/* Recalculate AI & Rubric Essay Scores Button */}
            <button
              type="button"
              onClick={handleRegradeAllEssays}
              disabled={isRegrading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              title="Hitung ulang seluruh nilai esai ujian dengan evaluator sintaks dan ketentuan instruksi yang adil"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRegrading ? 'animate-spin' : ''}`} />
              <span>{isRegrading ? 'Menghitung Ulang...' : '⚡ Hitung Ulang Nilai Esai'}</span>
            </button>

            {/* Reset Results Button */}
            <button
              type="button"
              onClick={handleResetExamResults}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-amber-300 dark:border-amber-800/80 bg-amber-50 hover:bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>Reset Hasil Sesi</span>
            </button>

            {/* Export Excel (.xlsx) Button */}
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
              title="Unduh seluruh rekapitulasi nilai dalam format Microsoft Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
              <span>Ekspor Excel (.xlsx)</span>
            </button>

            {/* Export 3-Sheet Attempts Analysis Button */}
            <button
              type="button"
              onClick={handleTriggerDetailedExport}
              disabled={isExportingDetailed}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-teal-700 hover:bg-teal-800 text-white dark:bg-teal-600 dark:hover:bg-teal-700 shadow-2xs transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              title="Ekspor Analisis Butir Soal 3 Percobaan (3 Sheet: Percobaan 1, 2, 3 dengan Kunci & Blok Warna)"
            >
              {isExportingDetailed ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Layers className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>Ekspor 3 Percobaan (.xlsx)</span>
            </button>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={fetchResultsAndExams}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-700/60 shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
              title="Perbarui data hasil ujian"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* Regrade Notice Banner */}
      {regradeNotice && (
        <div className="p-3.5 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 text-xs flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded-lg bg-indigo-600 text-white font-bold text-[10px]">AI</span>
            <span>{regradeNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setRegradeNotice(null)}
            className="text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-200 p-1 rounded-lg transition-colors cursor-pointer"
            title="Tutup pemberitahuan"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
          <div className="text-xs text-slate-500 mb-1">Total Peserta Selesai</div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">{total}</div>
        </Card>

        <Card className="bg-teal-50/50 dark:bg-teal-950/20 border-teal-200 dark:border-teal-900">
          <div className="text-xs text-slate-500 mb-1">Tingkat Kelulusan</div>
          <div className="text-2xl font-bold text-teal-600 dark:text-teal-400 font-mono">{passRate}%</div>
        </Card>

        <Card className="bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
          <div className="text-xs text-slate-500 mb-1">Rata-rata Nilai Tertinggi</div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">{avgScore} / 100</div>
        </Card>

        <Card className="bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900">
          <div className="text-xs text-slate-500 mb-1">Perlu Remidi (Tdk Lulus)</div>
          <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 font-mono">{failed}</div>
        </Card>
      </div>

      {/* Results DataTable */}
      <Card className="border-slate-200 dark:border-zinc-800 overflow-hidden" title="Daftar Nilai Peserta Ujian (DataTable)">
        {/* Table Search & Filter Toolbar */}
        <div className="p-4 border-b border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/50 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Cari nama, kode peserta, atau judul ujian..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:ring-2 focus:ring-emerald-500 outline-hidden"
              />
            </div>

            {/* Exam Filter Dropdown */}
            <div className="flex items-center gap-2 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 px-3 py-1.5 rounded-xl shadow-2xs">
              <Filter className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <select
                value={selectedExamId}
                onChange={(e) => setSelectedExamId(e.target.value)}
                aria-label="Filter Berdasarkan Sesi Ujian"
                className="text-xs font-semibold bg-transparent text-slate-800 dark:text-zinc-200 border-none outline-hidden cursor-pointer"
              >
                <option value="ALL" className="dark:bg-zinc-900">Semua Sesi Ujian ({results.length} hasil)</option>
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.id} className="dark:bg-zinc-900">
                    {ex.title} (Token: {ex.token})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-xs text-slate-500 whitespace-nowrap">
            Menampilkan <span className="font-semibold text-slate-900 dark:text-zinc-200">{filteredAndSortedResults.length}</span> dari {filteredByExamResults.length} peserta
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 border-b border-slate-200 dark:border-zinc-800 font-semibold uppercase tracking-wider select-none">
              <tr>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors whitespace-nowrap" onClick={() => handleSort('participantCode')}>
                  Kode / NISN {renderSortIcon('participantCode')}
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors whitespace-nowrap" onClick={() => handleSort('participantName')}>
                  Nama Peserta {renderSortIcon('participantName')}
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors whitespace-nowrap" onClick={() => handleSort('examTitle')}>
                  Ujian {renderSortIcon('examTitle')}
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors whitespace-nowrap" onClick={() => handleSort('totalAttemptsCount')}>
                  Percobaan {renderSortIcon('totalAttemptsCount')}
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors whitespace-nowrap" onClick={() => handleSort('percentage')}>
                  Nilai Tertinggi (%) {renderSortIcon('percentage')}
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors whitespace-nowrap" onClick={() => handleSort('isPassed')}>
                  Status {renderSortIcon('isPassed')}
                </th>
                <th className="px-4 py-3 cursor-pointer hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors whitespace-nowrap" onClick={() => handleSort('violationsCount')}>
                  Pelanggaran {renderSortIcon('violationsCount')}
                </th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
              {filteredAndSortedResults.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    Tidak ditemukan hasil ujian yang cocok.
                  </td>
                </tr>
              ) : (
                filteredAndSortedResults.map((r) => (
                  <tr key={r.sessionId} className="hover:bg-slate-50/50 dark:hover:bg-zinc-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-zinc-100 whitespace-nowrap">{r.participantCode}</td>
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-zinc-200 whitespace-nowrap">{r.participantName}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{r.examTitle}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedResultModal(r)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 border border-slate-200 dark:border-zinc-700 font-mono font-bold hover:bg-slate-200 transition-colors cursor-pointer"
                        title="Klik untuk melihat detail percobaan"
                      >
                        <History className="w-3 h-3 text-emerald-600" />
                        <span>{r.totalAttemptsCount || 1} / {r.maxAttemptsAllowed || 3}x</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-sm text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                      {r.percentage}%
                      <span className="ml-1 text-[10px] text-slate-400 font-normal">({r.score}/{r.maxScore})</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.isPassed ? (
                        <Badge variant="emerald">LULUS</Badge>
                      ) : (
                        <Badge variant="rose">REMIDI</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-rose-600 font-semibold whitespace-nowrap">{r.violationsCount}x</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedResultModal(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Detail</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResetResult(r.participantId, r.participantName, r.examId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Reset</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Attempt History Modal */}
      {selectedResultModal && (
        <div className="fixed inset-0 z-50 bg-zinc-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-zinc-800 max-w-xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-zinc-100 text-base flex items-center gap-2">
                  <Award className="w-5 h-5 text-emerald-600" />
                  Detail Percobaan Ujian - {selectedResultModal.participantName}
                </h3>
                <p className="text-xs text-slate-500">Kode: {selectedResultModal.participantCode} • Ujian: {selectedResultModal.examTitle}</p>
              </div>
              <button
                onClick={() => setSelectedResultModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-xl p-3 flex items-center justify-between">
              <div>
                <div className="text-xs text-emerald-800 dark:text-emerald-300 font-semibold">Nilai Akhir Terhitung:</div>
                <div className="text-xs text-slate-600 dark:text-zinc-400">Sistem mengambil NILAI TERTINGGI dari {selectedResultModal.totalAttemptsCount || 1} percobaan</div>
              </div>
              <div className="text-right">
                <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono">{selectedResultModal.percentage}%</span>
                <div>
                  {selectedResultModal.isPassed ? (
                    <Badge variant="emerald">LULUS</Badge>
                  ) : (
                    <Badge variant="rose">REMIDI</Badge>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider">Riwayat Attempt (Maksimal {selectedResultModal.maxAttemptsAllowed || 3}x):</h4>
              <div className="border border-slate-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-zinc-800 text-slate-500 font-semibold border-b border-slate-200 dark:border-zinc-800">
                    <tr>
                      <th className="px-3 py-2">Percobaan</th>
                      <th className="px-3 py-2">Nilai (%)</th>
                      <th className="px-3 py-2">Skor Poin</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(selectedResultModal.attemptsHistory || []).map((att) => {
                      const isBest = att.percentage === selectedResultModal.percentage;
                      return (
                        <tr key={att.sessionId} className={isBest ? 'bg-amber-50/70 dark:bg-amber-950/30 font-semibold' : ''}>
                          <td className="px-3 py-2 font-mono flex items-center gap-1.5">
                            Attempt #{att.attemptNumber}
                            {isBest && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500 text-white font-bold">TERTINGGI</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono font-bold text-emerald-600 dark:text-emerald-400">{att.percentage}%</td>
                          <td className="px-3 py-2 font-mono">{att.score} / {att.maxScore}</td>
                          <td className="px-3 py-2">
                            {att.isPassed ? (
                              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">LULUS</span>
                            ) : (
                              <span className="text-rose-600 dark:text-rose-400 font-semibold">TIDAK LULUS</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => fetchSessionDetail(att.sessionId)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 transition-colors cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Lihat Jawaban & AI</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Detailed answers preview with AI Essay feedback */}
            {isLoadingSessionDetail && (
              <div className="py-6 text-center text-xs text-slate-500 animate-pulse">
                Memuat detail lembar jawaban & evaluasi AI...
              </div>
            )}

            {selectedSessionDetail && !isLoadingSessionDetail && (
              <div className="mt-4 border-t border-slate-200 dark:border-zinc-800 pt-3 space-y-3 max-h-72 overflow-y-auto pr-1">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h5 className="text-xs font-bold text-slate-800 dark:text-zinc-200">
                    Lembar Jawaban & Evaluasi Otomatis (Attempt Terpilih):
                  </h5>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleRegradeSingleSession(selectedSessionDetail.sessionId)}
                      disabled={isRegrading}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 transition-colors disabled:opacity-50 cursor-pointer"
                      title="Hitung ulang evaluasi esai khusus untuk sesi siswa ini"
                    >
                      <RefreshCw className={`w-3 h-3 ${isRegrading ? 'animate-spin' : ''}`} />
                      <span>{isRegrading ? 'Menilai...' : 'Koreksi Ulang Esai'}</span>
                    </button>
                    <span className="text-[11px] font-mono text-slate-500 font-semibold">
                      Total: {selectedSessionDetail.score} / {selectedSessionDetail.maxScore} Poin
                    </span>
                  </div>
                </div>

                {selectedSessionDetail.questions.map((q: any, idx: number) => {
                  const ans = selectedSessionDetail.answers[q.id];
                  const isShortAnswerMulti =
                    q.type === 'SHORT_ANSWER_MULTI' ||
                    (Array.isArray(q.answerKey) && q.answerKey.length > 0) ||
                    (Array.isArray(q.shortAnswerMultiKey) && q.shortAnswerMultiKey.length > 0) ||
                    /_{2,}\s*\(?\s*(\d+)\s*\)?\s*_{2,}/.test(q.questionText || '');
                  const isEssay = q.type === 'ESSAY' && !isShortAnswerMulti;
                  const isShortAnswer = q.type === 'SHORT_ANSWER' && !isShortAnswerMulti;

                  return (
                    <div
                      key={q.id}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/60 dark:bg-zinc-800/40 text-xs space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 font-semibold text-slate-900 dark:text-zinc-100">
                          <span className="text-emerald-600 font-bold mr-1.5 font-mono">#{idx + 1}.</span>
                          <div className="inline">
                            <FormattedText text={q.questionText} />
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0 font-mono">
                          {q.points} Poin
                        </Badge>
                      </div>

                      {q.imageUrl && (
                        <img
                          src={q.imageUrl}
                          alt="Lampiran Soal"
                          className="max-h-28 rounded-lg border border-slate-200 dark:border-zinc-700 object-contain bg-white dark:bg-zinc-900"
                        />
                      )}

                      {isEssay ? (
                        <div className="space-y-1.5 pt-1">
                          <div className="bg-white dark:bg-zinc-900 p-2.5 rounded-lg border border-slate-200 dark:border-zinc-700">
                            <span className="font-semibold text-slate-500 block text-[11px] mb-1">
                              Jawaban Siswa:
                            </span>
                            <p className="text-slate-800 dark:text-zinc-200 whitespace-pre-wrap font-sans">
                              {ans?.essayAnswer || <span className="italic text-slate-400">Tidak ada jawaban</span>}
                            </p>
                          </div>

                          {/* AI Evaluation Box */}
                          <div className="p-2.5 rounded-lg border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/20 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="inline-flex items-center gap-1 font-bold text-indigo-800 dark:text-indigo-300 text-[11px]">
                                <span>🤖 Koreksi Cerdas AI Gemini:</span>
                                {ans?.aiGraded && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] bg-indigo-600 text-white font-bold">
                                    Gemini 3.7 Flash
                                  </span>
                                )}
                              </span>
                              <span className="font-mono font-bold text-indigo-700 dark:text-indigo-300">
                                Skor: {ans?.essayScore ?? 0} / {q.points}
                              </span>
                            </div>

                            <p className="text-slate-700 dark:text-zinc-300 text-[11px]">
                              {ans?.aiFeedback || 'Belum ada catatan evaluasi AI.'}
                            </p>

                            {ans?.aiConceptualStrengths && ans.aiConceptualStrengths.length > 0 && (
                              <div className="text-[10px] text-emerald-700 dark:text-emerald-400 pt-0.5">
                                ✓ <strong>Konsep Tepat:</strong> {ans.aiConceptualStrengths.join(', ')}
                              </div>
                            )}

                            {ans?.aiMissingConcepts && ans.aiMissingConcepts.length > 0 && (
                              <div className="text-[10px] text-amber-700 dark:text-amber-400">
                                ⚠ <strong>Perlu Dilengkapi:</strong> {ans.aiMissingConcepts.join(', ')}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : isShortAnswer ? (
                        <div className="space-y-1.5 pt-1">
                          <div className="bg-white dark:bg-zinc-900 p-2.5 rounded-lg border border-slate-200 dark:border-zinc-700">
                            <span className="font-semibold text-slate-500 block text-[11px] mb-1">
                              Isian Siswa:
                            </span>
                            <p className="text-slate-900 dark:text-zinc-100 font-mono text-xs">
                              {ans?.shortAnswer || ans?.essayAnswer || <span className="italic text-slate-400 font-sans">Tidak ada isian / kosong</span>}
                            </p>
                          </div>

                          <div className="flex items-center justify-between flex-wrap gap-2 pt-1 text-[11px]">
                            <div>
                              <span className="text-slate-500">Kunci Acuan: </span>
                              <code className="font-mono font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                                {q.shortAnswerKey || (q.shortAnswerKeys || []).join(' | ') || '-'}
                              </code>
                            </div>

                            {(ans?.essayScore ?? 0) > 0 ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Isian Tepat (+{q.points} Poin)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400">
                                <XCircle className="w-3.5 h-3.5" /> Isian Belum Tepat (0 Poin)
                              </span>
                            )}
                          </div>
                        </div>
                      ) : isShortAnswerMulti ? (
                        <div className="space-y-2 pt-1">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-zinc-300">
                            <span className="flex items-center gap-1.5 text-sky-700 dark:text-sky-300 font-bold">
                              <span>Koreksi Isian Multi-Blank:</span>
                            </span>
                            <span className="font-mono font-bold text-sky-700 dark:text-sky-300">
                              Skor: {ans?.essayScore ?? 0} / {q.points} Poin
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {(() => {
                              const keysList = (q.answerKey || q.shortAnswerMultiKey || []);
                              const effectiveKeys = keysList.length > 0 ? keysList : (() => {
                                const detected: any[] = [];
                                const r = /_{2,}\s*\(?\s*(\d+)\s*\)?\s*_{2,}/g;
                                let m: RegExpExecArray | null;
                                while ((m = r.exec(q.questionText || '')) !== null) {
                                  const n = parseInt(m[1], 10);
                                  if (!isNaN(n) && !detected.some(d => d.blank === n)) {
                                    detected.push({ blank: n, answer: '-' });
                                  }
                                }
                                return detected.sort((a, b) => a.blank - b.blank);
                              })();

                              return effectiveKeys.map((keyItem: any) => {
                                const bNum = keyItem.blank;
                                const breakdownItem = (ans?.multiAnswersBreakdown || []).find((b: any) => b.blank === bNum);
                                
                                let studentVal =
                                  (ans?.multiShortAnswers && (ans.multiShortAnswers[bNum] ?? ans.multiShortAnswers[String(bNum)])) ??
                                  breakdownItem?.studentAnswer ??
                                  ans?.shortAnswerMultiBreakdown?.[String(bNum)]?.answer ??
                                  '';

                                if (!studentVal && (ans?.shortAnswer || ans?.essayAnswer)) {
                                  const m = new RegExp(`(?:\\(|Blank\\s*|\\[)${bNum}(?:\\)|\\]|\\:|\\s*=)\\s*([^;\\n\\r]+)`, 'i').exec(ans.shortAnswer || ans.essayAnswer || '');
                                  if (m && m[1]) {
                                    studentVal = m[1].trim();
                                  }
                                }

                                const normS = studentVal.trim().toLowerCase().replace(/^['"](.*)['"]$/, '$1').replace(/\s+/g, '');
                                const normK = (keyItem.answer || '').trim().toLowerCase().replace(/^['"](.*)['"]$/, '$1').replace(/\s+/g, '');
                                const isCorrect = breakdownItem ? breakdownItem.isCorrect : (
                                  studentVal.trim().length > 0 && normS.length > 0 && (
                                    normS === normK ||
                                    normS === normK.replace(/^\$/, '') ||
                                    normS.replace(/^\$/, '') === normK
                                  )
                                );
                                const totalBlanks = effectiveKeys.length || 1;
                                const pointsEarned = breakdownItem?.pointsEarned ?? (isCorrect ? (q.points / totalBlanks) : 0);

                                return (
                                  <div
                                    key={bNum}
                                    className={`p-2.5 rounded-xl border text-xs space-y-1.5 transition-all ${
                                      isCorrect
                                        ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20'
                                        : 'border-rose-300 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="px-1.5 py-0.5 rounded font-mono font-bold text-[10px] bg-slate-200 dark:bg-zinc-700 text-slate-800 dark:text-zinc-200">
                                        Blank ({bNum})
                                      </span>
                                      <span className="font-mono text-[10px] font-bold text-slate-500">
                                        +{pointsEarned.toFixed(1).replace(/\.0$/, '')} Poin
                                      </span>
                                    </div>

                                    <div className="space-y-0.5">
                                      <div className="text-[11px]">
                                        <span className="text-slate-500">Jawaban Siswa: </span>
                                        <span className={`font-mono font-bold ${isCorrect ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                                          {studentVal || <span className="italic font-normal font-sans text-slate-400">Kosong</span>}
                                        </span>
                                      </div>
                                      <div className="text-[11px]">
                                        <span className="text-slate-500">Kunci: </span>
                                        <span className="font-mono text-slate-700 dark:text-zinc-300 font-semibold">
                                          {keyItem.answer}
                                        </span>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-1 text-[10px] font-semibold">
                                      {isCorrect ? (
                                        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                          <CheckCircle2 className="w-3.5 h-3.5" /> Benar
                                        </span>
                                      ) : (
                                        <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1">
                                          <XCircle className="w-3.5 h-3.5" /> Belum Tepat
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1 pt-1">
                          <div className="text-[11px] text-slate-600 dark:text-zinc-400">
                            Pilihan Siswa:{' '}
                            <span className="font-semibold text-slate-900 dark:text-zinc-100">
                              {q.options?.find((o: any) => o.id === ans?.selectedOptionId)?.optionText || (
                                <span className="italic text-slate-400">Tidak dijawab</span>
                              )}
                            </span>
                          </div>
                          {ans?.selectedOptionId === q.correctOptionId ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Jawaban Benar (+{q.points} Poin)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600">
                              <XCircle className="w-3.5 h-3.5" /> Jawaban Salah (0 Poin)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedResultModal(null);
                  setSelectedSessionDetail(null);
                }}
              >
                Tutup
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Pemilihan Sesi Ujian untuk Ekspor 3 Sheet (jika filter Ujian adalah ALL) */}
      {showExamSelectorModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-zinc-800">
              <h3 className="font-bold text-slate-900 dark:text-zinc-100 text-base flex items-center gap-2">
                <Layers className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0" />
                Ekspor Analisis 3 Percobaan
              </h3>
              <button
                type="button"
                onClick={() => setShowExamSelectorModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">
              Pilih ujian yang ingin diekspor. File Excel yang dihasilkan akan berisi <strong>3 Sheet (Percobaan 1, Percobaan 2, Percobaan 3)</strong>, lengkap dengan daftar nama peserta, butir soal, kunci jawaban di bawah soal, serta blok warna hijau (benar) dan merah (salah) untuk PG, serta uraian lengkap siswa.
            </p>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {exams.map((ex) => (
                <label
                  key={ex.id}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    selectedModalExamId === ex.id
                      ? 'border-teal-500 bg-teal-50/50 dark:bg-teal-950/30 dark:border-teal-600'
                      : 'border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="modalExam"
                    value={ex.id}
                    checked={selectedModalExamId === ex.id}
                    onChange={() => setSelectedModalExamId(ex.id)}
                    className="mt-0.5 text-teal-600 focus:ring-teal-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-900 dark:text-zinc-100 truncate">
                      {ex.title}
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                      <span>Token: <span className="font-mono font-semibold">{ex.token}</span></span>
                      <span>•</span>
                      <span>KKM: {ex.passPercentage}%</span>
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-zinc-800">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowExamSelectorModal(false)}
              >
                Batal
              </Button>
              <Button
                size="sm"
                disabled={!selectedModalExamId || isExportingDetailed}
                onClick={() => handleExportDetailedAttempts(selectedModalExamId)}
                className="bg-teal-700 hover:bg-teal-800 text-white dark:bg-teal-600 dark:hover:bg-teal-700 font-bold"
              >
                {isExportingDetailed ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                )}
                <span>Unduh Excel 3 Sheet</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

