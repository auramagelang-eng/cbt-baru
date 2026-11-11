import React, { useState, useEffect } from 'react';
import { Plus, BookOpen, Clock, Key, Shuffle, CheckCircle2, FileQuestion, Timer, Lock, AlertCircle, Edit3, Trash2, Power, RotateCcw, Settings, Eye, CheckSquare, ShieldCheck, HelpCircle, RefreshCw } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { QuestionEditorPage } from './QuestionEditorPage';
import { api } from '../../services/api';
import { Exam } from '../../types/cbt';

export const ExamManager: React.FC = () => {
  const [exams, setExams] = useState<Exam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Dedicated full-screen Question Editor Page state
  const [selectedExamForQuestions, setSelectedExamForQuestions] = useState<Exam | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    subject: '',
    durationMinutes: 60,
    passPercentage: 70,
    token: '',
    shuffleQuestions: true,
    shuffleAnswers: true,
    maxViolations: 3,
    isPerQuestionTimed: false,
    questionDurationSeconds: 30,
    isStrictTimer: true,
    showInstantFeedback: false,
    showAnswerKeys: true,
  });

  const fetchExams = async () => {
    setIsLoading(true);
    try {
      const res = await api.get('/exams');
      const serverExams: Exam[] = res.data.data || [];
      setExams(serverExams);
    } catch (e) {
      console.error('Gagal memuat ujian dari server/Cloudflare:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchExams();
  }, []);

  const handleToggleActive = async (examId: string) => {
    try {
      await api.patch(`/exams/${examId}/toggle-active`);
      await fetchExams();
    } catch (e) {
      console.error('Gagal mengubah status aktif/non-aktif', e);
    }
  };

  const handleDeleteExam = async (examId: string, title: string) => {
    if (window.confirm(`Apakah Anda yakin ingin MENGHAPUS ujian "${title}"?\n\nSeluruh bank soal, sesi, dan riwayat nilai peserta pada ujian ini akan dihapus permanen.`)) {
      try {
        await api.delete(`/exams/${examId}`);
        await fetchExams();
      } catch (e) {
        console.error('Gagal menghapus ujian', e);
      }
    }
  };

  const handleResetExam = async (examId: string, title: string) => {
    if (window.confirm(`Apakah Anda yakin ingin MERESET SELURUH SESI untuk ujian "${title}"?\n\nSemua peserta akan dapat login ulang dan mengerjakan ujian dari awal.`)) {
      try {
        const res = await api.post('/session/reset-exam', { examId });
        alert(res.data.message || 'Berhasil mereset seluruh sesi ujian');
        await fetchExams();
      } catch (e) {
        console.error('Gagal mereset sesi ujian', e);
      }
    }
  };

  const openCreateModal = () => {
    setEditingExam(null);
    setFormData({
      title: 'Ujian Pemrograman & Algoritma',
      subject: 'Informatika',
      durationMinutes: 45,
      passPercentage: 75,
      token: 'EXAM' + Math.floor(100 + Math.random() * 900),
      shuffleQuestions: true,
      shuffleAnswers: true,
      maxViolations: 3,
      isPerQuestionTimed: false,
      questionDurationSeconds: 30,
      isStrictTimer: true,
      showInstantFeedback: false,
      showAnswerKeys: true,
    });
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  const openEditModal = (exam: Exam) => {
    setEditingExam(exam);
    setFormData({
      title: exam.title,
      subject: exam.subject,
      durationMinutes: exam.durationMinutes,
      passPercentage: exam.passPercentage,
      token: exam.token,
      shuffleQuestions: exam.shuffleQuestions ?? true,
      shuffleAnswers: exam.shuffleAnswers ?? true,
      maxViolations: exam.maxViolations ?? 3,
      isPerQuestionTimed: !!exam.isPerQuestionTimed,
      questionDurationSeconds: exam.questionDurationSeconds ?? 30,
      isStrictTimer: exam.isStrictTimer ?? true,
      showInstantFeedback: exam.showInstantFeedback ?? false,
      showAnswerKeys: exam.showAnswerKeys ?? true,
    });
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  const handleSaveExam = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const payload = {
        title: formData.title.trim(),
        subject: formData.subject.trim(),
        durationMinutes: Number(formData.durationMinutes) || 60,
        passPercentage: Number(formData.passPercentage) || 70,
        token: formData.token.trim().toUpperCase(),
        shuffleQuestions: Boolean(formData.shuffleQuestions),
        shuffleAnswers: Boolean(formData.shuffleAnswers),
        maxViolations: Number(formData.maxViolations) || 3,
        isPerQuestionTimed: Boolean(formData.isPerQuestionTimed),
        questionDurationSeconds: Number(formData.questionDurationSeconds) || 30,
        isStrictTimer: Boolean(formData.isStrictTimer),
        showInstantFeedback: Boolean(formData.showInstantFeedback),
        showAnswerKeys: Boolean(formData.showAnswerKeys),
      };

      if (!payload.title || payload.title.length < 2) {
        setErrorMessage('Judul ujian wajib diisi minimal 2 karakter');
        setIsSubmitting(false);
        return;
      }
      if (!payload.token || payload.token.length < 2) {
        setErrorMessage('Token ujian wajib diisi minimal 2 karakter');
        setIsSubmitting(false);
        return;
      }

      if (editingExam) {
        await api.put(`/exams/${editingExam.id}`, payload);
      } else {
        await api.post('/exams', payload);
      }

      setIsModalOpen(false);
      setEditingExam(null);
      await fetchExams();
    } catch (err: any) {
      console.error('Error saving exam settings:', err);
      const serverErr = err.response?.data?.error || err.message || 'Gagal menyimpan pengaturan ujian';
      setErrorMessage(serverErr);
    } finally {
      setIsSubmitting(false);
    }
  };

  // If an exam is selected for question management, render the dedicated QuestionEditorPage!
  if (selectedExamForQuestions) {
    return (
      <QuestionEditorPage
        exam={selectedExamForQuestions}
        onBack={() => {
          setSelectedExamForQuestions(null);
          fetchExams();
        }}
        onQuestionsSaved={fetchExams}
      />
    );
  }

  return (
    <div className="space-y-6 font-sans">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100">Sesi & Daftar Ujian</h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400">Kelola pengaturan acak soal/jawaban, strict timer, feedback instan, dan kunci jawaban</p>
        </div>
        <Button
          variant="primary"
          onClick={openCreateModal}
          className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Buat Sesi Ujian Baru
        </Button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-xs text-slate-400">
          Memuat daftar ujian...
        </div>
      ) : exams.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-700 dark:text-zinc-300 mb-1">Belum Ada Sesi Ujian</h3>
          <p className="text-xs text-slate-400 mb-4">Silakan buat sesi ujian baru untuk memulai</p>
          <Button variant="primary" onClick={openCreateModal}>
            <Plus className="w-4 h-4" />
            Buat Ujian Pertama
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {exams.map((exam) => (
            <Card
              key={exam.id}
              className={`border transition-all space-y-4 p-5 ${
                exam.isActive
                  ? 'border-emerald-200 dark:border-emerald-900/60 bg-white dark:bg-zinc-900 shadow-sm'
                  : 'border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/50 opacity-90'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-100 text-slate-800 dark:bg-zinc-800 dark:text-zinc-200 border border-slate-200 dark:border-zinc-700 mb-1">
                      <Key className="w-3 h-3 text-emerald-600" /> Token: {exam.token}
                    </span>
                    <h3 className="font-bold text-base text-slate-900 dark:text-zinc-100">{exam.title}</h3>
                    <p className="text-xs text-slate-500 dark:text-zinc-400">{exam.subject}</p>
                  </div>
                  <Badge variant={exam.isActive ? 'emerald' : 'slate'}>
                    {exam.isActive ? 'Aktif' : 'Non-Aktif'}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 dark:bg-zinc-800/60 rounded-xl text-xs mb-3 border border-slate-100 dark:border-zinc-800">
                  <div>
                    <span className="text-slate-400 dark:text-zinc-400 block text-[11px]">Durasi Total</span>
                    <span className="font-semibold text-slate-800 dark:text-zinc-200 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-emerald-600" /> {exam.durationMinutes} mnt
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 dark:text-zinc-400 block text-[11px]">Jumlah Soal</span>
                    <span className="font-semibold text-slate-800 dark:text-zinc-200 flex items-center gap-1">
                      <FileQuestion className="w-3.5 h-3.5 text-teal-600" /> {exam.totalQuestions} soal
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 dark:text-zinc-400 block text-[11px]">Passing Grade</span>
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                      {exam.passPercentage}%
                    </span>
                  </div>
                </div>

                {/* Active Settings Badges */}
                <div className="p-2.5 rounded-xl bg-slate-100/70 dark:bg-zinc-800/40 border border-slate-200 dark:border-zinc-800 flex flex-wrap gap-1.5 text-[10px] font-semibold text-slate-700 dark:text-zinc-300">
                  <span className={`px-2 py-0.5 rounded-md border ${exam.shuffleQuestions ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    🔀 Soal Acak: {exam.shuffleQuestions ? 'Ya' : 'Tidak'}
                  </span>
                  <span className={`px-2 py-0.5 rounded-md border ${exam.shuffleAnswers ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    🔀 Opsi Acak: {exam.shuffleAnswers ? 'Ya' : 'Tidak'}
                  </span>
                  <span className={`px-2 py-0.5 rounded-md border ${exam.isStrictTimer !== false ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    ⏱️ Strict Timer: {exam.isStrictTimer !== false ? 'Aktif' : 'Off'}
                  </span>
                  <span className={`px-2 py-0.5 rounded-md border ${exam.showInstantFeedback ? 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    ⚡ Feedback Instan: {exam.showInstantFeedback ? 'Aktif' : 'Off'}
                  </span>
                  <span className={`px-2 py-0.5 rounded-md border ${exam.showAnswerKeys !== false ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    🔑 Kunci Jawaban: {exam.showAnswerKeys !== false ? 'Tampil' : 'Sembunyi'}
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-zinc-800">
                {/* Secondary Action Buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => openEditModal(exam)}
                    className="justify-center text-xs font-bold text-slate-700 dark:text-zinc-200 border-slate-300 dark:border-zinc-700 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    <Settings className="w-3.5 h-3.5 text-slate-600" />
                    Pengaturan Sesi
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => setSelectedExamForQuestions(exam)}
                    className="justify-center text-xs font-bold text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/60 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    Kelola Soal ({exam.totalQuestions})
                  </Button>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleToggleActive(exam.id)}
                    className={`py-2 px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1 shadow-xs transition-all cursor-pointer ${
                      exam.isActive
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        : 'bg-slate-700 hover:bg-slate-800 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-white'
                    }`}
                  >
                    <Power className="w-3.5 h-3.5 shrink-0" />
                    <span>{exam.isActive ? 'Nonaktifkan' : 'Aktifkan'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleResetExam(exam.id, exam.title)}
                    className="py-2 px-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center justify-center gap-1 shadow-xs transition-all cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                    <span>Reset Sesi</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteExam(exam.id, exam.title)}
                    className="py-2 px-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center justify-center gap-1 shadow-xs transition-all cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Hapus</span>
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal Create/Edit Exam Settings */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingExam(null);
        }}
        title={editingExam ? `Edit Pengaturan Sesi: ${editingExam.title}` : "Buat Sesi Ujian CBT Baru"}
        maxWidth="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => { setIsModalOpen(false); setEditingExam(null); }}>
              Batal
            </Button>
            <Button
              variant="primary"
              onClick={() => handleSaveExam()}
              isLoading={isSubmitting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {editingExam ? 'Simpan Perubahan' : 'Buat Ujian Baru'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSaveExam} className="space-y-4 text-xs">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg flex items-center gap-2 text-xs font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Section 1: Data Utama */}
          <div className="p-3 bg-slate-50 dark:bg-zinc-800/50 rounded-xl border border-slate-200/80 dark:border-zinc-700/80 space-y-3">
            <h4 className="font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5 text-xs">
              <BookOpen className="w-4 h-4 text-emerald-600" />
              <span>Informasi Utama Sesi Ujian</span>
            </h4>

            <div>
              <label className="block font-semibold mb-1">Judul Ujian</label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Contoh: Ujian Pemrograman Web & Database"
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Mata Pelajaran / Topik</label>
                <input
                  type="text"
                  required
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  placeholder="Informatika"
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-semibold">Token Ujian (Akses Peserta)</label>
                  <button
                    type="button"
                    onClick={() => {
                      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                      let rand = '';
                      for (let i = 0; i < 6; i++) {
                        rand += chars.charAt(Math.floor(Math.random() * chars.length));
                      }
                      setFormData(prev => ({ ...prev, token: rand }));
                    }}
                    className="text-xs text-primary hover:underline flex items-center gap-1 font-medium cursor-pointer"
                    title="Buat token acak baru"
                  >
                    <RefreshCw className="w-3 h-3" /> Acak Token
                  </button>
                </div>
                <input
                  type="text"
                  required
                  value={formData.token}
                  onChange={(e) => setFormData({ ...formData, token: e.target.value.toUpperCase() })}
                  placeholder="EXAM2026"
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 font-mono uppercase font-bold tracking-wider"
                />
                <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
                  Setiap kali token diganti, token lama otomatis hangus dan tidak dapat digunakan lagi.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold mb-1">Durasi Total (Menit)</label>
                <input
                  type="number"
                  min={1}
                  value={formData.durationMinutes}
                  onChange={(e) => setFormData({ ...formData, durationMinutes: parseInt(e.target.value) || 30 })}
                  className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Passing Grade (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={formData.passPercentage}
                  onChange={(e) => setFormData({ ...formData, passPercentage: parseInt(e.target.value) || 70 })}
                  className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Max Pelanggaran</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={formData.maxViolations}
                  onChange={(e) => setFormData({ ...formData, maxViolations: parseInt(e.target.value) || 3 })}
                  className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Pilihan Acak Soal & Jawaban */}
          <div className="p-3 bg-slate-100/70 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl space-y-2">
            <h4 className="font-bold text-slate-900 dark:text-zinc-200 flex items-center gap-1.5 text-xs">
              <Shuffle className="w-4 h-4 text-emerald-600" />
              <span>1. Pengaturan Acak Soal & Jawaban</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
                <input
                  type="checkbox"
                  checked={formData.shuffleQuestions}
                  onChange={(e) => setFormData({ ...formData, shuffleQuestions: e.target.checked })}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                />
                <div>
                  <span className="font-bold block text-slate-800 dark:text-zinc-200">Acak Urutan Soal</span>
                  <span className="text-[10px] text-slate-500">Urutan soal diacak untuk setiap peserta</span>
                </div>
              </label>

              <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800">
                <input
                  type="checkbox"
                  checked={formData.shuffleAnswers}
                  onChange={(e) => setFormData({ ...formData, shuffleAnswers: e.target.checked })}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                />
                <div>
                  <span className="font-bold block text-slate-800 dark:text-zinc-200">Acak Pilihan Jawaban</span>
                  <span className="text-[10px] text-slate-500">Opsi A, B, C, D diacak per-soal</span>
                </div>
              </label>
            </div>
          </div>

          {/* Section 3: Pengaturan Strict Timer */}
          <div className="p-3 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl space-y-2.5">
            <h4 className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5 text-xs">
              <Timer className="w-4 h-4 text-amber-600" />
              <span>2. Pengaturan Strict Timer & Waktu Ujian</span>
            </h4>

            <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg bg-white dark:bg-zinc-900 border border-amber-200/80 dark:border-amber-900/60">
              <input
                type="checkbox"
                checked={formData.isStrictTimer}
                onChange={(e) => setFormData({ ...formData, isStrictTimer: e.target.checked })}
                className="rounded border-amber-400 text-amber-600 focus:ring-amber-500 w-4 h-4 mt-0.5 cursor-pointer"
              />
              <div>
                <span className="font-bold block text-amber-900 dark:text-amber-200">Strict Timer (Submisi Otomatis Ketat saat Waktu Habis)</span>
                <span className="text-[10px] text-slate-500 dark:text-zinc-400">
                  Ketika durasi waktu habis, sistem langsung melakukan kunci otomatis dan mengunci input tanpa toleransi keterlambatan.
                </span>
              </div>
            </label>

            <div className="p-2 rounded-lg bg-white dark:bg-zinc-900 border border-amber-200/80 dark:border-amber-900/60 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800 dark:text-zinc-200">
                <input
                  type="checkbox"
                  checked={formData.isPerQuestionTimed}
                  onChange={(e) => setFormData({ ...formData, isPerQuestionTimed: e.target.checked })}
                  className="rounded border-amber-400 text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                />
                <Lock className="w-3.5 h-3.5 text-amber-600" />
                <span>Mode Berwaktu Per-Soal (Strict Timer Per-Soal)</span>
              </label>

              {formData.isPerQuestionTimed && (
                <div className="pt-1 flex items-center gap-2 pl-6">
                  <label className="font-semibold text-slate-700 dark:text-zinc-300 text-[11px]">Durasi Waktu Per-Soal (detik):</label>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={formData.questionDurationSeconds}
                    onChange={(e) => setFormData({ ...formData, questionDurationSeconds: parseInt(e.target.value) || 30 })}
                    className="w-24 p-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-slate-50 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 font-mono font-bold text-xs"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Section 4: Pengaturan Feedback & Kunci Jawaban */}
          <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl space-y-2">
            <h4 className="font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>3. Pengaturan Feedback & Kunci Jawaban</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg bg-white dark:bg-zinc-900 border border-emerald-100 dark:border-zinc-800">
                <input
                  type="checkbox"
                  checked={formData.showInstantFeedback}
                  onChange={(e) => setFormData({ ...formData, showInstantFeedback: e.target.checked })}
                  className="rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500 w-4 h-4 mt-0.5 cursor-pointer"
                />
                <div>
                  <span className="font-bold block text-slate-800 dark:text-zinc-200">Feedback Instan (Benar/Salah)</span>
                  <span className="text-[10px] text-slate-500">
                    Tampilkan indikator Benar/Salah secara langsung saat peserta memilih opsi jawaban.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-2 cursor-pointer p-2 rounded-lg bg-white dark:bg-zinc-900 border border-emerald-100 dark:border-zinc-800">
                <input
                  type="checkbox"
                  checked={formData.showAnswerKeys}
                  onChange={(e) => setFormData({ ...formData, showAnswerKeys: e.target.checked })}
                  className="rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500 w-4 h-4 mt-0.5 cursor-pointer"
                />
                <div>
                  <span className="font-bold block text-slate-800 dark:text-zinc-200">Tampilkan Kunci Jawaban & Pembahasan</span>
                  <span className="text-[10px] text-slate-500">
                    Izinkan peserta melihat kunci jawaban dan pembahasan setelah ujian selesai disubmit.
                  </span>
                </div>
              </label>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};
