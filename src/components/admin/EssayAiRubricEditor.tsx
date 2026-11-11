import React, { useState } from 'react';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  Key,
  Layers,
  HelpCircle,
  RefreshCw,
  Sliders,
  Check,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { api } from '../../services/api';
import { EssayAiRubric, CorrectVariationItem, CommonMistakeItem, KeyConceptItem } from '../../types/cbt';

interface EssayAiRubricEditorProps {
  questionText: string;
  points: number;
  teacherKey: string;
  rubric?: EssayAiRubric;
  onChangeTeacherKey: (key: string) => void;
  onChangeRubric: (rubric: EssayAiRubric) => void;
}

export const EssayAiRubricEditor: React.FC<EssayAiRubricEditorProps> = ({
  questionText,
  points,
  teacherKey,
  rubric,
  onChangeTeacherKey,
  onChangeRubric,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCorrectPattern, setNewCorrectPattern] = useState('');
  const [newMistakePattern, setNewMistakePattern] = useState('');
  const [newMistakeScore, setNewMistakeScore] = useState(40);
  const [newMistakeReason, setNewMistakeReason] = useState('');
  const [showAddMistake, setShowAddMistake] = useState(false);

  const handleGenerateRubric = async () => {
    if (!questionText.trim()) {
      setError('Harap isi teks pertanyaan soal terlebih dahulu.');
      return;
    }

    setError(null);
    setIsGenerating(true);
    try {
      const res = await api.post(
        '/ai/generate-essay-rubric',
        {
          questionText: questionText.trim(),
          essayAnswerKey: teacherKey.trim() || undefined,
          points: points || 20,
        },
        { timeout: 45000 }
      );

      const generated: EssayAiRubric = res.data.data;
      if (generated) {
        onChangeRubric(generated);
        if (!teacherKey.trim() && generated.idealAnswer) {
          onChangeTeacherKey(generated.idealAnswer);
        }
      }
    } catch (err: any) {
      console.error('Failed to generate rubric:', err);
      setError(err?.response?.data?.error || err?.message || 'Gagal generate rubrik AI. Silakan coba lagi.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddCorrectVariation = () => {
    if (!newCorrectPattern.trim() || !rubric) return;
    const updated: EssayAiRubric = {
      ...rubric,
      correctVariations: [
        ...(rubric.correctVariations || []),
        { pattern: newCorrectPattern.trim(), description: 'Variasi manual guru' },
      ],
    };
    onChangeRubric(updated);
    setNewCorrectPattern('');
  };

  const handleRemoveCorrectVariation = (idx: number) => {
    if (!rubric) return;
    const updated: EssayAiRubric = {
      ...rubric,
      correctVariations: rubric.correctVariations.filter((_, i) => i !== idx),
    };
    onChangeRubric(updated);
  };

  const handleAddMistake = () => {
    if (!newMistakePattern.trim() || !rubric) return;
    const updated: EssayAiRubric = {
      ...rubric,
      commonMistakes: [
        ...(rubric.commonMistakes || []),
        {
          pattern: newMistakePattern.trim(),
          scorePercentage: Number(newMistakeScore) || 0,
          reason: newMistakeReason.trim() || 'Jawaban kurang tepat.',
        },
      ],
    };
    onChangeRubric(updated);
    setNewMistakePattern('');
    setNewMistakeScore(40);
    setNewMistakeReason('');
    setShowAddMistake(false);
  };

  const handleRemoveMistake = (idx: number) => {
    if (!rubric) return;
    const updated: EssayAiRubric = {
      ...rubric,
      commonMistakes: rubric.commonMistakes.filter((_, i) => i !== idx),
    };
    onChangeRubric(updated);
  };

  return (
    <div className="space-y-4 pt-2">
      {/* Header & Quick Generator Action */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-50 via-teal-50 to-indigo-50 dark:from-emerald-950/40 dark:via-teal-950/40 dark:to-indigo-950/40 border border-emerald-200 dark:border-emerald-800/60 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div>
            <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-zinc-100 text-sm">
              <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Kunci Jawaban Model & Matriks Prediksi AI</span>
              {rubric && (
                <Badge variant="emerald" size="sm">
                  Aktif & Siap Koreksi
                </Badge>
              )}
            </div>
            <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">
              AI akan memprediksi variasi jawaban benar dan skenario jawaban salah/miskonsepsi siswa untuk koreksi kilat (0ms) & akurat.
            </p>
          </div>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleGenerateRubric}
            isLoading={isGenerating}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shrink-0 shadow-xs"
          >
            {isGenerating ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {rubric ? 'Regenerate Prediksi AI' : 'Buat Kunci & Prediksi AI'}
          </Button>
        </div>

        {error && (
          <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Teacher Answer Key Input (Optional reference) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300">
            Kunci Jawaban Model / Referensi Guru
          </label>
          <span className="text-[11px] text-slate-400 dark:text-zinc-500">
            (Bisa diketik manual atau otomatis terisi dari AI)
          </span>
        </div>
        <textarea
          rows={2}
          value={teacherKey}
          onChange={(e) => {
            onChangeTeacherKey(e.target.value);
            if (rubric) {
              onChangeRubric({ ...rubric, idealAnswer: e.target.value });
            }
          }}
          placeholder="Contoh: col-md-6 atau SELECT * FROM siswa atau penjelasannya..."
          className="w-full p-3 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-xs font-mono focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      {/* Rubric Matrix Display (if generated or existing) */}
      {rubric && (
        <div className="space-y-3.5 p-4 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60">
          {/* 1. Correct Variations Prediction Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-emerald-800 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Prediksi Kemungkinan Variasi Jawaban BENAR (100% Skor)
              </label>
              <span className="text-[11px] text-slate-500 dark:text-zinc-400">
                {rubric.correctVariations?.length || 0} variasi terdaftar
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(rubric.correctVariations || []).map((variation, vIdx) => (
                <div
                  key={vIdx}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-100/70 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs font-mono font-medium shadow-xs"
                  title={variation.description || 'Variasi jawaban benar'}
                >
                  <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                  <span>{variation.pattern}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveCorrectVariation(vIdx)}
                    className="text-emerald-500 hover:text-rose-600 p-0.5 rounded cursor-pointer ml-1"
                    title="Hapus variasi ini"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {/* Quick add custom variation */}
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newCorrectPattern}
                onChange={(e) => setNewCorrectPattern(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCorrectVariation();
                  }
                }}
                placeholder="+ Tambah variasi jawaban benar lainnya (misal: format lain / sinonim)..."
                className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-xs font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddCorrectVariation}
                disabled={!newCorrectPattern.trim()}
                className="text-xs h-8 px-2.5"
              >
                <Plus className="w-3 h-3" /> Tambah
              </Button>
            </div>
          </div>

          {/* 2. Common Mistakes / Misconceptions Prediction Section */}
          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-amber-800 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                Prediksi Kemungkinan Jawaban SALAH / MISKONSEPSI Siswa & Skor Parsial
              </label>
              <button
                type="button"
                onClick={() => setShowAddMistake(!showAddMistake)}
                className="text-[11px] font-bold text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" /> Tambah Miskonsepsi
              </button>
            </div>

            <div className="space-y-1.5">
              {(rubric.commonMistakes || []).map((mistake, mIdx) => (
                <div
                  key={mIdx}
                  className="p-2.5 rounded-lg bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-start sm:items-center gap-2 flex-1">
                    <span className="font-mono font-bold text-amber-900 dark:text-amber-200 px-1.5 py-0.5 rounded bg-amber-200/50 dark:bg-amber-900/50">
                      {mistake.pattern}
                    </span>
                    <span className="text-slate-600 dark:text-zinc-400 text-[11px] leading-tight">
                      {mistake.reason}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <Badge variant={mistake.scorePercentage > 0 ? 'amber' : 'slate'} size="sm">
                      Skor: {mistake.scorePercentage}% ({Math.round(points * (mistake.scorePercentage / 100))} Poin)
                    </Badge>
                    <button
                      type="button"
                      onClick={() => handleRemoveMistake(mIdx)}
                      className="text-slate-400 hover:text-rose-600 p-1 transition-colors cursor-pointer"
                      title="Hapus miskonsepsi ini"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Custom add misconception form */}
            {showAddMistake && (
              <div className="p-3 rounded-xl bg-white dark:bg-zinc-950 border border-amber-300 dark:border-amber-800 space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                      Pola Jawaban Siswa
                    </label>
                    <input
                      type="text"
                      value={newMistakePattern}
                      onChange={(e) => setNewMistakePattern(e.target.value)}
                      placeholder="Contoh: row>col+col+col atau .col*3"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                      Skor Parsial (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={newMistakeScore}
                      onChange={(e) => setNewMistakeScore(parseInt(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-mono font-bold"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                    Alasan / Feedback Koreksi untuk Siswa
                  </label>
                  <input
                    type="text"
                    value={newMistakeReason}
                    onChange={(e) => setNewMistakeReason(e.target.value)}
                    placeholder="Contoh: Kurang tepat: Emmet class Bootstrap wajib diawali tanda titik (.)."
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAddMistake(false)}
                    className="text-xs h-7"
                  >
                    Batal
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleAddMistake}
                    disabled={!newMistakePattern.trim()}
                    className="text-xs h-7 bg-amber-600 hover:bg-amber-700 text-white"
                  >
                    Simpan Pola
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* 3. Key Concepts / Rubric Summary */}
          {rubric.keyConcepts && rubric.keyConcepts.length > 0 && (
            <div className="pt-2 border-t border-slate-200 dark:border-zinc-800 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-600 dark:text-zinc-400 flex items-center gap-1">
                <Sliders className="w-3 h-3 text-indigo-600" /> Bobot Konsep:
              </span>
              {rubric.keyConcepts.map((kc, kIdx) => (
                <Badge key={kIdx} variant="indigo" size="sm">
                  {kc.concept} ({kc.weightPercentage}%)
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
