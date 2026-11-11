import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit3, CheckCircle2, Code, Save, AlertCircle, Sparkles, FileText, CheckSquare } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { FormattedText } from '../ui/CodeBlock';
import { EssayAiRubricEditor } from './EssayAiRubricEditor';
import { api } from '../../services/api';
import { Exam, Question, QuestionType, QuestionOption, EssayAiRubric, ShortAnswerMultiItem } from '../../types/cbt';

interface QuestionEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  exam: Exam | null;
  onQuestionsSaved: () => void;
}

export const QuestionEditorModal: React.FC<QuestionEditorModalProps> = ({
  isOpen,
  onClose,
  exam,
  onQuestionsSaved,
}) => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form state for creating/editing a single question
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [type, setType] = useState<QuestionType>('MULTIPLE_CHOICE');
  const [questionText, setQuestionText] = useState('');
  const [points, setPoints] = useState(20);
  const [options, setOptions] = useState<QuestionOption[]>([
    { id: 'opt_a', optionText: 'Pilihan A' },
    { id: 'opt_b', optionText: 'Pilihan B' },
    { id: 'opt_c', optionText: 'Pilihan C' },
    { id: 'opt_d', optionText: 'Pilihan D' },
  ]);
  const [correctOptionId, setCorrectOptionId] = useState<string>('opt_a');
  const [essayAnswerKey, setEssayAnswerKey] = useState('');
  const [essayAiRubric, setEssayAiRubric] = useState<EssayAiRubric | undefined>(undefined);
  const [shortAnswerKey, setShortAnswerKey] = useState('');
  const [shortAnswerMultiItems, setShortAnswerMultiItems] = useState<ShortAnswerMultiItem[]>([
    { blank: 1, answer: '' },
    { blank: 2, answer: '' },
  ]);
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);

  const fetchExamQuestions = async () => {
    if (!exam) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.get(`/exams/${exam.id}`);
      setQuestions(res.data.data?.questions || []);
    } catch (e: any) {
      console.error(e);
      setErrorMessage('Gagal memuat soal dari server.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && exam) {
      fetchExamQuestions();
      resetForm();
    }
  }, [isOpen, exam]);

  const resetForm = () => {
    setEditingQuestionId(null);
    setType('MULTIPLE_CHOICE');
    setQuestionText('');
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

  const handleAutoDetectBlanks = () => {
    const set = new Set<number>();
    const r = /_{2,}\((\d+)\)_{2,}/g;
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

  const handleInsertCodeSnippet = (lang: string) => {
    let snippet = '';
    if (lang === 'html') {
      snippet = '\n\n```html\n<div class="container">\n  <h1>Hello World</h1>\n</div>\n```';
    } else if (lang === 'css') {
      snippet = '\n\n```css\n.card {\n  display: flex;\n  background-color: #f8fafc;\n}\n```';
    } else if (lang === 'php') {
      snippet = '\n\n```php\n<form action="" method="____(1)____">\n  <input type="text" name="____(2)____">\n</form>\n```';
    } else if (lang === 'sql') {
      snippet = '\n\n```sql\nSELECT * FROM users \nWHERE status = "ACTIVE" \nORDER BY created_at DESC;\n```';
    }
    setQuestionText((prev) => prev + snippet);
  };

  const handleSaveQuestionToList = () => {
    if (!questionText.trim()) {
      setErrorMessage('Pertanyaan soal tidak boleh kosong!');
      return;
    }

    if (type !== 'ESSAY' && type !== 'SHORT_ANSWER' && type !== 'SHORT_ANSWER_MULTI') {
      const emptyOpt = options.find((o) => !o.optionText.trim());
      if (emptyOpt) {
        setErrorMessage('Seluruh teks pilihan jawaban harus diisi!');
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

    if (editingQuestionId) {
      // Edit existing
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === editingQuestionId
            ? {
                ...q,
                type,
                questionText,
                points,
                options: isNonOption ? [] : options,
                correctOptionId: isNonOption ? undefined : correctOptionId,
                essayAnswerKey: type === 'ESSAY' ? essayAnswerKey : undefined,
                essayAiRubric: type === 'ESSAY' ? essayAiRubric : undefined,
                shortAnswerKey: type === 'SHORT_ANSWER' ? shortAnswerKey.trim() : undefined,
                shortAnswerKeys: shortKeysParsed,
                answerKey: type === 'SHORT_ANSWER_MULTI' ? shortAnswerMultiItems : undefined,
                shortAnswerMultiKey: type === 'SHORT_ANSWER_MULTI' ? shortAnswerMultiItems : undefined,
                isCaseSensitive: type === 'SHORT_ANSWER' || type === 'SHORT_ANSWER_MULTI' ? isCaseSensitive : undefined,
              }
            : q
        )
      );
    } else {
      // Add new
      const newQuestion: Question = {
        id: `q_${Date.now()}`,
        examId: exam?.id || '',
        type,
        questionText,
        points,
        options: isNonOption ? [] : options,
        correctOptionId: isNonOption ? undefined : correctOptionId,
        essayAnswerKey: type === 'ESSAY' ? essayAnswerKey : undefined,
        essayAiRubric: type === 'ESSAY' ? essayAiRubric : undefined,
        shortAnswerKey: type === 'SHORT_ANSWER' ? shortAnswerKey.trim() : undefined,
        shortAnswerKeys: shortKeysParsed,
        answerKey: type === 'SHORT_ANSWER_MULTI' ? shortAnswerMultiItems : undefined,
        shortAnswerMultiKey: type === 'SHORT_ANSWER_MULTI' ? shortAnswerMultiItems : undefined,
        isCaseSensitive: type === 'SHORT_ANSWER' || type === 'SHORT_ANSWER_MULTI' ? isCaseSensitive : undefined,
      };
      setQuestions((prev) => [...prev, newQuestion]);
    }

    resetForm();
    setSuccessMessage('Soal ditambahkan ke daftar sementara. Jangan lupa klik "Simpan Seluruh Bank Soal".');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleEditQuestion = (q: Question) => {
    setEditingQuestionId(q.id);
    setType(q.type);
    setQuestionText(q.questionText);
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
  };

  const handleDeleteQuestion = (questionId: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== questionId));
  };

  const handleSaveAllToServer = async () => {
    if (!exam) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      await api.post(`/exams/${exam.id}/questions`, { questions });
      setSuccessMessage('Berhasil menyimpan bank soal ke server!');
      setTimeout(() => {
        setSuccessMessage(null);
        onQuestionsSaved();
        onClose();
      }, 1200);
    } catch (e: any) {
      console.error(e);
      setErrorMessage(e.response?.data?.error || 'Gagal menyimpan soal ke server');
    } finally {
      setIsSaving(false);
    }
  };

  if (!exam) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Kelola Soal: ${exam.title} (${questions.length} Soal)`}
      maxWidth="xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="primary"
            onClick={handleSaveAllToServer}
            isLoading={isSaving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200"
          >
            <Save className="w-4 h-4" />
            Simpan Seluruh Bank Soal ({questions.length} Soal)
          </Button>
        </div>
      }
    >
      <div className="space-y-6 text-xs text-slate-800 dark:text-zinc-100">
        {errorMessage && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Question Form Section */}
        <div className="p-4 bg-slate-50 dark:bg-zinc-800/60 rounded-2xl border border-slate-200/80 dark:border-zinc-700/80 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
              <Plus className="w-4 h-4" />
              {editingQuestionId ? 'Edit Soal' : 'Tambah Soal Baru'}
            </h4>
            {editingQuestionId && (
              <Button variant="ghost" size="sm" onClick={resetForm}>
                Batal Edit
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold mb-1">Tipe Soal</label>
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
                className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              >
                <option value="MULTIPLE_CHOICE">Pilihan Ganda</option>
                <option value="TRUE_FALSE">Benar / Salah (True/False)</option>
                <option value="SHORT_ANSWER">Isian Singkat / Lengkapi Kode (1 Jawaban)</option>
                <option value="SHORT_ANSWER_MULTI">Isian Kode Multi-Blank (____(1)____ s/d ____(N)____)</option>
                <option value="ESSAY">Uraian / Essay</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">Bobot Poin Skor</label>
              <input
                type="number"
                min={1}
                value={points}
                onChange={(e) => setPoints(parseInt(e.target.value) || 10)}
                className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block font-semibold">Teks Pertanyaan Soal</label>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-500 flex items-center gap-1">
                  <Code className="w-3.5 h-3.5 text-emerald-600" /> Sisipkan Kode:
                </span>
                {['html', 'css', 'php', 'sql'].map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => handleInsertCodeSnippet(lang)}
                    className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-zinc-700 text-slate-700 dark:text-zinc-200 font-mono text-[10px] uppercase font-bold hover:bg-emerald-600 hover:text-white transition-colors"
                  >
                    +{lang}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              rows={4}
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              placeholder="Ketik isi soal... Anda dapat menyisipkan kode program dengan format ```php ... ```"
              className="w-full p-3 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono text-xs leading-relaxed"
            />
          </div>

          {/* Code Live Preview */}
          {questionText.includes('```') && (
            <div className="p-3 bg-white dark:bg-zinc-900 rounded-xl border border-slate-200 dark:border-zinc-800">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                Preview Tampilan Soal:
              </div>
              <FormattedText text={questionText} />
            </div>
          )}

          {/* Options input if Multiple Choice or True/False */}
          {type !== 'ESSAY' && type !== 'SHORT_ANSWER' && type !== 'SHORT_ANSWER_MULTI' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block font-semibold">Pilihan Jawaban & Tandai Jawaban BENAR</label>
                {type === 'MULTIPLE_CHOICE' && options.length < 6 && (
                  <button
                    type="button"
                    onClick={() => {
                      const newId = `opt_${Date.now()}`;
                      setOptions([...options, { id: newId, optionText: '' }]);
                    }}
                    className="text-emerald-600 font-bold hover:underline flex items-center gap-1 text-[11px]"
                  >
                    + Tambah Opsi Pilihan
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {options.map((opt, idx) => {
                  const optionLabel = String.fromCharCode(65 + idx);
                  const isCorrect = correctOptionId === opt.id;

                  return (
                    <div
                      key={opt.id}
                      className={`flex items-center gap-2 p-2 rounded-xl border transition-all ${
                        isCorrect
                          ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30'
                          : 'border-slate-200 dark:border-zinc-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="correctAnswer"
                        checked={isCorrect}
                        onChange={() => setCorrectOptionId(opt.id)}
                        className="w-4 h-4 text-emerald-600 cursor-pointer"
                      />
                      <span className="font-bold font-mono text-slate-500 w-5">{optionLabel}.</span>
                      <input
                        type="text"
                        value={opt.optionText}
                        onChange={(e) => {
                          const updated = [...options];
                          updated[idx].optionText = e.target.value;
                          setOptions(updated);
                        }}
                        placeholder={`Teks pilihan ${optionLabel}...`}
                        className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                      />
                      {isCorrect && <Badge variant="emerald" size="sm">Kunci Jawaban</Badge>}
                      {type === 'MULTIPLE_CHOICE' && options.length > 2 && (
                        <button
                          type="button"
                          onClick={() => setOptions(options.filter((o) => o.id !== opt.id))}
                          className="text-slate-400 hover:text-rose-600 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Short Answer Configuration */}
          {type === 'SHORT_ANSWER' && (
            <div className="space-y-3 p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
                  <Code className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Kunci Jawaban Isian Singkat / Potongan Kode</span>
                </label>
                <Badge variant="teal" size="sm">Auto Koreksi</Badge>
              </div>

              <div>
                <input
                  type="text"
                  value={shortAnswerKey}
                  onChange={(e) => setShortAnswerKey(e.target.value)}
                  placeholder="Contoh: echo atau $total = $a + $b; atau mysqli_connect"
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono text-xs focus:ring-2 focus:ring-emerald-500"
                />
                <p className="text-[10px] text-slate-500 dark:text-zinc-400 mt-1">
                  Gunakan pemisah <code className="font-bold">|</code> untuk alternatif jawaban benar (contoh: <code className="text-emerald-600 font-mono">echo | print</code>).
                </p>
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-emerald-200/60 dark:border-emerald-900/40">
                <input
                  type="checkbox"
                  id="modalCaseSensitive"
                  checked={isCaseSensitive}
                  onChange={(e) => setIsCaseSensitive(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5 cursor-pointer"
                />
                <label htmlFor="modalCaseSensitive" className="text-xs font-semibold text-slate-700 dark:text-zinc-300 cursor-pointer select-none">
                  Sensitif Huruf Besar / Kecil (Case-Sensitive)
                </label>
              </div>
            </div>
          )}

          {/* Short Answer Multi (Blank-based) Configuration */}
          {type === 'SHORT_ANSWER_MULTI' && (
            <div className="space-y-3 p-3.5 rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/40 dark:bg-sky-950/20">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
                  <Code className="w-3.5 h-3.5 text-sky-600" />
                  <span>Kunci Jawaban Isian Multi-Blank (____(1)____ s/d ____(N)____)</span>
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAutoDetectBlanks}
                    className="text-[11px] font-semibold text-sky-600 hover:text-sky-700 bg-white dark:bg-zinc-800 border border-sky-300 dark:border-sky-700 px-2 py-1 rounded-md flex items-center gap-1 shadow-xs"
                    title="Deteksi otomatis seluruh pola ____(1)____ pada teks soal"
                  >
                    <span>🔍 Deteksi Otomatis dari Teks</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleInsertBlankTag}
                    className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 bg-white dark:bg-zinc-800 border border-emerald-300 dark:border-emerald-700 px-2 py-1 rounded-md flex items-center gap-1 shadow-xs"
                  >
                    <span>+ Sisipkan Blank #{shortAnswerMultiItems.length + 1}</span>
                  </button>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                Gunakan format <code className="font-mono bg-sky-100 dark:bg-sky-950 px-1 py-0.5 rounded text-sky-800 font-bold">____(1)____</code>, <code className="font-mono bg-sky-100 dark:bg-sky-950 px-1 py-0.5 rounded text-sky-800 font-bold">____(2)____</code> dst pada teks/kode di atas. Skor per-blank dihitung otomatis secara proporsional.
              </p>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {shortAnswerMultiItems.map((item, idx) => (
                  <div key={item.blank} className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-zinc-900 border border-sky-200 dark:border-sky-900/60">
                    <span className="w-20 shrink-0 text-center py-1 px-1.5 bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-300 rounded font-mono font-bold text-xs">
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
                      className="flex-1 p-2 rounded-md border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono text-xs focus:ring-2 focus:ring-sky-500"
                    />
                    {shortAnswerMultiItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const updated = shortAnswerMultiItems.filter((_, i) => i !== idx);
                          setShortAnswerMultiItems(updated);
                        }}
                        className="text-slate-400 hover:text-rose-600 p-1"
                        title="Hapus Blank Ini"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-sky-200/60 dark:border-sky-900/40">
                <input
                  type="checkbox"
                  id="modalMultiCaseSensitive"
                  checked={isCaseSensitive}
                  onChange={(e) => setIsCaseSensitive(e.target.checked)}
                  className="rounded border-slate-300 text-sky-600 focus:ring-sky-500 w-3.5 h-3.5 cursor-pointer"
                />
                <label htmlFor="modalMultiCaseSensitive" className="text-xs font-semibold text-slate-700 dark:text-zinc-300 cursor-pointer select-none">
                  Sensitif Huruf Besar / Kecil (Case-Sensitive)
                </label>
              </div>
            </div>
          )}

          {/* Essay AI Matrix Rubric & Auto-Grading Editor */}
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

          <Button
            type="button"
            variant="primary"
            onClick={handleSaveQuestionToList}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {editingQuestionId ? 'Perbarui Soal Ini' : 'Tambah Soal Ini ke Daftar'}
          </Button>
        </div>

        {/* Questions List Display */}
        <div className="space-y-3">
          <h4 className="font-bold text-sm text-slate-900 dark:text-zinc-100 flex items-center justify-between">
            <span>Daftar Soal Dalam Bank ({questions.length})</span>
          </h4>

          {isLoading ? (
            <div className="py-6 text-center text-slate-400">Memuat data soal...</div>
          ) : questions.length === 0 ? (
            <div className="py-8 text-center text-slate-400 border border-dashed border-slate-300 dark:border-zinc-700 rounded-xl">
              Belum ada soal dalam bank ujian ini. Gunakan formulir di atas untuk membuat soal.
            </div>
          ) : (
            <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
              {questions.map((q, qIdx) => (
                <div
                  key={q.id}
                  className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 space-y-2 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold font-mono text-emerald-600 text-sm">
                        #{String(qIdx + 1).padStart(2, '0')}
                      </span>
                      <Badge variant="teal" size="sm">{q.type}</Badge>
                      <Badge variant="slate" size="sm">{q.points} Poin</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleEditQuestion(q)}
                        className="p-1 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-zinc-800 rounded transition-colors"
                        title="Edit Soal"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteQuestion(q.id)}
                        className="p-1 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-zinc-800 rounded transition-colors"
                        title="Hapus Soal"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="text-slate-800 dark:text-zinc-200 text-xs">
                    <FormattedText text={q.questionText} />
                  </div>

                  {q.type !== 'ESSAY' && q.type !== 'SHORT_ANSWER' && q.options && (
                    <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-slate-100 dark:border-zinc-800/80 text-[11px]">
                      {q.options.map((opt, oIdx) => {
                        const label = String.fromCharCode(65 + oIdx);
                        const isKey = q.correctOptionId === opt.id;
                        return (
                          <div
                            key={opt.id}
                            className={`p-1.5 rounded-lg flex items-center justify-between ${
                              isKey
                                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800'
                                : 'bg-slate-50 dark:bg-zinc-800/50 text-slate-600 dark:text-zinc-400'
                            }`}
                          >
                            <span>
                              <strong>{label}.</strong> {opt.optionText}
                            </span>
                            {isKey && <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {q.type === 'SHORT_ANSWER' && (
                    <div className="pt-2 border-t border-slate-100 dark:border-zinc-800/80 text-[11px]">
                      <div className="p-2 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-300 font-mono flex items-center justify-between">
                        <span><strong>Kunci Isian:</strong> {q.shortAnswerKey || (q.shortAnswerKeys || []).join(' | ') || '-'}</span>
                        {q.isCaseSensitive && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-sans font-bold">
                            Case-Sensitive
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {q.type === 'SHORT_ANSWER_MULTI' && (
                    <div className="pt-2 border-t border-slate-100 dark:border-zinc-800/80 text-[11px] space-y-1.5">
                      <div className="text-[10px] font-bold text-sky-700 dark:text-sky-400 uppercase tracking-wider flex items-center justify-between">
                        <span>Kunci Jawaban Multi-Blank ({(q.answerKey || q.shortAnswerMultiKey || []).length} Blanks):</span>
                        {q.isCaseSensitive && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-sans font-bold">
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
                      {q.essayAiRubric && (
                        <div className="p-2 rounded-lg bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 flex items-center justify-between text-[10px] text-indigo-900 dark:text-indigo-300 font-bold uppercase tracking-wider">
                          <span className="flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                            Matriks AI Aktif
                          </span>
                          <span>
                            {q.essayAiRubric.correctVariations?.length || 0} Benar • {q.essayAiRubric.commonMistakes?.length || 0} Miskonsepsi
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
