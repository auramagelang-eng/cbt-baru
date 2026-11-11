import { User, Exam, Question, ParticipantAnswer, ViolationLog, ExamResult } from '../types/cbt';
import fs from 'fs';
import path from 'path';

export interface StoredSession {
  sessionId: string;
  examId: string;
  participantId: string;
  attemptNumber?: number;
  startTime: number;
  endTime: number;
  shuffledQuestions: Question[];
  answers: Record<string, ParticipantAnswer>;
  violationsCount: number;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'AUTO_SUBMITTED';
  submittedAt?: string;
  score?: number;
  maxScore?: number;
  currentQuestionIndex?: number;
  activeDeviceId?: string;
  ipAddress?: string;
}

const DB_FILE_PATH = path.join(process.cwd(), 'db_store.json');

class DatabaseStore {
  private users = new Map<string, User>();
  private usersByToken = new Map<string, User>();
  private usersByParticipantCode = new Map<string, User>();

  private exams = new Map<string, Exam>();
  private examsByToken = new Map<string, Exam>();

  private questionsByExamId = new Map<string, Question[]>();
  private sessions = new Map<string, StoredSession>();
  private sessionsByParticipantExam = new Map<string, StoredSession>(); // Key: `${participantId}_${examId}`

  private violationLogs: ViolationLog[] = [];

  public queryCount = 0;
  public totalRequests = 0;
  public savedRequestsCount = 0; // Each batch save saves N-1 per-question requests

  constructor() {
    if (!this.loadPersistedData()) {
      this.seedDefaultData();
      this.persistData();
    }
  }

  private loadPersistedData(): boolean {
    try {
      if (!fs.existsSync(DB_FILE_PATH)) {
        return false;
      }
      const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8');
      const data = JSON.parse(raw);

      if (!data || !data.users || !data.exams) {
        return false;
      }

      this.users.clear();
      this.usersByToken.clear();
      this.usersByParticipantCode.clear();
      (data.users || []).forEach((u: User) => {
        if (u.role === 'PARTICIPANT' && !u.originalName) {
          if (u.name && (u.name.startsWith('Peserta') || u.name.startsWith('Siswa'))) {
            u.originalName = u.name;
          } else {
            const code = (u.participantCode || u.username || '').toUpperCase();
            const rplMatch = code.match(/^RPL0*(\d+)$/i);
            if (rplMatch) {
              u.originalName = `Peserta RPL ${rplMatch[1].padStart(2, '0')}`;
            } else if (code) {
              u.originalName = `Peserta ${code}`;
            }
          }
        }
        this.users.set(u.id, u);
        if (u.token) this.usersByToken.set(u.token.toUpperCase(), u);
        if (u.participantCode) this.usersByParticipantCode.set(u.participantCode.toUpperCase(), u);
      });

      this.exams.clear();
      this.examsByToken.clear();
      (data.exams || []).forEach((e: Exam) => {
        this.exams.set(e.id, e);
        if (e.token) {
          this.examsByToken.set(e.token.toUpperCase(), e);
          const cleaned = e.token.trim().toUpperCase().replace(/[\/\-\_\s]/g, '');
          this.examsByToken.set(cleaned, e);
        }
      });

      this.questionsByExamId.clear();
      if (data.questionsByExamId) {
        Object.entries(data.questionsByExamId).forEach(([examId, questions]) => {
          this.questionsByExamId.set(examId, questions as Question[]);
        });
      }

      this.sessions.clear();
      this.sessionsByParticipantExam.clear();
      (data.sessions || []).forEach((s: StoredSession) => {
        this.sessions.set(s.sessionId, s);
        this.sessionsByParticipantExam.set(`${s.participantId}_${s.examId}`, s);
      });

      this.violationLogs = data.violationLogs || [];

      if (!this.exams.has('exam_php_multi')) {
        this.seedPhpMultiExamData();
        this.persistData(true);
      }

      console.log('DatabaseStore successfully loaded from persistent file:', DB_FILE_PATH);
      return true;
    } catch (err) {
      console.error('Failed to load db_store.json, falling back to seed data:', err);
      return false;
    }
  }

  private persistTimer: any = null;
  public persistData(immediate = true): void {
    const doWrite = () => {
      try {
        const data = {
          users: Array.from(this.users.values()),
          exams: Array.from(this.exams.values()),
          questionsByExamId: Object.fromEntries(this.questionsByExamId.entries()),
          sessions: Array.from(this.sessions.values()),
          violationLogs: this.violationLogs,
        };
        fs.writeFileSync(DB_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
      } catch (err) {
        console.error('Failed to persist database to disk:', err);
      }
    };

    if (immediate) {
      if (this.persistTimer) clearTimeout(this.persistTimer);
      doWrite();
    } else {
      if (this.persistTimer) clearTimeout(this.persistTimer);
      this.persistTimer = setTimeout(doWrite, 100);
    }
  }

  private seedDefaultData() {
    // 1. Admin User
    const adminUser: User = {
      id: 'usr_admin',
      username: 'ahmad',
      name: 'Ahmad (Administrator)',
      role: 'ADMIN',
    };
    this.users.set(adminUser.id, adminUser);

    // 2. 40 Sample Exam Participants with token format RPL01 - RPL40
    for (let i = 1; i <= 40; i++) {
      const numStr = String(i).padStart(2, '0');
      const code = `RPL${numStr}`;
      const token = `RPL${numStr}`;
      const participant: User = {
        id: `usr_rpl_${numStr}`,
        username: code.toLowerCase(),
        name: `Peserta RPL ${numStr}`,
        role: 'PARTICIPANT',
        participantCode: code,
        token: token,
      };
      this.users.set(participant.id, participant);
      this.usersByToken.set(token.toUpperCase(), participant);
      this.usersByParticipantCode.set(code.toUpperCase(), participant);
    }

    // 3. Sample Exam
    const sampleExam: Exam = {
      id: 'exam_matematika_01',
      title: 'Ujian Akhir Semester - Matematika & Algoritma',
      subject: 'Teknologi Informasi',
      durationMinutes: 45,
      totalQuestions: 10,
      passPercentage: 70,
      token: 'EXAM36',
      isActive: true,
      shuffleQuestions: true,
      shuffleAnswers: true,
      maxViolations: 3,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
    };
    this.exams.set(sampleExam.id, sampleExam);
    this.examsByToken.set(sampleExam.token, sampleExam);

    // 4. Sample Questions
    const sampleQuestions: Question[] = [
      {
        id: 'q1',
        examId: sampleExam.id,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Berapakah hasil dari kompleksitas waktu terbaik (Best-case time complexity) untuk Algoritma Quick Sort?',
        points: 10,
        options: [
          { id: 'q1_a', optionText: 'O(n log n)' },
          { id: 'q1_b', optionText: 'O(n^2)' },
          { id: 'q1_c', optionText: 'O(n)' },
          { id: 'q1_d', optionText: 'O(1)' },
        ],
        correctOptionId: 'q1_a',
      },
      {
        id: 'q2',
        examId: sampleExam.id,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Manakah dari struktur data berikut yang bekerja menggunakan prinsip LIFO (Last In First Out)?',
        points: 10,
        options: [
          { id: 'q2_a', optionText: 'Queue' },
          { id: 'q2_b', optionText: 'Stack' },
          { id: 'q2_c', optionText: 'Linked List' },
          { id: 'q2_d', optionText: 'Binary Tree' },
        ],
        correctOptionId: 'q2_b',
      },
      {
        id: 'q3',
        examId: sampleExam.id,
        type: 'TRUE_FALSE',
        questionText: 'Protokol HTTPS menggunakan enkripsi SSL/TLS pada port default 443.',
        points: 10,
        options: [
          { id: 'q3_a', optionText: 'BENAR (True)' },
          { id: 'q3_b', optionText: 'SALAH (False)' },
        ],
        correctOptionId: 'q3_a',
      },
      {
        id: 'q4',
        examId: sampleExam.id,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Dalam arsitektur REST API, HTTP method manakah yang bersifat Idempotent?',
        points: 10,
        options: [
          { id: 'q4_a', optionText: 'POST dan PATCH' },
          { id: 'q4_b', optionText: 'GET, PUT, dan DELETE' },
          { id: 'q4_c', optionText: 'Hanya POST' },
          { id: 'q4_d', optionText: 'Hanya CONNECT' },
        ],
        correctOptionId: 'q4_b',
      },
      {
        id: 'q5',
        examId: sampleExam.id,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Fitur apakah yang digunakan pada CBT Cloud ini untuk menghindari polling dan mengefisiensikan request ke server Cloud Run?',
        points: 10,
        options: [
          { id: 'q5_a', optionText: 'Polling tiap 1 detik' },
          { id: 'q5_b', optionText: 'Single-payload load + Local state + Debounce Auto-Save (3-5 detik)' },
          { id: 'q5_c', optionText: 'Request soal satu per satu secara berulang' },
          { id: 'q5_d', optionText: 'Banyak WebSocket heartbeats' },
        ],
        correctOptionId: 'q5_b',
      },
      {
        id: 'q6',
        examId: sampleExam.id,
        type: 'TRUE_FALSE',
        questionText: 'Perhitungan timer waktu sisa ujian dikirim via HTTP Request dari server setiap detik.',
        points: 10,
        options: [
          { id: 'q6_a', optionText: 'BENAR (True)' },
          { id: 'q6_b', optionText: 'SALAH (False, dihitung lokal di browser & diverifikasi akhir oleh server)' },
        ],
        correctOptionId: 'q6_b',
      },
      {
        id: 'q7',
        examId: sampleExam.id,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Berapakah batas toleransi pelanggaran (Pindah Tab/Keluar Fullscreen) sebelum sistem CBT melakukan Auto-Submit otomatis?',
        points: 10,
        options: [
          { id: 'q7_a', optionText: '10 kali' },
          { id: 'q7_b', optionText: '3 kali' },
          { id: 'q7_c', optionText: '50 kali' },
          { id: 'q7_d', optionText: 'Tidak ada batas' },
        ],
        correctOptionId: 'q7_b',
      },
      {
        id: 'q8',
        examId: sampleExam.id,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Manakah perintah SQL yang digunakan untuk menghapus seluruh isi tabel secara cepat tanpa mencatat log baris individu?',
        points: 10,
        options: [
          { id: 'q8_a', optionText: 'DELETE FROM table' },
          { id: 'q8_b', optionText: 'TRUNCATE TABLE' },
          { id: 'q8_c', optionText: 'DROP TABLE' },
          { id: 'q8_d', optionText: 'REMOVE ALL' },
        ],
        correctOptionId: 'q8_b',
      },
      {
        id: 'q9',
        examId: sampleExam.id,
        type: 'ESSAY',
        questionText: 'Jelaskan mengapa arsitektur Stateless Server dan Single Payload sangat efisien untuk deployment di Google AI Studio Cloud / Cloud Run!',
        points: 10,
        options: [],
        essayAnswerKey: 'Mengurangi cold start, meminimalkan query database, menghilangkan session memory leak, dan menghemat konsumsi CPU & RAM secara drastis.',
      },
      {
        id: 'q10',
        examId: sampleExam.id,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Dalam pemrograman berorientasi objek (OOP), kemampuan kelas turunan untuk memberikan implementasi spesifik dari metode yang sudah ada pada induknya dinamakan...',
        points: 10,
        options: [
          { id: 'q10_a', optionText: 'Encapsulation' },
          { id: 'q10_b', optionText: 'Polymorphism (Method Overriding)' },
          { id: 'q10_c', optionText: 'Inheritance' },
          { id: 'q10_d', optionText: 'Abstraction' },
        ],
        correctOptionId: 'q10_b',
      }
    ];

    this.questionsByExamId.set(sampleExam.id, sampleQuestions);

    this.seedD1R2Data();
  }

  private seedD1R2Data() {
    // 1. Exam D1/R2
    const d1r2Exam: Exam = {
      id: 'exam_d1_r2',
      title: 'Ujian CBT Sesi D1 - Ruang 2 (D1/R2)',
      subject: 'Informatika & Pemrograman D1/R2',
      durationMinutes: 60,
      totalQuestions: 10,
      passPercentage: 70,
      token: 'D1R2',
      isActive: true,
      shuffleQuestions: true,
      shuffleAnswers: true,
      maxViolations: 3,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
    };
    this.exams.set(d1r2Exam.id, d1r2Exam);
    this.examsByToken.set(d1r2Exam.token, d1r2Exam);

    // 2. Participants for D1/R2
    for (let i = 1; i <= 20; i++) {
      const numStr = String(i).padStart(2, '0');
      const code = `D1-R2-${numStr}`;
      const token = `D1R2${numStr}`;
      const p: User = {
        id: `usr_d1_r2_${numStr}`,
        username: code.toLowerCase(),
        name: `Peserta D1/R2 No ${numStr}`,
        role: 'PARTICIPANT',
        participantCode: code,
        token: token,
      };
      this.users.set(p.id, p);
      this.usersByToken.set(token.toUpperCase(), p);
      this.usersByParticipantCode.set(code.toUpperCase(), p);
    }

    // 3. Questions for D1/R2 (Combining all questions across the system into D1/R2 exam)
    const sampleQuestionsFromExam1 = this.questionsByExamId.get('exam_matematika_01') || [];
    const d1r2Questions: Question[] = [
      ...sampleQuestionsFromExam1.map(q => ({ ...q, examId: d1r2Exam.id })),
      {
        id: 'q_d1r2_1',
        examId: d1r2Exam.id,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Manakah komponen utama dari arsitektur komputer Von Neumann?',
        points: 10,
        options: [
          { id: 'opt_d1_1a', optionText: 'CPU, Memori Utama, Input/Output, Bus' },
          { id: 'opt_d1_1b', optionText: 'Kamera, GPU, Printer' },
          { id: 'opt_d1_1c', optionText: 'Router, Switch, Modem' },
          { id: 'opt_d1_1d', optionText: 'Hanya Harddisk dan RAM' },
        ],
        correctOptionId: 'opt_d1_1a',
      },
      {
        id: 'q_d1r2_2',
        examId: d1r2Exam.id,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Dalam bahasa pemrograman TypeScript, perintah untuk mendeklarasikan variabel yang nilainya tidak dapat diubah (immutable) adalah...',
        points: 10,
        options: [
          { id: 'opt_d1_2a', optionText: 'var' },
          { id: 'opt_d1_2b', optionText: 'let' },
          { id: 'opt_d1_2c', optionText: 'const' },
          { id: 'opt_d1_2d', optionText: 'static' },
        ],
        correctOptionId: 'opt_d1_2c',
      },
      {
        id: 'q_d1r2_3',
        examId: d1r2Exam.id,
        type: 'TRUE_FALSE',
        questionText: 'Perintah git commit -m "msg" digunakan untuk menyimpan perubahan ke repositori lokal.',
        points: 10,
        options: [
          { id: 'opt_d1_3a', optionText: 'BENAR (True)' },
          { id: 'opt_d1_3b', optionText: 'SALAH (False)' },
        ],
        correctOptionId: 'opt_d1_3a',
      },
      {
        id: 'q_d1r2_4',
        examId: d1r2Exam.id,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Di antara algoritma sorting berikut, manakah yang memiliki kompleksitas terburuk O(N^2)?',
        points: 10,
        options: [
          { id: 'opt_d1_4a', optionText: 'Bubble Sort & Selection Sort' },
          { id: 'opt_d1_4b', optionText: 'Merge Sort' },
          { id: 'opt_d1_4c', optionText: 'Heap Sort' },
          { id: 'opt_d1_4d', optionText: 'Radix Sort' },
        ],
        correctOptionId: 'opt_d1_4a',
      },
      {
        id: 'q_d1r2_5',
        examId: d1r2Exam.id,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Fungsi utama dari index pada tabel database Relational (SQL) adalah...',
        points: 10,
        options: [
          { id: 'opt_d1_5a', optionText: 'Mempercepat proses pencarian data (Query SELECT)' },
          { id: 'opt_d1_5b', optionText: 'Mengkompresi ukuran file database' },
          { id: 'opt_d1_5c', optionText: 'Menghapus data duplikat secara otomatis' },
          { id: 'opt_d1_5d', optionText: 'Menandai kolom sebagai password' },
        ],
        correctOptionId: 'opt_d1_5a',
      },
      {
        id: 'q_d1r2_6',
        examId: d1r2Exam.id,
        type: 'TRUE_FALSE',
        questionText: 'Network Port 80 digunakan secara default oleh protokol HTTP non-enkripsi.',
        points: 10,
        options: [
          { id: 'opt_d1_6a', optionText: 'BENAR (True)' },
          { id: 'opt_d1_6b', optionText: 'SALAH (False)' },
        ],
        correctOptionId: 'opt_d1_6a',
      },
      {
        id: 'q_d1r2_7',
        examId: d1r2Exam.id,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Manakah dari HTTP Status Code berikut yang berarti "Bad Request"?',
        points: 10,
        options: [
          { id: 'opt_d1_7a', optionText: '200' },
          { id: 'opt_d1_7b', optionText: '400' },
          { id: 'opt_d1_7c', optionText: '404' },
          { id: 'opt_d1_7d', optionText: '500' },
        ],
        correctOptionId: 'opt_d1_7b',
      },
      {
        id: 'q_d1r2_8',
        examId: d1r2Exam.id,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Fitur Anticheat pada aplikasi CBT ini akan melakukan auto-submit jika peserta melakukan pelanggaran sebanyak...',
        points: 10,
        options: [
          { id: 'opt_d1_8a', optionText: '1 kali' },
          { id: 'opt_d1_8b', optionText: '3 kali' },
          { id: 'opt_d1_8c', optionText: '10 kali' },
          { id: 'opt_d1_8d', optionText: 'Tidak ada batasan' },
        ],
        correctOptionId: 'opt_d1_8b',
      },
      {
        id: 'q_d1r2_9',
        examId: d1r2Exam.id,
        type: 'ESSAY',
        questionText: 'Sebutkan 3 jenis metode HTTP yang umum digunakan dalam arsitektur REST API!',
        points: 10,
        options: [],
        essayAnswerKey: 'GET, POST, PUT / DELETE / PATCH',
      },
      {
        id: 'q_d1r2_10',
        examId: d1r2Exam.id,
        type: 'MULTIPLE_CHOICE',
        questionText: 'Dalam React JS, hook yang digunakan untuk menyimpan nilai state lokal komponen adalah...',
        points: 10,
        options: [
          { id: 'opt_d1_10a', optionText: 'useEffect' },
          { id: 'opt_d1_10b', optionText: 'useState' },
          { id: 'opt_d1_10c', optionText: 'useContext' },
          { id: 'opt_d1_10d', optionText: 'useRef' },
        ],
        correctOptionId: 'opt_d1_10b',
      },
    ];
    d1r2Exam.totalQuestions = d1r2Questions.length;
    this.questionsByExamId.set(d1r2Exam.id, d1r2Questions);

    // Also update sample_exam_1 to have token CBT2026
    const exam1 = this.exams.get('exam_matematika_01');
    if (exam1) {
      exam1.token = 'CBT2026';
      this.saveExam(exam1);
    }

    // Seed PHP Multi Exam
    this.seedPhpMultiExamData();

    this.persistData(true);
  }

  private seedPhpMultiExamData() {
    const phpExam: Exam = {
      id: 'exam_php_multi',
      title: 'Praktikum PHP Form & Logika (Multi-Blank Fill-In)',
      subject: 'Pemrograman Web & PHP',
      durationMinutes: 45,
      totalQuestions: 5,
      passPercentage: 75,
      token: 'PHP01',
      isActive: true,
      shuffleQuestions: false,
      shuffleAnswers: false,
      maxViolations: 3,
      maxAttempts: 3,
      createdAt: new Date().toISOString(),
    };
    this.exams.set(phpExam.id, phpExam);
    this.examsByToken.set(phpExam.token, phpExam);

    const phpQuestions: Question[] = [
      {
        id: 'q_php_1',
        examId: phpExam.id,
        type: 'SHORT_ANSWER_MULTI',
        questionText: 'Lengkapi form PHP berikut agar dapat menghitung total harga dari input jumlah barang, dengan ketentuan: jika jumlah > 10 maka harga satuan 5000, selain itu harga satuan 6000.\n\n```php\n<form action="" method="____(1)____">\n    Jumlah: <input type="number" name="____(2)____">\n    <button type="submit" name="____(3)____">Hitung</button>\n</form>\n\n<?php\nif (isset($_POST[\'____(3)____\'])) {\n    $jumlah = $_POST[\'____(2)____\'];\n    if ($jumlah ____(4)____ 10) {\n        $harga = 5000;\n    } else {\n        $harga = 6000;\n    }\n    $total = $jumlah * $harga;\n    echo "Total: " . ____(5)____;\n}\n?>\n```\n\nIsilah bagian (1)–(5) dengan jawaban tepat!',
        points: 10,
        options: [],
        answerKey: [
          { blank: 1, answer: 'POST' },
          { blank: 2, answer: 'jumlah' },
          { blank: 3, answer: 'hitung' },
          { blank: 4, answer: '>' },
          { blank: 5, answer: '$total' },
        ],
        shortAnswerMultiKey: [
          { blank: 1, answer: 'POST' },
          { blank: 2, answer: 'jumlah' },
          { blank: 3, answer: 'hitung' },
          { blank: 4, answer: '>' },
          { blank: 5, answer: '$total' },
        ],
      },
      {
        id: 'q_php_2',
        examId: phpExam.id,
        type: 'SHORT_ANSWER_MULTI',
        questionText: 'Lengkapi form PHP berikut agar menampilkan bilangan genap dari 1 sampai batas yang diinput user.\n\n```php\n<form action="" method="____(1)____">\n    Batas: <input type="number" name="____(2)____">\n    <input type="submit" name="____(3)____" value="Tampilkan">\n</form>\n\n<?php\nif (isset($_POST[\'____(3)____\'])) {\n    $batas = $_POST[\'____(2)____\'];\n    for ($i = 1; $i ____(4)____ $batas; $i++) {\n        if ($i ____(5)____ 2 == 0) {\n            echo $i . " ";\n        }\n    }\n}\n?>\n```\n\nIsilah bagian (1)–(5) dengan jawaban tepat!',
        points: 10,
        options: [],
        answerKey: [
          { blank: 1, answer: 'POST' },
          { blank: 2, answer: 'batas' },
          { blank: 3, answer: 'tampil' },
          { blank: 4, answer: '<=' },
          { blank: 5, answer: '%' },
        ],
        shortAnswerMultiKey: [
          { blank: 1, answer: 'POST' },
          { blank: 2, answer: 'batas' },
          { blank: 3, answer: 'tampil' },
          { blank: 4, answer: '<=' },
          { blank: 5, answer: '%' },
        ],
      },
      {
        id: 'q_php_3',
        examId: phpExam.id,
        type: 'SHORT_ANSWER_MULTI',
        questionText: 'Lengkapi form PHP berikut agar mengecek kategori nilai: jika nilai >= 75 maka "Lulus", selain itu "Tidak Lulus".\n\n```php\n<form action="" method="____(1)____">\n    Nilai: <input type="text" name="____(2)____">\n    <button type="submit" name="____(3)____">Cek</button>\n</form>\n\n<?php\nif (____(4)____($_POST[\'cek\'])) {\n    $nilai = $_POST[\'____(2)____\'];\n    if ($nilai ____(5)____ 75) {\n        echo "Lulus";\n    } else {\n        echo "Tidak Lulus";\n    }\n}\n?>\n```\n\nIsilah bagian (1)–(5) dengan jawaban tepat!',
        points: 10,
        options: [],
        answerKey: [
          { blank: 1, answer: 'POST' },
          { blank: 2, answer: 'nilai' },
          { blank: 3, answer: 'cek' },
          { blank: 4, answer: 'isset' },
          { blank: 5, answer: '>=' },
        ],
        shortAnswerMultiKey: [
          { blank: 1, answer: 'POST' },
          { blank: 2, answer: 'nilai' },
          { blank: 3, answer: 'cek' },
          { blank: 4, answer: 'isset' },
          { blank: 5, answer: '>=' },
        ],
      },
      {
        id: 'q_php_4',
        examId: phpExam.id,
        type: 'SHORT_ANSWER_MULTI',
        questionText: 'Lengkapi form PHP berikut agar menampilkan tabel perkalian dari angka yang diinput user (1 sampai 10).\n\n```php\n<form action="" method="____(1)____">\n    Angka: <input type="number" name="____(2)____">\n    <input type="submit" name="____(3)____" value="Tampilkan">\n</form>\n\n<?php\nif (isset($_POST[\'____(3)____\'])) {\n    $angka = $_POST[\'____(2)____\'];\n    for ($i = 1; $i <= ____(4)____; $i++) {\n        echo $angka . " x " . $i . " = " . (____(5)____) . "<br>";\n    }\n}\n?>\n```\n\nIsilah bagian (1)–(5) dengan jawaban tepat!',
        points: 10,
        options: [],
        answerKey: [
          { blank: 1, answer: 'POST' },
          { blank: 2, answer: 'angka' },
          { blank: 3, answer: 'tampil' },
          { blank: 4, answer: '10' },
          { blank: 5, answer: '$angka * $i' },
        ],
        shortAnswerMultiKey: [
          { blank: 1, answer: 'POST' },
          { blank: 2, answer: 'angka' },
          { blank: 3, answer: 'tampil' },
          { blank: 4, answer: '10' },
          { blank: 5, answer: '$angka * $i' },
        ],
      },
      {
        id: 'q_php_5',
        examId: phpExam.id,
        type: 'SHORT_ANSWER_MULTI',
        questionText: 'Lengkapi form PHP berikut agar menjumlahkan angka 1 sampai N (N dari input), menggunakan looping while.\n\n```php\n<form action="" method="____(1)____">\n    N: <input type="number" name="____(2)____">\n    <button type="submit" name="____(3)____">Jumlahkan</button>\n</form>\n\n<?php\nif (isset($_POST[\'____(3)____\'])) {\n    $n = $_POST[\'____(2)____\'];\n    $i = 1;\n    $total = 0;\n    ____(4)____ ($i <= $n) {\n        $total = $total + $i;\n        $i____(5)____;\n    }\n    echo "Total: " . $total;\n}\n?>\n```\n\nIsilah bagian (1)–(5) dengan jawaban tepat!',
        points: 10,
        options: [],
        answerKey: [
          { blank: 1, answer: 'POST' },
          { blank: 2, answer: 'n' },
          { blank: 3, answer: 'jumlah' },
          { blank: 4, answer: 'while' },
          { blank: 5, answer: '++' },
        ],
        shortAnswerMultiKey: [
          { blank: 1, answer: 'POST' },
          { blank: 2, answer: 'n' },
          { blank: 3, answer: 'jumlah' },
          { blank: 4, answer: 'while' },
          { blank: 5, answer: '++' },
        ],
      },
    ];

    this.questionsByExamId.set(phpExam.id, phpQuestions);
  }

  // --- Indexed Data Accessors with Query Counters ---

  public getUserByToken(token: string): User | undefined {
    this.queryCount++;
    if (!token) return undefined;
    const cleanToken = token.trim().toUpperCase();
    const cleanStripped = cleanToken.replace(/[\/\-\_\s]/g, '');

    // 1. Exact match in token index
    let user = this.usersByToken.get(cleanToken) || this.usersByToken.get(cleanStripped);
    if (user) {
      const uToken = (user.token || '').trim().toUpperCase();
      const uTokenClean = uToken.replace(/[\/\-\_\s]/g, '');
      if (uToken === cleanToken || uTokenClean === cleanStripped || uToken === `TK-${cleanToken}`) {
        return user;
      }
      // Stale map entry - clean it up
      this.usersByToken.delete(cleanToken);
      this.usersByToken.delete(cleanStripped);
      user = undefined;
    }

    // 2. Exact match in participantCode index
    user = this.usersByParticipantCode.get(cleanToken) || this.usersByParticipantCode.get(cleanStripped);
    if (user) {
      const uCode = (user.participantCode || '').trim().toUpperCase();
      const uCodeClean = uCode.replace(/[\/\-\_\s]/g, '');
      if (uCode === cleanToken || uCodeClean === cleanStripped) {
        return user;
      }
      this.usersByParticipantCode.delete(cleanToken);
      this.usersByParticipantCode.delete(cleanStripped);
      user = undefined;
    }

    // 3. Fallback scan: case-insensitive match strictly against CURRENT values
    return Array.from(this.users.values()).find(u => {
      const uToken = (u.token || '').trim().toUpperCase();
      const uTokenClean = uToken.replace(/[\/\-\_\s]/g, '');
      const uCode = (u.participantCode || '').trim().toUpperCase();
      const uCodeClean = uCode.replace(/[\/\-\_\s]/g, '');
      const uName = (u.username || '').trim().toUpperCase();
      return (
        uToken === cleanToken ||
        uTokenClean === cleanStripped ||
        uCode === cleanToken ||
        uCodeClean === cleanStripped ||
        uName === cleanToken ||
        uToken === `TK-${cleanToken}`
      );
    });
  }

  public getUserByParticipantCode(code: string): User | undefined {
    this.queryCount++;
    if (!code) return undefined;
    const cleanCode = code.trim().toUpperCase();
    const cleanStripped = cleanCode.replace(/[\/\-\_\s]/g, '');

    let user = this.usersByParticipantCode.get(cleanCode) || this.usersByParticipantCode.get(cleanStripped);
    if (user) {
      const uCode = (user.participantCode || '').trim().toUpperCase();
      const uCodeClean = uCode.replace(/[\/\-\_\s]/g, '');
      if (uCode === cleanCode || uCodeClean === cleanStripped) {
        return user;
      }
      this.usersByParticipantCode.delete(cleanCode);
      this.usersByParticipantCode.delete(cleanStripped);
      user = undefined;
    }

    return Array.from(this.users.values()).find(u => {
      const uCode = (u.participantCode || '').trim().toUpperCase();
      const uCodeClean = uCode.replace(/[\/\-\_\s]/g, '');
      const uName = (u.username || '').trim().toUpperCase();
      return uCode === cleanCode || uCodeClean === cleanStripped || uName === cleanCode;
    });
  }

  public getUserById(id: string): User | undefined {
    this.queryCount++;
    return this.users.get(id);
  }

  public getExamByToken(token: string): Exam | undefined {
    this.queryCount++;
    if (!token) return undefined;
    const rawUpper = token.trim().toUpperCase();
    const cleanToken = rawUpper.replace(/[\/\-\_\s]/g, '');

    // 1. Direct map lookup
    let exam = this.examsByToken.get(rawUpper) || this.examsByToken.get(cleanToken);
    if (exam) {
      // STRICT CHECK: The exam's current token MUST strictly match the searched token!
      const currentUpper = (exam.token || '').trim().toUpperCase();
      const currentClean = currentUpper.replace(/[\/\-\_\s]/g, '');
      if (currentUpper === rawUpper || currentClean === cleanToken) {
        return exam;
      }
      // Outdated token index entry detected! Purge it from map
      this.examsByToken.delete(rawUpper);
      this.examsByToken.delete(cleanToken);
      exam = undefined;
    }

    // 2. Scan exams matching exact token or cleaned token of their CURRENT token
    const found = Array.from(this.exams.values()).find(e => {
      if (!e.token) return false;
      const eUpper = e.token.trim().toUpperCase();
      const eClean = eUpper.replace(/[\/\-\_\s]/g, '');
      return eUpper === rawUpper || eClean === cleanToken;
    });

    if (found) {
      // Re-index to direct map
      this.examsByToken.set(rawUpper, found);
      this.examsByToken.set(cleanToken, found);
    }

    return found;
  }

  public getExamById(id: string): Exam | undefined {
    this.queryCount++;
    return this.exams.get(id);
  }

  public getAllExams(): Exam[] {
    this.queryCount++;
    return Array.from(this.exams.values());
  }

  public saveExam(exam: Exam): void {
    this.queryCount++;
    // Clean up old token mappings for this exam ID
    const existing = this.exams.get(exam.id);
    if (existing && existing.token) {
      const oldUpper = existing.token.trim().toUpperCase();
      const oldClean = oldUpper.replace(/[\/\-\_\s]/g, '');
      this.examsByToken.delete(oldUpper);
      this.examsByToken.delete(oldClean);
    }
    // Also sweep examsByToken to remove any other stale keys referencing this exam
    for (const [k, e] of this.examsByToken.entries()) {
      if (e.id === exam.id) {
        this.examsByToken.delete(k);
      }
    }

    this.exams.set(exam.id, exam);
    if (exam.token) {
      const upper = exam.token.trim().toUpperCase();
      const clean = upper.replace(/[\/\-\_\s]/g, '');
      this.examsByToken.set(upper, exam);
      this.examsByToken.set(clean, exam);
    }
    this.persistData();
  }

  public toggleExamActive(examId: string): Exam | undefined {
    this.queryCount++;
    const exam = this.exams.get(examId);
    if (exam) {
      exam.isActive = !exam.isActive;
      this.saveExam(exam);
    }
    return exam;
  }

  public deleteExam(examId: string): boolean {
    this.queryCount++;
    const exam = this.exams.get(examId);
    if (!exam) return false;

    for (const [key, e] of this.examsByToken.entries()) {
      if (e.id === examId) {
        this.examsByToken.delete(key);
      }
    }
    this.exams.delete(examId);
    this.questionsByExamId.delete(examId);

    // Clean up associated sessions and violation logs
    const sessionsToDelete: string[] = [];
    this.sessions.forEach((sess, id) => {
      if (sess.examId === examId) {
        sessionsToDelete.push(id);
        this.sessionsByParticipantExam.delete(`${sess.participantId}_${examId}`);
      }
    });

    sessionsToDelete.forEach(id => this.sessions.delete(id));
    this.violationLogs = this.violationLogs.filter(v => !sessionsToDelete.includes(v.sessionId));

    this.persistData();
    return true;
  }

  public resetExamSessions(examId: string): number {
    return this.resetAllSessions(examId, true);
  }

  public resetAllSessions(examId?: string, clearDeviceLocks: boolean = true): number {
    this.queryCount++;
    let count = 0;
    const sessionsToDelete: string[] = [];

    this.sessions.forEach((sess, id) => {
      if (!examId || examId === 'ALL' || sess.examId === examId) {
        sessionsToDelete.push(id);
        this.sessionsByParticipantExam.delete(`${sess.participantId}_${sess.examId}`);
        count++;
      }
    });

    sessionsToDelete.forEach(id => this.sessions.delete(id));

    if (!examId || examId === 'ALL') {
      this.violationLogs = [];
    } else {
      this.violationLogs = this.violationLogs.filter(v => !sessionsToDelete.includes(v.sessionId));
    }

    if (clearDeviceLocks) {
      this.users.forEach(user => {
        if (user.role === 'PARTICIPANT') {
          delete user.activeDeviceId;
          delete user.ipAddress;
        }
      });
    }

    this.persistData();
    return count;
  }

  public unlockAllDevices(): number {
    this.queryCount++;
    let count = 0;
    this.users.forEach(user => {
      if (user.role === 'PARTICIPANT' && (user.activeDeviceId || user.ipAddress)) {
        delete user.activeDeviceId;
        delete user.ipAddress;
        count++;
      }
    });

    // Clear activeDeviceId from all sessions so participants can continue or reconnect without losing answers
    this.sessions.forEach(session => {
      if (session.activeDeviceId || session.ipAddress) {
        delete session.activeDeviceId;
        delete session.ipAddress;
      }
    });

    this.persistData();
    return count;
  }

  public unlockParticipantDevice(participantId: string): boolean {
    this.queryCount++;
    let unlocked = false;
    const user = this.users.get(participantId);
    if (user) {
      if (user.activeDeviceId || user.ipAddress) {
        unlocked = true;
      }
      delete user.activeDeviceId;
      delete user.ipAddress;
    }

    // Clear device lock on all participant sessions without deleting data or answers
    this.sessions.forEach(session => {
      if (session.participantId === participantId) {
        if (session.activeDeviceId || session.ipAddress) {
          unlocked = true;
        }
        delete session.activeDeviceId;
        delete session.ipAddress;
      }
    });

    this.persistData();
    return unlocked;
  }

  public resetParticipantSession(participantId: string, examId?: string, unlockOnly: boolean = false): boolean {
    if (unlockOnly) {
      return this.unlockParticipantDevice(participantId);
    }

    this.queryCount++;
    let found = false;
    const sessionsToDelete: string[] = [];

    this.sessions.forEach((sess, id) => {
      if (sess.participantId === participantId && (!examId || sess.examId === examId)) {
        sessionsToDelete.push(id);
        this.sessionsByParticipantExam.delete(`${sess.participantId}_${sess.examId}`);
        found = true;
      }
    });

    const user = this.users.get(participantId);
    if (user) {
      delete user.activeDeviceId;
      delete user.ipAddress;
    }

    sessionsToDelete.forEach(id => this.sessions.delete(id));
    this.violationLogs = this.violationLogs.filter(v => !sessionsToDelete.includes(v.sessionId));

    this.persistData();
    return found;
  }

  public getQuestionsByExamId(examId: string): Question[] {
    this.queryCount++;
    return this.questionsByExamId.get(examId) || [];
  }

  public saveQuestionsForExam(examId: string, questions: Question[]): void {
    this.queryCount++;
    this.questionsByExamId.set(examId, questions);
    const exam = this.exams.get(examId);
    if (exam) {
      exam.totalQuestions = questions.length;
      this.exams.set(examId, exam);
    }

    // Auto-sync into master D1/R2 database if examId is different
    if (examId !== 'exam_d1_r2') {
      const d1r2Questions = this.questionsByExamId.get('exam_d1_r2') || [];
      const existingIds = new Set(d1r2Questions.map(q => q.id));
      const existingTexts = new Set(d1r2Questions.map(q => q.questionText.trim().toLowerCase()));

      let added = false;
      questions.forEach(q => {
        const textKey = q.questionText.trim().toLowerCase();
        if (!existingIds.has(q.id) && !existingTexts.has(textKey)) {
          const syncedQ: Question = {
            ...q,
            id: q.id.startsWith('q_') ? q.id : `q_sync_${q.id}`,
            examId: 'exam_d1_r2',
          };
          d1r2Questions.push(syncedQ);
          existingIds.add(syncedQ.id);
          existingTexts.add(textKey);
          added = true;
        }
      });

      if (added) {
        this.questionsByExamId.set('exam_d1_r2', d1r2Questions);
        const d1r2Exam = this.exams.get('exam_d1_r2');
        if (d1r2Exam) {
          d1r2Exam.totalQuestions = d1r2Questions.length;
          this.exams.set('exam_d1_r2', d1r2Exam);
        }
      }
    }

    this.persistData();
  }

  public getSession(sessionId: string): StoredSession | undefined {
    this.queryCount++;
    return this.sessions.get(sessionId);
  }

  public getSessionsByParticipantAndExam(participantId: string, examId: string): StoredSession[] {
    this.queryCount++;
    const all = Array.from(this.sessions.values()).filter(
      s => s.participantId === participantId && s.examId === examId
    );
    return all.sort((a, b) => (a.attemptNumber || 1) - (b.attemptNumber || 1));
  }

  public getSessionByParticipantAndExam(participantId: string, examId: string): StoredSession | undefined {
    this.queryCount++;
    const userSessions = Array.from(this.sessions.values()).filter(
      s => s.participantId === participantId && s.examId === examId
    );
    if (userSessions.length === 0) return undefined;

    // Prefer IN_PROGRESS session if any exists
    const inProgress = userSessions.find(s => s.status === 'IN_PROGRESS');
    if (inProgress) return inProgress;

    // Otherwise return latest session attempt
    return userSessions.sort((a, b) => (b.attemptNumber || 1) - (a.attemptNumber || 1))[0];
  }

  public saveSession(session: StoredSession): void {
    this.queryCount++;
    this.sessions.set(session.sessionId, session);
    this.sessionsByParticipantExam.set(`${session.participantId}_${session.examId}`, session);
    this.persistData();
  }

  public getAllSessions(): StoredSession[] {
    this.queryCount++;
    return Array.from(this.sessions.values());
  }

  public logViolation(violation: ViolationLog): void {
    this.queryCount++;
    this.violationLogs.unshift(violation);
    this.persistData();
  }

  public getViolationLogs(sessionId?: string): ViolationLog[] {
    this.queryCount++;
    if (sessionId) {
      return this.violationLogs.filter(v => v.sessionId === sessionId);
    }
    return this.violationLogs;
  }

  public getAllParticipants(): User[] {
    this.queryCount++;
    return Array.from(this.users.values()).filter(u => u.role === 'PARTICIPANT');
  }

  public createParticipant(participant: User): void {
    this.queryCount++;
    const existing = this.users.get(participant.id);
    if (existing) {
      for (const [k, u] of this.usersByToken.entries()) {
        if (u.id === participant.id) this.usersByToken.delete(k);
      }
      for (const [k, u] of this.usersByParticipantCode.entries()) {
        if (u.id === participant.id) this.usersByParticipantCode.delete(k);
      }
    }

    this.users.set(participant.id, participant);
    if (participant.token) {
      const upperToken = participant.token.trim().toUpperCase();
      this.usersByToken.set(upperToken, participant);
      this.usersByToken.set(upperToken.replace(/[\/\-\_\s]/g, ''), participant);
    }
    if (participant.participantCode) {
      const upperCode = participant.participantCode.trim().toUpperCase();
      this.usersByParticipantCode.set(upperCode, participant);
      this.usersByParticipantCode.set(upperCode.replace(/[\/\-\_\s]/g, ''), participant);
    }
    this.persistData();
  }

  public deleteParticipant(participantId: string): boolean {
    this.queryCount++;
    const user = this.users.get(participantId);
    if (!user || user.role === 'ADMIN') return false;

    if (user.token) {
      const upperToken = user.token.trim().toUpperCase();
      this.usersByToken.delete(upperToken);
      this.usersByToken.delete(upperToken.replace(/[\/\-\_\s]/g, ''));
    }
    if (user.participantCode) {
      const upperCode = user.participantCode.trim().toUpperCase();
      this.usersByParticipantCode.delete(upperCode);
      this.usersByParticipantCode.delete(upperCode.replace(/[\/\-\_\s]/g, ''));
    }

    this.users.delete(participantId);
    this.resetParticipantSession(participantId);
    this.persistData();
    return true;
  }

  public clearAllParticipants(): number {
    this.queryCount++;
    let count = 0;
    const idsToDelete: string[] = [];

    this.users.forEach((user, id) => {
      if (user.role === 'PARTICIPANT') {
        idsToDelete.push(id);
        if (user.token) {
          const upperToken = user.token.trim().toUpperCase();
          this.usersByToken.delete(upperToken);
          this.usersByToken.delete(upperToken.replace(/[\/\-\_\s]/g, ''));
        }
        if (user.participantCode) {
          const upperCode = user.participantCode.trim().toUpperCase();
          this.usersByParticipantCode.delete(upperCode);
          this.usersByParticipantCode.delete(upperCode.replace(/[\/\-\_\s]/g, ''));
        }
        count++;
      }
    });

    idsToDelete.forEach(id => this.users.delete(id));
    this.resetAllSessions('ALL', true);
    this.persistData();
    return count;
  }

  public wipeAllData(): { examsDeleted: number; participantsDeleted: number; questionsDeleted: number; sessionsDeleted: number } {
    this.queryCount++;
    const examsDeleted = this.exams.size;
    let questionsDeleted = 0;
    this.questionsByExamId.forEach((qs) => {
      questionsDeleted += qs.length;
    });
    const sessionsDeleted = this.sessions.size;

    let participantsDeleted = 0;
    const adminUser = this.users.get('usr_admin');

    this.users.forEach((u) => {
      if (u.role === 'PARTICIPANT') participantsDeleted++;
    });

    // 1. Create an automatic safety backup before wiping so data can always be recovered
    try {
      const backupPath = path.join(process.cwd(), 'db_backup_latest.json');
      const backupData = {
        users: Array.from(this.users.values()),
        exams: Array.from(this.exams.values()),
        questionsByExamId: Object.fromEntries(this.questionsByExamId.entries()),
        sessions: Array.from(this.sessions.values()),
        violationLogs: this.violationLogs,
        backedUpAt: new Date().toISOString(),
      };
      fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf-8');
      console.log('[DatabaseStore] Automatic safety backup saved to:', backupPath);
    } catch (e) {
      console.warn('[DatabaseStore] Safety backup warning:', e);
    }

    this.exams.clear();
    this.examsByToken.clear();
    this.questionsByExamId.clear();
    this.sessions.clear();
    this.sessionsByParticipantExam.clear();
    this.violationLogs = [];

    this.users.clear();
    this.usersByToken.clear();
    this.usersByParticipantCode.clear();

    if (adminUser) {
      this.users.set(adminUser.id, adminUser);
    } else {
      this.users.set('usr_admin', {
        id: 'usr_admin',
        username: 'ahmad',
        name: 'Ahmad (Administrator)',
        role: 'ADMIN',
      });
    }

    this.persistData();

    return {
      examsDeleted,
      participantsDeleted,
      questionsDeleted,
      sessionsDeleted,
    };
  }

  public restoreSafetyBackup(): { success: boolean; message: string; restoredExams: number; restoredParticipants: number } {
    try {
      const backupPath = path.join(process.cwd(), 'db_backup_latest.json');
      if (!fs.existsSync(backupPath)) {
        return { success: false, message: 'File cadangan keselamatan (db_backup_latest.json) tidak ditemukan.', restoredExams: 0, restoredParticipants: 0 };
      }
      const raw = fs.readFileSync(backupPath, 'utf-8');
      const data = JSON.parse(raw);
      if (!data) {
        return { success: false, message: 'File cadangan kosong atau rusak.', restoredExams: 0, restoredParticipants: 0 };
      }

      let restoredExams = 0;
      let restoredParticipants = 0;

      if (Array.isArray(data.exams)) {
        data.exams.forEach((e: Exam) => {
          this.saveExam(e);
          restoredExams++;
        });
      }

      if (data.questionsByExamId) {
        Object.entries(data.questionsByExamId).forEach(([examId, qs]) => {
          this.saveQuestionsForExam(examId, qs as Question[]);
        });
      }

      if (Array.isArray(data.users)) {
        data.users.forEach((u: User) => {
          if (u.role === 'PARTICIPANT') {
            this.createParticipant(u);
            restoredParticipants++;
          }
        });
      }

      if (Array.isArray(data.sessions)) {
        data.sessions.forEach((s: StoredSession) => {
          this.saveSession(s);
        });
      }

      this.persistData(true);
      return {
        success: true,
        message: `Berhasil memulihkan ${restoredExams} ujian dan ${restoredParticipants} peserta dari file cadangan!`,
        restoredExams,
        restoredParticipants,
      };
    } catch (err: any) {
      return { success: false, message: `Gagal memulihkan cadangan: ${err.message}`, restoredExams: 0, restoredParticipants: 0 };
    }
  }

  public importParticipantsBatch(
    items: Array<{ name: string; participantCode: string; token?: string }>,
    clearExisting: boolean = false
  ): User[] {
    this.queryCount++;
    if (clearExisting) {
      this.clearAllParticipants();
    }

    const created: User[] = [];
    items.forEach((item, idx) => {
      const cleanName = (item.name || '').trim();
      const cleanCode = (item.participantCode || `P${String(idx + 1).padStart(3, '0')}`).trim().toUpperCase();
      const cleanToken = (item.token || cleanCode).trim().toUpperCase();
      if (!cleanName) return;

      const user: User = {
        id: `usr_${Date.now()}_${idx}_${Math.floor(Math.random() * 1000)}`,
        username: cleanCode.toLowerCase(),
        name: cleanName,
        role: 'PARTICIPANT',
        participantCode: cleanCode,
        token: cleanToken,
      };

      this.createParticipant(user);
      created.push(user);
    });

    this.persistData();
    return created;
  }

  public getDatabaseExport(): {
    users: User[];
    exams: Exam[];
    questionsByExamId: Record<string, Question[]>;
    timestamp: string;
  } {
    return {
      users: Array.from(this.users.values()),
      exams: Array.from(this.exams.values()),
      questionsByExamId: Object.fromEntries(this.questionsByExamId.entries()),
      timestamp: new Date().toISOString(),
    };
  }

  public restoreOrMergeDatabase(backupData: {
    users?: User[];
    exams?: Exam[];
    questionsByExamId?: Record<string, Question[]>;
    participants?: User[];
  }): { usersCount: number; examsCount: number; questionsCount: number } {
    this.queryCount++;

    // 1. Merge or restore participants & users
    const usersToMerge = (backupData.users || backupData.participants || []);
    if (Array.isArray(usersToMerge)) {
      usersToMerge.forEach((u) => {
        if (u && u.id) {
          this.users.set(u.id, u);
          if (u.token) {
            this.usersByToken.set(u.token.toUpperCase(), u);
          }
          if (u.participantCode) {
            this.usersByParticipantCode.set(u.participantCode.toUpperCase(), u);
          }
        }
      });
    }

    // 2. Merge or restore exams
    if (Array.isArray(backupData.exams)) {
      backupData.exams.forEach((e) => {
        if (e && e.id) {
          this.exams.set(e.id, e);
          if (e.token) {
            this.examsByToken.set(e.token.toUpperCase(), e);
            const cleaned = e.token.trim().toUpperCase().replace(/[\/\-\_\s]/g, '');
            this.examsByToken.set(cleaned, e);
          }
        }
      });
    }

    // 3. Merge or restore questions
    if (backupData.questionsByExamId && typeof backupData.questionsByExamId === 'object') {
      Object.entries(backupData.questionsByExamId).forEach(([examId, questions]) => {
        if (Array.isArray(questions)) {
          this.questionsByExamId.set(examId, questions);
          const exam = this.exams.get(examId);
          if (exam) {
            exam.totalQuestions = questions.length;
            this.exams.set(examId, exam);
          }
        }
      });
    }

    this.persistData(true);

    let totalQ = 0;
    this.questionsByExamId.forEach((qs) => {
      totalQ += qs.length;
    });

    console.log(`[DatabaseStore] Restored/Merged state: ${this.users.size} users, ${this.exams.size} exams, ${totalQ} questions.`);

    return {
      usersCount: this.users.size,
      examsCount: this.exams.size,
      questionsCount: totalQ,
    };
  }
}

export const dbStore = new DatabaseStore();
