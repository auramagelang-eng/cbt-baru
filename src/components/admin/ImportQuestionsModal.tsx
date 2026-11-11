import React, { useState } from 'react';
import { Upload, FileText, Copy, Check, AlertCircle, FileCode, CheckCircle2, Download } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Question, QuestionType, QuestionOption, ShortAnswerMultiItem } from '../../types/cbt';

export const PHP_MULTI_QUESTIONS_SAMPLE = [
  {
    type: "SHORT_ANSWER_MULTI",
    questionText: "Lengkapi form PHP berikut agar dapat menghitung total harga dari input jumlah barang, dengan ketentuan: jika jumlah > 10 maka harga satuan 5000, selain itu harga satuan 6000.\n\n```php\n<form action=\"\" method=\"____(1)____\">\n    Jumlah: <input type=\"number\" name=\"____(2)____\">\n    <button type=\"submit\" name=\"____(3)____\">Hitung</button>\n</form>\n\n<?php\nif (isset($_POST['____(3)____'])) {\n    $jumlah = $_POST['____(2)____'];\n    if ($jumlah ____(4)____ 10) {\n        $harga = 5000;\n    } else {\n        $harga = 6000;\n    }\n    $total = $jumlah * $harga;\n    echo \"Total: \" . ____(5)____;\n}\n?>\n```\n\nIsilah bagian (1)–(5) dengan jawaban tepat!",
    points: 10,
    answerKey: [
      { blank: 1, answer: "POST" },
      { blank: 2, answer: "jumlah" },
      { blank: 3, answer: "hitung" },
      { blank: 4, answer: ">" },
      { blank: 5, answer: "$total" }
    ]
  },
  {
    type: "SHORT_ANSWER_MULTI",
    questionText: "Lengkapi form PHP berikut agar menampilkan bilangan genap dari 1 sampai batas yang diinput user.\n\n```php\n<form action=\"\" method=\"____(1)____\">\n    Batas: <input type=\"number\" name=\"____(2)____\">\n    <input type=\"submit\" name=\"____(3)____\" value=\"Tampilkan\">\n</form>\n\n<?php\nif (isset($_POST['____(3)____'])) {\n    $batas = $_POST['____(2)____'];\n    for ($i = 1; $i ____(4)____ $batas; $i++) {\n        if ($i ____(5)____ 2 == 0) {\n            echo $i . \" \";\n        }\n    }\n}\n?>\n```\n\nIsilah bagian (1)–(5) dengan jawaban tepat!",
    points: 10,
    answerKey: [
      { blank: 1, answer: "POST" },
      { blank: 2, answer: "batas" },
      { blank: 3, answer: "tampil" },
      { blank: 4, answer: "<=" },
      { blank: 5, answer: "%" }
    ]
  },
  {
    type: "SHORT_ANSWER_MULTI",
    questionText: "Lengkapi form PHP berikut agar mengecek kategori nilai: jika nilai >= 75 maka \"Lulus\", selain itu \"Tidak Lulus\".\n\n```php\n<form action=\"\" method=\"____(1)____\">\n    Nilai: <input type=\"text\" name=\"____(2)____\">\n    <button type=\"submit\" name=\"____(3)____\">Cek</button>\n</form>\n\n<?php\nif (____(4)____($_POST['cek'])) {\n    $nilai = $_POST['____(2)____'];\n    if ($nilai ____(5)____ 75) {\n        echo \"Lulus\";\n    } else {\n        echo \"Tidak Lulus\";\n    }\n}\n?>\n```\n\nIsilah bagian (1)–(5) dengan jawaban tepat!",
    points: 10,
    answerKey: [
      { blank: 1, answer: "POST" },
      { blank: 2, answer: "nilai" },
      { blank: 3, answer: "cek" },
      { blank: 4, answer: "isset" },
      { blank: 5, answer: ">=" }
    ]
  },
  {
    type: "SHORT_ANSWER_MULTI",
    questionText: "Lengkapi form PHP berikut agar menampilkan tabel perkalian dari angka yang diinput user (1 sampai 10).\n\n```php\n<form action=\"\" method=\"____(1)____\">\n    Angka: <input type=\"number\" name=\"____(2)____\">\n    <input type=\"submit\" name=\"____(3)____\" value=\"Tampilkan\">\n</form>\n\n<?php\nif (isset($_POST['____(3)____'])) {\n    $angka = $_POST['____(2)____'];\n    for ($i = 1; $i <= ____(4)____; $i++) {\n        echo $angka . \" x \" . $i . \" = \" . (____(5)____) . \"<br>\";\n    }\n}\n?>\n```\n\nIsilah bagian (1)–(5) dengan jawaban tepat!",
    points: 10,
    answerKey: [
      { blank: 1, answer: "POST" },
      { blank: 2, answer: "angka" },
      { blank: 3, answer: "tampil" },
      { blank: 4, answer: "10" },
      { blank: 5, answer: "$angka * $i" }
    ]
  },
  {
    type: "SHORT_ANSWER_MULTI",
    questionText: "Lengkapi form PHP berikut agar menjumlahkan angka 1 sampai N (N dari input), menggunakan looping while.\n\n```php\n<form action=\"\" method=\"____(1)____\">\n    N: <input type=\"number\" name=\"____(2)____\">\n    <button type=\"submit\" name=\"____(3)____\">Jumlahkan</button>\n</form>\n\n<?php\nif (isset($_POST['____(3)____'])) {\n    $n = $_POST['____(2)____'];\n    $i = 1;\n    $total = 0;\n    ____(4)____ ($i <= $n) {\n        $total = $total + $i;\n        $i____(5)____;\n    }\n    echo \"Total: \" . $total;\n}\n?>\n```\n\nIsilah bagian (1)–(5) dengan jawaban tepat!",
    points: 10,
    answerKey: [
      { blank: 1, answer: "POST" },
      { blank: 2, answer: "n" },
      { blank: 3, answer: "jumlah" },
      { blank: 4, answer: "while" },
      { blank: 5, answer: "++" }
    ]
  }
];

const SAMPLE_JSON_TEMPLATE = [
  {
    type: "MULTIPLE_CHOICE",
    questionText: "Manakah tag HTML5 yang tepat untuk membuat tautan navigasi ke halaman lain?\n\n```html\n<a href=\"https://smk.sch.id\">Kunjungi Web Sekolah</a>\n```",
    points: 20,
    options: [
      "<a href=\"...\">",
      "<link src=\"...\">",
      "<nav to=\"...\">",
      "<url path=\"...\">"
    ],
    correctAnswer: "A"
  },
  {
    type: "TRUE_FALSE",
    questionText: "Properti CSS `display: flex; justify-content: center; align-items: center;` digunakan untuk menengahkan elemen secara horizontal dan vertikal.\n\n```css\n.card-container {\n  display: flex;\n  justify-content: center;\n  align-items: center;\n}\n```",
    points: 20,
    correctAnswer: "BENAR"
  },
  {
    type: "SHORT_ANSWER",
    questionText: "Lengkapilah baris kode PHP berikut untuk mencetak nilai variabel ke layar:\n\n```php\n$pesan = \"Selamat Datang di Portal CBT\";\n_____ $pesan;\n```",
    points: 20,
    shortAnswerKey: "echo | print",
    isCaseSensitive: false
  },
  {
    type: "SHORT_ANSWER_MULTI",
    questionText: "Lengkapi potongan kode PHP form berikut agar dapat memproses data POST input nama dan menampilkannya:\n\n```php\n<form action=\"\" method=\"____(1)____\">\n    Nama: <input type=\"text\" name=\"____(2)____\">\n    <button type=\"submit\" name=\"____(3)____\">Kirim</button>\n</form>\n\n<?php\nif (isset($_POST['____(3)____'])) {\n    $nama = $_POST['____(2)____'];\n    ____(4)____ \"Halo, \" . $nama;\n}\n?>\n```",
    points: 20,
    answerKey: [
      { "blank": 1, "answer": "POST" },
      { "blank": 2, "answer": "nama" },
      { "blank": 3, "answer": "kirim" },
      { "blank": 4, "answer": "echo", "alternatives": ["print"] }
    ]
  },
  {
    type: "ESSAY",
    questionText: "Tuliskan kueri SQL untuk mengambil seluruh data siswa dari tabel `students` yang memiliki nilai `score` di atas 75 dan diurutkan dari nilai tertinggi!\n\n```sql\n-- Tuliskan kueri SQL lengkap di bawah ini\n```",
    points: 20,
    essayAnswerKey: "SELECT * FROM students WHERE score > 75 ORDER BY score DESC;"
  }
];

const SAMPLE_TEXT_TEMPLATE = `SOAL 1
Tipe: MULTIPLE_CHOICE
Poin: 20
Tanya: Manakah tag HTML5 yang digunakan untuk membuat navigasi?
A: <nav>
B: <header>
C: <navigation>
D: <menu>
Kunci: A

SOAL 2
Tipe: TRUE_FALSE
Poin: 20
Tanya: CSS flexbox dapat menengahkan elemen secara horizontal dan vertikal.
Kunci: BENAR

SOAL 3
Tipe: SHORT_ANSWER
Poin: 20
Tanya: Lengkapilah baris kode PHP untuk menampilkan teks ke layar: _____ "Halo CBT";
Kunci: echo | print

SOAL 4
Tipe: ESSAY
Poin: 20
Tanya: Tuliskan sintaks koneksi database di PHP!
Kunci: $conn = new mysqli($host, $user, $pass, $db);
`;

interface ImportQuestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  examId: string;
  onImportQuestions: (questions: Question[]) => Promise<void> | void;
}

export const ImportQuestionsModal: React.FC<ImportQuestionsModalProps> = ({
  isOpen,
  onClose,
  examId,
  onImportQuestions,
}) => {
  const [activeTab, setActiveTab] = useState<'JSON' | 'TEXT'>('JSON');
  const [rawContent, setRawContent] = useState('');
  const [copiedTemplate, setCopiedTemplate] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedPreview, setParsedPreview] = useState<Question[]>([]);

  const handleCopyTemplate = () => {
    const textToCopy = activeTab === 'JSON' ? JSON.stringify(SAMPLE_JSON_TEMPLATE, null, 2) : SAMPLE_TEXT_TEMPLATE;
    navigator.clipboard.writeText(textToCopy);
    setCopiedTemplate(true);
    setTimeout(() => setCopiedTemplate(false), 2000);
  };

  const handleDownloadTemplateFile = () => {
    const textContent = activeTab === 'JSON' ? JSON.stringify(SAMPLE_JSON_TEMPLATE, null, 2) : SAMPLE_TEXT_TEMPLATE;
    const blob = new Blob([textContent], { type: activeTab === 'JSON' ? 'application/json' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeTab === 'JSON' ? 'template_impor_soal.json' : 'template_impor_soal.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseJSONInput = (text: string): Question[] => {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      throw new Error('Format JSON harus berupa Array / Daftar Objek [...]');
    }

    return data.map((item: any, idx: number) => {
      const rawType = String(item.type || 'MULTIPLE_CHOICE').toUpperCase();
      let qType: QuestionType = 'MULTIPLE_CHOICE';

      if (
        rawType.includes('MULTI') ||
        (Array.isArray(item.answerKey) && item.answerKey.length > 0 && typeof item.answerKey[0] === 'object' && 'blank' in item.answerKey[0]) ||
        (Array.isArray(item.shortAnswerMultiKey) && item.shortAnswerMultiKey.length > 0 && typeof item.shortAnswerMultiKey[0] === 'object' && 'blank' in item.shortAnswerMultiKey[0])
      ) {
        qType = 'SHORT_ANSWER_MULTI';
      } else if (
        rawType.includes('SHORT') ||
        rawType.includes('ISIAN') ||
        rawType.includes('SINGKAT') ||
        rawType === 'BLANK'
      ) {
        qType = 'SHORT_ANSWER';
      } else if (rawType.includes('TRUE') || rawType.includes('BENAR') || rawType.includes('SALAH')) {
        qType = 'TRUE_FALSE';
      } else if (rawType.includes('ESSAY') || rawType.includes('URAIAN')) {
        qType = 'ESSAY';
      } else {
        qType = 'MULTIPLE_CHOICE';
      }

      const qText = item.questionText || item.question || item.tanya || `Soal ${idx + 1}`;
      const qPoints = Number(item.points || item.poin) || 20;

      let qOptions: QuestionOption[] = [];
      let correctOptId: string | undefined = undefined;

      if (qType === 'MULTIPLE_CHOICE') {
        const rawOpts: string[] = item.options || item.pilihan || [];
        qOptions = rawOpts.map((optStr: string, optIdx: number) => ({
          id: `opt_${Date.now()}_${idx}_${optIdx}`,
          optionText: String(optStr),
        }));

        // Determine correct option
        const keyVal = String(item.correctAnswer || item.answer || item.kunci || item.key || 'A').trim().toUpperCase();
        if (['A', 'B', 'C', 'D', 'E'].includes(keyVal)) {
          const charIndex = keyVal.charCodeAt(0) - 65;
          if (qOptions[charIndex]) {
            correctOptId = qOptions[charIndex].id;
          }
        } else if (qOptions.length > 0) {
          const matchedOpt = qOptions.find(o => o.optionText.trim().toLowerCase() === keyVal.toLowerCase());
          correctOptId = matchedOpt ? matchedOpt.id : qOptions[0].id;
        }
      } else if (qType === 'TRUE_FALSE') {
        qOptions = [
          { id: `opt_true_${Date.now()}_${idx}`, optionText: 'BENAR (True)' },
          { id: `opt_false_${Date.now()}_${idx}`, optionText: 'SALAH (False)' },
        ];
        const keyVal = String(item.correctAnswer || item.answer || item.kunci || item.key || 'BENAR').toUpperCase();
        if (keyVal.includes('SALAH') || keyVal === 'FALSE' || keyVal === 'B' || keyVal === '2') {
          correctOptId = qOptions[1].id;
        } else {
          correctOptId = qOptions[0].id;
        }
      }

      // Robust single short answer extraction:
      let shortKeyVal = '';
      let shortKeysList: string[] | undefined = undefined;

      if (qType === 'SHORT_ANSWER') {
        const rawCandidate =
          item.shortAnswerKey ??
          item.correctAnswer ??
          item.answer ??
          item.shortAnswer ??
          item.kunci ??
          item.key ??
          item.jawaban;

        if (Array.isArray(rawCandidate)) {
          shortKeysList = rawCandidate.map(String).map((s) => s.trim()).filter(Boolean);
          shortKeyVal = shortKeysList[0] || '';
        } else if (Array.isArray(item.shortAnswerKeys)) {
          shortKeysList = item.shortAnswerKeys.map(String).map((s) => s.trim()).filter(Boolean);
          shortKeyVal = String(rawCandidate || shortKeysList[0] || '').trim();
        } else if (rawCandidate !== undefined && rawCandidate !== null) {
          shortKeyVal = String(rawCandidate).trim();
          if (shortKeyVal.includes('|')) {
            shortKeysList = shortKeyVal.split('|').map((s: string) => s.trim()).filter(Boolean);
          } else {
            shortKeysList = [shortKeyVal];
          }
        }
      }

      let multiAnswerKey: ShortAnswerMultiItem[] | undefined = undefined;
      if (qType === 'SHORT_ANSWER_MULTI') {
        const rawKey = item.answerKey || item.shortAnswerMultiKey;
        if (Array.isArray(rawKey)) {
          multiAnswerKey = rawKey.map((k: any) => ({
            blank: Number(k.blank),
            answer: String(k.answer ?? k.kunci ?? ''),
            alternatives: Array.isArray(k.alternatives) ? k.alternatives : undefined,
          }));
        } else if (typeof rawKey === 'object' && rawKey !== null) {
          multiAnswerKey = Object.entries(rawKey).map(([k, v]) => ({
            blank: Number(k),
            answer: String(v || ''),
          }));
        }
      }

      return {
        id: `q_imp_${Date.now()}_${idx}`,
        examId: examId,
        type: qType,
        questionText: qText,
        imageUrl: item.imageUrl || item.gambar || undefined,
        points: qPoints,
        options: (qType === 'ESSAY' || qType === 'SHORT_ANSWER' || qType === 'SHORT_ANSWER_MULTI') ? [] : qOptions,
        correctOptionId: correctOptId,
        essayAnswerKey: qType === 'ESSAY' ? String(item.essayAnswerKey || item.correctAnswer || item.answer || item.kunci || item.key || '') : undefined,
        shortAnswerKey: qType === 'SHORT_ANSWER' ? (shortKeyVal || undefined) : undefined,
        shortAnswerKeys: qType === 'SHORT_ANSWER' ? shortKeysList : undefined,
        answerKey: multiAnswerKey,
        shortAnswerMultiKey: multiAnswerKey,
        isCaseSensitive: Boolean(item.isCaseSensitive ?? item.caseSensitive ?? false),
      };
    });
  };

  const parseTextInput = (text: string): Question[] => {
    const blocks = text.split(/SOAL\s+\d+/i).filter(b => b.trim().length > 0);
    if (blocks.length === 0) {
      throw new Error('Format teks tidak valid. Gunakan format diawali "SOAL 1", "SOAL 2", dst.');
    }

    return blocks.map((block, idx) => {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      let qType: QuestionType = 'MULTIPLE_CHOICE';
      let qPoints = 20;
      let qText = '';
      let qImageUrl: string | undefined = undefined;
      let optionsMap: Record<string, string> = {};
      let keyVal = 'A';
      let multiMap: Record<number, string> = {};

      for (const line of lines) {
        if (line.toLowerCase().startsWith('tipe:')) {
          const t = line.substring(5).trim().toUpperCase();
          if (t.includes('MULTI')) qType = 'SHORT_ANSWER_MULTI';
          else if (t.includes('TRUE') || t.includes('BENAR')) qType = 'TRUE_FALSE';
          else if (t.includes('SHORT') || t.includes('ISIAN') || t.includes('BLANK')) qType = 'SHORT_ANSWER';
          else if (t.includes('ESSAY') || t.includes('URAIAN')) qType = 'ESSAY';
          else qType = 'MULTIPLE_CHOICE';
        } else if (line.toLowerCase().startsWith('poin:')) {
          qPoints = parseInt(line.substring(5).trim()) || 20;
        } else if (line.toLowerCase().startsWith('tanya:')) {
          qText = line.substring(6).trim();
        } else if (line.toLowerCase().startsWith('gambar:') || line.toLowerCase().startsWith('image:')) {
          qImageUrl = line.substring(line.indexOf(':') + 1).trim();
        } else if (line.match(/^kunci\s*\(?(\d+)\)?\s*:/i)) {
          const m = line.match(/^kunci\s*\(?(\d+)\)?\s*:(.*)$/i);
          if (m) {
            multiMap[Number(m[1])] = m[2].trim();
          }
        } else if (line.match(/^[A-E]:/i)) {
          const letter = line[0].toUpperCase();
          optionsMap[letter] = line.substring(2).trim();
        } else if (line.toLowerCase().startsWith('kunci:')) {
          keyVal = line.substring(6).trim();
        }
      }

      let qOptions: QuestionOption[] = [];
      let correctOptId: string | undefined = undefined;

      if (qType === 'MULTIPLE_CHOICE') {
        const letters = Object.keys(optionsMap).sort();
        qOptions = letters.map((ltr, optIdx) => ({
          id: `opt_${Date.now()}_${idx}_${optIdx}`,
          optionText: optionsMap[ltr] || '',
        }));

        const cleanKey = keyVal.toUpperCase();
        const keyIdx = letters.indexOf(cleanKey);
        if (keyIdx !== -1 && qOptions[keyIdx]) {
          correctOptId = qOptions[keyIdx].id;
        } else if (qOptions.length > 0) {
          correctOptId = qOptions[0].id;
        }
      } else if (qType === 'TRUE_FALSE') {
        qOptions = [
          { id: `opt_true_${Date.now()}_${idx}`, optionText: 'BENAR (True)' },
          { id: `opt_false_${Date.now()}_${idx}`, optionText: 'SALAH (False)' },
        ];
        if (keyVal.toUpperCase().includes('SALAH') || keyVal.toUpperCase() === 'FALSE') {
          correctOptId = qOptions[1].id;
        } else {
          correctOptId = qOptions[0].id;
        }
      }

      const textMultiKeys: ShortAnswerMultiItem[] | undefined = Object.keys(multiMap).length > 0
        ? Object.entries(multiMap).map(([k, v]) => ({ blank: Number(k), answer: v }))
        : undefined;

      return {
        id: `q_imp_${Date.now()}_${idx}`,
        examId,
        type: qType,
        questionText: qText || `Pertanyaan ${idx + 1}`,
        imageUrl: qImageUrl,
        points: qPoints,
        options: (qType === 'ESSAY' || qType === 'SHORT_ANSWER' || qType === 'SHORT_ANSWER_MULTI') ? [] : qOptions,
        correctOptionId: correctOptId,
        essayAnswerKey: (qType as QuestionType) === 'ESSAY' ? keyVal : undefined,
        shortAnswerKey: qType === 'SHORT_ANSWER' ? keyVal : undefined,
        shortAnswerKeys: qType === 'SHORT_ANSWER' && keyVal.includes('|')
          ? keyVal.split('|').map(s => s.trim()).filter(Boolean)
          : qType === 'SHORT_ANSWER' && keyVal
          ? [keyVal]
          : undefined,
        answerKey: textMultiKeys,
        shortAnswerMultiKey: textMultiKeys,
      };
    });
  };

  const handleProcessParse = () => {
    setParseError(null);
    if (!rawContent.trim()) {
      setParseError('Data teks/JSON impor belum diisi!');
      return;
    }

    try {
      let result: Question[] = [];
      if (activeTab === 'JSON') {
        result = parseJSONInput(rawContent);
      } else {
        result = parseTextInput(rawContent);
      }

      setParsedPreview(result);
    } catch (err: any) {
      console.error(err);
      setParseError(err.message || 'Gagal memproses data impor. Periksa kembali format teks/JSON Anda.');
    }
  };

  const handleConfirmImport = () => {
    if (parsedPreview.length === 0) return;
    onImportQuestions(parsedPreview);
    onClose();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setRawContent(content || '');
    };
    reader.readAsText(file);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Impor Soal Langsung Ke Ujian Ini"
      maxWidth="xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          {parsedPreview.length > 0 ? (
            <Button
              variant="primary"
              onClick={handleConfirmImport}
              className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200"
            >
              <CheckCircle2 className="w-4 h-4" />
              Tambahkan {parsedPreview.length} Soal Ke Ujian Ini
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleProcessParse}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Proses & Pratinjau Soal
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4 text-xs font-sans text-slate-800 dark:text-zinc-100">
        <p className="text-slate-500 dark:text-zinc-400">
          Soal yang diimpor hanya akan tersimpan <strong>khusus di dalam ujian ini</strong> tanpa dicampur ke tempat lain.
        </p>

        {/* Format Selector Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-zinc-800 pb-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab('JSON');
              setParsedPreview([]);
              setParseError(null);
            }}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'JSON'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700'
            }`}
          >
            <FileCode className="w-4 h-4" />
            Format JSON
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('TEXT');
              setParsedPreview([]);
              setParseError(null);
            }}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'TEXT'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700'
            }`}
          >
            <FileText className="w-4 h-4" />
            Format Teks Sederhana
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveTab('JSON');
                setRawContent(JSON.stringify(PHP_MULTI_QUESTIONS_SAMPLE, null, 2));
                setParsedPreview([]);
              }}
              className="text-amber-700 dark:text-amber-400 hover:underline font-bold flex items-center gap-1 text-[11px] cursor-pointer bg-amber-50 dark:bg-amber-950/40 px-2 py-1 rounded-md border border-amber-200 dark:border-amber-800"
              title="Muat 5 soal isian multi-blank PHP yang diminta"
            >
              📥 Muat 5 Soal PHP (Multi-Blank)
            </button>
            <button
              type="button"
              onClick={handleCopyTemplate}
              className="text-emerald-700 dark:text-emerald-400 hover:underline font-bold flex items-center gap-1 text-[11px] cursor-pointer"
            >
              {copiedTemplate ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedTemplate ? 'Tersalin' : 'Salin Contoh Template'}
            </button>
            <button
              type="button"
              onClick={handleDownloadTemplateFile}
              className="text-slate-600 dark:text-zinc-300 hover:text-emerald-600 flex items-center gap-1 text-[11px] cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Unduh File Template
            </button>
          </div>
        </div>

        {parseError && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{parseError}</span>
          </div>
        )}

        {/* Input Textarea & File Upload */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block font-semibold">Tempelkan Data Soal atau Unggah File (.json / .txt):</label>
            <label className="text-emerald-700 dark:text-emerald-400 font-bold hover:underline cursor-pointer flex items-center gap-1">
              <Upload className="w-3.5 h-3.5" />
              Pilih File Dari Komputer
              <input
                type="file"
                accept={activeTab === 'JSON' ? '.json' : '.txt,.csv'}
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          <textarea
            rows={8}
            value={rawContent}
            onChange={(e) => {
              setRawContent(e.target.value);
              setParsedPreview([]);
            }}
            placeholder={
              activeTab === 'JSON'
                ? 'Tempelkan struktur JSON soal di sini...'
                : 'Tempelkan teks daftar soal (format SOAL 1, SOAL 2...) di sini...'
            }
            className="w-full p-3 rounded-xl border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 font-mono text-xs leading-relaxed focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Parsed Preview Section */}
        {parsedPreview.length > 0 && (
          <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/80 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Berhasil Membaca {parsedPreview.length} Soal
              </h4>
              <Badge variant="emerald">Siap Diimpor</Badge>
            </div>

            <div className="max-h-[220px] overflow-y-auto space-y-2 pr-1">
              {parsedPreview.map((q, idx) => (
                <div key={q.id} className="p-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-emerald-100 dark:border-zinc-800 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold font-mono text-emerald-700 text-xs">#{idx + 1}</span>
                    <Badge variant={q.type === 'SHORT_ANSWER_MULTI' ? 'amber' : 'teal'} size="sm">{q.type}</Badge>
                    <span className="text-[11px] font-semibold text-slate-700 dark:text-zinc-200 truncate">{q.questionText}</span>
                  </div>
                  {q.type === 'SHORT_ANSWER_MULTI' && (
                    <div className="text-[10px] text-amber-700 dark:text-amber-300 font-mono pl-6 flex flex-wrap gap-1.5">
                      <span className="font-bold">Kunci:</span>
                      {(q.answerKey || q.shortAnswerMultiKey || []).map((k) => (
                        <span key={k.blank} className="bg-amber-100 dark:bg-amber-950 px-1.5 py-0.5 rounded border border-amber-300 dark:border-amber-700">
                          ({k.blank}) {k.answer}
                        </span>
                      ))}
                    </div>
                  )}
                  {q.type === 'SHORT_ANSWER' && (
                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono pl-6">
                      Kunci Isian: {q.shortAnswerKey || (q.shortAnswerKeys || []).join(' | ') || '-'}
                    </div>
                  )}
                  {q.type !== 'ESSAY' && q.type !== 'SHORT_ANSWER' && q.type !== 'SHORT_ANSWER_MULTI' && q.options && (
                    <div className="text-[10px] text-slate-500 dark:text-zinc-400 pl-6">
                      Jumlah opsi: {q.options.length} pilihan
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
