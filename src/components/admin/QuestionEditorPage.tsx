import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  Code,
  Save,
  AlertCircle,
  Upload,
  Layers,
  Copy,
  Download,
  FileSpreadsheet,
  Image as ImageIcon,
  X,
  Sparkles,
  Link2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { FormattedText } from '../ui/CodeBlock';
import { ImportQuestionsModal } from './ImportQuestionsModal';
import { EssayAiRubricEditor } from './EssayAiRubricEditor';
import { api } from '../../services/api';
import { Exam, Question, QuestionType, QuestionOption, EssayAiRubric, ShortAnswerMultiItem } from '../../types/cbt';

interface QuestionEditorPageProps {
  exam: Exam;
  onBack: () => void;
  onQuestionsSaved?: () => void;
}

export const QuestionEditorPage: React.FC<QuestionEditorPageProps> = ({
  exam,
  onBack,
  onQuestionsSaved,
}) => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Import Modal state
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // Form state for individual question
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [type, setType] = useState<QuestionType>('MULTIPLE_CHOICE');
  const [questionText, setQuestionText] = useState('');
  const [questionImageUrl, setQuestionImageUrl] = useState('');
  const [showQuestionUrlInput, setShowQuestionUrlInput] = useState(false);
  const [points, setPoints] = useState(20);
  const [options, setOptions] = useState<QuestionOption[]>([
    { id: 'opt_1', optionText: '' },
    { id: 'opt_2', optionText: '' },
    { id: 'opt_3', optionText: '' },
    { id: 'opt_4', optionText: '' },
  ]);
  const [correctOptionId, setCorrectOptionId] = useState<string>('opt_1');
  const [essayAnswerKey, setEssayAnswerKey] = useState('');
  const [essayAiRubric, setEssayAiRubric] = useState<EssayAiRubric | undefined>(undefined);
  const [shortAnswerKey, setShortAnswerKey] = useState('');
  const [shortAnswerMultiItems, setShortAnswerMultiItems] = useState<ShortAnswerMultiItem[]>([
    { blank: 1, answer: '' },
    { blank: 2, answer: '' },
  ]);
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);

  const questionImageInputRef = useRef<HTMLInputElement>(null);
  const optionImageInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  const handleAutoDetectBlanks = () => {
    const set = new Set<number>();
    const r = /_{2,}\s*\(?\s*(\d+)\s*\)?\s*_{2,}/g;
    let m: RegExpExecArray | null;
    while ((m = r.exec(questionText)) !== null) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n)) set.add(n);
    }
    if (set.size === 0) {
      setErrorMessage('Tidak ditemukan pola ____(1)____, ____(2)____ pada teks pertanyaan soal.');
      return;
    }
    const detected = Array.from(set).sort((a, b) => a - b);
    const newItems: ShortAnswerMultiItem[] = detected.map((blankNum) => {
      const existing = shortAnswerMultiItems.find((item) => item.blank === blankNum);
      return existing || { blank: blankNum, answer: '' };
    });
    setShortAnswerMultiItems(newItems);
    setSuccessMessage(`Berhasil mendeteksi ${detected.length} slot isian blank dari teks soal!`);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleInsertBlankTag = () => {
    const nextNum = shortAnswerMultiItems.length + 1;
    const tag = `____(${nextNum})____`;
    setQuestionText((prev) => prev + tag);
    setShortAnswerMultiItems((prev) => [...prev, { blank: nextNum, answer: '' }]);
  };

  const fetchExamQuestions = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.get(`/exams/${exam.id}`);
      const serverQuestions: Question[] = res.data.data?.questions || [];
      setQuestions(serverQuestions);
    } catch (e: any) {
      console.error('Gagal memuat soal dari server/Cloudflare:', e);
      setErrorMessage('Gagal memuat daftar soal dari server.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchExamQuestions();
    resetForm();
  }, [exam.id]);

  const resetForm = () => {
    setEditingQuestionId(null);
    setType('MULTIPLE_CHOICE');
    setQuestionText('');
    setQuestionImageUrl('');
    setShowQuestionUrlInput(false);
    setPoints(20);
    const newOptions = [
      { id: `opt_1_${Date.now()}`, optionText: '' },
      { id: `opt_2_${Date.now()}`, optionText: '' },
      { id: `opt_3_${Date.now()}`, optionText: '' },
      { id: `opt_4_${Date.now()}`, optionText: '' },
    ];
    setOptions(newOptions);
    setCorrectOptionId(newOptions[0].id);
    setEssayAnswerKey('');
    setEssayAiRubric(undefined);
    setShortAnswerKey('');
    setShortAnswerMultiItems([
      { blank: 1, answer: '' },
      { blank: 2, answer: '' },
    ]);
    setIsCaseSensitive(false);
  };

  const handleInsertCodeSnippet = (lang: string) => {
    let snippet = '';
    if (lang === 'html') {
      snippet = '\n\n```html\n<div class="container">\n  <h1>Judul Halaman</h1>\n</div>\n```';
    } else if (lang === 'css') {
      snippet = '\n\n```css\n.button {\n  display: flex;\n  background-color: #2563eb;\n}\n```';
    } else if (lang === 'php') {
      snippet = '\n\n```php\n<form action="" method="____(1)____">\n    Jumlah: <input type="number" name="____(2)____">\n    <button type="submit" name="____(3)____">Hitung</button>\n</form>\n```';
    } else if (lang === 'sql') {
      snippet = '\n\n```sql\nSELECT * FROM users \nWHERE status = "ACTIVE" \nORDER BY id DESC;\n```';
    } else if (lang === 'js') {
      snippet = '\n\n```javascript\nconst score = 85;\nif (score >= 75) {\n  console.log("LULUS");\n}\n```';
    }
    setQuestionText((prev) => prev + snippet);
  };

  const handleQuestionFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setErrorMessage('Ukuran file gambar maksimal 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setQuestionImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleOptionFileUpload = (optionId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1.5 * 1024 * 1024) {
      setErrorMessage('Ukuran file gambar pilihan maksimal 1.5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setOptions((prev) =>
          prev.map((opt) => (opt.id === optionId ? { ...opt, imageUrl: reader.result as string } : opt))
        );
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const syncQuestionsToServer = async (updatedQuestions: Question[]) => {
    setIsSaving(true);
    try {
      // Satu-satunya sumber penyimpanan adalah database server (Supabase).
      // Tidak ada lagi salinan di browser, jadi daftar soal selalu sama dengan isi database.
      const res = await api.post(`/exams/${exam.id}/questions`, { questions: updatedQuestions });
      if (res.data?.persisted === false) {
        setErrorMessage('Perubahan belum tersimpan permanen di database. Periksa koneksi database lalu simpan ulang.');
      }
      if (onQuestionsSaved) onQuestionsSaved();
      // Muat ulang dari server supaya tampilan = isi database sebenarnya.
      await fetchExamQuestions();
    } catch (e: any) {
      console.error('Gagal menyimpan soal ke server:', e);
      setErrorMessage('Gagal menyimpan soal ke database. Perubahan dibatalkan.');
      // Kembalikan daftar ke kondisi database, bukan menyimpan salinan lokal.
      await fetchExamQuestions();
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddQuestionToList = () => {
    if (!questionText.trim()) {
      setErrorMessage('Isi teks pertanyaan tidak boleh kosong!');
      return;
    }

    if (type !== 'ESSAY' && type !== 'SHORT_ANSWER' && type !== 'SHORT_ANSWER_MULTI') {
      const emptyOpt = options.find((o) => !o.optionText.trim() && !o.imageUrl);
      if (emptyOpt) {
        setErrorMessage('Seluruh pilihan jawaban harus diisi teks atau gambar!');
        return;
      }
    }

    if (type === 'SHORT_ANSWER' && !shortAnswerKey.trim()) {
      setErrorMessage('Kunci jawaban isian singkat wajib diisi!');
      return;
    }

    if (type === 'SHORT_ANSWER_MULTI') {
      const validItems = shortAnswerMultiItems.filter((item) => item.answer.trim().length > 0);
      if (validItems.length === 0) {
        setErrorMessage('Setidaknya satu kunci jawaban blank harus diisi!');
        return;
      }
    }

    const shortKeysParsed = type === 'SHORT_ANSWER'
      ? (shortAnswerKey.includes('|')
          ? shortAnswerKey.split('|').map((s) => s.trim()).filter(Boolean)
          : shortAnswerKey.includes(',')
          ? shortAnswerKey.split(',').map((s) => s.trim()).filter(Boolean)
          : [shortAnswerKey.trim()])
      : undefined;

    setErrorMessage(null);

    const isNonOption = type === 'ESSAY' || type === 'SHORT_ANSWER' || type === 'SHORT_ANSWER_MULTI';

    let updatedList: Question[] = [];
    if (editingQuestionId) {
      updatedList = questions.map((q) =>
        q.id === editingQuestionId
          ? {
              ...q,
              type,
              questionText,
              imageUrl: questionImageUrl.trim() || undefined,
              points,
              options: isNonOption ? [] : options,
              correctOptionId: isNonOption ? undefined : correctOptionId,
              essayAnswerKey: type === 'ESSAY' ? essayAnswerKey : undefined,
              essayAiRubric: type === 'ESSAY' ? essayAiRubric : undefined,
              shortAnswerKey: type === 'SHORT_ANSWER' ? shortAnswerKey.trim() : undefined,
              shortAnswerKeys: shortKeysParsed,
              answerKey: type === 'SHORT_ANSWER_MULTI' ? shortAnswerMultiItems : undefined,
              shortAnswerMultiKey: type === 'SHORT_ANSWER_MULTI' ? shortAnswerMultiItems : undefined,
              isCaseSensitive: (type === 'SHORT_ANSWER' || type === 'SHORT_ANSWER_MULTI') ? isCaseSensitive : undefined,
            }
          : q
      );
    } else {
      const newQuestion: Question = {
        id: `q_${Date.now()}`,
        examId: exam.id,
        type,
        questionText,
        imageUrl: questionImageUrl.trim() || undefined,
        points,
        options: isNonOption ? [] : options,
        correctOptionId: isNonOption ? undefined : correctOptionId,
        essayAnswerKey: type === 'ESSAY' ? essayAnswerKey : undefined,
        essayAiRubric: type === 'ESSAY' ? essayAiRubric : undefined,
        shortAnswerKey: type === 'SHORT_ANSWER' ? shortAnswerKey.trim() : undefined,
        shortAnswerKeys: shortKeysParsed,
        answerKey: type === 'SHORT_ANSWER_MULTI' ? shortAnswerMultiItems : undefined,
        shortAnswerMultiKey: type === 'SHORT_ANSWER_MULTI' ? shortAnswerMultiItems : undefined,
        isCaseSensitive: (type === 'SHORT_ANSWER' || type === 'SHORT_ANSWER_MULTI') ? isCaseSensitive : undefined,
      };
      updatedList = [...questions, newQuestion];
    }

    setQuestions(updatedList);
    syncQuestionsToServer(updatedList);

    resetForm();
    setSuccessMessage(
      editingQuestionId
        ? 'Soal berhasil diperbarui dan tersimpan ke database!'
        : 'Soal berhasil ditambahkan dan tersimpan otomatis ke database!'
    );
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const handleEditQuestion = (q: Question) => {
    setEditingQuestionId(q.id);
    setType(q.type);
    setQuestionText(q.questionText);
    setQuestionImageUrl(q.imageUrl || '');
    setShowQuestionUrlInput(!!q.imageUrl && !q.imageUrl.startsWith('data:'));
    setPoints(q.points);
    if (q.options && q.options.length > 0) {
      setOptions(q.options);
      setCorrectOptionId(q.correctOptionId || q.options[0].id);
    } else {
      const newOptions = [
        { id: `opt_1_${Date.now()}`, optionText: '' },
        { id: `opt_2_${Date.now()}`, optionText: '' },
      ];
      setOptions(newOptions);
      setCorrectOptionId(newOptions[0].id);
    }
    setEssayAnswerKey(q.essayAnswerKey || '');
    setEssayAiRubric(q.essayAiRubric);
    setShortAnswerKey(q.shortAnswerKey || (q.shortAnswerKeys || []).join(' | ') || '');
    if (q.type === 'SHORT_ANSWER_MULTI') {
      const keys = q.answerKey || q.shortAnswerMultiKey || [];
      if (keys.length > 0) {
        setShortAnswerMultiItems(keys);
      } else {
        setShortAnswerMultiItems([
          { blank: 1, answer: '' },
          { blank: 2, answer: '' },
        ]);
      }
    }
    setIsCaseSensitive(!!q.isCaseSensitive);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteQuestion = (questionId: string) => {
    const updated = questions.filter((q) => q.id !== questionId);
    setQuestions(updated);
    syncQuestionsToServer(updated);
  };

  const handleDuplicateQuestion = (q: Question) => {
    const dup: Question = {
      ...q,
      id: `q_${Date.now()}`,
      questionText: `${q.questionText} (Salinan)`,
    };
    const updated = [...questions, dup];
    setQuestions(updated);
    syncQuestionsToServer(updated);
  };

  const handleImportedQuestionsReceived = (imported: Question[]) => {
    const updated = [...questions, ...imported];
    setQuestions(updated);
    syncQuestionsToServer(updated);
    setSuccessMessage(`Berhasil mengimpor ${imported.length} soal dan tersimpan ke database!`);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const handleExportQuestionsBackup = () => {
    if (questions.length === 0) {
      setErrorMessage('Belum ada soal untuk diekspor. Tambahkan atau impor soal terlebih dahulu.');
      return;
    }

    const backupData = {
      examTitle: exam.title,
      subject: exam.subject,
      examToken: exam.token,
      exportedAt: new Date().toISOString(),
      totalQuestions: questions.length,
      questions: questions,
    };

    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup_soal_${exam.token}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setSuccessMessage(`File backup berisi ${questions.length} soal berhasil diunduh ke komputer Anda!`);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const handleExportQuestionsExcel = () => {
    if (questions.length === 0) {
      setErrorMessage('Belum ada soal untuk diekspor. Tambahkan atau impor soal terlebih dahulu.');
      return;
    }

    const headers = [
      'No',
      'Tipe Soal',
      'Teks Pertanyaan',
      'Gambar Soal (URL)',
      'Bobot Poin',
      'Pilihan A',
      'Pilihan B',
      'Pilihan C',
      'Pilihan D',
      'Kunci Jawaban Benar',
    ];
    const rows = questions.map((q, idx) => {
      const optA = q.options?.[0]?.optionText || '';
      const optB = q.options?.[1]?.optionText || '';
      const optC = q.options?.[2]?.optionText || '';
      const optD = q.options?.[3]?.optionText || '';

      let keyText = '';
      if (q.type === 'ESSAY') {
        keyText = q.essayAnswerKey || 'Uraian Auto-Graded';
      } else {
        const correctIndex = q.options?.findIndex((o) => o.id === q.correctOptionId);
        if (correctIndex !== undefined && correctIndex !== -1) {
          keyText = String.fromCharCode(65 + correctIndex);
        }
      }

      return [
        idx + 1,
        `"${q.type}"`,
        `"${q.questionText.replace(/"/g, '""')}"`,
        `"${(q.imageUrl || '').replace(/"/g, '""')}"`,
        q.points,
        `"${optA.replace(/"/g, '""')}"`,
        `"${optB.replace(/"/g, '""')}"`,
        `"${optC.replace(/"/g, '""')}"`,
        `"${optD.replace(/"/g, '""')}"`,
        `"${keyText.replace(/"/g, '""')}"`,
      ];
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `soal_ujian_${exam.token}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setSuccessMessage(`File Excel (.csv) berisi ${questions.length} soal berhasil diunduh!`);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const handleSaveAllToServer = async () => {
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await api.post(`/exams/${exam.id}/questions`, { questions });
      setSuccessMessage('Seluruh soal untuk ujian ini berhasil disimpan ke server!');
      if (onQuestionsSaved) onQuestionsSaved();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e: any) {
      console.error(e);
      setErrorMessage(e.response?.data?.error || 'Gagal menyimpan soal ujian ke server');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Top Header Bar */}
      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={onBack}
            className="border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali ke Sesi Ujian
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 dark:text-zinc-100">{exam.title}</h1>
              <Badge variant="emerald">Token: {exam.token}</Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              Mata Pelajaran: <span className="font-semibold text-slate-700 dark:text-zinc-300">{exam.subject}</span> • Total {questions.length} Soal Khusus Ujian Ini
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button
            variant="outline"
            onClick={() => setIsImportModalOpen(true)}
            className="border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <Upload className="w-4 h-4" />
            Impor Soal
          </Button>

          <Button
            variant="outline"
            onClick={handleExportQuestionsBackup}
            className="border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40"
          >
            <Download className="w-4 h-4" />
            Ekspor Backup (JSON)
          </Button>

          <Button
            variant="outline"
            onClick={handleExportQuestionsExcel}
            className="border-teal-300 dark:border-teal-800 text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40"
          >
            <FileSpreadsheet className="w-4 h-4 text-teal-600" />
            Ekspor Excel (.csv)
          </Button>

          <Button
            variant="primary"
            onClick={handleSaveAllToServer}
            isLoading={isSaving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200 dark:shadow-none"
          >
            <Save className="w-4 h-4" />
            Simpan ke Server ({questions.length})
          </Button>
        </div>
      </div>

      {errorMessage && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-2xl flex items-center gap-3 text-xs font-semibold shadow-xs">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-2xl flex items-center gap-3 text-xs font-semibold shadow-xs">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Main Grid: 2 Columns for Spacious Editing */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Editor Panel (7 Columns) */}
        <section className="lg:col-span-7 space-y-6">
          <Card className="border-slate-200 dark:border-zinc-800 shadow-sm p-6">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-zinc-100">
                    {editingQuestionId ? 'Form Edit Soal' : 'Form Tambah Soal Baru'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">Soal ini tersimpan eksklusif untuk ujian "{exam.title}"</p>
                </div>
              </div>
              {editingQuestionId && (
                <Button variant="ghost" size="sm" onClick={resetForm} className="text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200">
                  Batal Edit
                </Button>
              )}
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold mb-1.5 text-slate-700 dark:text-zinc-300">Tipe Soal</label>
                  <select
                    value={type}
                    onChange={(e) => {
                      const newType = e.target.value as QuestionType;
                      setType(newType);
                      if (newType === 'TRUE_FALSE') {
                        setOptions([
                          { id: 'opt_true', optionText: 'BENAR (True)' },
                          { id: 'opt_false', optionText: 'SALAH (False)' },
                        ]);
                        setCorrectOptionId('opt_true');
                      }
                    }}
                    className="w-full p-3 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 font-medium focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="MULTIPLE_CHOICE">Pilihan Ganda (Multiple Choice)</option>
                    <option value="TRUE_FALSE">Benar / Salah (True / False)</option>
                    <option value="SHORT_ANSWER">Isian Singkat / Lengkapi Kode (1 Jawaban)</option>
                    <option value="SHORT_ANSWER_MULTI">Isian Kode Multi-Blank (____(1)____ s/d ____(N)____)</option>
                    <option value="ESSAY">Uraian / Essay (Auto Koreksi Otomatis)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1.5 text-slate-700 dark:text-zinc-300">Bobot Poin Skor</label>
                  <input
                    type="number"
                    min={1}
                    value={points}
                    onChange={(e) => setPoints(parseInt(e.target.value) || 10)}
                    className="w-full p-3 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 font-mono font-bold focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Teks Pertanyaan & Toolbar Kode */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block font-semibold text-slate-700 dark:text-zinc-300">
                    Teks Pertanyaan Soal
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                      <Code className="w-3.5 h-3.5 text-emerald-600" /> Sisipkan Kode:
                    </span>
                    {['html', 'css', 'php', 'sql', 'js'].map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => handleInsertCodeSnippet(lang)}
                        className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-mono text-[10px] uppercase font-bold hover:bg-emerald-600 hover:text-white transition-colors cursor-pointer"
                      >
                        +{lang}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  rows={5}
                  value={questionText}
                  onChange={(e) => setQuestionText(e.target.value)}
                  placeholder="Ketik isi pertanyaan soal di sini... Anda bisa memasukkan snippet kode program dengan format ```php ... ```"
                  className="w-full p-4 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 font-mono text-xs leading-relaxed focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {/* Upload / Link Gambar Pertanyaan Soal */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-zinc-950/60 border border-slate-200 dark:border-zinc-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-emerald-600" />
                    <span className="font-semibold text-slate-700 dark:text-zinc-200">
                      Gambar / Ilustrasi Soal (Opsional)
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      ref={questionImageInputRef}
                      onChange={handleQuestionFileUpload}
                      accept="image/*"
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => questionImageInputRef.current?.click()}
                      className="text-[11px] h-7 border-slate-300 dark:border-zinc-700"
                    >
                      <Upload className="w-3 h-3" />
                      Upload Gambar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowQuestionUrlInput(!showQuestionUrlInput)}
                      className="text-[11px] h-7 text-slate-600 dark:text-zinc-400"
                    >
                      <Link2 className="w-3 h-3" />
                      {showQuestionUrlInput ? 'Tutup URL' : 'Input URL'}
                    </Button>
                  </div>
                </div>

                {showQuestionUrlInput && (
                  <input
                    type="url"
                    value={questionImageUrl}
                    onChange={(e) => setQuestionImageUrl(e.target.value)}
                    placeholder="https://example.com/gambar-diagram.png"
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-xs font-mono"
                  />
                )}

                {questionImageUrl && (
                  <div className="relative inline-block border border-slate-300 dark:border-zinc-700 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 p-1 group">
                    <img
                      src={questionImageUrl}
                      alt="Gambar Pertanyaan"
                      className="max-h-48 max-w-full rounded-lg object-contain"
                      onError={() => setErrorMessage('Gagal memuat gambar dari URL/Data yang dimasukkan.')}
                    />
                    <button
                      type="button"
                      onClick={() => setQuestionImageUrl('')}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-rose-600 text-white shadow-md hover:bg-rose-700 transition-colors"
                      title="Hapus Gambar"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Live Preview Code */}
              {questionText.includes('```') && (
                <div className="p-4 bg-slate-50 dark:bg-zinc-950 rounded-xl border border-slate-200 dark:border-zinc-800">
                  <div className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2">
                    Pratinjau Tampilan Kode Soal:
                  </div>
                  <FormattedText text={questionText} />
                </div>
              )}

              {/* Options Input Section for Multiple Choice / True False */}
              {type !== 'ESSAY' && type !== 'SHORT_ANSWER' && type !== 'SHORT_ANSWER_MULTI' && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <label className="block font-semibold text-slate-700 dark:text-zinc-300">
                      Pilihan Jawaban & Tandai KUNCI JAWABAN (Radio Button)
                    </label>
                    {type === 'MULTIPLE_CHOICE' && options.length < 6 && (
                      <button
                        type="button"
                        onClick={() => {
                          const newId = `opt_${Date.now()}`;
                          setOptions([...options, { id: newId, optionText: '' }]);
                        }}
                        className="text-emerald-600 dark:text-emerald-400 font-bold hover:underline flex items-center gap-1 text-xs cursor-pointer"
                      >
                        + Opsi Pilihan Jawaban
                      </button>
                    )}
                  </div>

                  <div className="space-y-3">
                    {options.map((opt, idx) => {
                      const label = String.fromCharCode(65 + idx);
                      const isCorrect = correctOptionId === opt.id;

                      return (
                        <div
                          key={opt.id}
                          className={`p-3 rounded-xl border transition-all space-y-2.5 ${
                            isCorrect
                              ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 text-slate-900 dark:text-zinc-100'
                              : 'border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="radio"
                              name="correctAnswer"
                              checked={isCorrect}
                              onChange={() => setCorrectOptionId(opt.id)}
                              className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            />
                            <span className="font-bold font-mono text-slate-500 dark:text-zinc-400 w-6 text-center text-sm">
                              {label}.
                            </span>
                            <input
                              type="text"
                              value={opt.optionText}
                              onChange={(e) => {
                                const updated = [...options];
                                updated[idx].optionText = e.target.value;
                                setOptions(updated);
                              }}
                              placeholder={`Teks pilihan ${label}...`}
                              className="flex-1 p-2.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-xs focus:ring-2 focus:ring-emerald-500"
                            />

                            {/* Option image upload trigger */}
                            <input
                              type="file"
                              ref={(el) => (optionImageInputRefs.current[opt.id] = el)}
                              onChange={(e) => handleOptionFileUpload(opt.id, e)}
                              accept="image/*"
                              className="hidden"
                            />
                            <button
                              type="button"
                              onClick={() => optionImageInputRefs.current[opt.id]?.click()}
                              className={`p-2 rounded-lg border transition-colors flex items-center gap-1 text-[11px] ${
                                opt.imageUrl
                                  ? 'border-emerald-400 bg-emerald-100/60 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                                  : 'border-slate-200 dark:border-zinc-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800'
                              }`}
                              title="Tambah Gambar untuk Opsi Pilihan ini"
                            >
                              <ImageIcon className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">{opt.imageUrl ? 'Ganti Gbr' : '+Gbr'}</span>
                            </button>

                            {isCorrect && <Badge variant="emerald">Kunci Jawaban</Badge>}
                            {type === 'MULTIPLE_CHOICE' && options.length > 2 && (
                              <button
                                type="button"
                                onClick={() => setOptions(options.filter((o) => o.id !== opt.id))}
                                className="text-slate-400 hover:text-rose-600 p-1.5 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>

                          {/* Render option image preview if present */}
                          {opt.imageUrl && (
                            <div className="flex items-center gap-2 pl-9">
                              <div className="relative border border-slate-300 dark:border-zinc-700 rounded-lg p-1 bg-white dark:bg-zinc-950">
                                <img
                                  src={opt.imageUrl}
                                  alt={`Gambar Pilihan ${label}`}
                                  className="h-16 w-auto object-contain rounded"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOptions((prev) =>
                                      prev.map((o) => (o.id === opt.id ? { ...o, imageUrl: undefined } : o))
                                    );
                                  }}
                                  className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-rose-600 text-white shadow hover:bg-rose-700"
                                  title="Hapus Gambar Opsi"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </div>
                              <span className="text-[10px] text-slate-400">Gambar pilihan {label} terlampir</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Short Answer / Code Completion Section */}
              {type === 'SHORT_ANSWER' && (
                <div className="space-y-4 pt-2 p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-2">
                      <Code className="w-4 h-4 text-emerald-600" />
                      <span>Kunci Jawaban Isian Singkat / Baris Kode</span>
                    </label>
                    <Badge variant="teal" size="sm">Auto Koreksi Otomatis</Badge>
                  </div>

                  <div>
                    <input
                      type="text"
                      value={shortAnswerKey}
                      onChange={(e) => setShortAnswerKey(e.target.value)}
                      placeholder="Contoh: echo atau $total = $a + $b; atau mysqli_connect"
                      className="w-full p-3 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 font-mono text-sm focus:ring-2 focus:ring-emerald-500 shadow-xs"
                    />
                    <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
                      💡 <strong>Format Alternatif:</strong> Pisahkan dengan karakter garis tegak <code className="bg-white dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-zinc-700 font-mono font-bold">|</code> jika ada beberapa kemungkinan jawaban yang benar (contoh: <code className="bg-white dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-zinc-700 font-mono text-emerald-600 dark:text-emerald-400">echo | print</code> atau <code className="bg-white dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-zinc-700 font-mono text-emerald-600 dark:text-emerald-400">SELECT | select</code>).
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-1 border-t border-emerald-200/60 dark:border-emerald-900/40">
                    <input
                      type="checkbox"
                      id="caseSensitiveToggle"
                      checked={isCaseSensitive}
                      onChange={(e) => setIsCaseSensitive(e.target.checked)}
                      className="rounded border-slate-300 dark:border-zinc-700 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                    />
                    <label htmlFor="caseSensitiveToggle" className="text-xs font-semibold text-slate-700 dark:text-zinc-300 cursor-pointer select-none">
                      Sensitif Huruf Besar / Kecil (Case-Sensitive)
                    </label>
                    <span className="text-[10px] text-slate-500 dark:text-zinc-400">
                      (Centang jika jawaban harus persis huruf kapital/kecilnya)
                    </span>
                  </div>
                </div>
              )}

              {/* Short Answer Multi (Blank-based) Configuration */}
              {type === 'SHORT_ANSWER_MULTI' && (
                <div className="space-y-4 pt-2 p-4 rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/40 dark:bg-sky-950/20">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-2">
                      <Code className="w-4 h-4 text-sky-600" />
                      <span>Kunci Jawaban Isian Multi-Blank (____(1)____ s/d ____(N)____)</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleAutoDetectBlanks}
                        className="text-xs font-semibold text-sky-600 hover:text-sky-700 bg-white dark:bg-zinc-800 border border-sky-300 dark:border-sky-700 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-xs cursor-pointer"
                        title="Deteksi otomatis seluruh pola ____(1)____ pada teks soal"
                      >
                        <span>🔍 Deteksi Dari Teks</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleInsertBlankTag}
                        className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 bg-white dark:bg-zinc-800 border border-emerald-300 dark:border-emerald-700 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-xs cursor-pointer"
                      >
                        <span>+ Sisipkan Blank #{shortAnswerMultiItems.length + 1}</span>
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed">
                    Gunakan pola <code className="font-mono bg-sky-100 dark:bg-sky-950 px-1 py-0.5 rounded text-sky-800 font-bold">____(1)____</code>, <code className="font-mono bg-sky-100 dark:bg-sky-950 px-1 py-0.5 rounded text-sky-800 font-bold">____(2)____</code> dst pada teks/snippet kode di atas. Masukkan kunci jawaban untuk masing-masing blank. Nilai dihitung proporsional sesuai jumlah blank yang dijawab benar.
                  </p>

                  <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                    {shortAnswerMultiItems.map((item, idx) => (
                      <div key={item.blank} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-sky-200 dark:border-sky-900/60 shadow-2xs">
                        <span className="w-20 shrink-0 text-center py-1.5 px-2 bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-300 rounded-lg font-mono font-bold text-xs">
                          Blank ({item.blank})
                        </span>
                        <input
                          type="text"
                          value={item.answer}
                          onChange={(e) => {
                            const updated = [...shortAnswerMultiItems];
                            updated[idx].answer = e.target.value;
                            setShortAnswerMultiItems(updated);
                          }}
                          placeholder={`Kunci jawaban blank (${item.blank}), contoh: POST atau $total`}
                          className="flex-1 p-2.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 font-mono text-xs focus:ring-2 focus:ring-sky-500"
                        />
                        {shortAnswerMultiItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = shortAnswerMultiItems.filter((_, i) => i !== idx);
                              setShortAnswerMultiItems(updated);
                            }}
                            className="text-slate-400 hover:text-rose-600 p-1.5 transition-colors cursor-pointer"
                            title="Hapus Blank Ini"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-sky-200/60 dark:border-sky-900/40">
                    <input
                      type="checkbox"
                      id="multiCaseSensitiveToggle"
                      checked={isCaseSensitive}
                      onChange={(e) => setIsCaseSensitive(e.target.checked)}
                      className="rounded border-slate-300 dark:border-zinc-700 text-sky-600 focus:ring-sky-500 w-4 h-4 cursor-pointer"
                    />
                    <label htmlFor="multiCaseSensitiveToggle" className="text-xs font-semibold text-slate-700 dark:text-zinc-300 cursor-pointer select-none">
                      Sensitif Huruf Besar / Kecil (Case-Sensitive)
                    </label>
                  </div>
                </div>
              )}

              {/* Essay Auto-Grading & AI Matrix Rubric Editor */}
              {type === 'ESSAY' && (
                <EssayAiRubricEditor
                  questionText={questionText}
                  points={points}
                  teacherKey={essayAnswerKey}
                  rubric={essayAiRubric}
                  onChangeTeacherKey={setEssayAnswerKey}
                  onChangeRubric={setEssayAiRubric}
                />
              )}

              <div className="pt-4">
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleAddQuestionToList}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md text-xs font-bold"
                >
                  {editingQuestionId ? 'Perbarui Soal Ujian Ini' : 'Tambahkan Soal Ini Ke Ujian'}
                </Button>
              </div>
            </div>
          </Card>
        </section>

        {/* Right Column: Questions List Display (5 Columns) */}
        <section className="lg:col-span-5 space-y-4">
          <Card className="border-slate-200 dark:border-zinc-800 p-5">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-zinc-800">
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-zinc-100 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-600" />
                  Daftar Soal Ujian Ini ({questions.length})
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  Tersimpan khusus untuk quiz ini • Total: {questions.reduce((acc, q) => acc + q.points, 0)} Poin
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveAllToServer}
                isLoading={isSaving}
                className="text-xs font-bold text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
              >
                <Save className="w-3.5 h-3.5" />
                Simpan Ke Server
              </Button>
            </div>

            {isLoading ? (
              <div className="py-12 text-center text-xs text-slate-400">Memuat data soal...</div>
            ) : questions.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-slate-300 dark:border-zinc-800 rounded-2xl p-6">
                Belum ada soal dalam ujian ini. Gunakan form di sebelah kiri atau tombol Impor untuk menambahkan soal.
              </div>
            ) : (
              <div className="space-y-3.5 max-h-[750px] overflow-y-auto pr-1">
                {questions.map((q, qIdx) => (
                  <div
                    key={q.id}
                    className="p-4 rounded-xl bg-white dark:bg-zinc-900/80 border border-slate-200 dark:border-zinc-800 space-y-2.5 shadow-xs transition-all hover:border-emerald-300 dark:hover:border-zinc-700"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400 text-sm">
                          #{String(qIdx + 1).padStart(2, '0')}
                        </span>
                        <Badge variant="teal" size="sm">
                          {q.type}
                        </Badge>
                        <Badge variant="slate" size="sm">
                          {q.points} Poin
                        </Badge>
                        {q.imageUrl && (
                          <Badge variant="amber" size="sm">
                            <ImageIcon className="w-3 h-3 mr-0.5" /> Gbr Soal
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDuplicateQuestion(q)}
                          className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                          title="Duplikat Soal"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEditQuestion(q)}
                          className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                          title="Edit Soal"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteQuestion(q.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                          title="Hapus Soal"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="text-slate-800 dark:text-zinc-200 text-xs">
                      <FormattedText text={q.questionText} />
                    </div>

                    {/* Question image thumbnail if present */}
                    {q.imageUrl && (
                      <div className="p-1 bg-slate-50 dark:bg-zinc-950 rounded-lg border border-slate-200 dark:border-zinc-800 inline-block">
                        <img
                          src={q.imageUrl}
                          alt="Thumbnail Soal"
                          className="max-h-24 max-w-full rounded object-contain"
                        />
                      </div>
                    )}

                    {q.type !== 'ESSAY' && q.type !== 'SHORT_ANSWER' && q.options && (
                      <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-zinc-800/80 text-[11px]">
                        {q.options.map((opt, oIdx) => {
                          const label = String.fromCharCode(65 + oIdx);
                          const isKey = q.correctOptionId === opt.id;
                          return (
                            <div
                              key={opt.id}
                              className={`p-2 rounded-lg flex items-center justify-between ${
                                isKey
                                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800'
                                  : 'bg-slate-50 dark:bg-zinc-800/50 text-slate-600 dark:text-zinc-400'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span>
                                  <strong>{label}.</strong> {opt.optionText}
                                </span>
                                {opt.imageUrl && (
                                  <img
                                    src={opt.imageUrl}
                                    alt={`Gbr ${label}`}
                                    className="h-6 w-auto rounded border border-slate-200 dark:border-zinc-700"
                                  />
                                )}
                              </div>
                              {isKey && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {q.type === 'SHORT_ANSWER' && (
                      <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-zinc-800/80 text-[11px]">
                        <div className="p-2.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-300 font-mono flex items-center justify-between flex-wrap gap-1">
                          <div>
                            <span className="font-bold">Kunci Isian:</span> {q.shortAnswerKey || (q.shortAnswerKeys || []).join(' | ') || '-'}
                          </div>
                          {q.isCaseSensitive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-sans font-semibold">
                              Case-Sensitive
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {q.type === 'SHORT_ANSWER_MULTI' && (
                      <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-zinc-800/80 text-[11px]">
                        <div className="flex items-center justify-between text-[10px] font-bold text-sky-700 dark:text-sky-400 uppercase tracking-wider">
                          <span>Kunci Multi-Blank ({(q.answerKey || q.shortAnswerMultiKey || []).length} Blanks):</span>
                          {q.isCaseSensitive && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-sans font-semibold">
                              Case-Sensitive
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {(q.answerKey || q.shortAnswerMultiKey || []).map((b) => (
                            <span
                              key={b.blank}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 font-mono text-[11px] text-sky-900 dark:text-sky-300"
                            >
                              <span className="font-bold text-sky-600">({b.blank})</span>
                              <span>{b.answer}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {q.type === 'ESSAY' && (
                      <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-zinc-800/80 text-[11px]">
                        {q.essayAnswerKey && (
                          <div className="p-2 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-300 font-mono">
                            <span className="font-bold">Kunci Model:</span> {q.essayAnswerKey}
                          </div>
                        )}

                        {q.essayAiRubric ? (
                          <div className="p-2.5 rounded-lg bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 space-y-1 text-slate-700 dark:text-zinc-300">
                            <div className="flex items-center justify-between font-bold text-indigo-900 dark:text-indigo-300 text-[10px] uppercase tracking-wider">
                              <span className="flex items-center gap-1">
                                <Sparkles className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                                Matriks Koreksi AI Siap
                              </span>
                              <span>
                                {q.essayAiRubric.correctVariations?.length || 0} Benar • {q.essayAiRubric.commonMistakes?.length || 0} Prediksi Salah
                              </span>
                            </div>

                            {q.essayAiRubric.correctVariations && q.essayAiRubric.correctVariations.length > 0 && (
                              <div className="text-[10px] text-emerald-700 dark:text-emerald-400 flex flex-wrap gap-1 items-center">
                                <span className="font-semibold">Variasi 100%:</span>
                                {q.essayAiRubric.correctVariations.slice(0, 3).map((v, idx) => (
                                  <span key={idx} className="font-mono bg-emerald-100/60 dark:bg-emerald-950/60 px-1 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                                    {v.pattern}
                                  </span>
                                ))}
                                {q.essayAiRubric.correctVariations.length > 3 && (
                                  <span className="text-slate-400">+{q.essayAiRubric.correctVariations.length - 3} lainnya</span>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-indigo-500" />
                            <span>Koreksi AI Otomatis aktif saat peserta submit</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>
      </div>

      {/* Import Questions Modal */}
      <ImportQuestionsModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        examId={exam.id}
        onImportQuestions={handleImportedQuestionsReceived}
      />
    </div>
  );
};
