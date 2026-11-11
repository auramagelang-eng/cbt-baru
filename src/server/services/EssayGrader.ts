import { GoogleGenAI, Type } from '@google/genai';
import { EssayAiRubric, KeyConceptItem, CorrectVariationItem, CommonMistakeItem } from '../../types/cbt';

/**
 * CBT Cloud Intelligent Auto-Grading Engine for Essay / Uraian Questions
 * Supports:
 * 1. AI Pre-computed Evaluation Matrix (Kunci Jawaban Model, Variasi Benar, Prediksi Miskonsepsi Siswa)
 * 2. Instant 0ms Matcher against pre-computed patterns for ultra-low latency
 * 3. Gemini AI contextual evaluation (gemini-3.7-flash) guided by rich rubric
 * 4. Algorithmic fallback using semantic keyword extraction, typo tolerance, and concept matching.
 */

export interface EssayGradeResult {
  score: number;
  matchPercentage: number;
  matchedKeywords: string[];
  totalKeywordsCount: number;
  feedback: string;
  aiGraded: boolean;
  conceptualStrengths?: string[];
  missingConcepts?: string[];
}

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient) {
    const key = process.env.GEMINI_API_KEY || '';
    if (key) {
      geminiClient = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
  }
  return geminiClient;
}

const CANDIDATE_MODELS = [
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.1-flash-lite',
];

export class EssayGrader {
  /**
   * Detects if the question involves a PHP Web Form, HTML form submission, or superglobals.
   */
  public static isPhpFormQuestion(questionText: string, teacherKey?: string): boolean {
    const combined = `${questionText || ''} ${teacherKey || ''}`.toLowerCase();
    const formMarkers = [
      '<form',
      'form method',
      'method="post"',
      "method='post'",
      'method="get"',
      '$_post',
      '$_get',
      '$_request',
      '<input',
      '<select',
      '<button',
      'type="submit"',
      'type="number"',
      'type="text"',
      'name="',
      "name='",
      'logika php untuk',
      'setelah form',
      'dari form',
      'superglobal',
      'isset($_post',
      'isset($_get',
      'periksa nilai',
      'seleksi beasiswa',
      'hitung pembayaran',
      'proses peminjaman',
      'periksa kompetensi',
      'tampilkan deret',
      'hitung total',
      'buat tabel',
      'buat rekap',
      'buat pola',
      'predikat nilai',
    ];
    return (
      formMarkers.some((m) => combined.includes(m)) ||
      (combined.includes('form') && (combined.includes('php') || combined.includes('post') || combined.includes('isset')))
    );
  }

  /**
   * Detects if the question or answer key involves PHP, CLI commands, scripts, or coding practice.
   */
  public static isPhpOrCliCodeQuestion(questionText: string, teacherKey?: string): boolean {
    const combined = `${questionText || ''} ${teacherKey || ''}`.toLowerCase();
    const phpCliKeywords = [
      'php',
      'cli',
      'terminal',
      'command line',
      'baris perintah',
      'perintah',
      'console',
      'readline',
      'fgets',
      'stdin',
      'stdout',
      'argv',
      'argc',
      'artisan',
      'composer',
      'sintaks',
      'koding',
      'coding',
      'skrip',
      'script',
      'fungsi',
      'function',
      'variable',
      'variabel',
      'localhost',
      'built-in server',
      'server bawaan',
      'syntax-check',
      'lint',
      'mysqli',
      'pdo',
      'echo',
      'print_r',
      'var_dump',
      'die(',
      'exit(',
      'php -',
      'php.ini',
      '$_post',
      '$_get',
      'isset(',
      '<form',
      'form method',
    ];
    return phpCliKeywords.some((kw) => combined.includes(kw));
  }

  /**
   * Determines if a question asks for a full programming problem / algorithm task
   * rather than a simple 1-line CLI command or single syntax keyword.
   */
  public static isFullProgrammingProblem(questionText: string, teacherKey?: string): boolean {
    const combined = `${questionText || ''} ${teacherKey || ''}`.toLowerCase();

    // NEVER treat multi-blank fill-in questions (____(1)____) or short-answer multi as full programming problems!
    if (/_{2,}\s*\(?\s*\d+\s*\)?\s*_{2,}/.test(combined) || combined.includes('____') || combined.includes('short_answer_multi')) {
      return false;
    }

    const programmingTaskMarkers = [
      'buatlah program',
      'buat program',
      'tulis program',
      'membuat program',
      'bikin program',
      'skrip lengkap',
      'script lengkap',
      'kode program',
      'menentukan apakah',
      'menentukan jenis',
      'menentukan bangun',
      'menentukan warna',
      'persegi atau persegi panjang',
      'sistem login',
      'warna seragam',
      'jenjang sekolah',
      'if...else',
      'if else',
      'if...elseif...else',
      'elseif',
      'else if',
      'percabangan',
      'hitunglah',
      'menghitung luas',
      'rumus:',
      'luas =',
      'keliling =',
      'algoritma',
      'kalkulator',
      'studi kasus',
      'switch case',
      'perulangan',
      'looping',
      'operator &&',
      'operator ||',
      'tidak boleh sensitif',
      'case-sensitive',
      'case sensitive',
      'strtolower',
      'strtoupper',
      'tuliskan logika php',
      'tuliskan kode php',
      'logika php',
      'setelah form',
      'dari form',
      'predikat nilai',
      'penerima beasiswa',
      'sistem kasir',
      'diskon',
      'peminjaman barang',
      'kelulusan kompetensi',
      'deret bilangan',
      'angsuran',
      'tabel perkalian',
      'rekap data',
      'pola bintang',
      'nested loop',
      'perulangan for',
      'perulangan while',
      'foreach',
      'while',
      'for (',
      'for(',
      '$_post',
      'isset',
    ];
    return programmingTaskMarkers.some((marker) => combined.includes(marker));
  }

  /**
   * Normalizes PHP code or CLI commands for accurate structural and semantic comparison.
   * Strips <?php, ?>, comments, outer whitespace, normalizes quotes and trailing semicolons.
   */
  public static normalizePhpOrCliCode(code: string): string {
    if (!code) return '';
    let cleaned = code.trim();

    // Strip opening and closing php tags if present
    cleaned = cleaned.replace(/^<\?php\s*/i, '').replace(/\s*\?>$/i, '').trim();

    // Remove single line comments // or #
    cleaned = cleaned.replace(/\/\/[^\r\n]*/g, '').replace(/#[^\r\n]*/g, '');

    // Normalize quotes: replace double quotes with single quotes
    cleaned = cleaned.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, "'$1'");

    // Remove trailing semicolons for single-statement comparison
    cleaned = cleaned.replace(/;+\s*$/, '');

    // Normalize spaces around operators while keeping word boundaries
    cleaned = cleaned
      .replace(/\s+/g, ' ')
      .replace(/\s*([=+\-*/<>()\[\]{},.:;])\s*/g, '$1')
      .toLowerCase()
      .trim();

    return cleaned;
  }

  /**
   * Checks if student answer is syntactically / semantically equivalent to a reference pattern in PHP/CLI.
   * STRICT GUARD: ONLY matches single-statement commands or short expressions.
   * NEVER short-circuits or matches multi-line scripts, programs, or control-flow code!
   */
  public static isPhpOrCliEquivalent(studentRaw: string, targetRaw: string): boolean {
    if (!studentRaw || !targetRaw) return false;

    // Guard: If either text has multiple statements or lines, they CANNOT be matched via single command shortcuts
    const studentLines = studentRaw.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
    const targetLines = targetRaw.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (studentLines.length > 2 || targetLines.length > 2) {
      return false;
    }

    const sNorm = this.normalizePhpOrCliCode(studentRaw);
    const tNorm = this.normalizePhpOrCliCode(targetRaw);

    if (sNorm === tNorm) return true;

    // Never match if either contains control flow keywords (if, else, for, while, etc.)
    const containsControlFlow = (s: string) => /\b(if|else|while|for|foreach|switch|class|function)\b/.test(s);
    if (containsControlFlow(sNorm) || containsControlFlow(tNorm)) {
      return false;
    }

    // 1. Handle CLI built-in web server variations:
    // php -S localhost:8000 <=> php -S 127.0.0.1:8000 <=> php -S 0.0.0.0:8000
    const isServerTarget = tNorm.startsWith('php-s') || tNorm.startsWith('php -s');
    const isServerStudent = sNorm.startsWith('php-s') || sNorm.startsWith('php -s');
    if (isServerTarget && isServerStudent) {
      const targetPort = tNorm.match(/:(\d+)/)?.[1] || '8000';
      const studentPort = sNorm.match(/:(\d+)/)?.[1] || '8000';
      const studentHasHost = sNorm.includes('localhost') || sNorm.includes('127.0.0.1') || sNorm.includes('0.0.0.0');
      const targetHasHost = tNorm.includes('localhost') || tNorm.includes('127.0.0.1') || tNorm.includes('0.0.0.0');

      if (studentPort === targetPort && (studentHasHost || !targetHasHost)) {
        return true;
      }
    }

    // 2. Handle single-statement CLI input: $var = readline(...) <=> $var = fgets(STDIN)
    // ONLY when both are strictly single input assignment statements!
    const isSingleReadlineTarget = /^(\$[a-z0-9_]+=)?(readline\(|fgets\(stdin\))/i.test(tNorm);
    const isSingleReadlineStudent = /^(\$[a-z0-9_]+=)?(readline\(|fgets\(stdin\))/i.test(sNorm);
    if (isSingleReadlineTarget && isSingleReadlineStudent) {
      const sSemicolons = (studentRaw.match(/;/g) || []).length;
      if (sSemicolons <= 1) {
        return true;
      }
    }

    // 3. Handle single CLI argument reference: $argv[1]
    const isSingleArgvTarget = /^(\$[a-z0-9_]+=)?\$argv\[1\]/i.test(tNorm);
    const isSingleArgvStudent = /^(\$[a-z0-9_]+=)?\$argv\[1\]/i.test(sNorm);
    if (isSingleArgvTarget && isSingleArgvStudent) {
      return true;
    }

    // 4. Handle PHP lint command: php -l file.php <=> php --syntax-check file.php
    if (
      (tNorm.startsWith('php-l') || tNorm.startsWith('php--syntax-check')) &&
      (sNorm.startsWith('php-l') || sNorm.startsWith('php--syntax-check'))
    ) {
      const targetFile = tNorm.replace(/^php(-l|--syntax-check)/, '').trim();
      const studentFile = sNorm.replace(/^php(-l|--syntax-check)/, '').trim();
      if (!targetFile || !studentFile || targetFile === studentFile) {
        return true;
      }
    }

    // 5. Handle PHP interactive shell
    if (tNorm === 'php-a' && sNorm === 'php-a') {
      return true;
    }

    return false;
  }

  /**
   * Comprehensive syntax, requirement, and logic evaluator for full PHP / CLI programming questions.
   * Prevents non-functional, syntax-broken, or incomplete code from receiving full/high marks.
   */
  public static evaluatePhpProgramSubmission(
    studentAnswer: string,
    questionText: string,
    maxPoints: number,
    essayAiRubric?: EssayAiRubric
  ): EssayGradeResult {
    const rawAnswer = (studentAnswer || '').trim();
    const qLower = (questionText || '').toLowerCase();

    // 0. Detect non-code submissions or non-answer apologies (e.g. "maaf tidak tahu")
    const hasAnyPhpMarker = /\$|\b(?:echo|print|if|else|elseif|for|while|foreach|isset|empty|function)\b|<\?php/i.test(rawAnswer);
    const answerNorm = rawAnswer.toLowerCase();
    const isApologyOrNonAnswer =
      answerNorm.includes('tidak tahu') ||
      answerNorm.includes('tidak tau') ||
      answerNorm.includes('gak tahu') ||
      answerNorm.includes('gak tau') ||
      answerNorm.includes('gatau') ||
      answerNorm.includes('belum paham') ||
      answerNorm.includes('belum belajar') ||
      answerNorm.includes('kurang paham') ||
      answerNorm.includes('ora ngerti') ||
      (answerNorm.includes('maaf') && !rawAnswer.includes('$'));

    if (!hasAnyPhpMarker || (isApologyOrNonAnswer && !rawAnswer.includes('$'))) {
      return {
        score: 0,
        matchPercentage: 0,
        matchedKeywords: [],
        totalKeywordsCount: essayAiRubric?.keyConcepts?.length || 4,
        feedback: '[Koreksi Koding] Jawaban belum menyertakan kode program PHP yang diminta.',
        aiGraded: false,
        conceptualStrengths: [],
        missingConcepts: ['Jawaban belum memuat kode PHP'],
      };
    }

    // 1. Detect fatal syntax errors (quotes, bracket, operator, and keyword integrity)
    const syntaxErrors: string[] = [];

    // Check quotes: detect unescaped / mismatched quotes
    const strippedEscaped = rawAnswer.replace(/\\"/g, '').replace(/\\'/g, '');
    const doubleQuoteCount = (strippedEscaped.match(/"/g) || []).length;
    const singleQuoteCount = (strippedEscaped.match(/'/g) || []).length;
    if (doubleQuoteCount % 2 !== 0) {
      syntaxErrors.push('Tanda petik ganda (") tidak berpasangan / rusak');
    }
    if (singleQuoteCount % 2 !== 0) {
      syntaxErrors.push("Tanda petik tunggal (') tidak berpasangan / rusak");
    }

    // Check broken quote constructs in readline or conditions (e.g. readline("luas" :") or if(... :"))
    if (/readline\s*\(\s*"[^"]*"\s*:/i.test(rawAnswer) || /readline\s*\(\s*'[^']*'\s*:/i.test(rawAnswer)) {
      if (!syntaxErrors.some((e) => e.includes('readline'))) {
        syntaxErrors.push('Sintaks string prompt readline tidak valid (terdapat titik dua atau petik di luar batas string)');
      }
    }
    if (/if\s*\(.*:"\s*\)/i.test(rawAnswer) || /if\s*\(.*:'\s*\)/i.test(rawAnswer)) {
      syntaxErrors.push('Sintaks kondisi if tidak valid (terdapat tanda titik dua dan petik ganjil di dalam kurung kondisi)');
    }

    // Check broken operators: e.g. && == or || == or && <
    if (/\b(?:&&|\|\|)\s*(?:==|===|!=|!==|<|>|<=|>=)/.test(rawAnswer)) {
      syntaxErrors.push('Operator logika dan perbandingan rusak (misal: "&& ==" tanpa variabel pembanding)');
    }

    // Check conditionless else if: e.g. else if { or elseif {
    if (/\b(?:else\s+if|elseif)\s*\{/i.test(rawAnswer)) {
      syntaxErrors.push('Sintaks "else if" tidak memiliki kurung kondisi (else if (...) wajib memiliki kondisi)');
    }

    // Detect if this question is a Web/Form PHP task or multi-blank fill-in
    const isWebOrFormQuestion =
      qLower.includes('<form') ||
      qLower.includes('form') ||
      qLower.includes('formulir') ||
      qLower.includes('$_post') ||
      qLower.includes('$_get') ||
      qLower.includes('$_request') ||
      (qLower.includes('post') && (qLower.includes('method') || qLower.includes('action'))) ||
      qLower.includes('<input') ||
      qLower.includes('input type') ||
      qLower.includes('html');

    const isMultiBlankSummary =
      /^\s*(?:\(\d+\)|\[\d+\])/.test(rawAnswer) ||
      /;\s*(?:\(\d+\)|\[\d+\])/.test(rawAnswer) ||
      /_{2,}\s*\(?\s*\d+\s*\)?\s*_{2,}/.test(qLower) ||
      qLower.includes('____');

    // Check bracket matching: (), {}, [] (only for full program scripts, not multi-blank summaries)
    if (!isMultiBlankSummary) {
      const bracketStack: string[] = [];
      const openClosePairs: Record<string, string> = { ')': '(', '}': '{', ']': '[' };
      let hasBracketMismatch = false;

      // Remove comments and string literals so brackets inside strings don't falsely trigger
      const codeNoStringsOrComments = rawAnswer
        .replace(/\/\/[^\r\n]*/g, '')
        .replace(/#[^\r\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '""')
        .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, "''");

      for (let i = 0; i < codeNoStringsOrComments.length; i++) {
        const char = codeNoStringsOrComments[i];
        if (char === '(' || char === '{' || char === '[') {
          bracketStack.push(char);
        } else if (char === ')' || char === '}' || char === ']') {
          const expectedOpen = openClosePairs[char];
          if (bracketStack.length === 0 || bracketStack.pop() !== expectedOpen) {
            hasBracketMismatch = true;
            break;
          }
        }
      }
      if (hasBracketMismatch || bracketStack.length > 0) {
        syntaxErrors.push('Tanda kurung kurawal {}, (), atau [] tidak berpasangan / unclosed bracket');
      }

      // Note: single-statement if-else without curly braces (e.g., if (...) doA(); else doB();) is valid PHP.
      // Unclosed curly braces are already accurately caught above by bracketStack.
    }

    // Quick exact / normalized equivalence check against ideal answer
    if (essayAiRubric?.idealAnswer) {
      const sNorm = this.normalizePhpOrCliCode(rawAnswer);
      const kNorm = this.normalizePhpOrCliCode(essayAiRubric.idealAnswer);
      if (sNorm && kNorm && sNorm === kNorm) {
        return {
          score: maxPoints,
          matchPercentage: 100,
          matchedKeywords: ['Logika PHP Sesuai Kunci Model'],
          totalKeywordsCount: essayAiRubric.keyConcepts?.length || 4,
          feedback: isWebOrFormQuestion
            ? '[Koreksi Koding] Logika pemrosesan form PHP berhasil memenuhi semua ketentuan instruksi dengan tepat dan valid.'
            : '[Koreksi Koding] Program PHP CLI berhasil memenuhi semua ketentuan instruksi dengan tepat dan logis.',
          aiGraded: false,
          conceptualStrengths: essayAiRubric.keyConcepts?.map((k) => k.concept) || ['Struktur logika PHP tepat sempurna'],
          missingConcepts: [],
        };
      }
    }

    // 2. Requirement Extraction from Question Text
    // Strict distinction: Forms use $_POST/$_GET, NEVER terminal readline!
    const requiresReadline =
      !isWebOrFormQuestion &&
      !isMultiBlankSummary &&
      (qLower.includes('readline') ||
        qLower.includes('fgets(stdin') ||
        qLower.includes('baca input terminal') ||
        qLower.includes('input terminal') ||
        qLower.includes('cli') ||
        qLower.includes('meminta pengguna memasukkan'));
    const requiresIfElse =
      qLower.includes('if') ||
      qLower.includes('else') ||
      qLower.includes('percabangan') ||
      qLower.includes('menentukan') ||
      qLower.includes('seleksi') ||
      qLower.includes('diskon') ||
      qLower.includes('peminjaman') ||
      qLower.includes('kompetensi');
    const requiresAndOperator =
      qLower.includes('&&') ||
      qLower.includes('operator &&') ||
      qLower.includes('seluruh persyaratan') ||
      qLower.includes('dan password');

    // Loop detection
    const requiresForeach = qLower.includes('foreach');
    const requiresWhile = qLower.includes('while') || qLower.includes('perulangan while');
    const requiresNestedLoop = qLower.includes('nested loop') || qLower.includes('bersarang') || (qLower.includes('pola bintang') && qLower.includes('dua'));
    const requiresForLoop = !requiresNestedLoop && (qLower.includes('perulangan for') || (qLower.includes('for') && (qLower.includes('deret') || qLower.includes('tabel') || qLower.includes('perkalian') || qLower.includes('harga') || qLower.includes('barang'))));

    // Check scenario types:
    const isPredikatScenario = qLower.includes('predikat') && (qLower.includes('nilai') || qLower.includes('90'));
    const isBeasiswaScenario = qLower.includes('beasiswa') && (qLower.includes('penghasilan') || qLower.includes('pelanggaran'));
    const isDiskonScenario = (qLower.includes('kasir') || qLower.includes('diskon')) && (qLower.includes('member') || qLower.includes('belanja'));
    const isTotalHargaBarangScenario =
      (qLower.includes('harga') || qLower.includes('total belanja') || qLower.includes('barang') || qLower.includes('harga1')) &&
      (qLower.includes('for') || qLower.includes('200000') || qLower.includes('20.000') || qLower.includes('array'));
    const isPeminjamanScenario = (qLower.includes('peminjaman') || qLower.includes('pinjam')) && (qLower.includes('stok') || qLower.includes('perangkat'));
    const isKompetensiScenario = qLower.includes('kompetensi') && (qLower.includes('teori') || qLower.includes('praktik'));
    const isDeretGenapScenario = qLower.includes('deret') && qLower.includes('genap');
    const isAngsuranScenario = qLower.includes('angsuran') && (qLower.includes('bulan') || qLower.includes('bayar'));
    const isPerkalianScenario = qLower.includes('perkalian') || (qLower.includes('tabel') && qLower.includes('angka'));
    const isRekapNilaiScenario =
      qLower.includes('rekap') &&
      (qLower.includes('foreach') || qLower.includes('nilai[]') || qLower.includes('nama1') || qLower.includes('nilai1') || qLower.includes('daftar_nama') || qLower.includes('lulus'));
    const isPolaBintangScenario = qLower.includes('pola bintang') || (qLower.includes('bintang') && qLower.includes('baris'));

    const isPersegiScenario = !isWebOrFormQuestion && qLower.includes('persegi') && (qLower.includes('panjang') || qLower.includes('lebar'));
    const isLoginScenario = !isWebOrFormQuestion &&
      (qLower.includes('login') || qLower.includes('username')) &&
      (qLower.includes('admin') || qLower.includes('operator') || qLower.includes('user') || qLower.includes('password'));
    const isSeragamScenario = !isWebOrFormQuestion &&
      (qLower.includes('seragam') ||
      (qLower.includes('jenjang') && (qLower.includes('sd') || qLower.includes('smp') || qLower.includes('sma'))));

    // 3. Evaluate Student Answer Components
    const strengths: string[] = [];
    const missing: string[] = [];

    // --- Component A: Input Reading / Form Handling (20%) ---
    let inputRatio = 0;
    const hasReadlineFunc = /readline\s*\(/i.test(rawAnswer) || /fgets\s*\(\s*stdin/i.test(rawAnswer);
    const readlineCallsCount =
      (rawAnswer.match(/readline\s*\(/gi) || []).length +
      (rawAnswer.match(/fgets\s*\(\s*stdin/gi) || []).length;

    if (isWebOrFormQuestion) {
      const hasFormPost = /\$_POST\b/i.test(rawAnswer);
      const hasFormGet = /\$_GET\b/i.test(rawAnswer);
      const hasFormRequest = /\$_REQUEST\b/i.test(rawAnswer) || /filter_input/i.test(rawAnswer);
      const hasAnyForm = hasFormPost || hasFormGet || hasFormRequest;
      const hasIssetSubmit =
        /isset\s*\(\s*\$_(?:POST|GET|REQUEST)\s*\[/i.test(rawAnswer) ||
        /\$_SERVER\s*\[\s*['"]REQUEST_METHOD/i.test(rawAnswer) ||
        /!empty\s*\(\s*\$_(?:POST|GET|REQUEST)/i.test(rawAnswer);

      if (hasIssetSubmit && hasAnyForm) {
        inputRatio = 1.0;
        strengths.push('Memeriksa tombol submit (isset($_POST)) dan mengambil data form ($_POST)');
      } else if (hasAnyForm) {
        inputRatio = 0.85;
        strengths.push('Mengambil data input form melalui superglobal PHP ($_POST)');
        missing.push('Disarankan memeriksa tombol submit dengan isset($_POST[...])');
      } else if (hasReadlineFunc) {
        inputRatio = 0.25;
        missing.push('Menggunakan readline() CLI padahal ini aplikasi berbasis Web Form (gunakan $_POST)');
      } else {
        inputRatio = 0.3;
        missing.push('Membaca input data form menggunakan $_POST atau $_GET');
      }
    } else if (requiresReadline) {
      if (isPersegiScenario) {
        const hasPanjangInput = /\$panjang\s*=/i.test(rawAnswer) && hasReadlineFunc;
        const hasLebarInput = /\$lebar\s*=/i.test(rawAnswer) && hasReadlineFunc;
        if (hasPanjangInput && hasLebarInput) {
          inputRatio = 1.0;
          strengths.push('Membaca input panjang dan lebar dengan readline() secara lengkap');
        } else if (readlineCallsCount >= 2 || (hasReadlineFunc && (hasPanjangInput || hasLebarInput))) {
          inputRatio = 0.6;
          strengths.push('Memanggil fungsi readline() untuk membaca input');
          missing.push('Input belum lengkap menampung kedua variabel ($panjang dan $lebar)');
        } else if (hasReadlineFunc) {
          inputRatio = 0.35;
          strengths.push('Memanggil readline()');
          missing.push('Input hanya dibaca sebagian / variabel penampung belum tepat');
        } else {
          missing.push('Tidak membaca input menggunakan readline() untuk panjang dan lebar');
        }
      } else if (isLoginScenario) {
        const hasUserInput = (/\$user/i.test(rawAnswer) || /\$username/i.test(rawAnswer)) && hasReadlineFunc;
        const hasPassInput = (/\$pass/i.test(rawAnswer) || /\$password/i.test(rawAnswer)) && hasReadlineFunc;
        if (hasUserInput && hasPassInput) {
          inputRatio = 1.0;
          strengths.push('Membaca input username dan password dengan readline()');
        } else if (readlineCallsCount >= 2 || (hasReadlineFunc && (hasUserInput || hasPassInput))) {
          inputRatio = 0.6;
          strengths.push('Memanggil readline() untuk membaca kredensial');
          missing.push('Input kredensial belum lengkap untuk kedua variabel (username dan password)');
        } else if (hasReadlineFunc) {
          inputRatio = 0.35;
          strengths.push('Memanggil fungsi readline()');
          missing.push('Input hanya dipanggil sebagian');
        } else {
          missing.push('Tidak membaca input kredensial menggunakan fungsi readline()');
        }
      } else if (isSeragamScenario) {
        const hasJenjangInput =
          (/\$jenjang/i.test(rawAnswer) || /\$sekolah/i.test(rawAnswer) || /\$tingkat/i.test(rawAnswer)) &&
          hasReadlineFunc;
        if (hasJenjangInput) {
          inputRatio = 1.0;
          strengths.push('Membaca input jenjang sekolah dengan readline()');
        } else if (hasReadlineFunc) {
          inputRatio = 0.5;
          strengths.push('Memanggil readline() untuk membaca input');
          missing.push('Variabel penampung jenjang sekolah belum sesuai instruksi');
        } else {
          missing.push('Sama sekali tidak membaca input dari pengguna dengan readline() (variabel langsung dipakai tanpa deklarasi input)');
        }
      } else {
        if (readlineCallsCount >= 2) {
          inputRatio = 1.0;
          strengths.push('Membaca input pengguna dengan readline()');
        } else if (hasReadlineFunc) {
          inputRatio = 0.65;
          strengths.push('Membaca input pengguna dengan readline()');
        } else {
          missing.push('Tidak membaca input terminal menggunakan readline()');
        }
      }
    } else {
      inputRatio = 1.0;
    }

    // --- Component B: Branching Structure & Loops (35%) ---
    let logicRatio = 0;
    const hasIf = /\bif\s*\(/i.test(rawAnswer);
    const hasElseIf = /\b(?:else\s+if|elseif)\s*\(/i.test(rawAnswer);
    const hasElse = /\belse\b/i.test(rawAnswer);
    const hasAndOp = /&&|\band\b/i.test(rawAnswer);
    const hasComparison = /==|===|!=|!==|<|>|<=|>=/i.test(rawAnswer);

    const hasForeach = /\bforeach\s*\(/i.test(rawAnswer);
    const hasWhile = /\bwhile\s*\(/i.test(rawAnswer);
    const hasFor = /\bfor\s*\(/i.test(rawAnswer);
    const forLoopMatches = (rawAnswer.match(/\bfor\s*\(/gi) || []).length;

    if (requiresNestedLoop) {
      if (forLoopMatches >= 2 || (hasFor && (rawAnswer.includes('str_repeat') || hasWhile))) {
        logicRatio = 1.0;
        strengths.push('Menggunakan nested loop (perulangan bersarang) untuk baris dan kolom');
      } else if (hasFor || hasWhile) {
        logicRatio = 0.55;
        strengths.push('Menggunakan perulangan for');
        missing.push('Belum menggunakan perulangan bersarang (nested loop) untuk baris dan kolom bintang');
      } else {
        missing.push('Tidak menggunakan perulangan bersarang (nested loop)');
      }
    } else if (requiresForeach) {
      if (hasForeach) {
        logicRatio = 1.0;
        strengths.push('Menggunakan perulangan foreach untuk menelusuri data array nilai');
      } else if (hasFor || hasWhile) {
        logicRatio = 0.7;
        strengths.push('Menggunakan perulangan untuk menelusuri array');
        missing.push('Soal secara spesifik meminta perulangan foreach');
      } else {
        missing.push('Tidak menggunakan perulangan foreach');
      }
    } else if (requiresWhile) {
      if (hasWhile) {
        logicRatio = 1.0;
        strengths.push('Menggunakan perulangan while untuk iterasi bulan angsuran');
      } else if (hasFor) {
        logicRatio = 0.7;
        strengths.push('Menggunakan perulangan for');
        missing.push('Soal secara spesifik meminta perulangan while');
      } else {
        missing.push('Tidak menggunakan perulangan while');
      }
    } else if (requiresForLoop) {
      if (hasFor) {
        logicRatio = 1.0;
        strengths.push('Menggunakan perulangan for dengan batas iterasi yang tepat');
      } else if (hasWhile) {
        logicRatio = 0.75;
        strengths.push('Menggunakan perulangan');
        missing.push('Soal secara spesifik meminta perulangan for');
      } else {
        missing.push('Tidak menggunakan perulangan for');
      }
    } else if (requiresIfElse) {
      if (isPredikatScenario) {
        const hasA = /["']A["']/i.test(rawAnswer) || /\$predikat\s*=\s*["']A["']/i.test(rawAnswer);
        const hasB = /["']B["']/i.test(rawAnswer) || /\$predikat\s*=\s*["']B["']/i.test(rawAnswer);
        const hasC = /["']C["']/i.test(rawAnswer) || /\$predikat\s*=\s*["']C["']/i.test(rawAnswer);
        const hasD = /["']D["']/i.test(rawAnswer) || /\$predikat\s*=\s*["']D["']/i.test(rawAnswer);
        const hasE = /["']E["']/i.test(rawAnswer) || /\$predikat\s*=\s*["']E["']/i.test(rawAnswer);
        const predikatCount = (hasA ? 1 : 0) + (hasB ? 1 : 0) + (hasC ? 1 : 0) + (hasD ? 1 : 0) + (hasE ? 1 : 0);

        if (hasIf && (hasElseIf || predikatCount >= 4) && hasElse && predikatCount >= 4) {
          logicRatio = 1.0;
          strengths.push('Percabangan if...elseif...else predikat nilai A, B, C, D, E lengkap');
        } else if (hasIf && predikatCount >= 3) {
          logicRatio = 0.7;
          strengths.push('Percabangan if...elseif menentukan sebagian besar predikat');
          missing.push(`Predikat nilai belum lengkap: terdeteksi ${predikatCount}/5 predikat`);
        } else if (hasIf) {
          logicRatio = 0.4;
          strengths.push('Menggunakan struktur percabangan if');
          missing.push('Percabangan predikat belum lengkap untuk rentang nilai');
        } else {
          missing.push('Tidak menggunakan percabangan if...elseif...else untuk menentukan predikat');
        }
      } else if (isBeasiswaScenario) {
        const has85 = /85/.test(rawAnswer);
        const has3jt = /3000000|3\.000\.000/.test(rawAnswer);
        const hasPelanggaran =
          /pelanggaran/i.test(rawAnswer) ||
          /<=\s*2\b/i.test(rawAnswer) ||
          /<\s*3\b/i.test(rawAnswer) ||
          /tidak/i.test(rawAnswer);

        if (hasIf && has85 && has3jt && hasPelanggaran && hasAndOp) {
          logicRatio = 1.0;
          strengths.push('Percabangan dan operator && menguji 3 kriteria beasiswa (nilai >= 85, penghasilan <= 3jt, pelanggaran <= 2 / tanpa pelanggaran)');
        } else if (hasIf && ((has85 && has3jt) || (has85 && hasPelanggaran) || (has3jt && hasPelanggaran))) {
          logicRatio = 0.7;
          strengths.push('Menguji sebagian kriteria beasiswa dengan operator logika');
          missing.push('Kriteria beasiswa belum lengkap menguji ketiga persyaratan');
        } else if (hasIf) {
          logicRatio = 0.4;
          strengths.push('Menggunakan if untuk seleksi beasiswa');
          missing.push('Pengujian kriteria seleksi beasiswa belum lengkap');
        } else {
          missing.push('Tidak menggunakan percabangan untuk seleksi beasiswa');
        }
      } else if (isDiskonScenario) {
        const hasMemberCheck = /member/i.test(rawAnswer) || /ya/i.test(rawAnswer) || /status/i.test(rawAnswer);
        const has500rb = /500000|500\.000/.test(rawAnswer);

        if (hasIf && hasMemberCheck && has500rb) {
          logicRatio = 1.0;
          strengths.push('Percabangan diskon memeriksa status member dan batas belanja Rp500.000');
        } else if (hasIf && (hasMemberCheck || has500rb)) {
          logicRatio = 0.65;
          strengths.push('Menggunakan percabangan untuk sebagian kondisi diskon');
          missing.push('Percabangan diskon belum lengkap memeriksa status member dan total belanja');
        } else if (hasIf) {
          logicRatio = 0.4;
          strengths.push('Menggunakan struktur if');
          missing.push('Logika penentuan diskon kasir belum lengkap');
        } else {
          missing.push('Tidak menggunakan percabangan untuk diskon');
        }
      } else if (isPeminjamanScenario) {
        const hasKurang1 = /<\s*1|<=?\s*0/.test(rawAnswer);
        const hasLebihStok = />\s*\$stok|>=\s*\$stok/i.test(rawAnswer) || />\s*15/i.test(rawAnswer);

        if (hasIf && (hasKurang1 || hasLebihStok) && hasElse) {
          logicRatio = 1.0;
          strengths.push('Percabangan validasi peminjaman memeriksa batas minimum dan ketersediaan stok');
        } else if (hasIf) {
          logicRatio = 0.65;
          strengths.push('Menggunakan percabangan if untuk peminjaman');
          missing.push('Validasi peminjaman belum lengkap menguji kondisi batas stok dan minimum');
        } else {
          missing.push('Tidak menggunakan percabangan untuk validasi peminjaman');
        }
      } else if (isKompetensiScenario) {
        const has60 = /60/.test(rawAnswer);
        const has75 = /75/.test(rawAnswer);
        const mentionsKompeten = /kompeten/i.test(rawAnswer);

        if (hasIf && has60 && has75 && mentionsKompeten) {
          logicRatio = 1.0;
          strengths.push('Percabangan status kompetensi menguji nilai minimum 60 dan rata-rata 75');
        } else if (hasIf && mentionsKompeten) {
          logicRatio = 0.65;
          strengths.push('Menggunakan if untuk status kompetensi');
          missing.push('Kondisi pengujian kompetensi belum lengkap memeriksa batas nilai dan rata-rata');
        } else if (hasIf) {
          logicRatio = 0.4;
          strengths.push('Menggunakan struktur if');
          missing.push('Penentuan status kompetensi belum dibuat');
        } else {
          missing.push('Tidak menggunakan percabangan untuk kelulusan kompetensi');
        }
      } else if (isPersegiScenario) {
        const hasPersegiCompare =
          /\$panjang\s*==\s*\$lebar/i.test(rawAnswer) ||
          /\$panjang\s*===\s*\$lebar/i.test(rawAnswer) ||
          /\$lebar\s*==\s*\$panjang/i.test(rawAnswer);
        const mentionsPersegi = /persegi/i.test(rawAnswer);

        if (hasIf && hasElse && (hasPersegiCompare || hasComparison) && mentionsPersegi) {
          logicRatio = 1.0;
          strengths.push('Percabangan if...else membandingkan panjang == lebar untuk Persegi vs Persegi Panjang');
        } else if (hasIf && mentionsPersegi) {
          logicRatio = 0.45;
          strengths.push('Menggunakan struktur if untuk jenis bangun');
          missing.push('Percabangan if...else belum lengkap membandingkan kondisi panjang dan lebar');
        } else if (hasIf) {
          logicRatio = 0.25;
          strengths.push('Menggunakan keyword if');
          missing.push('Logika penentuan bangun Persegi vs Persegi Panjang belum dibuat');
        } else {
          missing.push('Tidak menggunakan percabangan if...else untuk menentukan bangun');
        }
      } else if (isLoginScenario) {
        const checksAdmin = /admin/i.test(rawAnswer) && /admin123/i.test(rawAnswer);
        const checksOperator = /operator/i.test(rawAnswer) && /operator123/i.test(rawAnswer);
        const checksUser = /\buser\b/i.test(rawAnswer) && /user123/i.test(rawAnswer);
        const rolesCheckedCount = (checksAdmin ? 1 : 0) + (checksOperator ? 1 : 0) + (checksUser ? 1 : 0);

        if (hasIf && (hasElseIf || rolesCheckedCount >= 2) && rolesCheckedCount === 3 && hasAndOp) {
          logicRatio = 1.0;
          strengths.push('Percabangan if...elseif...else dan operator && memeriksa 3 role (Admin, Operator, User) lengkap');
        } else if (hasIf && rolesCheckedCount >= 2 && hasAndOp) {
          logicRatio = 0.65;
          strengths.push('Menggunakan if...elseif dan operator && untuk autentikasi');
          missing.push(`Role akun belum lengkap: terdeteksi ${rolesCheckedCount}/3 role (Admin, Operator, User)`);
        } else if (hasIf && (rolesCheckedCount >= 1 || hasAndOp)) {
          logicRatio = 0.35;
          strengths.push('Mencoba struktur percabangan if dengan operator &&');
          missing.push('Struktur if...elseif...else belum lengkap dan sebagian besar akun (Admin, Operator, User) belum dicek');
        } else if (hasIf) {
          logicRatio = 0.2;
          strengths.push('Terdapat struktur if');
          missing.push('Percabangan login belum menguji kombinasi username dan password');
        } else {
          missing.push('Sama sekali tidak menggunakan if...elseif...else untuk autentikasi login');
        }
      } else if (isSeragamScenario) {
        const checksSD = /\bsd\b/i.test(rawAnswer);
        const checksSMP = /\bsmp\b/i.test(rawAnswer);
        const checksSMA = /\bsma\b/i.test(rawAnswer);
        const jenjangCount = (checksSD ? 1 : 0) + (checksSMP ? 1 : 0) + (checksSMA ? 1 : 0);

        const hasCaseLower = /strtolower\s*\(/i.test(rawAnswer) || /strtoupper\s*\(/i.test(rawAnswer);
        const hasMultipleOrCases = (rawAnswer.match(/\|\|/g) || []).length >= 4;

        if (hasIf && jenjangCount === 3 && (hasCaseLower || hasMultipleOrCases) && hasElse) {
          logicRatio = 1.0;
          strengths.push('Percabangan if...elseif...else jenjang SD, SMP, SMA lengkap dengan case-insensitive & fallback else');
        } else if (hasIf && jenjangCount === 3) {
          logicRatio = 0.6;
          strengths.push('Percabangan if...elseif mencakup 3 jenjang sekolah (SD, SMP, SMA)');
          if (!hasElse) missing.push('Belum memiliki blok fallback else untuk input di luar SD, SMP, SMA');
          if (!hasCaseLower && !hasMultipleOrCases) missing.push('Penanganan huruf besar/kecil (case-insensitive) belum optimal (disarankan memakai strtolower)');
        } else if (hasIf && jenjangCount >= 1) {
          logicRatio = 0.35;
          strengths.push('Menggunakan if...elseif untuk sebagian jenjang sekolah');
          missing.push('Jenjang sekolah belum lengkap atau belum ada penanganan input tidak sesuai');
        } else {
          missing.push('Tidak menggunakan percabangan if...elseif...else untuk menentukan warna seragam');
        }
      } else {
        if (hasIf && (hasElseIf || hasElse)) {
          logicRatio = 1.0;
          strengths.push('Menggunakan struktur percabangan if...else secara tepat');
        } else if (hasIf) {
          logicRatio = 0.5;
          strengths.push('Menggunakan struktur if');
          missing.push('Percabangan else belum lengkap');
        } else {
          missing.push('Tidak menggunakan struktur percabangan');
        }
      }
    } else {
      logicRatio = 1.0;
    }

    // --- Component C: Business Logic / Calculation (20%) ---
    let calcRatio = 0;
    if (isPredikatScenario) {
      const hasValidation0100 = /<\s*0|>|100/.test(rawAnswer);
      if (hasValidation0100) {
        calcRatio = 1.0;
        strengths.push('Validasi nilai di luar rentang 0-100 diterapkan');
      } else {
        calcRatio = 0.75;
        missing.push('Belum menambahkan validasi jika nilai di luar rentang 0-100');
      }
    } else if (isBeasiswaScenario) {
      const asksForReason = qLower.includes('alasan') || qLower.includes('persyaratan yang tidak terpenuhi');
      const hasFailureReason = /alasan|syarat|belum|melebihi|catatan/i.test(rawAnswer);
      const hasStatusOutput = /lolos|berhak/i.test(rawAnswer);

      if (asksForReason) {
        if (hasFailureReason) {
          calcRatio = 1.0;
          strengths.push('Menampilkan alasan persyaratan yang tidak terpenuhi jika tidak lolos');
        } else {
          calcRatio = 0.75;
          missing.push('Belum menampilkan alasan spesifik mengapa peserta didik tidak lolos beasiswa');
        }
      } else {
        if (hasStatusOutput || hasIf) {
          calcRatio = 1.0;
          strengths.push('Menampilkan status kelulusan seleksi beasiswa (Lolos Beasiswa / Tidak Lolos Beasiswa)');
        } else {
          calcRatio = 0.8;
        }
      }
    } else if (isDiskonScenario) {
      const hasPotonganCalc = /\*\s*(?:0\.\d+|\d+\s*\/\s*100|\$[a-zA-Z0-9_]+|\d+)/i.test(rawAnswer) || /diskon|potongan/i.test(rawAnswer);
      const hasTotalCalc = /-\s*(?:\$[a-zA-Z0-9_]+|\d+)/i.test(rawAnswer) || /\*\s*(?:0\.85|0\.9|0\.95)/.test(rawAnswer) || /total_bayar|bayar/i.test(rawAnswer);
      if (hasPotonganCalc && hasTotalCalc) {
        calcRatio = 1.0;
        strengths.push('Menghitung nominal potongan harga dan total pembayaran setelah diskon');
      } else if (hasPotonganCalc || hasTotalCalc) {
        calcRatio = 0.75;
        strengths.push('Melakukan kalkulasi diskon');
        missing.push('Perhitungan potongan atau total pembayaran akhir belum lengkap');
      } else {
        missing.push('Tidak melakukan perhitungan diskon dan total pembayaran');
      }
    } else if (isTotalHargaBarangScenario) {
      const hasArray = /\[\s*\$|array\s*\(/i.test(rawAnswer);
      const hasAccum = /\+=\s*\$|\=\s*\$[a-zA-Z0-9_]+\s*\+\s*\$/i.test(rawAnswer);
      const hasDiskon20k = /200000|200\.000/.test(rawAnswer) && /20000|20\.000/.test(rawAnswer);
      const hasTotalBayar = /-\s*(?:\$[a-zA-Z0-9_]+|20000|20\.000)/i.test(rawAnswer) || /total_bayar|bayar/i.test(rawAnswer);

      if (hasArray && hasAccum && hasDiskon20k && hasTotalBayar) {
        calcRatio = 1.0;
        strengths.push('Menampung harga barang ke array, mengakumulasikan total dengan perulangan for, memberi potongan Rp20.000 jika total >= Rp200.000, dan menghitung total pembayaran');
      } else if (hasAccum && (hasDiskon20k || hasTotalBayar)) {
        calcRatio = 0.85;
        strengths.push('Menghitung akumulasi total harga barang dan kondisi diskon');
      } else if (hasAccum || hasArray) {
        calcRatio = 0.65;
        strengths.push('Memproses array dan total belanja');
        missing.push('Ketentuan potongan Rp20.000 (jika total >= Rp200.000) atau total pembayaran belum lengkap');
      } else {
        missing.push('Tidak melakukan perhitungan total harga barang dan potongan');
      }
    } else if (isPeminjamanScenario) {
      const hasStokInit = /\$stok\s*=\s*15/i.test(rawAnswer);
      const hasStokReduce = /\$stok\s*(?:-=\s*\$jumlah|=\s*\$stok\s*-\s*\$jumlah)/i.test(rawAnswer);
      if (hasStokInit && hasStokReduce) {
        calcRatio = 1.0;
        strengths.push('Menentukan stok awal 15 dan mengurangi stok saat peminjaman berhasil');
      } else if (hasStokInit || hasStokReduce) {
        calcRatio = 0.65;
        strengths.push('Memproses variabel stok');
        missing.push('Inisialisasi stok 15 atau pengurangan sisa stok belum lengkap');
      } else {
        missing.push('Tidak memproses pengurangan stok peminjaman');
      }
    } else if (isKompetensiScenario) {
      const hasAverage = /\(\s*\$teori\s*\+\s*\$praktik\s*\)\s*\/\s*2/i.test(rawAnswer) || /\/\s*2/i.test(rawAnswer);
      const hasValidation = /<\s*0|>|100/.test(rawAnswer);
      if (hasAverage && hasValidation) {
        calcRatio = 1.0;
        strengths.push('Memvalidasi nilai 0-100 dan menghitung rata-rata teori dan praktik');
      } else if (hasAverage || hasValidation) {
        calcRatio = 0.65;
        strengths.push('Menghitung rata-rata nilai');
        missing.push('Validasi nilai 0-100 atau perhitungan rata-rata belum lengkap');
      } else {
        missing.push('Tidak menghitung nilai rata-rata');
      }
    } else if (isDeretGenapScenario) {
      const hasTotalAccum = /\$total\s*\+=\s*\$i|\$total\s*=\s*\$total\s*\+\s*\$i/i.test(rawAnswer);
      if (hasTotalAccum) {
        calcRatio = 1.0;
        strengths.push('Menghitung akumulasi jumlah seluruh bilangan genap ($total += $i)');
      } else {
        calcRatio = 0.6;
        missing.push('Belum mengakumulasikan total jumlah seluruh bilangan genap');
      }
    } else if (isAngsuranScenario) {
      const hasTotalAccum = /\$total\s*\+=\s*\$angsuran|\$total\s*=\s*\$total\s*\+\s*\$angsuran/i.test(rawAnswer);
      const hasCounterIncrement = /\$i\+\+|\$i\s*\+=\s*1/i.test(rawAnswer);
      if (hasTotalAccum && hasCounterIncrement) {
        calcRatio = 1.0;
        strengths.push('Menghitung total pembayaran dengan akumulator ($total += $angsuran) dan increment loop ($i++)');
      } else if (hasTotalAccum) {
        calcRatio = 0.7;
        strengths.push('Menggunakan variabel akumulator');
        missing.push('Pastikan counter perulangan while di-increment ($i++)');
      } else {
        missing.push('Tidak menghitung total pembayaran dengan variabel akumulator');
      }
    } else if (isPerkalianScenario) {
      const hasMultiply = /\*\s*\$i|\$angka\s*\*\s*\$i/i.test(rawAnswer);
      if (hasMultiply) {
        calcRatio = 1.0;
        strengths.push('Menghitung hasil perkalian pada setiap iterasi');
      } else {
        calcRatio = 0.5;
        missing.push('Belum menghitung hasil perkalian ($angka * $i)');
      }
    } else if (isRekapNilaiScenario) {
      const asksForAverage = qLower.includes('rata-rata') || qLower.includes('average');
      const hasLulusCheck = />=\s*75/.test(rawAnswer) && /lulus/i.test(rawAnswer);
      const hasLulusCounter = /\+\+|\+=\s*1/i.test(rawAnswer);
      const hasArray = /\[\s*\$|array\s*\(/i.test(rawAnswer);
      const hasAvg = /count\s*\(/i.test(rawAnswer) || /\/\s*\d+/i.test(rawAnswer);

      if (asksForAverage) {
        const hasAccum = /\+=\s*\$/i.test(rawAnswer);
        if (hasAccum && (hasLulusCounter || hasLulusCheck) && hasAvg) {
          calcRatio = 1.0;
          strengths.push('Menghitung total nilai, rata-rata, dan jumlah nilai yang mencapai minimal 75');
        } else if (hasAccum || hasAvg) {
          calcRatio = 0.75;
          strengths.push('Menghitung total atau rata-rata array');
          missing.push('Kalkulasi rekap belum lengkap (pastikan menghitung total, rata-rata, dan filter >= 75)');
        } else {
          missing.push('Tidak menghitung rekapitulasi data array');
        }
      } else {
        if (hasLulusCheck && hasLulusCounter && hasArray) {
          calcRatio = 1.0;
          strengths.push('Menampung data ke array, menentukan keterangan Lulus (>= 75) / Tidak Lulus, dan menghitung jumlah siswa yang lulus');
        } else if (hasLulusCheck && (hasLulusCounter || hasArray)) {
          calcRatio = 0.85;
          strengths.push('Menentukan status kelulusan peserta didik');
        } else if (hasLulusCheck || hasArray) {
          calcRatio = 0.65;
          strengths.push('Memproses data array siswa');
          missing.push('Keterangan kelulusan (>= 75: Lulus) atau counter jumlah siswa lulus ($jumlah_lulus++) belum lengkap');
        } else {
          missing.push('Tidak memproses status kelulusan siswa dan jumlah yang lulus');
        }
      }
    } else if (isPolaBintangScenario) {
      const hasStarPrint = /echo\s*["']\*["']/i.test(rawAnswer) || /print\s*["']\*["']/i.test(rawAnswer);
      const hasLineBreak = /echo\s*["']<br>["']|print\s*["']<br>["']/i.test(rawAnswer);
      if (hasStarPrint && hasLineBreak) {
        calcRatio = 1.0;
        strengths.push('Mencetak karakter bintang (*) dan pemisah baris baru (<br>) pada setiap baris');
      } else if (hasStarPrint) {
        calcRatio = 0.7;
        strengths.push('Mencetak karakter bintang');
        missing.push('Belum mencetak baris baru (<br>) setelah perulangan dalam selesai');
      } else {
        missing.push('Tidak mencetak pola bintang');
      }
    } else if (isPersegiScenario) {
      const hasMultiplication =
        /\*\s*(\$[a-zA-Z0-9_]+|\d+)/i.test(rawAnswer) || /\$panjang\s*\*\s*\$lebar/i.test(rawAnswer);
      const hasLuasVariable = /\$luas\s*=/i.test(rawAnswer) || (hasMultiplication && /luas/i.test(rawAnswer));
      if (hasLuasVariable && hasMultiplication) {
        calcRatio = 1.0;
        strengths.push('Menghitung rumus luas bangun ($panjang * $lebar) dengan tepat');
      } else if (hasMultiplication) {
        calcRatio = 0.5;
        strengths.push('Melakukan operasi perkalian');
        missing.push('Rumus luas belum ditampung ke variabel $luas');
      } else {
        missing.push('Tidak melakukan perhitungan rumus luas ($panjang * $lebar)');
      }
    } else if (isLoginScenario) {
      const mentionsLevel = /level/i.test(rawAnswer) || /admin/i.test(rawAnswer);
      const mentionsSuccess = /berhasil/i.test(rawAnswer) || /selamat datang/i.test(rawAnswer);
      const mentionsFailure = /gagal/i.test(rawAnswer) || /salah/i.test(rawAnswer) || /tidak ditemukan/i.test(rawAnswer);

      if (mentionsLevel && mentionsSuccess && mentionsFailure) {
        calcRatio = 1.0;
        strengths.push('Logika respon login berhasil menampilkan Level pengguna dan penanganan login gagal');
      } else if (mentionsSuccess || mentionsLevel) {
        calcRatio = 0.5;
        strengths.push('Menampilkan role/level pengguna');
        missing.push('Pesan status login berhasil atau gagal belum lengkap');
      } else if (mentionsFailure) {
        calcRatio = 0.3;
        missing.push('Belum menampilkan pesan sukses dan level akun');
      } else {
        missing.push('Tidak menampilkan status login berhasil/gagal serta level akun');
      }
    } else if (isSeragamScenario) {
      const mentionsMerahPutih = /merah\s*putih/i.test(rawAnswer);
      const mentionsBiruPutih = /biru\s*putih/i.test(rawAnswer);
      const mentionsAbuPutih = /abu/i.test(rawAnswer);
      const colorsCount = (mentionsMerahPutih ? 1 : 0) + (mentionsBiruPutih ? 1 : 0) + (mentionsAbuPutih ? 1 : 0);

      if (colorsCount === 3) {
        calcRatio = 1.0;
        strengths.push('Memetakan warna seragam untuk ketiga jenjang (Merah Putih, Biru Putih, Abu-abu Putih) dengan benar');
      } else if (colorsCount >= 1) {
        calcRatio = 0.45;
        strengths.push('Memetakan sebagian warna seragam');
        missing.push(`Warna seragam belum lengkap (${colorsCount}/3 jenjang)`);
      } else {
        missing.push('Tidak memetakan warna seragam yang diminta soal');
      }
    } else {
      calcRatio = 1.0;
    }

    // --- Component D: Output Display (15%) ---
    let outputRatio = 0;
    const hasEcho = /\b(?:echo|print|printf)\b/i.test(rawAnswer) || /<\?=/i.test(rawAnswer);
    const hasHtmlOutput = /<(?:div|p|h\d|span|table|form|b|strong|label|input|button|br)\b/i.test(rawAnswer);

    if (hasEcho || (isWebOrFormQuestion && hasHtmlOutput) || isMultiBlankSummary) {
      outputRatio = 1.0;
      strengths.push(isWebOrFormQuestion ? 'Menampilkan respon hasil form dengan echo' : 'Menampilkan output menggunakan echo/print');
    } else {
      missing.push(isWebOrFormQuestion ? 'Tidak mencetak output hasil pemrosesan form' : 'Tidak mencetak output ke layar terminal menggunakan echo/print');
    }

    // --- Component E: Syntax Validity & Cap (10% + Strict Penalty Cap) ---
    let syntaxRatio = 1.0;
    if (syntaxErrors.length > 0) {
      syntaxRatio = 0;
      missing.push(`Error Sintaks PHP: ${syntaxErrors.join('; ')}`);
    } else {
      strengths.push('Sintaks PHP valid tanpa parse error');
    }

    // Weighted composite calculation:
    // Input: 20%, Logic: 35%, Business/Calc: 20%, Output: 15%, Syntax: 10%
    let earnedRatio =
      inputRatio * 0.2 +
      logicRatio * 0.35 +
      calcRatio * 0.2 +
      outputRatio * 0.15 +
      syntaxRatio * 0.1;

    // STRICT PENALTY CAPPING:
    // If code has fatal syntax error, interpreter PHP would immediately fail (Parse error).
    // Maximum score capped at 20% (or 25% if input reading was partly right).
    if (syntaxErrors.length > 0) {
      const cap = inputRatio > 0.5 ? 0.2 : 0.15;
      earnedRatio = Math.min(earnedRatio, cap);
    }

    // If student did NOT read input when interactive CLI was required:
    if (requiresReadline && !hasReadlineFunc) {
      earnedRatio = Math.min(earnedRatio, 0.3);
    }

    // Final score calculation:
    const calculatedScore = Math.max(0, Math.min(maxPoints, Math.round(maxPoints * earnedRatio)));
    const matchPercentage = Math.round((calculatedScore / maxPoints) * 100);

    let feedback = '';
    if (calculatedScore >= Math.round(maxPoints * 0.8)) {
      feedback = isWebOrFormQuestion
        ? '[Koreksi Koding] Logika pemrosesan form PHP berhasil memenuhi ketentuan instruksi dengan tepat dan valid.'
        : '[Koreksi Koding] Program PHP CLI berhasil memenuhi ketentuan instruksi dengan tepat dan logis.';
    } else if (calculatedScore >= Math.round(maxPoints * 0.5)) {
      feedback = `[Koreksi Koding] Logika kode sebagian benar (${calculatedScore}/${maxPoints} Poin). Kekurangan: ${missing.slice(0, 2).join('; ')}.`;
    } else {
      feedback = `[Koreksi Koding] Kode belum memenuhi ketentuan (${calculatedScore}/${maxPoints} Poin). ${
        syntaxErrors.length > 0 ? `Kesalahan sintaks fatal: ${syntaxErrors.join('; ')}. ` : ''
      }Kekurangan materi: ${missing.filter((m) => !m.includes('Error Sintaks')).slice(0, 2).join('; ')}.`;
    }

    return {
      score: calculatedScore,
      matchPercentage,
      matchedKeywords: strengths,
      totalKeywordsCount: strengths.length + missing.length,
      feedback,
      aiGraded: false,
      conceptualStrengths: strengths,
      missingConcepts: missing,
    };
  }

  /**
   * Helper to execute Gemini generation with automatic multi-model fallback and retry
   */
  private static async executeGeminiWithFallback<T>(
    operationName: string,
    executeFn: (ai: GoogleGenAI, model: string) => Promise<T>
  ): Promise<T> {
    const ai = getGeminiClient();
    if (!ai) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    let lastError: any = null;

    for (const model of CANDIDATE_MODELS) {
      try {
        return await executeFn(ai, model);
      } catch (err: any) {
        lastError = err;
        const status = err?.status || err?.code || 'unknown';
        console.warn(`[EssayGrader ${operationName}] Model ${model} failed with status: ${status}`);

        // If 503 (high demand), wait briefly before next model
        if (status === 503) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        // If 429 (quota exceeded) or 404 (model not found), immediately continue to the next model
      }
    }

    throw lastError || new Error(`All candidate models failed for ${operationName}`);
  }

  /**
   * Generates a comprehensive AI Answer Key Matrix & Grading Rubric
   * including ideal answer, key concepts, correct variations, and predicted common mistakes/misconceptions.
   */
  public static async generateEssayAiRubric(
    questionText: string,
    teacherKey?: string,
    maxPoints: number = 20
  ): Promise<EssayAiRubric> {
    const cleanQuestion = (questionText || '').trim();
    const cleanTeacherKey = (teacherKey || '').trim();
    const isForm = this.isPhpFormQuestion(cleanQuestion, cleanTeacherKey);
    const isProg = this.isFullProgrammingProblem(cleanQuestion, cleanTeacherKey);
    const isCode = this.isPhpOrCliCodeQuestion(cleanQuestion, cleanTeacherKey);

    try {
      const codeSpecificInstructions = isForm
        ? `
PETUNJUK KHUSUS SOAL PEMROGRAMAN PHP BERBASIS WEB FORM / FORMULIR HTML:
- "idealAnswer": Tuliskan KODE LOGIKA PHP LENGKAP yang valid dan rapi (menggunakan <?php ... ?>) yang memproses form HTML di atas (memeriksa tombol submit dengan isset($_POST[...]), mengambil nilai form dari $_POST, validasi data, struktur percabangan/perulangan yang diminta, dan menampilkan output dengan echo).
- "keyConcepts": Cantumkan 4 pilar logika pemrosesan form:
  1. Pemeriksaan tombol submit (isset($_POST[...])) & pembacaan input form ($_POST[...]) (bobot 20-25%)
  2. Validasi input & struktur logika percabangan (if/elseif/else) atau perulangan (for/while/foreach) (bobot 30-35%)
  3. Pemenuhan logika bisnis / kalkulasi rumus / pengolahan data form (bobot 20-25%)
  4. Format output pesan hasil (echo, <br>) & sintaks PHP yang valid tanpa parse error (bobot 15-20%)
- "correctVariations": Cantumkan 2 sampai 4 variasi penulisan skrip PHP valid yang sah dan berfungsi (misal: nested if vs compound if, variasi nama variabel, konkatenasi vs interpolasi string). JANGAN PERNAH mencantumkan fungsi readline() atau STDIN karena ini adalah form web HTML!
- "commonMistakes": Cantumkan kesalahan khas siswa pada form PHP (misal: lupa isset($_POST), salah nama input $_POST, parse error tanda kutip/kurung, atau tidak ada output).
`
        : isProg
        ? `
PETUNJUK KHUSUS SOAL PEMROGRAMAN / STUDI KASUS PROGRAM PHP LENGKAP:
- "idealAnswer": Tuliskan KODE PROGRAM PHP LENGKAP yang valid dan rapi (menggunakan <?php ... ?>) yang menyelesaikan SEMUA ketentuan spesifik soal (membaca seluruh input dengan readline(), struktur percabangan yang diminta, pengujian seluruh kondisi/role/kategori, rumus/kalkulasi (jika ada), dan format output yang sesuai).
- "keyConcepts": Cantumkan 4 pilar logika program spesifik sesuai soal:
  1. Pembacaan variabel input dengan readline() (bobot 20-25%)
  2. Struktur logika percabangan (if...else / if...elseif...else) dan operator (bobot 30-35%)
  3. Pemenuhan logika bisnis / kalkulasi rumus / pemetaan kategori soal (bobot 20-25%)
  4. Format output pesan hasil & sintaks PHP yang valid tanpa parse error (bobot 15-20%)
- "correctVariations": Cantumkan 2 sampai 4 variasi penulisan skrip LENGKAP yang sah dan berfungsi. JANGAN PERNAH mencantumkan potongan 1 baris (seperti $input = readline();) sebagai kunci benar untuk soal program lengkap!
- "commonMistakes": Cantumkan kesalahan fatal siswa yang spesifik untuk materi soal ini (misal: parse error tanda kutip/kurung, tidak membaca input readline, salah operator, atau kondisi tidak lengkap).
`
        : isCode
        ? `
PETUNJUK KHUSUS SOAL PERINTAH CLI / POTONGAN SINTAKS SINGKAT:
- "idealAnswer": Tuliskan perintah CLI atau baris kode PHP yang paling presisi, baku, dan langsung menyelesaikan tugas (contoh: "php -S localhost:8000" atau "$nama = readline('Nama: ');" atau "$argv[1]" atau "php -l index.php").
- "correctVariations": Cantumkan 4 sampai 8 variasi penulisan jawaban BENAR yang sah secara sintaks PHP/CLI (misal: dengan atau tanpa tag '<?php' dan '?>', kutip tunggal '' vs kutip dua "", ekuivalensi host 'localhost:8000' vs '127.0.0.1:8000' vs '0.0.0.0:8000', ekuivalensi fungsi seperti 'readline()' vs 'fgets(STDIN)', dengan atau tanpa tanda titik koma ';' di akhir, variasi nama variabel).
- "commonMistakes": Cantumkan 3 sampai 6 kesalahan spesifik siswa pada PHP/CLI (misal: flag '-s' huruf kecil untuk web server, lupa port, salah nama fungsi seperti 'input()' Python, lupa tanda '$' pada variabel, atau sintaks non-CLI).
- "keyConcepts": Cantumkan token/fungsi kunci perintah beserta bobot persentasenya.
`
        : '';

      const prompt = `Anda adalah pakar penilai ujian dan perancang kurikulum CBT profesional.
Tugas Anda adalah membuat KUNCI JAWABAN MODEL & MATRIKS PREDIKSI JAWABAN (Rubrik Penilaian, Variasi Jawaban Benar, dan Prediksi Kesalahan/Miskonsepsi Siswa) yang SANGAT SPESIFIK, AKURAT, DAN 100% RELEVAN HANYA DENGAN PERTANYAAN BERIKUT:

Pertanyaan Ujian:
"""${cleanQuestion}"""

${cleanTeacherKey ? `Kunci Acuan/Referensi Guru (wajib diperhatikan jika relevan): """${cleanTeacherKey}"""\n` : ''}
Bobot Poin Soal: ${maxPoints} Poin
${codeSpecificInstructions}
PETUNJUK UTAMA:
1. "idealAnswer": Tuliskan jawaban atau potongan kode/sintaks yang paling tepat, baku, dan langsung menjawab pertanyaan di atas. (Misal: jika soal menanyakan class Bootstrap untuk 6 kolom layar medium, jawabannya adalah "col-md-6". Jika soal teori/konseptual, tuliskan jawaban inti yang padat dan jelas).
2. "keyConcepts": 2 sampai 4 konsep/kata kunci esensial beserta bobot persen (total = 100%) dan deskripsi singkat.
3. "correctVariations": 3 sampai 6 variasi kemungkinan jawaban BENAR yang berpotensi ditulis siswa untuk PERTANYAAN INI (termasuk variasi penulisan tanpa spasi, dengan tag lengkap, penulisan class CSS murni, selector dengan titik, sinonim kata, atau format sah lainnya).
4. "commonMistakes": 3 sampai 6 kemungkinan jawaban SALAH / KELIRU / MISKONSEPSI yang KHAS dan SPESIFIK untuk materi pertanyaan ini beserta skor parsial (scorePercentage: 0 - 80%) dan alasan/feedback koreksi edukatifnya.
5. "summaryExplanation": Penjelasan ringkas 1-2 kalimat mengenai konsep jawaban yang benar untuk materi soal ini.

PENTING: Jangan membuat prediksi materi yang tidak diminta oleh pertanyaan di atas.`;

      const result = await this.executeGeminiWithFallback<EssayAiRubric>(
        'generateEssayAiRubric',
        async (ai, model) => {
          const response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              systemInstruction:
                'Anda adalah perancang rubrik evaluasi ujian CBT akademik dan IT yang presisi, adil, dan cermat.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  idealAnswer: { type: Type.STRING },
                  keyConcepts: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        concept: { type: Type.STRING },
                        weightPercentage: { type: Type.NUMBER },
                        description: { type: Type.STRING },
                      },
                      required: ['concept', 'weightPercentage'],
                    },
                  },
                  correctVariations: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        pattern: { type: Type.STRING },
                        description: { type: Type.STRING },
                      },
                      required: ['pattern'],
                    },
                  },
                  commonMistakes: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        pattern: { type: Type.STRING },
                        scorePercentage: { type: Type.NUMBER },
                        reason: { type: Type.STRING },
                      },
                      required: ['pattern', 'scorePercentage', 'reason'],
                    },
                  },
                  summaryExplanation: { type: Type.STRING },
                },
                required: ['idealAnswer', 'keyConcepts', 'correctVariations', 'commonMistakes'],
              },
            },
          });

          const raw = response.text?.trim();
          if (!raw) throw new Error('Empty response from Gemini');

          const parsed = JSON.parse(raw);
          return {
            idealAnswer: parsed.idealAnswer || cleanTeacherKey || 'Jawaban ideal.',
            keyConcepts: Array.isArray(parsed.keyConcepts) ? parsed.keyConcepts : [],
            correctVariations: Array.isArray(parsed.correctVariations) ? parsed.correctVariations : [],
            commonMistakes: Array.isArray(parsed.commonMistakes) ? parsed.commonMistakes : [],
            summaryExplanation: parsed.summaryExplanation || '',
            generatedAt: new Date().toISOString(),
          };
        }
      );

      return result;
    } catch (e) {
      console.warn('AI Rubric generation error across all models, falling back to smart heuristic generator:', e);
    }

    return this.generateFallbackRubric(cleanQuestion, cleanTeacherKey, maxPoints);
  }

  /**
   * Generates intelligent fallback rubric when offline / Gemini API is unreachable
   * Context-aware heuristic that matches question topic instead of generic hardcoded stubs.
   */
  public static generateFallbackRubric(
    questionText: string,
    teacherKey?: string,
    maxPoints: number = 20
  ): EssayAiRubric {
    const qNorm = (questionText || '').toLowerCase();
    const rawKey = (teacherKey || '').trim();

    // 0. PHP Full Programming Problem / Algorithm Task (Web Form vs CLI Program)
    if (this.isFullProgrammingProblem(questionText, teacherKey)) {
      const isFormQuestion = this.isPhpFormQuestion(questionText, teacherKey);

      if (isFormQuestion) {
        let idealCode = rawKey || '';
        let keyConcepts: KeyConceptItem[] = [];
        let commonMistakes: CommonMistakeItem[] = [];
        let summaryExplanation = '';

        // Check standard form tasks or dynamic form tasks
        const isPredikatTask = qNorm.includes('predikat') && (qNorm.includes('nilai') || qNorm.includes('90'));
        const isBeasiswaTask = qNorm.includes('beasiswa') && (qNorm.includes('penghasilan') || qNorm.includes('pelanggaran'));
        const isDiskonTask = (qNorm.includes('kasir') || qNorm.includes('diskon')) && (qNorm.includes('member') || qNorm.includes('belanja'));
        const isTotalHargaBarangTask =
          (qNorm.includes('harga') || qNorm.includes('total belanja') || qNorm.includes('barang') || qNorm.includes('harga1')) &&
          (qNorm.includes('for') || qNorm.includes('200000') || qNorm.includes('20.000') || qNorm.includes('array'));
        const isPeminjamanTask = (qNorm.includes('peminjaman') || qNorm.includes('pinjam')) && (qNorm.includes('stok') || qNorm.includes('perangkat'));
        const isKompetensiTask = qNorm.includes('kompetensi') && (qNorm.includes('teori') || qNorm.includes('praktik'));
        const isDeretGenapTask = qNorm.includes('deret') && qNorm.includes('genap');
        const isAngsuranTask = qNorm.includes('angsuran') && (qNorm.includes('bulan') || qNorm.includes('bayar'));
        const isPerkalianTask = qNorm.includes('perkalian') || (qNorm.includes('tabel') && qNorm.includes('angka'));
        const isRekapNilaiTask =
          qNorm.includes('rekap') &&
          (qNorm.includes('foreach') || qNorm.includes('nilai[]') || qNorm.includes('nama1') || qNorm.includes('nilai1') || qNorm.includes('daftar_nama') || qNorm.includes('lulus'));
        const isPolaBintangTask = qNorm.includes('pola bintang') || (qNorm.includes('bintang') && qNorm.includes('baris'));

        if (isPredikatTask) {
          idealCode = rawKey || `<?php
if (isset($_POST['proses'])) {
    $nama = $_POST['nama'];
    $nilai = $_POST['nilai'];

    if ($nilai < 0 || $nilai > 100) {
        $predikat = "Tidak Valid";
    } elseif ($nilai >= 90) {
        $predikat = "A";
    } elseif ($nilai >= 80) {
        $predikat = "B";
    } elseif ($nilai >= 70) {
        $predikat = "C";
    } elseif ($nilai >= 60) {
        $predikat = "D";
    } else {
        $predikat = "E";
    }

    echo "Nama: $nama<br>";
    echo "Nilai: $nilai<br>";
    echo "Predikat: $predikat";
}
?>`;
          keyConcepts = [
            { concept: 'Tombol Submit & Input Form ($_POST)', weightPercentage: 20, description: 'Memeriksa isset($_POST[\'proses\']) dan mengambil $_POST[\'nama\'], $_POST[\'nilai\']' },
            { concept: 'Validasi Rentang Nilai (0-100)', weightPercentage: 25, description: 'Menolak atau menandai nilai di luar rentang 0-100 sebagai tidak valid' },
            { concept: 'Percabangan if...elseif...else Predikat (A-E)', weightPercentage: 35, description: 'Menentukan predikat A (>=90), B (>=80), C (>=70), D (>=60), E (<60)' },
            { concept: 'Output Data & Sintaks PHP Valid', weightPercentage: 20, description: 'Menampilkan nama, nilai, dan predikat dengan echo' },
          ];
          commonMistakes = [
            { pattern: 'tanpa isset submit', scorePercentage: 80, reason: 'Logika predikat sudah tepat, disarankan menambahkan isset($_POST[\'proses\']) untuk memeriksa klik tombol form.' },
            { pattern: 'tanpa validasi 0-100', scorePercentage: 75, reason: 'Percabangan predikat berjalan, namun belum memeriksa validasi nilai di luar rentang 0-100.' },
            { pattern: 'readline form', scorePercentage: 30, reason: 'Menggunakan readline() CLI bukannya variabel $_POST dari form HTML.' },
          ];
          summaryExplanation = 'Kode PHP memeriksa pengiriman form dengan isset($_POST[\'proses\']), mengambil data $_POST, memvalidasi rentang 0-100, menentukan predikat A-E dengan if...elseif...else, lalu menampilkan output.';
        } else if (isBeasiswaTask) {
          const isNumericBeasiswa = qNorm.includes('maksimal 2') || qNorm.includes('<= 2') || qNorm.includes('jumlah pelanggaran') || !qNorm.includes('alasan');
          if (isNumericBeasiswa) {
            idealCode = rawKey || `<?php
if (isset($_POST['seleksi'])) {
    $nama = $_POST['nama'];
    $nilai = $_POST['nilai'];
    $penghasilan = $_POST['penghasilan'];
    $pelanggaran = $_POST['pelanggaran'];

    if ($nilai >= 85 && $penghasilan <= 3000000 && $pelanggaran <= 2) {
        $hasil = 'Lolos Beasiswa';
    } else {
        $hasil = 'Tidak Lolos Beasiswa';
    }

    echo 'Nama: ' . $nama . '<br>';
    echo 'Hasil Seleksi: ' . $hasil;
}
?>`;
            keyConcepts = [
              { concept: 'Input Form & Tombol Seleksi ($_POST)', weightPercentage: 20, description: 'Mengambil nama, nilai, penghasilan, dan pelanggaran dari $_POST' },
              { concept: 'Operator Logika && Menguji 3 Syarat (nilai >= 85, penghasilan <= 3jt, pelanggaran <= 2)', weightPercentage: 40, description: 'Menguji ketiga persyaratan beasiswa dengan operator &&' },
              { concept: 'Percabangan Status Kelulusan (Lolos Beasiswa / Tidak Lolos Beasiswa)', weightPercentage: 20, description: 'Menentukan status kelulusan beasiswa' },
              { concept: 'Output Data & Sintaks Valid', weightPercentage: 20, description: 'Menampilkan nama peserta dan hasil seleksi ke layar' },
            ];
            commonMistakes = [
              { pattern: 'salah operator logika', scorePercentage: 50, reason: 'Menggunakan operator || bukannya && untuk menggabungkan ketiga syarat beasiswa.' },
              { pattern: 'tanpa isset submit', scorePercentage: 80, reason: 'Disarankan memeriksa klik tombol dengan isset($_POST[\'seleksi\']).' },
            ];
            summaryExplanation = 'Kode PHP mengambil data form, menguji syarat beasiswa (nilai >= 85, penghasilan <= 3jt, pelanggaran <= 2) dengan operator &&, dan menampilkan hasil seleksi.';
          } else {
            idealCode = rawKey || `<?php
if (isset($_POST['seleksi'])) {
    $nama = $_POST['nama'];
    $nilai = $_POST['nilai'];
    $penghasilan = $_POST['penghasilan'];
    $pelanggaran = $_POST['pelanggaran'];

    if ($nilai >= 85 && $penghasilan <= 3000000 && $pelanggaran == "tidak") {
        echo "$nama BERHAK MENERIMA BEASISWA";
    } else {
        echo "$nama TIDAK BERHAK MENERIMA BEASISWA<br>";
        if ($nilai < 85) echo "Nilai belum memenuhi syarat<br>";
        if ($penghasilan > 3000000) echo "Penghasilan orang tua melebihi batas<br>";
        if ($pelanggaran == "ya") echo "Memiliki catatan pelanggaran berat";
    }
}
?>`;
            keyConcepts = [
              { concept: 'Input Form & Tombol Seleksi ($_POST)', weightPercentage: 20, description: 'Mengambil data nama, nilai, penghasilan, dan pelanggaran dari $_POST' },
              { concept: 'Kondisi Beasiswa & Operator &&', weightPercentage: 35, description: 'Memeriksa nilai >= 85, penghasilan <= 3.000.000, dan tidak ada pelanggaran berat' },
              { concept: 'Logika Penjelasan Alasan Tidak Lolos', weightPercentage: 25, description: 'Menampilkan alasan spesifik persyaratan yang tidak terpenuhi' },
              { concept: 'Output Status Beasiswa & Sintaks Valid', weightPercentage: 20, description: 'Mencetak status kelolosan beasiswa dan rincian ke layar' },
            ];
            commonMistakes = [
              { pattern: 'tanpa alasan gagal', scorePercentage: 70, reason: 'Pengecekan beasiswa sudah benar, namun belum menampilkan alasan spesifik jika siswa tidak lolos.' },
              { pattern: 'salah operator logika', scorePercentage: 50, reason: 'Menggunakan operator || (OR) bukannya && (AND) untuk persyaratan beasiswa.' },
            ];
            summaryExplanation = 'Kode PHP mengambil data form, menguji seluruh syarat beasiswa dengan operator &&, dan menampilkan status kelolosan beserta alasan jika ditolak.';
          }
        } else if (isDiskonTask) {
          idealCode = rawKey || `<?php
if (isset($_POST['hitung'])) {
    $nama = $_POST['nama'];
    $member = $_POST['member'];
    $belanja = $_POST['belanja'];

    if ($member == "ya") {
        $diskon = ($belanja >= 500000) ? 0.15 : 0.10;
    } else {
        $diskon = ($belanja >= 500000) ? 0.05 : 0;
    }

    $potongan = $belanja * $diskon;
    $total = $belanja - $potongan;

    echo "Nama: $nama<br>Total Belanja: Rp$belanja<br>Diskon: Rp$potongan<br>Total Pembayaran: Rp$total";
}
?>`;
          keyConcepts = [
            { concept: 'Input Form Kasir ($_POST)', weightPercentage: 20, description: 'Mengambil nama, status member, dan total belanja dari form' },
            { concept: 'Percabangan Diskon Member & Nonmember', weightPercentage: 35, description: 'Menentukan persentase diskon 15%, 10%, 5%, atau 0% dengan percabangan' },
            { concept: 'Perhitungan Potongan & Total Pembayaran', weightPercentage: 25, description: 'Menghitung nominal potongan harga dan total belanja akhir' },
            { concept: 'Output Rincian Transaksi', weightPercentage: 20, description: 'Menampilkan nama, total belanja, diskon, dan total bayar' },
          ];
          commonMistakes = [
            { pattern: 'tanpa diskon nonmember', scorePercentage: 65, reason: 'Hanya menghitung diskon untuk member, belum menghitung diskon 5% untuk nonmember.' },
            { pattern: 'lupa kurangi belanja', scorePercentage: 60, reason: 'Menghitung potongan diskon tetapi total pembayaran belum dikurangi nominal potongan.' },
          ];
          summaryExplanation = 'Kode PHP menentukan persentase diskon berdasarkan status member dan batas belanja Rp500.000, menghitung potongan serta total pembayaran.';
        } else if (isTotalHargaBarangTask) {
          idealCode = rawKey || `<?php
if (isset($_POST['hitung'])) {
    $harga = [$_POST['harga1'], $_POST['harga2'], $_POST['harga3'], $_POST['harga4']];
    $total = 0;

    for ($i = 0; $i < count($harga); $i++) {
        $total += $harga[$i];
    }

    if ($total >= 200000) {
        $diskon = 20000;
    } else {
        $diskon = 0;
    }

    $total_bayar = $total - $diskon;

    echo "Total Belanja: Rp" . $total . "<br>";
    echo "Nominal Diskon: Rp" . $diskon . "<br>";
    echo "Total Bayar: Rp" . $total_bayar;
}
?>`;
          keyConcepts = [
            { concept: 'Input Harga Barang ke Array PHP ($_POST & Array)', weightPercentage: 20, description: 'Mengambil data harga1 sampai harga4 dari form dan menampungnya ke array PHP' },
            { concept: 'Perulangan for Menghitung Total ($total += $harga[$i])', weightPercentage: 30, description: 'Menggunakan perulangan for dan variabel akumulator untuk menjumlahkan seluruh harga barang' },
            { concept: 'Percabangan Diskon Rp20.000 (Jika Total >= Rp200.000)', weightPercentage: 30, description: 'Menentukan potongan harga Rp20.000 jika belanja minimal Rp200.000 dan menghitung total bayar' },
            { concept: 'Output Rincian Belanja, Diskon, & Total Bayar', weightPercentage: 20, description: 'Menampilkan total sebelum diskon, nominal diskon, dan total yang harus dibayar' },
          ];
          commonMistakes = [
            { pattern: 'bukan perulangan for', scorePercentage: 65, reason: 'Soal mewajibkan perulangan for untuk menjumlahkan array, hindari hanya menggunakan array_sum langsung.' },
            { pattern: 'lupa kurangi diskon', scorePercentage: 70, reason: 'Total belanja sudah benar namun total pembayaran akhir belum dikurangi nominal diskon Rp20.000.' },
          ];
          summaryExplanation = 'Kode PHP mengambil data harga 1-4 ke dalam array, menghitung total belanja menggunakan perulangan for, memberikan diskon Rp20.000 jika total >= Rp200.000, lalu menampilkan rincian pembayaran.';
        } else if (isPeminjamanTask) {
          idealCode = rawKey || `<?php
$stok = 15;
if (isset($_POST['pinjam'])) {
    $nama = $_POST['nama'];
    $perangkat = $_POST['perangkat'];
    $jumlah = $_POST['jumlah'];

    if ($jumlah < 1) {
        $pesan = "Jumlah peminjaman tidak valid";
    } elseif ($stok <= 0) {
        $pesan = "Stok habis";
    } elseif ($jumlah > $stok) {
        $pesan = "Peminjaman ditolak, stok tidak mencukupi";
    } else {
        $stok -= $jumlah;
        $pesan = "Peminjaman berhasil";
    }

    echo "Nama: $nama<br>Perangkat: $perangkat<br>Status: $pesan<br>Sisa stok: $stok";
}
?>`;
          keyConcepts = [
            { concept: 'Stok Awal 15 & Input Form ($_POST)', weightPercentage: 20, description: 'Inisialisasi stok 15 dan mengambil nama, perangkat, jumlah pinjam' },
            { concept: 'Validasi Jumlah Pinjam & Stok', weightPercentage: 35, description: 'Memeriksa jumlah < 1, stok kosong, dan jumlah melebihi stok' },
            { concept: 'Pengurangan Sisa Stok ($stok - $jumlah)', weightPercentage: 25, description: 'Mengurangi stok perangkat saat peminjaman berhasil' },
            { concept: 'Output Status & Sisa Stok', weightPercentage: 20, description: 'Menampilkan rincian peminjaman dan sisa stok terkini' },
          ];
          commonMistakes = [
            { pattern: 'tanpa pengurangan stok', scorePercentage: 65, reason: 'Validasi berhasil namun lupa memperbarui variabel sisa stok perangkat.' },
            { pattern: 'tanpa validasi negatif', scorePercentage: 70, reason: 'Belum memeriksa kondisi jika jumlah pinjam kurang dari 1.' },
          ];
          summaryExplanation = 'Kode PHP menginisialisasi stok 15 unit, memvalidasi kondisi peminjaman, mengurangi stok jika berhasil, dan menampilkan status.';
        } else if (isKompetensiTask) {
          idealCode = rawKey || `<?php
if (isset($_POST['cek'])) {
    $nama = $_POST['nama'];
    $teori = $_POST['teori'];
    $praktik = $_POST['praktik'];

    if ($teori < 0 || $teori > 100 || $praktik < 0 || $praktik > 100) {
        $status = "Nilai tidak valid";
    } else {
        $rata = ($teori + $praktik) / 2;
        if ($teori < 60 || $praktik < 60) {
            $status = "BELUM KOMPETEN";
        } elseif ($rata >= 75) {
            $status = "KOMPETEN";
        } else {
            $status = "PERLU PENGAYAAN";
        }
    }

    echo "Nama: $nama<br>";
    if (isset($rata)) echo "Rata-rata: $rata<br>";
    echo "Status: $status";
}
?>`;
          keyConcepts = [
            { concept: 'Input Form Nilai Teori & Praktik', weightPercentage: 20, description: 'Mengambil data nama, nilai teori, dan praktik dari form' },
            { concept: 'Validasi Rentang 0-100 & Rata-rata', weightPercentage: 25, description: 'Memvalidasi nilai 0-100 dan menghitung rata-rata ($teori + $praktik) / 2' },
            { concept: 'Percabangan Status Kompetensi', weightPercentage: 35, description: 'Menentukan KOMPETEN, BELUM KOMPETEN, atau PERLU PENGAYAAN' },
            { concept: 'Output Nama, Rata-rata, & Status', weightPercentage: 20, description: 'Menampilkan nama, nilai rata-rata, dan status kompetensi' },
          ];
          commonMistakes = [
            { pattern: 'tanpa status pengayaan', scorePercentage: 65, reason: 'Hanya menentukan KOMPETEN dan BELUM KOMPETEN, belum menangani kategori PERLU PENGAYAAN.' },
            { pattern: 'tanpa validasi 0-100', scorePercentage: 75, reason: 'Belum memvalidasi batas nilai 0 sampai 100.' },
          ];
          summaryExplanation = 'Kode PHP memvalidasi nilai teori dan praktik pada rentang 0-100, menghitung rata-rata, dan menentukan status kompetensi.';
        } else if (isDeretGenapTask) {
          idealCode = rawKey || `<?php
if (isset($_POST['tampil'])) {
    $batas = $_POST['batas'];
    $total = 0;

    for ($i = 2; $i <= $batas; $i += 2) {
        echo $i . " ";
        $total += $i;
    }

    echo "<br>Jumlah: $total";
}
?>`;
          keyConcepts = [
            { concept: 'Input Batas Deret Bilangan ($_POST)', weightPercentage: 20, description: 'Mengambil nilai batas dari form $_POST[\'batas\']' },
            { concept: 'Perulangan for Bilangan Genap', weightPercentage: 35, description: 'Menggunakan perulangan for mulai dari 2 sampai batas genap' },
            { concept: 'Akumulasi Jumlah Bilangan Genap ($total += $i)', weightPercentage: 25, description: 'Menjumlahkan seluruh bilangan genap yang dicetak' },
            { concept: 'Output Deret Bilangan & Total Akhir', weightPercentage: 20, description: 'Mencetak deret angka dan total jumlah keseluruhan' },
          ];
          commonMistakes = [
            { pattern: 'tanpa total penjumlahan', scorePercentage: 65, reason: 'Perulangan deret genap sudah benar namun belum menghitung jumlah seluruh bilangan genap.' },
            { pattern: 'mulai dari 0 atau 1', scorePercentage: 80, reason: 'Disarankan mulai dari angka genap pertama (2).' },
          ];
          summaryExplanation = 'Kode PHP menggunakan perulangan for dari 2 sampai batas untuk menampilkan deret bilangan genap dan mengakumulasikan total jumlahnya.';
        } else if (isAngsuranTask) {
          idealCode = rawKey || `<?php
if (isset($_POST['hitung'])) {
    $nama = $_POST['nama'];
    $angsuran = $_POST['angsuran'];
    $bulan = $_POST['bulan'];

    $i = 1;
    $total = 0;

    while ($i <= $bulan) {
        $total += $angsuran;
        $i++;
    }

    echo "Nama: $nama<br>Jumlah bulan: $bulan<br>Total pembayaran: Rp$total";
}
?>`;
          keyConcepts = [
            { concept: 'Input Pelanggan, Angsuran, Bulan ($_POST)', weightPercentage: 20, description: 'Mengambil data dari form $_POST' },
            { concept: 'Perulangan while Menjumlahkan Angsuran', weightPercentage: 35, description: 'Menggunakan perulangan while untuk iterasi bulan angsuran' },
            { concept: 'Variabel Akumulator Total ($total += $angsuran)', weightPercentage: 25, description: 'Menjumlahkan akumulasi nominal pembayaran' },
            { concept: 'Output Nama, Bulan, & Total Pembayaran', weightPercentage: 20, description: 'Menampilkan data pelanggan dan total pembayaran angsuran' },
          ];
          commonMistakes = [
            { pattern: 'bukan while', scorePercentage: 60, reason: 'Soal secara spesifik meminta perulangan while, hindari perkalian langsung tanpa loop.' },
            { pattern: 'infinite loop while', scorePercentage: 30, reason: 'Lupa menambahkan increment counter ($i++) di dalam perulangan while.' },
          ];
          summaryExplanation = 'Kode PHP menggunakan perulangan while dan variabel akumulator untuk menghitung total pembayaran angsuran per bulan.';
        } else if (isPerkalianTask) {
          idealCode = rawKey || `<?php
if (isset($_POST['proses'])) {
    $angka = $_POST['angka'];

    for ($i = 1; $i <= 10; $i++) {
        $hasil = $angka * $i;
        echo "$angka x $i = $hasil<br>";
    }
}
?>`;
          keyConcepts = [
            { concept: 'Input Angka Form ($_POST)', weightPercentage: 20, description: 'Mengambil angka dari form $_POST[\'angka\']' },
            { concept: 'Perulangan for Iterasi 1 sampai 10', weightPercentage: 35, description: 'Menggunakan perulangan for ($i=1; $i<=10; $i++)' },
            { concept: 'Kalkulasi Perkalian ($angka * $i)', weightPercentage: 25, description: 'Menghitung hasil kali angka pada setiap iterasi' },
            { concept: 'Output Format Tabel Perkalian', weightPercentage: 20, description: 'Menampilkan baris perkalian lengkap dengan <br>' },
          ];
          commonMistakes = [
            { pattern: 'iterasi kurang dari 10', scorePercentage: 70, reason: 'Perulangan belum berjalan lengkap sampai 10 (misal hanya sampai 9 atau batas keliru).' },
            { pattern: 'lupa echo format', scorePercentage: 60, reason: 'Menghitung perkalian namun tidak mencetak format tabel perkalian (Angka x i = Hasil).' },
          ];
          summaryExplanation = 'Kode PHP mengambil angka dari form dan menggunakan perulangan for dari 1 sampai 10 untuk mencetak tabel perkalian lengkap.';
        } else if (isRekapNilaiTask) {
          const isKelulusanSiswa = qNorm.includes('nama1') || qNorm.includes('nilai1') || qNorm.includes('daftar_nama') || (qNorm.includes('lulus') && !qNorm.includes('rata-rata'));
          if (isKelulusanSiswa) {
            idealCode = rawKey || `<?php
if (isset($_POST['rekap'])) {
    $daftar_nama = [$_POST['nama1'], $_POST['nama2'], $_POST['nama3']];
    $daftar_nilai = [$_POST['nilai1'], $_POST['nilai2'], $_POST['nilai3']];
    $jumlah_lulus = 0;

    foreach ($daftar_nama as $index => $nama) {
        $nilai = $daftar_nilai[$index];
        if ($nilai >= 75) {
            $ket = "Lulus";
            $jumlah_lulus++;
        } else {
            $ket = "Tidak Lulus";
        }
        echo "Nama: $nama | Nilai: $nilai | Keterangan: $ket<br>";
    }

    echo "Jumlah Siswa Lulus: $jumlah_lulus";
}
?>`;
            keyConcepts = [
              { concept: 'Input Form Nama & Nilai Siswa ke Array PHP', weightPercentage: 20, description: 'Mengambil nama dan nilai dari form lalu menampungnya ke dalam array PHP ($daftar_nama dan $daftar_nilai)' },
              { concept: 'Perulangan foreach Menampilkan Nama & Nilai', weightPercentage: 30, description: 'Menggunakan perulangan foreach untuk menelusuri data array siswa' },
              { concept: 'Percabangan Keterangan Kelulusan (Nilai >= 75: Lulus)', weightPercentage: 25, description: 'Menentukan keterangan Lulus jika nilai >= 75 atau Tidak Lulus jika di bawah 75' },
              { concept: 'Counter Akumulasi Jumlah Siswa Lulus ($jumlah_lulus++)', weightPercentage: 25, description: 'Menghitung dan menampilkan total jumlah peserta yang lulus' },
            ];
            commonMistakes = [
              { pattern: 'bukan foreach', scorePercentage: 65, reason: 'Soal secara spesifik meminta perulangan foreach untuk menampilkan data siswa.' },
              { pattern: 'tanpa hitung jumlah lulus', scorePercentage: 70, reason: 'Status kelulusan sudah dicetak namun belum menghitung jumlah siswa yang lulus.' },
            ];
            summaryExplanation = 'Kode PHP menampung nama dan nilai siswa ke array, melakukan perulangan foreach untuk menampilkan nama, nilai, serta keterangan Lulus/Tidak Lulus, dan menghitung jumlah siswa yang lulus.';
          } else {
            idealCode = rawKey || `<?php
if (isset($_POST['rekap'])) {
    $nama = $_POST['nama'];
    $nilai = $_POST['nilai'];

    $total = 0;
    $lulus = 0;

    echo "Nama: $nama<br>";

    foreach ($nilai as $angka) {
        echo "Nilai: $angka<br>";
        $total += $angka;
        if ($angka >= 75) $lulus++;
    }

    $rata = $total / count($nilai);

    echo "Total: $total<br>Rata-rata: $rata<br>Jumlah nilai minimal 75: $lulus";
}
?>`;
            keyConcepts = [
              { concept: 'Input Form Array Nilai ($_POST[\'nilai\'])', weightPercentage: 20, description: 'Membaca nama dan array lima nilai dari form' },
              { concept: 'Perulangan foreach Iterasi Array', weightPercentage: 35, description: 'Menggunakan perulangan foreach untuk menelusuri array nilai' },
              { concept: 'Akumulasi Total, Rata-rata, & Filter >= 75', weightPercentage: 25, description: 'Menghitung total nilai, rata-rata, dan jumlah nilai lulus (>=75)' },
              { concept: 'Output Rekapitulasi Lengkap', weightPercentage: 20, description: 'Menampilkan setiap nilai, total, rata-rata, dan jumlah nilai lulus' },
            ];
            commonMistakes = [
              { pattern: 'bukan foreach', scorePercentage: 65, reason: 'Soal secara spesifik meminta perulangan foreach untuk menelusuri data array.' },
              { pattern: 'tanpa hitung lulus 75', scorePercentage: 70, reason: 'Perulangan dan rata-rata berjalan, namun belum menghitung jumlah nilai yang mencapai minimal 75.' },
            ];
            summaryExplanation = 'Kode PHP menggunakan perulangan foreach untuk menelusuri array nilai, mencetak setiap nilai, serta menghitung total, rata-rata, dan jumlah nilai >= 75.';
          }
        } else if (isPolaBintangTask) {
          idealCode = rawKey || `<?php
if (isset($_POST['buat'])) {
    $baris = $_POST['baris'];

    for ($i = 1; $i <= $baris; $i++) {
        for ($j = 1; $j <= $i; $j++) {
            echo "*";
        }
        echo "<br>";
    }
}
?>`;
          keyConcepts = [
            { concept: 'Input Jumlah Baris ($_POST[\'baris\'])', weightPercentage: 20, description: 'Mengambil jumlah baris pola bintang dari form' },
            { concept: 'Perulangan Luar for (Baris)', weightPercentage: 25, description: 'Menggunakan perulangan for luar untuk menentukan baris 1 sampai N' },
            { concept: 'Perulangan Dalam for (Cetak Bintang)', weightPercentage: 35, description: 'Menggunakan perulangan for dalam (nested loop) untuk mencetak bintang' },
            { concept: 'Output Baris Baru (<br>) & Validitas', weightPercentage: 20, description: 'Mencetak baris baru setelah perulangan dalam selesai' },
          ];
          commonMistakes = [
            { pattern: 'bukan nested loop', scorePercentage: 60, reason: 'Soal mewajibkan nested loop (perulangan bersarang), hindari hanya menggunakan 1 perulangan.' },
            { pattern: 'lupa baris baru', scorePercentage: 65, reason: 'Perulangan bersarang berjalan namun lupa mencetak pemisah baris baru (<br>) di akhir tiap baris.' },
          ];
          summaryExplanation = 'Kode PHP mengambil jumlah baris dari form dan menggunakan nested loop (perulangan bersarang for) untuk mencetak pola bintang bertingkat.';
        } else {
          // Dynamic PHP Web Form Fallback
          idealCode = rawKey || `<?php
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Logika pemrosesan data form
}
?>`;
          keyConcepts = [
            { concept: 'Pemeriksaan Form & Input ($_POST)', weightPercentage: 25, description: 'Memeriksa submit form dan mengambil input via $_POST' },
            { concept: 'Struktur Logika Percabangan / Perulangan', weightPercentage: 35, description: 'Mengimplementasikan struktur logika sesuai ketentuan soal' },
            { concept: 'Pemrosesan Data & Logika Bisnis', weightPercentage: 20, description: 'Melakukan kalkulasi atau validasi data sesuai instruksi' },
            { concept: 'Output Respon Form & Sintaks Valid', weightPercentage: 20, description: 'Menampilkan hasil pemrosesan form dengan echo' },
          ];
          commonMistakes = [
            { pattern: 'readline pada form', scorePercentage: 30, reason: 'Menggunakan readline() CLI bukannya variabel $_POST dari form HTML.' },
            { pattern: 'syntax error', scorePercentage: 15, reason: 'Terdapat parse error fatal pada sintaks PHP.' },
          ];
          summaryExplanation = 'Kode PHP memproses pengiriman data dari form HTML menggunakan superglobal $_POST, mengeksekusi logika yang diminta, dan menampilkan output.';
        }

        const variations: CorrectVariationItem[] = [];
        if (idealCode) {
          variations.push({ pattern: idealCode, description: 'Kunci model PHP Form lengkap' });
          const noTag = idealCode.replace(/^<\?php\s*/i, '').replace(/\s*\?>$/i, '').trim();
          if (noTag !== idealCode) {
            variations.push({ pattern: noTag, description: 'Tanpa tag <?php ?>' });
          }
        }

        return {
          idealAnswer: idealCode,
          keyConcepts,
          correctVariations: variations,
          commonMistakes,
          summaryExplanation,
          generatedAt: new Date().toISOString(),
        };
      }

      const isPersegiTask =
        qNorm.includes('persegi') && (qNorm.includes('panjang') || qNorm.includes('lebar'));
      const isLoginTask =
        (qNorm.includes('login') || qNorm.includes('username')) &&
        (qNorm.includes('admin') || qNorm.includes('operator') || qNorm.includes('user') || qNorm.includes('password'));
      const isSeragamTask =
        qNorm.includes('seragam') ||
        (qNorm.includes('jenjang') && (qNorm.includes('sd') || qNorm.includes('smp') || qNorm.includes('sma')));

      let idealCode = '';
      let keyConcepts: KeyConceptItem[] = [];
      let commonMistakes: CommonMistakeItem[] = [];
      let summaryExplanation = '';

      if (isPersegiTask) {
        idealCode = `<?php
$panjang = (float) readline("Masukkan panjang : ");
$lebar = (float) readline("Masukkan lebar : ");

if ($panjang == $lebar) {
    $bangun = "PERSEGI";
} else {
    $bangun = "PERSEGI PANJANG";
}

$luas = $panjang * $lebar;

echo "=== PROGRAM MENENTUKAN BANGUN ===\\n";
echo "Masukkan panjang : " . $panjang . "\\n";
echo "Masukkan lebar : " . $lebar . "\\n";
echo "Bangun : " . $bangun . "\\n";
echo "Luas : " . $luas . "\\n";
?>`;
        keyConcepts = [
          { concept: 'Input readline() ($panjang & $lebar)', weightPercentage: 20, description: 'Menerima input panjang dan lebar dengan readline()' },
          { concept: 'Percabangan if...else ($panjang == $lebar)', weightPercentage: 35, description: 'Menentukan jenis bangun Persegi vs Persegi Panjang' },
          { concept: 'Perhitungan Luas ($panjang * $lebar)', weightPercentage: 25, description: 'Menghitung rumus perkalian panjang x lebar' },
          { concept: 'Output & Validitas Sintaks PHP', weightPercentage: 20, description: 'Mencetak output tanpa parse error' },
        ];
        commonMistakes = [
          { pattern: 'readline tanpa if else', scorePercentage: 15, reason: 'Hanya membaca input tanpa if...else dan tanpa rumus luas.' },
          { pattern: 'syntax error array kutip', scorePercentage: 10, reason: 'Terdapat kesalahan sintaks fatal PHP (parse error tanda kutip atau kurung).' },
          { pattern: 'tanpa rumus luas', scorePercentage: 40, reason: 'Menentukan jenis bangun namun tidak menghitung luas.' },
        ];
        summaryExplanation = 'Program membaca input panjang dan lebar, membandingkan dengan if...else, menghitung luas, dan mencetak output.';
      } else if (isLoginTask) {
        idealCode = `<?php
$username = readline("Username : ");
$password = readline("Password : ");

if ($username == "admin" && $password == "admin123") {
    echo "Login berhasil! Selamat datang, admin.\\n";
    echo "Level : Admin\\n";
} elseif ($username == "operator" && $password == "operator123") {
    echo "Login berhasil! Selamat datang, operator.\\n";
    echo "Level : Operator\\n";
} elseif ($username == "user" && $password == "user123") {
    echo "Login berhasil! Selamat datang, user.\\n";
    echo "Level : User\\n";
} else {
    echo "Login gagal! Username atau password salah.\\n";
}
?>`;
        keyConcepts = [
          { concept: 'Input readline() ($username & $password)', weightPercentage: 20, description: 'Membaca input username dan password' },
          { concept: 'Struktur if...elseif...else dan operator &&', weightPercentage: 35, description: 'Pengujian kombinasi username && password' },
          { concept: 'Autentikasi 3 Role (Admin, Operator, User)', weightPercentage: 25, description: 'Pengecekan akun 3 role pengguna lengkap' },
          { concept: 'Pesan Berhasil/Gagal, Level & Validitas Sintaks', weightPercentage: 20, description: 'Menampilkan status login dan level akun tanpa parse error' },
        ];
        commonMistakes = [
          { pattern: 'syntax error operator && ==', scorePercentage: 15, reason: 'Kesalahan sintaks pada operator kondisi atau kurung kurawal tidak tertutup.' },
          { pattern: 'hanya 1 atau 2 role', scorePercentage: 45, reason: 'Hanya mengecek sebagian role (misal admin saja) tanpa mengecek operator dan user.' },
          { pattern: 'tanpa pesan status dan level', scorePercentage: 50, reason: 'Percabangan ada namun tidak menampilkan pesan login berhasil/gagal dan level pengguna.' },
        ];
        summaryExplanation = 'Program meminta username & password dengan readline(), mengecek 3 akun dengan if...elseif...else dan &&, lalu menampilkan level atau pesan gagal.';
      } else if (isSeragamTask) {
        idealCode = `<?php
$jenjang = readline("Masukkan jenjang sekolah : ");
$jenjangLower = strtolower(trim($jenjang));

if ($jenjangLower == "sd") {
    echo "=== PROGRAM WARNA SERAGAM ===\\n";
    echo "Jenjang : SD\\n";
    echo "Warna seragam : Merah Putih\\n";
} elseif ($jenjangLower == "smp") {
    echo "=== PROGRAM WARNA SERAGAM ===\\n";
    echo "Jenjang : SMP\\n";
    echo "Warna seragam : Biru Putih\\n";
} elseif ($jenjangLower == "sma") {
    echo "=== PROGRAM WARNA SERAGAM ===\\n";
    echo "Jenjang : SMA\\n";
    echo "Warna seragam : Abu-abu Putih\\n";
} else {
    echo "=== PROGRAM WARNA SERAGAM ===\\n";
    echo "Jenjang sekolah tidak ditemukan! Silakan pilih SD, SMP, atau SMA.\\n";
}
?>`;
        keyConcepts = [
          { concept: 'Input readline() ($jenjang)', weightPercentage: 20, description: 'Membaca input jenjang sekolah dengan readline()' },
          { concept: 'Case-Insensitive (strtolower / variasi huruf)', weightPercentage: 20, description: 'Input tidak sensitif terhadap huruf besar dan kecil' },
          { concept: 'Percabangan if...elseif 3 Jenjang (SD, SMP, SMA)', weightPercentage: 35, description: 'Pemetaan warna seragam SD, SMP, dan SMA' },
          { concept: 'Penanganan Fallback else & Output', weightPercentage: 25, description: 'Pesan jika jenjang tidak ditemukan dan sintaks valid' },
        ];
        commonMistakes = [
          { pattern: 'tanpa input readline', scorePercentage: 25, reason: 'Menggunakan variabel jenjang tanpa membaca input dari terminal dengan readline().' },
          { pattern: 'unclosed brace syntax error', scorePercentage: 15, reason: 'Lupa tanda kurung kurawal penutup } sebelum else if.' },
          { pattern: 'tanpa fallback else', scorePercentage: 50, reason: 'Tidak menyediakan blok else untuk input yang tidak sesuai.' },
        ];
        summaryExplanation = 'Program membaca jenjang dengan readline(), mengubah ke lowercase untuk case-insensitive, menentukan warna seragam dengan if...elseif...else, dan menangani input salah.';
      } else {
        idealCode = `<?php
// Program PHP CLI Lengkap
$input = readline("Masukkan data: ");
if (!empty($input)) {
    echo "Hasil: " . $input . "\\n";
}
?>`;
        keyConcepts = [
          { concept: 'Input readline()', weightPercentage: 25, description: 'Membaca input dari terminal' },
          { concept: 'Logika Pemrosesan & Percabangan', weightPercentage: 45, description: 'Struktur logika yang memenuhi instruksi soal' },
          { concept: 'Output & Validitas Sintaks', weightPercentage: 30, description: 'Mencetak output hasil tanpa parse error' },
        ];
        commonMistakes = [
          { pattern: 'syntax error', scorePercentage: 15, reason: 'Terdapat parse error fatal pada kode PHP.' },
          { pattern: 'tidak tahu', scorePercentage: 0, reason: 'Tidak menjawab materi soal.' },
        ];
        summaryExplanation = 'Program PHP CLI harus membaca input dengan readline(), memproses instruksi soal, dan mencetak output yang sesuai.';
      }

      return {
        idealAnswer: idealCode,
        keyConcepts,
        correctVariations: [
          { pattern: idealCode, description: 'Kode program PHP standar' },
        ],
        commonMistakes,
        summaryExplanation,
        generatedAt: new Date().toISOString(),
      };
    }

    // 1. Bootstrap Grid Class Detection (e.g. col-md-6, col-lg-4, col-sm-12)
    const isBootstrapClass =
      (qNorm.includes('bootstrap') || qNorm.includes('grid')) &&
      (qNorm.includes('class') || qNorm.includes('div') || qNorm.includes('kolom') || qNorm.includes('col'));

    if (isBootstrapClass && !qNorm.includes('emmet')) {
      // Detect column width
      let colNum = '6';
      if (qNorm.includes('12') || qNorm.includes('dua belas') || qNorm.includes('penuh')) colNum = '12';
      else if (qNorm.includes('6') || qNorm.includes('enam') || qNorm.includes('setengah')) colNum = '6';
      else if (qNorm.includes('4') || qNorm.includes('empat')) colNum = '4';
      else if (qNorm.includes('3') || qNorm.includes('tiga')) colNum = '3';
      else if (qNorm.includes('2') || qNorm.includes('dua')) colNum = '2';
      else if (qNorm.includes('8') || qNorm.includes('delapan')) colNum = '8';
      else if (qNorm.includes('1') || qNorm.includes('satu')) colNum = '1';

      // Detect breakpoint
      let bp = 'md';
      let bpName = 'medium (>=768px)';
      if (qNorm.includes('small') || qNorm.includes('kecil') || qNorm.includes('sm')) {
        bp = 'sm';
        bpName = 'small (>=576px)';
      } else if (qNorm.includes('large') || qNorm.includes('besar') || qNorm.includes('lg')) {
        bp = 'lg';
        bpName = 'large (>=992px)';
      } else if (qNorm.includes('extra large') || qNorm.includes('xl')) {
        bp = 'xl';
        bpName = 'extra large (>=1200px)';
      } else if (qNorm.includes('medium') || qNorm.includes('sedang') || qNorm.includes('md')) {
        bp = 'md';
        bpName = 'medium (>=768px)';
      }

      const mainClass = `col-${bp}-${colNum}`;

      return {
        idealAnswer: mainClass,
        keyConcepts: [
          { concept: `col-${bp}-`, weightPercentage: 50, description: `Prefix breakpoint grid Bootstrap ${bpName}` },
          { concept: colNum, weightPercentage: 50, description: `Alokasi lebar ${colNum} kolom dari total 12 kolom sistem grid` },
        ],
        correctVariations: [
          { pattern: mainClass, description: 'Nama class murni Bootstrap' },
          { pattern: `.${mainClass}`, description: 'Notasi class dengan dot selector' },
          { pattern: `class="${mainClass}"`, description: 'Sebagai atribut class HTML' },
          { pattern: `<div class="${mainClass}">`, description: 'Tag div pembuka' },
          { pattern: `<div class="${mainClass}"></div>`, description: 'Elemen div lengkap' },
          { pattern: `class='${mainClass}'`, description: 'Kutipan tunggal' },
        ],
        commonMistakes: [
          {
            pattern: `col-${colNum}`,
            scorePercentage: 50,
            reason: `Lebar ${colNum} kolom sudah benar, namun tidak menyertakan breakpoint '${bp}' untuk layar medium ke atas.`,
          },
          {
            pattern: `col-sm-${colNum}`,
            scorePercentage: 30,
            reason: `Menggunakan breakpoint 'sm' (small) bukan '${bp}'.`,
          },
          {
            pattern: `col-lg-${colNum}`,
            scorePercentage: 30,
            reason: `Menggunakan breakpoint 'lg' (large) bukan '${bp}'.`,
          },
          {
            pattern: `${bp}-${colNum}`,
            scorePercentage: 30,
            reason: 'Kurang prefix "col-" untuk penulisan class grid Bootstrap.',
          },
          {
            pattern: 'tidak tahu',
            scorePercentage: 0,
            reason: 'Tidak menjawab materi soal.',
          },
        ],
        summaryExplanation: `Pada sistem grid 12 kolom Bootstrap, lebar ${colNum} kolom pada ukuran layar ${bpName} ke atas ditulis dengan class '${mainClass}'.`,
        generatedAt: new Date().toISOString(),
      };
    }

    // 2. Explicit Emmet Syntax Question (ONLY when "emmet" is explicitly mentioned)
    if (qNorm.includes('emmet')) {
      const is3Col = qNorm.includes('3') || qNorm.includes('tiga');
      const is4Col = qNorm.includes('4') || qNorm.includes('empat');
      const is2Col = qNorm.includes('2') || qNorm.includes('dua');
      const colMultiplier = is4Col ? 4 : is2Col ? 2 : 3;

      return {
        idealAnswer: `.row>.col*${colMultiplier}`,
        keyConcepts: [
          { concept: '.row', weightPercentage: 50, description: 'Class pembungkus baris Bootstrap' },
          { concept: `.col*${colMultiplier}`, weightPercentage: 50, description: `Class ${colMultiplier} kolom dengan perkalian atau chaining` },
        ],
        correctVariations: [
          { pattern: `.row>.col*${colMultiplier}`, description: 'Sintaks perkalian Emmet standar' },
          { pattern: `.row>.col${'+.col'.repeat(colMultiplier - 1)}`, description: 'Sintaks chaining tanda plus' },
          { pattern: `.row>.col-4*${colMultiplier}`, description: 'Sintaks grid eksplisit col-4' },
          { pattern: `.row>.col-md-4*${colMultiplier}`, description: 'Sintaks breakpoint responsif md' },
          { pattern: `div.row>div.col*${colMultiplier}`, description: 'Lengkap dengan tag div' },
          { pattern: `.row > .col*${colMultiplier}`, description: 'Dengan spasi' },
        ],
        commonMistakes: [
          {
            pattern: `row>col${'+col'.repeat(colMultiplier - 1)}`,
            scorePercentage: 40,
            reason: 'Sintaks kurang tepat: Emmet class Bootstrap wajib diawali tanda titik (.). Tanpa titik akan menghasilkan tag kustom <row><col></col></row>.',
          },
          {
            pattern: `row>col*${colMultiplier}`,
            scorePercentage: 40,
            reason: 'Sintaks tanpa titik (.): Emmet class Bootstrap wajib diawali tanda titik (.).',
          },
          {
            pattern: `.col*${colMultiplier}`,
            scorePercentage: 30,
            reason: 'Hanya membuat kolom tanpa baris pembungkus (.row).',
          },
          {
            pattern: 'tidak tahu',
            scorePercentage: 0,
            reason: 'Tidak menjawab substansi materi soal.',
          },
        ],
        summaryExplanation: `Sintaks Emmet untuk membuat baris dan kolom pada Bootstrap diawali tanda titik (.) sebagai penanda class, misal .row>.col*${colMultiplier}.`,
        generatedAt: new Date().toISOString(),
      };
    }

    // 3. PHP CLI Built-in Web Server (e.g. php -S localhost:8000)
    const isPhpServer =
      (qNorm.includes('php') || qNorm.includes('cli') || qNorm.includes('terminal')) &&
      (qNorm.includes('-s') || qNorm.includes('server') || qNorm.includes('localhost') || qNorm.includes('port') || qNorm.includes('web server') || qNorm.includes('built-in'));

    if (isPhpServer) {
      const portMatch = qNorm.match(/(\d{4})/);
      const port = portMatch ? portMatch[1] : '8000';
      const mainCmd = `php -S localhost:${port}`;

      return {
        idealAnswer: mainCmd,
        keyConcepts: [
          { concept: 'php -S', weightPercentage: 50, description: 'Flag -S (kapital) untuk menjalankan PHP built-in web server' },
          { concept: `localhost:${port}`, weightPercentage: 50, description: `Host dan port binding (${port})` },
        ],
        correctVariations: [
          { pattern: mainCmd, description: 'Perintah CLI server standar' },
          { pattern: `php -S 127.0.0.1:${port}`, description: 'Dengan alamat loopback IP' },
          { pattern: `php -S 0.0.0.0:${port}`, description: 'Dengan all interfaces' },
          { pattern: `php -S localhost:${port} -t public`, description: 'Dengan docroot public' },
          { pattern: `php -S 127.0.0.1:${port} -t public`, description: 'Dengan docroot public IP' },
          { pattern: `php -S localhost:${port} index.php`, description: 'Dengan router script' },
        ],
        commonMistakes: [
          {
            pattern: `php -s localhost:${port}`,
            scorePercentage: 60,
            reason: 'Flag -s harus menggunakan huruf KAPITAL (-S). Huruf kecil (-s) pada PHP CLI adalah untuk output HTML sintaks berwarna.',
          },
          {
            pattern: `php localhost:${port}`,
            scorePercentage: 30,
            reason: 'Kurang flag "-S" sebelum alamat host dan port.',
          },
          {
            pattern: `localhost:${port}`,
            scorePercentage: 20,
            reason: 'Kurang perintah "php -S".',
          },
          {
            pattern: 'tidak tahu',
            scorePercentage: 0,
            reason: 'Tidak menjawab materi soal.',
          },
        ],
        summaryExplanation: `Perintah CLI untuk menjalankan web server bawaan PHP adalah "php -S localhost:${port}" (huruf S wajib kapital).`,
        generatedAt: new Date().toISOString(),
      };
    }

    // 4. PHP CLI Terminal Input (readline / fgets(STDIN)) - Single Command only
    const isPhpCliInput =
      !this.isFullProgrammingProblem(questionText, teacherKey) &&
      (qNorm.includes('php') || qNorm.includes('cli') || qNorm.includes('terminal')) &&
      (qNorm.includes('readline') || qNorm.includes('stdin') || qNorm.includes('fgets') || qNorm.includes('baca input') || qNorm.includes('input terminal') || qNorm.includes('input user') || qNorm.includes('masukkan nama'));

    if (isPhpCliInput) {
      return {
        idealAnswer: '$input = readline("Masukkan data: ");',
        keyConcepts: [
          { concept: 'readline / fgets(STDIN)', weightPercentage: 60, description: 'Fungsi membaca baris teks dari terminal/STDIN di PHP' },
          { concept: 'variabel penampung ($input)', weightPercentage: 40, description: 'Menampung hasil input ke dalam variabel' },
        ],
        correctVariations: [
          { pattern: '$input = readline();', description: 'Readline tanpa prompt' },
          { pattern: '$input = readline("Masukkan: ");', description: 'Readline dengan prompt' },
          { pattern: '$nama = readline("Masukkan nama: ");', description: 'Readline variabel nama' },
          { pattern: '$input = trim(fgets(STDIN));', description: 'Sintaks stream STDIN dengan trim' },
          { pattern: '$input = fgets(STDIN);', description: 'Sintaks stream STDIN murni' },
          { pattern: 'readline("Masukkan: ")', description: 'Pemanggilan fungsi readline langsung' },
          { pattern: 'fgets(STDIN)', description: 'Pemanggilan fgets STDIN langsung' },
          { pattern: '$nama = trim(fgets(STDIN));', description: 'Variabel nama STDIN' },
        ],
        commonMistakes: [
          {
            pattern: 'input()',
            scorePercentage: 20,
            reason: 'input() adalah fungsi bahasa Python, di PHP CLI gunakan readline() atau fgets(STDIN).',
          },
          {
            pattern: 'cin >>',
            scorePercentage: 10,
            reason: 'cin adalah sintaks C++, di PHP CLI gunakan readline() atau fgets(STDIN).',
          },
          {
            pattern: '$_POST',
            scorePercentage: 15,
            reason: '$_POST adalah variabel HTTP Web form, bukan untuk input interaktif CLI terminal.',
          },
          {
            pattern: 'tidak tahu',
            scorePercentage: 0,
            reason: 'Tidak menjawab materi soal.',
          },
        ],
        summaryExplanation: 'Untuk membaca input terminal di PHP CLI dapat menggunakan fungsi readline("Prompt: ") atau trim(fgets(STDIN)).',
        generatedAt: new Date().toISOString(),
      };
    }

    // 5. PHP CLI Arguments ($argv / $argc)
    const isPhpCliArgs =
      (qNorm.includes('php') || qNorm.includes('cli') || qNorm.includes('terminal')) &&
      (qNorm.includes('argv') || qNorm.includes('argc') || qNorm.includes('argumen') || qNorm.includes('parameter cli') || qNorm.includes('baris perintah'));

    if (isPhpCliArgs) {
      return {
        idealAnswer: '$arg = $argv[1];',
        keyConcepts: [
          { concept: '$argv', weightPercentage: 60, description: 'Array global pembawa argumen baris perintah di PHP CLI' },
          { concept: '[1]', weightPercentage: 40, description: 'Indeks 1 untuk argumen pertama (indeks 0 adalah nama file skrip)' },
        ],
        correctVariations: [
          { pattern: '$argv[1]', description: 'Argumen baris perintah pertama' },
          { pattern: '$arg = $argv[1];', description: 'Assignment ke variabel' },
          { pattern: '$argv', description: 'Array argumen' },
          { pattern: '$argc', description: 'Jumlah argumen baris perintah' },
          { pattern: 'print_r($argv);', description: 'Cetak seluruh array argv' },
          { pattern: 'var_dump($argv);', description: 'Dump seluruh array argv' },
          { pattern: 'echo $argv[1];', description: 'Echo argumen pertama' },
        ],
        commonMistakes: [
          {
            pattern: '$_GET',
            scorePercentage: 20,
            reason: '$_GET adalah untuk parameter URL web browser, di CLI gunakan $argv.',
          },
          {
            pattern: '$args',
            scorePercentage: 40,
            reason: 'Nama array standar di PHP CLI adalah $argv (bukan $args).',
          },
          {
            pattern: 'tidak tahu',
            scorePercentage: 0,
            reason: 'Tidak menjawab materi soal.',
          },
        ],
        summaryExplanation: 'PHP CLI menyediakan array bawaan $argv untuk membaca argumen baris perintah, di mana $argv[0] adalah nama file dan $argv[1] adalah argumen pertama.',
        generatedAt: new Date().toISOString(),
      };
    }

    // 6. PHP CLI Linting / Syntax Check (-l)
    const isPhpLint =
      (qNorm.includes('php') || qNorm.includes('cli')) &&
      (qNorm.includes('lint') || qNorm.includes('cek sintaks') || qNorm.includes('syntax check') || qNorm.includes('validasi sintaks') || qNorm.includes('-l'));

    if (isPhpLint) {
      return {
        idealAnswer: 'php -l index.php',
        keyConcepts: [
          { concept: 'php -l', weightPercentage: 70, description: 'Flag -l (lint) untuk memeriksa sintaks tanpa mengeksekusi kode' },
          { concept: 'filename.php', weightPercentage: 30, description: 'Target file PHP yang diperiksa' },
        ],
        correctVariations: [
          { pattern: 'php -l index.php', description: 'Cek sintaks index.php' },
          { pattern: 'php -l file.php', description: 'Cek sintaks file.php' },
          { pattern: 'php -l script.php', description: 'Cek sintaks script.php' },
          { pattern: 'php --syntax-check index.php', description: 'Versi panjang flag syntax check' },
          { pattern: 'php -l', description: 'Flag php -l' },
        ],
        commonMistakes: [
          { pattern: 'php -v', scorePercentage: 20, reason: 'Flag -v adalah untuk mengecek versi PHP, bukan sintaks (gunakan -l).' },
          { pattern: 'php -c', scorePercentage: 20, reason: 'Flag -c adalah untuk menentukan path php.ini.' },
          { pattern: 'tidak tahu', scorePercentage: 0, reason: 'Tidak menjawab materi soal.' },
        ],
        summaryExplanation: 'Untuk mengecek sintaks file PHP dari CLI tanpa menjalankannya, gunakan perintah "php -l nama_file.php".',
        generatedAt: new Date().toISOString(),
      };
    }

    // 7. PHP Database Connection / MySQLi Detection
    if (
      (qNorm.includes('mysqli') || qNorm.includes('koneksi') || qNorm.includes('database') || qNorm.includes('db')) &&
      (qNorm.includes('php') || qNorm.includes('code') || qNorm.includes('sintaks'))
    ) {
      return {
        idealAnswer: '$conn = new mysqli("localhost", "root", "", "database_name");',
        keyConcepts: [
          { concept: 'new mysqli', weightPercentage: 40, description: 'Instansiasi objek mysqli' },
          { concept: 'host, user, pass, db', weightPercentage: 60, description: 'Parameter koneksi server database' },
        ],
        correctVariations: [
          { pattern: '$conn = new mysqli($host, $user, $pass, $db);', description: 'Variabel parameter' },
          { pattern: '$koneksi = mysqli_connect("localhost", "root", "", "db");', description: 'Sintaks prosedural mysqli_connect' },
          { pattern: '$conn = new mysqli("localhost", "root", "", "db");', description: 'Sintaks OOP' },
          { pattern: 'mysqli_connect("localhost", "root", "", "database_name");', description: 'Fungsi murni' },
        ],
        commonMistakes: [
          { pattern: 'mysqli()', scorePercentage: 30, reason: 'Kurang keyword new atau mysqli_connect.' },
          { pattern: 'mysql_connect()', scorePercentage: 20, reason: 'mysql_connect() sudah deprecated di PHP modern.' },
          { pattern: 'tidak tahu', scorePercentage: 0, reason: 'Tidak menjawab materi soal.' },
        ],
        summaryExplanation: 'Koneksi database di PHP dapat menggunakan OOP ($conn = new mysqli(...)) atau prosedural (mysqli_connect(...)).',
        generatedAt: new Date().toISOString(),
      };
    }

    // 4. Fallback based on Teacher's Key or Question Keywords
    const key = rawKey || this.generateKeyFromQuestion(questionText);
    const keywords = this.extractKeywords(key);

    const variations: CorrectVariationItem[] = [
      { pattern: key, description: 'Sesuai kunci referensi guru/model' },
    ];
    if (key.toLowerCase() !== key) {
      variations.push({ pattern: key.toLowerCase(), description: 'Huruf kecil' });
    }
    if (key.includes('class=')) {
      const classMatch = key.match(/class=["']([^"']+)["']/);
      if (classMatch) {
        variations.push({ pattern: classMatch[1], description: 'Hanya nilai class' });
        variations.push({ pattern: `.${classMatch[1]}`, description: 'Notasi titik class selector' });
      }
    }

    return {
      idealAnswer: key,
      keyConcepts:
        keywords.length > 0
          ? keywords.slice(0, 3).map((kw) => ({
              concept: kw,
              weightPercentage: Math.round(100 / Math.min(keywords.length, 3)),
              description: `Pemahaman mengenai ${kw}`,
            }))
          : [{ concept: 'Konsep dasar materi', weightPercentage: 100 }],
      correctVariations: variations,
      commonMistakes: [
        { pattern: 'tidak tahu', scorePercentage: 0, reason: 'Tidak menjawab materi soal.' },
        { pattern: 'skip', scorePercentage: 0, reason: 'Tidak menjawab materi soal.' },
        { pattern: 'kurang paham', scorePercentage: 0, reason: 'Tidak menjawab materi soal.' },
      ],
      summaryExplanation: `Evaluasi materi berdasarkan kesesuaian konsep: ${key}.`,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Helper to derive reasonable key text from question if no teacher key exists
   */
  private static generateKeyFromQuestion(questionText: string): string {
    const cleaned = (questionText || '').trim();
    if (!cleaned) return 'Jawaban ideal sesuai materi soal.';
    const words = cleaned.split(/\s+/);
    if (words.length <= 6) return cleaned;
    return 'Jawaban komprehensif sesuai pertanyaan';
  }

  /**
   * Evaluates student's essay answer using AI and pre-computed matrix
   */
  public static async gradeEssayWithAI(
    questionText: string,
    studentAnswer: string | undefined,
    answerKey: string | undefined,
    maxPoints: number,
    essayAiRubric?: EssayAiRubric
  ): Promise<EssayGradeResult> {
    const rawAnswer = (studentAnswer || '').trim();

    // If student left the answer empty
    if (!rawAnswer) {
      return {
        score: 0,
        matchPercentage: 0,
        matchedKeywords: [],
        totalKeywordsCount: 0,
        feedback: 'Jawaban uraian kosong / tidak diisi peserta.',
        aiGraded: true,
        conceptualStrengths: [],
        missingConcepts: ['Jawaban tidak diisi'],
      };
    }

    const studentNormalized = this.normalizeText(rawAnswer);
    const compactStudent = this.compactSyntax(rawAnswer);

    // =========================================================================
    // PHASE 1: ULTRA-FAST 0ms PRE-COMPUTED MATRIX MATCHER
    // If the rubric has pre-calculated correct variations or predicted common mistakes,
    // we can grade with 100% laser precision immediately!
    // =========================================================================
    const isProg = this.isFullProgrammingProblem(questionText, answerKey || essayAiRubric?.idealAnswer);

    if (essayAiRubric) {
      // 1. Check Correct Variations (Instant 100% Score)
      // STRICT GUARD: For full programming problems, NEVER match a 1-liner or short variation!
      if (!isProg && Array.isArray(essayAiRubric.correctVariations)) {
        for (const variation of essayAiRubric.correctVariations) {
          // Never match if variation pattern is a single-statement while student answer is multi-line
          if (
            variation.pattern.length < 50 &&
            (rawAnswer.length > 50 || rawAnswer.includes('\n'))
          ) {
            continue;
          }

          const varNorm = this.normalizeText(variation.pattern);
          const varCompact = this.compactSyntax(variation.pattern);

          if (
            studentNormalized === varNorm ||
            compactStudent === varCompact ||
            this.isSyntaxEquivalent(compactStudent, varCompact) ||
            this.isPhpOrCliEquivalent(rawAnswer, variation.pattern)
          ) {
            return {
              score: maxPoints,
              matchPercentage: 100,
              matchedKeywords: [variation.pattern],
              totalKeywordsCount: essayAiRubric.keyConcepts?.length || 1,
              feedback: `[Kunci Matriks AI] Sintaks/Jawaban tepat sempurna: ${variation.pattern}`,
              aiGraded: true,
              conceptualStrengths: essayAiRubric.keyConcepts?.map((k) => k.concept) || [variation.pattern],
              missingConcepts: [],
            };
          }
        }
      }

      // 2. Check Common Mistakes / Partial Credit (Instant Calibrated Score)
      // 0. Check Ideal Answer or Teacher Key Exact / Semantic Equivalence
      const keyToMatch = answerKey || essayAiRubric?.idealAnswer;
      if (keyToMatch && keyToMatch.trim().length > 10) {
        const studentNormCode = this.normalizePhpOrCliCode(rawAnswer);
        const keyNormCode = this.normalizePhpOrCliCode(keyToMatch);
        if (studentNormCode === keyNormCode && studentNormCode.length > 10) {
          return {
            score: maxPoints,
            matchPercentage: 100,
            matchedKeywords: ['Logika PHP Sesuai Kunci Model'],
            totalKeywordsCount: essayAiRubric?.keyConcepts?.length || 4,
            feedback: this.isPhpFormQuestion(questionText, answerKey)
              ? '[Koreksi Koding] Logika pemrosesan form PHP berhasil memenuhi semua ketentuan instruksi dengan tepat dan valid.'
              : '[Koreksi Koding] Program PHP CLI berhasil memenuhi semua ketentuan instruksi dengan tepat dan logis.',
            aiGraded: true,
            conceptualStrengths: essayAiRubric?.keyConcepts?.map((k) => k.concept) || ['Struktur logika PHP tepat sempurna'],
            missingConcepts: [],
          };
        }
      }

      // Only match if student answer is explicitly equivalent to mistake pattern, NEVER via broad substring
      if (Array.isArray(essayAiRubric.commonMistakes)) {
        for (const mistake of essayAiRubric.commonMistakes) {
          const misNorm = this.normalizeText(mistake.pattern);
          const misCompact = this.compactSyntax(mistake.pattern);

          if (
            studentNormalized === misNorm ||
            compactStudent === misCompact
          ) {
            const calculatedScore = Math.round(maxPoints * (mistake.scorePercentage / 100));
            return {
              score: calculatedScore,
              matchPercentage: mistake.scorePercentage,
              matchedKeywords: [],
              totalKeywordsCount: essayAiRubric.keyConcepts?.length || 1,
              feedback: `[Koreksi Otomatis] ${mistake.reason}`,
              aiGraded: true,
              conceptualStrengths: mistake.scorePercentage >= 50 ? ['Struktur dasar sebagian sudah dipahami'] : [],
              missingConcepts: [mistake.reason],
            };
          }
        }
      }
    }

    // =========================================================================
    // PHASE 2: GEMINI AI CONTEXTUAL & LOGICAL EVALUATION
    // Prioritize logical correctness, reasoning, and conceptual coherence
    // rather than strict literal matching to teacher's answer key.
    // =========================================================================
    try {
      let rubricContext = '';
      if (essayAiRubric && essayAiRubric.idealAnswer && !essayAiRubric.idealAnswer.toLowerCase().includes('jawaban komprehensif')) {
        rubricContext = `\nReferensi Konsep Ideal (Sebagai Panduan Konteks, BUKAN Kunci Kaku):\n"""${essayAiRubric.idealAnswer}"""\n`;
      }

      const isForm = this.isPhpFormQuestion(questionText, answerKey || essayAiRubric?.idealAnswer);
      const isCode = this.isPhpOrCliCodeQuestion(questionText, answerKey || essayAiRubric?.idealAnswer);

      let prompt = '';
      if (isForm) {
        prompt = `Anda adalah instruktur pemrograman IT dan penguji sertifikasi kompetensi rekayasa perangkat lunak (RPL / Web Backend PHP).
Tugas Anda adalah menilai kode logika PHP pemrosesan FORM HTML dari siswa secara SANGAT PRESISI, ADIL, DAN MENDIDIK BERDASARKAN LOGIKA KOMPUTASI DAN SINTAKS PHP.

Pertanyaan Ujian:
"""${questionText}"""

${answerKey && answerKey.trim() && !answerKey.toLowerCase().includes('jawaban komprehensif') ? `Referensi Kunci Guru/Model: """${answerKey.trim()}"""\n` : ''}${rubricContext}
Jawaban Peserta Ujian:
"""${rawAnswer}"""

Bobot Nilai Maksimal: ${maxPoints} Poin

PETUNJUK PENILAIAN WAJIB UNTUK SOAL LOGIKA PHP BERBASIS FORM HTML:
1. SUMBER INPUT ADALAH FORM HTML ($_POST / $_GET):
   - Siswa harus memeriksa pengiriman form (misal: if (isset($_POST['...'])) atau pemeriksaan tombol submit atau method form).
   - Nilai diambil dari form melalui superglobal $_POST (atau $_GET), misal $_POST['nama'], $_POST['nilai'], $_POST['belanja'], atau array $_POST['nilai'].
   - JANGAN PERNAH menuntut atau mengharapkan readline() atau input terminal STDIN, karena ini adalah aplikasi Form Web!

2. ATURAN EMAS: TOLERANSI PENUH TERHADAP NAMA VARIABEL & VARIASI GAYA KODING SISWA:
   - Kunci guru/model HANYA SALAH SATU CONTOH IMPLEMENTASI. JANGAN SEKALI-KALI terpaku atau membandingkan nama variabel dengan kunci jawaban guru!
   - Siswa BERHAK dan SANGAT SERING menggunakan nama variabel yang berbeda:
     * Soal Predikat: $nilai, $skor, $score, $angka, $n, $predikat, $pred, $grade, $hasil, $kategori, dll.
     * Soal Beasiswa: $nilai, $skor, $penghasilan, $gaji, $income, $pelanggaran, $sp, $poin, $hasil, $status, dll.
     * Soal Diskon: $belanja, $total, $tot, $subtotal, $member, $is_member, $status, $diskon, $potongan, $persen, $bayar, $total_bayar, dll.
     * Soal Total Harga Barang: $harga1..$harga4, $daftar_harga, $arr, $items, $total, $subtotal, $diskon, $potongan, $total_bayar, dll.
     * Soal Rekap Nilai: $daftar_nama, $daftar_nilai, $siswa, $data, $nama, $nilai, $lulus, $total_lulus, $jumlah_lulus, $counter, dll.
   - DILARANG KERAS mengurangi nilai hanya karena siswa memakai nama variabel yang berbeda!
   - Berikan NILAI PENUH (${maxPoints} Poin, 100%) jika kode siswa berhasil menjalankan seluruh tugas dan ketentuan soal dengan benar:
     * Mengambil data form ($_POST).
     * Struktur percabangan/perulangan tepat (if/elseif/else, for, foreach).
     * Operator logika dan perbandingan tepat (&&, >=, <=, ==).
     * Perhitungan matematika / diskon / counter akumulasi tepat.
     * Sintaks PHP valid dan tidak ada parse error fatal.
     * Output data ditampilkan (echo/print).
     * Tag pembuka '<?php' dan penutup '?>' bersifat opsional jika siswa hanya menuliskan bagian logika.
     * Format output bebas menggunakan tanda kutip tunggal ('') atau ganda (""), dengan atau tanpa tag <br>.

3. VALIDITAS SINTAKS PHP:
   - Cek kesalahan sintaks fatal PHP (parse error): tanda kutip string yang tidak berpasangan, tanda kurung kurawal/siku yang tidak tertutup, atau operator rusak (misal: "&& ==").
   - Jika kode siswa mengalami SYNTAX / PARSE ERROR FATAL (sehingga tidak dapat dieksekusi sama sekali oleh PHP), berikan nilai maksimal 15% - 25% (skor sangat rendah) dan jelaskan kesalahan sintaksnya.
   - Jika sintaks valid tapi terdapat kekurangan logika (misal: lupa satu cabang kondisi atau salah rumus), berikan skor parsial proporsional (40% - 80%).

4. SKORING & FEEDBACK:
   - NILAI PENUH (${maxPoints} Poin, 100%): Logika form lengkap, kalkulasi/perulangan tepat, sintaks PHP valid (apapun nama variabel yang dipilih siswa).
   - NILAI PARSIAL (50% - 85%): Logika utama jalan tapi ada detail kecil terlewat (misal: belum memvalidasi nilai luar rentang atau salah satu opsi terlewat).
   - NILAI PARSIAL RENDAH (15% - 30%): Hanya mengambil input form tanpa logika/perulangan yang diminta, atau kode ada parse error fatal.
   - KOSONG / MENYERAH: 0 Poin.

Format Output JSON Wajib:
- score: Angka skor dari 0 sampai ${maxPoints}
- matchPercentage: Persentase kesesuaian dari 0 sampai 100
- feedback: Ulasan evaluasi teknis ringkas dan mendidik dalam bahasa Indonesia (1-2 kalimat)
- conceptualStrengths: Array string poin-poin kode/perintah yang benar
- missingConcepts: Array string poin kekurangan teknis/sintaks`;
      } else if (isProg) {
        prompt = `Anda adalah instruktur pemrograman IT dan penguji sertifikasi kompetensi rekayasa perangkat lunak (RPL/Backend PHP).
Tugas Anda adalah menilai kode program PHP CLI dari siswa secara SANGAT PRESISI, ADIL, DAN TELITI BERDASARKAN KESESUAIAN DENGAN SEMUA KETENTUAN SOAL, LOGIKA KOMPUTASI, DAN SINTAKS PHP.

Pertanyaan Ujian:
"""${questionText}"""

${answerKey && answerKey.trim() && !answerKey.toLowerCase().includes('jawaban komprehensif') ? `Referensi Kunci Guru/Model: """${answerKey.trim()}"""\n` : ''}${rubricContext}
Jawaban Peserta Ujian:
"""${rawAnswer}"""

Bobot Nilai Maksimal: ${maxPoints} Poin

PETUNJUK PENILAIAN WAJIB & KETAT UNTUK SOAL PEMROGRAMAN LENGKAP:
1. EKSTRAK SEMUA KETENTUAN DARI SOAL:
   - Identifikasi semua input yang wajib dibaca (misal readline() untuk username & password, panjang & lebar, atau jenjang sekolah).
   - Identifikasi struktur logika percabangan yang diminta (misal: if...else, if...elseif...else, operator &&, perbandingan case-insensitive, atau perulangan).
   - Identifikasi rumus / kalkulasi perhitungan matematika (bila diminta). Jika soal TIDAK meminta rumus (seperti soal login akun atau penentuan warna seragam), JANGAN menuntut rumus luas!
   - Identifikasi output yang diminta (pesan sukses/gagal, level akun, jenis bangun, warna seragam, dsb).
   - Identifikasi penanganan kondisi fallback / input tidak valid (misal: "Jika username atau password salah", "Jika input tidak sesuai").
2. EVALUASI SINTAKS & VALIDITAS PHP:
   - Cek kesalahan sintaks fatal PHP (parse error): tanda kutip string yang tidak berpasangan, tanda kurung kurawal/siku yang tidak tertutup, kesalahan sintaks operator seperti "&& ==", atau "else if" tanpa kurung kurawal penutup sebelumnya.
   - PENTING: Jika kode siswa mengalami SYNTAX / PARSE ERROR FATAL (sehingga tidak dapat dieksekusi sama sekali oleh PHP), BERIKAN NILAI MAKSIMAL 15% - 25% (Skor sangat rendah). DILARANG KERAS memberikan nilai tinggi apalagi nilai penuh pada kode yang sintaksnya rusak!
   - Jika siswa sama sekali TIDAK MEMBACA INPUT menggunakan readline() padahal diminta, berikan skor 0 pada komponen input.
   - Jika siswa tidak mengimplementasikan percabangan yang diminta atau salah menguji kondisi, kurangi nilai secara signifikan.
3. ATURAN SKORING:
   - NILAI PENUH (${maxPoints} Poin, 100%): HANYA jika program benar, logis, memenuhi semua ketentuan instruksi soal, dan sintaksnya valid.
   - NILAI PARSIAL RENDAH (10% - 25%): Jika kode mengalami Parse Error / Syntax Error fatal (seperti kutip string rusak, kurung siku tidak tertutup), atau instruksi utama tidak dikerjakan. Jangan pernah memberi nilai tinggi jika kode tidak bisa dieksekusi dan ada parse error!
   - LOGIKA SEBAGIAN BENAR (40% - 60%): Sebagian instruksi dikerjakan (misal: input benar tapi cabang role/kondisi belum lengkap).
   - KOSONG / MENYERAH: 0 Poin.
4. FEEDBACK: Jelaskan secara spesifik letak kesalahan sintaks dan poin instruksi soal mana saja yang belum dikerjakan.

Format Output JSON Wajib:
- score: Angka skor dari 0 sampai ${maxPoints}
- matchPercentage: Persentase kesesuaian dari 0 sampai 100
- feedback: Ulasan evaluasi teknis ringkas dan mendidik dalam bahasa Indonesia (1-2 kalimat)
- conceptualStrengths: Array string poin-poin kode/perintah yang benar
- missingConcepts: Array string poin kekurangan teknis/sintaks`;
      } else if (isCode) {
        prompt = `Anda adalah instruktur pemrograman senior dan penguji sertifikasi kompetensi IT (spesialisasi PHP, CLI Scripting, & Backend Development).
Tugas Anda adalah menilai jawaban kode atau perintah CLI PHP dari peserta secara SANGAT PRESISI, ADIL, DAN MENDALAM BERDASARKAN LOGIKA KOMPUTASI.

Pertanyaan Ujian:
"""${questionText}"""

${answerKey && answerKey.trim() && !answerKey.toLowerCase().includes('jawaban komprehensif') ? `Referensi Kunci Guru/Model: """${answerKey.trim()}"""\n` : ''}${rubricContext}
Jawaban Peserta Ujian:
"""${rawAnswer}"""

Bobot Nilai Maksimal: ${maxPoints} Poin

PETUNJUK PENILAIAN PRESISI KODING & CLI PHP:
1. VALIDITAS TEKNIS & EKUIVALENSI LOGIKA (SEMANTIC EQUIVALENCE):
   - Jika peserta menjawab dengan sintaks/perintah alternatif yang SECARA TEKNIS SAH DAN BERFUNGSI DI PHP/CLI untuk menyelesaikan instruksi soal, BERIKAN NILAI PENUH (${maxPoints} Poin, 100%).
   - Ekuivalensi umum yang WAJIB dianggap benar 100%:
     * Input Terminal: readline("...") ekuivalen dengan trim(fgets(STDIN)) atau fgets(STDIN).
     * Web Server Bawaan CLI: "php -S localhost:8000", "php -S 127.0.0.1:8000", "php -S 0.0.0.0:8000" adalah ekuivalen.
     * Cek Sintaks (Lint): "php -l nama_file.php" ekuivalen dengan "php --syntax-check nama_file.php".
     * Argumen CLI: $argv[1] untuk argumen pertama, atau iterasi foreach ($argv).
     * Output CLI: echo $x . PHP_EOL, echo "$x\\n", atau echo $x;
     * Database: OOP ($conn = new mysqli(...)) atau prosedural (mysqli_connect(...)) atau PDO.
2. TOLERANSI SINTAKS RINGAN:
   - Tag pembuka '<?php' dan penutup '?>' bersifat opsional jika soal meminta potongan kode/perintah baris tunggal. Baik menyertakan tag ataupun tidak, nilainya tetap sama tingginya.
   - Perbedaan tanda kutip tunggal ('') vs ganda ("") tidak boleh mengurangi nilai kecuali berhubungan dengan interpolasi variabel.
   - Tanda titik koma (;) di baris terakhir atau spasi/indentasi tidak boleh mengurangi nilai.
   - Nama variabel bebas (misal peserta memakai $nama, $input, $data, $val) selama alur program logis dan tepat.
3. SKORING TEKNIS & SISTEMATIS:
   - TEPAT & BERFUNGSI SEMPURNA: Menghasilkan output atau menjalankan tugas yang diminta -> Berikan Nilai Penuh (${maxPoints} Poin, 100%).
   - LOGIKA BENAR DENGAN KEKELIRUAN SANGAT KECIL (misal: typo 1 karakter nama fungsi standar atau kurang tanda kutip pada string CLI tapi perintah utamanya benar) -> Berikan 80% - 95% dari ${maxPoints} Poin.
   - LOGIKA SEBAGIAN BENAR (misal: menulis 'php localhost:8000' tanpa flag '-S', atau memanggil readline() tanpa ditampung variabel) -> Berikan 50% - 75% dari ${maxPoints} Poin.
   - SINTAKS MENYIMPANG / BAHASA LAIN (misal: sintaks Python 'input()', Java 'System.out.println', atau perintah yang tidak ada di PHP/CLI) -> Berikan 10% - 30% dari ${maxPoints} Poin.
   - KOSONG / MENYERAH (misal: "tidak tahu", "skip", teks acak) -> Berikan 0 Poin.

Format Output JSON Wajib:
- score: Angka skor dari 0 sampai ${maxPoints}
- matchPercentage: Persentase kesesuaian dari 0 sampai 100
- feedback: Ulasan evaluasi teknis ringkas dan mendidik dalam bahasa Indonesia (1-2 kalimat)
- conceptualStrengths: Array string poin-poin kode/perintah yang benar
- missingConcepts: Array string poin kekurangan teknis (bila ada)`;
      } else {
        prompt = `Anda adalah penilai ujian profesional dan adil berbasis AI.
TUGAS UTAMA: Periksa apakah jawaban peserta LOGIS, MASUK AKAL, dan SESUAI SUBSTANSI PERTANYAAN, BUKAN mencocokkan kata demi kata dengan kunci jawaban.

Pertanyaan Ujian:
"""${questionText}"""

${answerKey && answerKey.trim() && !answerKey.toLowerCase().includes('jawaban komprehensif') ? `Konteks/Referensi Guru (Hanya sebagai acuan materi, peserta tidak wajib memakai kata yang sama): """${answerKey.trim()}"""\n` : ''}${rubricContext}
Jawaban Peserta Ujian:
"""${rawAnswer}"""

Bobot Nilai Maksimal: ${maxPoints} Poin

PRINSIP PENILAIAN DENGAN TOLERANSI TINGGI (LOGICAL & CONTEXTUAL EVALUATION):
1. UTAMAKAN KELOGISAN & HUBUNGAN DENGAN SOAL:
   - Cek hubungan sebab-akibat dan logika antara soal dan jawaban peserta.
   - Apakah jawaban peserta masuk akal, menjawab inti pertanyaan, atau memberikan penjelasan/contoh yang benar dalam dunia nyata/praktek?
   - Jika peserta menggunakan kalimat, sudut pandang, sinonim, analogi, atau gaya bahasa sendiri namun substansinya benar dan logis, BERIKAN NILAI MAKSIMAL (${maxPoints}) atau sangat tinggi (${Math.round(maxPoints * 0.85)} - ${maxPoints}). JANGAN kurangi nilai hanya karena tidak ada kata yang persis dengan kunci.
2. TOLERANSI FORMAT & PENULISAN:
   - Toleransi kesalahan ketik ringan (typo), ejaan santai, singkatan lazim (misal: "yg", "dg", "tdk", "bisa", "krn"), atau gaya penulisan informal siswa.
   - Jika soal meminta kode/sintaks/perintah dan siswa menjawab logika perintahnya dengan benar atau formatnya dapat dipahami, berikan apresiasi nilai tinggi.
3. SKALA PENILAIAN BERDASARKAN LOGIKA JAWABAN:
   - SANGAT LOGIS & LENGKAP: Menjawab substansi pertanyaan dengan alasan/contoh yang logis -> Nilai Penuh (${maxPoints} Poin).
   - LOGIS TAPI RINGKAS: Konsep dasarnya benar dan masuk akal meskipun singkat -> Nilai 70% - 90% dari ${maxPoints} Poin.
   - SEBAGIAN BENAR / LOGIKA KURANG TUNTAS: Ada pemahaman materi yang benar tapi ada bagian yang kurang tepat -> Nilai 40% - 60% dari ${maxPoints} Poin.
   - TIDAK LOGIS / MENYIMPANG DARI MATERI: Menjawab sesuatu yang salah secara materi atau tidak berhubungan dengan pertanyaan -> Nilai 10% - 30% dari ${maxPoints} Poin.
   - TIDAK MENJAWAB / MENYERAH: Hanya menulis "tidak tahu", "skip", "ga tau", "ok", "titik", atau teks kosong/acak tanpa usaha -> Berikan 0 Poin.

Format Output JSON Wajib:
- score: Angka skor dari 0 sampai ${maxPoints}
- matchPercentage: Persentase kesesuaian dari 0 sampai 100
- feedback: Ulasan evaluasi yang edukatif, hangat, dan mengapresiasi pemahaman logika siswa dalam Bahasa Indonesia (1-2 kalimat)
- conceptualStrengths: Array string poin-poin logika/konsep baik yang disampaikan peserta
- missingConcepts: Array string hal yang dapat diperdalam/disempurnakan (bila ada)`;
      }

      const aiResult = await this.executeGeminiWithFallback<EssayGradeResult>(
        'gradeEssayWithAI',
        async (ai, model) => {
          const aiCallPromise = ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              systemInstruction:
                'Anda adalah instruktur IT dan perancang evaluasi ujian CBT yang sangat presisi, adil, dan objektif.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  score: {
                    type: Type.NUMBER,
                    description: `Nilai poin antara 0 sampai ${maxPoints}`,
                  },
                  matchPercentage: {
                    type: Type.NUMBER,
                    description: 'Persentase kesesuaian 0-100',
                  },
                  feedback: {
                    type: Type.STRING,
                    description: 'Ulasan evaluasi ringkas dalam bahasa Indonesia',
                  },
                  conceptualStrengths: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Daftar konsep yang tepat dijawab',
                  },
                  missingConcepts: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Daftar konsep yang belum lengkap',
                  },
                },
                required: ['score', 'matchPercentage', 'feedback'],
              },
            },
          });

          // Timeout protection: 12000ms per model attempt to ensure thorough code evaluation
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('AI grading timeout exceeded')), 12000)
          );

          const response = await Promise.race([aiCallPromise, timeoutPromise]);
          const rawJson = response.text?.trim();
          if (!rawJson) throw new Error('Empty AI grade response');

          const parsed = JSON.parse(rawJson);
          const rawScore = typeof parsed.score === 'number' ? parsed.score : 0;
          const score = Math.max(0, Math.min(maxPoints, Math.round(rawScore)));
          const matchPercentage =
            typeof parsed.matchPercentage === 'number'
              ? Math.max(0, Math.min(100, Math.round(parsed.matchPercentage)))
              : Math.round((score / maxPoints) * 100);

          return {
            score,
            matchPercentage,
            matchedKeywords: parsed.conceptualStrengths || [],
            totalKeywordsCount: (parsed.conceptualStrengths?.length || 0) + (parsed.missingConcepts?.length || 0),
            feedback: `[AI Gemini] ${parsed.feedback || 'Jawaban telah dievaluasi oleh Gemini AI.'}`,
            aiGraded: true,
            conceptualStrengths: parsed.conceptualStrengths || [],
            missingConcepts: parsed.missingConcepts || [],
          };
        }
      );

      return aiResult;
    } catch (err) {
      console.warn('Gemini AI grading encountered an error across models, using local fallback:', err);
    }

    // =========================================================================
    // PHASE 3: LOCAL HEURISTIC FALLBACK WITH SYNTAX & MATRIX INTELLIGENCE
    // =========================================================================
    if (isProg) {
      const progResult = this.evaluatePhpProgramSubmission(rawAnswer, questionText, maxPoints, essayAiRubric);
      return {
        ...progResult,
        aiGraded: true,
      };
    }

    const localResult = this.gradeEssayLocal(rawAnswer, answerKey || essayAiRubric?.idealAnswer, questionText, maxPoints, essayAiRubric);
    return {
      ...localResult,
      aiGraded: true,
    };
  }

  /**
   * Normalizes text for comparison (lowercasing, cleaning excessive punctuation/spaces)
   */
  private static normalizeText(text: string): string {
    return (text || '')
      .toLowerCase()
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[^\w\s\d\+\-\*\/\=\<\>\(\)\{\}\$\_\.\,\:\;\`\'\"]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Removes all whitespace from syntax/code for strict structural matching
   */
  private static compactSyntax(text: string): string {
    return (text || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .trim();
  }

  /**
   * Checks if two syntax strings are equivalent (handling minor formatting differences)
   */
  private static isSyntaxEquivalent(a: string, b: string): boolean {
    if (a === b) return true;
    const cleanA = a.replace(/["']/g, '"').replace(/;/g, '');
    const cleanB = b.replace(/["']/g, '"').replace(/;/g, '');
    return cleanA === cleanB;
  }

  /**
   * Extracts essential keywords or concept phrases from the teacher's answer key.
   */
  private static extractKeywords(key: string): string[] {
    if (!key || !key.trim()) return [];

    const parts = key.split(/[,;\n|/]+/).map(p => this.normalizeText(p)).filter(p => p.length >= 2);

    if (parts.length > 0) {
      return Array.from(new Set(parts));
    }

    return this.normalizeText(key)
      .split(/\s+/)
      .filter(w => w.length >= 3 && !['dan', 'atau', 'yang', 'untuk', 'dengan', 'pada', 'adalah', 'yaitu', 'dari', 'ke'].includes(w));
  }

  /**
   * Computes Levenshtein Distance for typo tolerance
   */
  private static levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  /**
   * Checks if a keyword is found in the student answer
   */
  private static isKeywordMatched(keyword: string, studentNormalized: string, studentTokens: string[]): boolean {
    if (studentNormalized.includes(keyword)) {
      return true;
    }

    const keyTokens = keyword.split(/\s+/).filter(t => t.length > 1);
    if (keyTokens.length > 1) {
      const allTokensFound = keyTokens.every(kt => studentNormalized.includes(kt));
      if (allTokensFound) return true;
    }

    if (keyTokens.length === 1 && keyword.length >= 4) {
      for (const token of studentTokens) {
        if (Math.abs(token.length - keyword.length) <= 2) {
          const dist = this.levenshteinDistance(keyword, token);
          const maxAllowedDist = keyword.length > 6 ? 2 : 1;
          if (dist <= maxAllowedDist) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Local heuristic fallback grading with code/syntax/emmet intelligence
   */
  public static gradeEssayLocal(
    studentAnswer: string | undefined,
    answerKey: string | undefined,
    questionText: string = '',
    maxPoints: number = 10,
    essayAiRubric?: EssayAiRubric
  ): EssayGradeResult {
    const rawAnswer = (studentAnswer || '').trim();
    if (!rawAnswer) {
      return {
        score: 0,
        matchPercentage: 0,
        matchedKeywords: [],
        totalKeywordsCount: 0,
        feedback: 'Jawaban uraian kosong / belum dijawab.',
        aiGraded: false,
        conceptualStrengths: [],
        missingConcepts: ['Jawaban kosong'],
      };
    }

    const studentNormalized = this.normalizeText(rawAnswer);
    const studentTokens = studentNormalized.split(/\s+/).filter(t => t.length >= 2);
    const nonAnswerKeywords = [
      'tidak tahu', 'tidak tau', 'nggak tahu', 'nggak tau', 'gak tahu', 'gak tau',
      'tdk tahu', 'tdk tau', 'ga tau', 'gatau', 'ndak tau', 'ora ngerti',
      'ok', 'oke', 'pass', 'skip', 'kosong', 'entah', 'blank', 'null', 'undefined',
      'tidak mengerti', 'kurang paham', 'belum belajar', 'asdf', 'test'
    ];

    if (nonAnswerKeywords.some(p => studentNormalized === p || studentNormalized.startsWith(p + ' '))) {
      return {
        score: 0,
        matchPercentage: 0,
        matchedKeywords: [],
        totalKeywordsCount: 0,
        feedback: 'Jawaban belum menjawab materi soal yang ditanyakan.',
        aiGraded: false,
        conceptualStrengths: [],
        missingConcepts: ['Materi belum dijawab'],
      };
    }

    // =========================================================================
    // PHP & CLI Coding Semantic Evaluator
    // =========================================================================
    if (this.isFullProgrammingProblem(questionText, answerKey || essayAiRubric?.idealAnswer)) {
      return this.evaluatePhpProgramSubmission(rawAnswer, questionText, maxPoints, essayAiRubric);
    }

    const isPhpCli = this.isPhpOrCliCodeQuestion(questionText, answerKey || essayAiRubric?.idealAnswer);
    if (isPhpCli) {
      // 1. Direct equivalence check against answer key or rubric variations
      if (answerKey && this.isPhpOrCliEquivalent(rawAnswer, answerKey)) {
        return {
          score: maxPoints,
          matchPercentage: 100,
          matchedKeywords: [answerKey],
          totalKeywordsCount: 1,
          feedback: `[Koreksi Koding] Perintah/sintaks PHP CLI valid dan berfungsi tepat.`,
          aiGraded: false,
          conceptualStrengths: ['Sintaks CLI/PHP tepat dan siap eksekusi'],
          missingConcepts: [],
        };
      }

      if (essayAiRubric?.correctVariations) {
        for (const varItem of essayAiRubric.correctVariations) {
          if (this.isPhpOrCliEquivalent(rawAnswer, varItem.pattern)) {
            return {
              score: maxPoints,
              matchPercentage: 100,
              matchedKeywords: [varItem.pattern],
              totalKeywordsCount: 1,
              feedback: `[Koreksi Koding] Sintaks PHP CLI sesuai variasi standar: ${varItem.pattern}`,
              aiGraded: false,
              conceptualStrengths: ['Sintaks CLI/PHP tepat sempurna'],
              missingConcepts: [],
            };
          }
        }
      }

      // 2. Command & Token Extraction for CLI PHP (single statement only!)
      const normStudentCode = this.normalizePhpOrCliCode(rawAnswer);
      const studentLines = rawAnswer.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);

      // Check server command
      if (
        studentLines.length <= 2 &&
        (normStudentCode.startsWith('php-s') ||
          (normStudentCode.startsWith('php') &&
            (normStudentCode.includes('localhost') || normStudentCode.includes('127.0.0.1'))))
      ) {
        const hasCapitalS = rawAnswer.includes('-S');
        const hasPort = /:(\d{4})/.test(rawAnswer);
        if (hasCapitalS && hasPort) {
          return {
            score: maxPoints,
            matchPercentage: 100,
            matchedKeywords: ['php -S', 'localhost/port'],
            totalKeywordsCount: 2,
            feedback: '[Koreksi Koding] Perintah web server bawaan PHP CLI tepat sempurna.',
            aiGraded: false,
            conceptualStrengths: ['Flag -S kapital web server', 'Binding host dan port'],
            missingConcepts: [],
          };
        } else if (hasPort) {
          const score = Math.round(maxPoints * 0.7);
          return {
            score,
            matchPercentage: 70,
            matchedKeywords: ['php', 'port'],
            totalKeywordsCount: 2,
            feedback: '[Koreksi Koding] Perintah hampir benar, namun flag server PHP CLI wajib huruf kapital (-S).',
            aiGraded: false,
            conceptualStrengths: ['Host dan port'],
            missingConcepts: ['Flag -S kapital'],
          };
        }
      }

      // Check readline / input (strictly single command!)
      if (
        studentLines.length <= 2 &&
        (normStudentCode.startsWith('readline(') ||
          (normStudentCode.startsWith('$') && normStudentCode.includes('=readline(')) ||
          normStudentCode.includes('fgets(stdin)'))
      ) {
        const hasVar = rawAnswer.includes('$') && rawAnswer.includes('=');
        const score = hasVar ? maxPoints : Math.round(maxPoints * 0.85);
        return {
          score,
          matchPercentage: hasVar ? 100 : 85,
          matchedKeywords: ['input cli', normStudentCode.includes('readline') ? 'readline' : 'stdin'],
          totalKeywordsCount: 2,
          feedback: hasVar
            ? '[Koreksi Koding] Pembacaan input terminal PHP CLI tepat sempurna.'
            : '[Koreksi Koding] Fungsi pembacaan input terminal benar (disarankan menampung nilai ke variabel).',
          aiGraded: false,
          conceptualStrengths: ['Pemanggilan input stream terminal'],
          missingConcepts: hasVar ? [] : ['Variabel penampung hasil input'],
        };
      }

      // Check argv / argc (single statement)
      if (
        studentLines.length <= 2 &&
        (normStudentCode.includes('$argv[') || normStudentCode.includes('$argc'))
      ) {
        return {
          score: maxPoints,
          matchPercentage: 100,
          matchedKeywords: ['$argv'],
          totalKeywordsCount: 1,
          feedback: '[Koreksi Koding] Penggunaan argumen baris perintah $argv tepat.',
          aiGraded: false,
          conceptualStrengths: ['Array global $argv'],
          missingConcepts: [],
        };
      }

      // Check linting -l (single statement)
      if (
        studentLines.length <= 2 &&
        (normStudentCode.startsWith('php-l') || normStudentCode.startsWith('php--syntax-check'))
      ) {
        return {
          score: maxPoints,
          matchPercentage: 100,
          matchedKeywords: ['php -l'],
          totalKeywordsCount: 1,
          feedback: '[Koreksi Koding] Perintah lint / cek sintaks PHP CLI tepat.',
          aiGraded: false,
          conceptualStrengths: ['Flag linting php -l'],
          missingConcepts: [],
        };
      }
    }

    // Check for syntax/emmet patterns (e.g. .row>.col*3, div.container, SQL SELECT, HTML tags)
    const isCodeOrEmmet =
      rawAnswer.includes('>') ||
      rawAnswer.includes('*') ||
      rawAnswer.includes('.') ||
      rawAnswer.includes('#') ||
      rawAnswer.includes(';') ||
      rawAnswer.includes('{') ||
      rawAnswer.includes('<') ||
      rawAnswer.includes('$') ||
      rawAnswer.includes('=');

    const qNormalized = this.normalizeText(questionText);

    // ONLY check Emmet specific syntax if the question explicitly asks for Emmet
    if (
      qNormalized.includes('emmet') &&
      (rawAnswer.includes('>') || rawAnswer.includes('*') || rawAnswer.includes('+'))
    ) {
      const hasClassDot = rawAnswer.includes('.row') && (rawAnswer.includes('.col') || rawAnswer.includes('.col*'));
      if (hasClassDot) {
        return {
          score: maxPoints,
          matchPercentage: 100,
          matchedKeywords: ['.row', '.col', 'Emmet Bootstrap Grid'],
          totalKeywordsCount: 2,
          feedback: 'Sintaks Emmet pembungkus baris dan kolom tepat sempurna.',
          aiGraded: false,
          conceptualStrengths: ['Sintaks Emmet class .row', 'Perkalian kolom class .col'],
          missingConcepts: [],
        };
      } else if (!rawAnswer.includes('.')) {
        // Missing class dot prefix
        const partialScore = Math.round(maxPoints * 0.4);
        return {
          score: partialScore,
          matchPercentage: 40,
          matchedKeywords: ['Struktur hirarki emmet'],
          totalKeywordsCount: 2,
          feedback: 'Sintaks Emmet kurang tepat: Untuk class Bootstrap harus diawali tanda titik (.). Tanpa titik, Emmet akan menghasilkan tag kustom bukannya class CSS.',
          aiGraded: false,
          conceptualStrengths: ['Struktur hierarki row dan col'],
          missingConcepts: ['Tanda titik (.) untuk class Bootstrap'],
        };
      }
    }

    // If the question or student answer involves PHP/CLI code, always route to structured code evaluation
    // to prevent invalid syntax or incomplete code from getting inflated text tolerance scores!
    if (isPhpCli || this.isPhpOrCliCodeQuestion(questionText, answerKey) || rawAnswer.includes('<?php') || rawAnswer.includes('readline')) {
      return this.evaluatePhpProgramSubmission(rawAnswer, questionText, maxPoints, essayAiRubric);
    }

    const rawKey = (answerKey || '').trim();
    const isGenericPlaceholder =
      !rawKey ||
      rawKey.toLowerCase().includes('jawaban komprehensif') ||
      rawKey.toLowerCase().includes('jawaban ideal') ||
      rawKey.toLowerCase().includes('sesuai materi') ||
      rawKey.toLowerCase().includes('sesuai pertanyaan');

    if (isGenericPlaceholder) {
      // Extract relevant domain keywords from question text to check relevance
      const qKeywords = this.extractKeywords(questionText).filter(
        kw => !['mengapa', 'bagaimana', 'jelaskan', 'berikan', 'contoh', 'contohnya', 'fungsi', 'perbedaan', 'kode', 'berikut'].includes(kw.toLowerCase())
      );

      const matchedQKeywords = qKeywords.filter(kw => this.isKeywordMatched(kw, studentNormalized, studentTokens));
      const wordCount = rawAnswer.split(/\s+/).length;

      let ratio = 0.5;
      if (wordCount >= 20) ratio = 0.9;
      else if (wordCount >= 12) ratio = 0.8;
      else if (wordCount >= 6) ratio = 0.7;
      else ratio = 0.5;

      // Bonus if technical keywords from question are matched
      if (matchedQKeywords.length > 0) {
        ratio = Math.min(1.0, ratio + matchedQKeywords.length * 0.05);
      }

      const score = Math.max(1, Math.round(maxPoints * ratio));
      return {
        score,
        matchPercentage: Math.round(ratio * 100),
        matchedKeywords: matchedQKeywords,
        totalKeywordsCount: Math.max(1, qKeywords.length),
        feedback: `Koreksi otomatis kelengkapan jawaban (${wordCount} kata, konsep relevan terdeteksi).`,
        aiGraded: false,
        conceptualStrengths: matchedQKeywords.length > 0 ? matchedQKeywords : ['Penjelasan memadai sesuai konteks soal'],
        missingConcepts: [],
      };
    }

    const keyNormalized = this.normalizeText(rawKey);

    if (studentNormalized === keyNormalized || this.isPhpOrCliEquivalent(rawAnswer, rawKey)) {
      return {
        score: maxPoints,
        matchPercentage: 100,
        matchedKeywords: [keyNormalized],
        totalKeywordsCount: 1,
        feedback: 'Jawaban tepat sempurna sesuai kunci jawaban.',
        aiGraded: false,
      };
    }

    const keywords = this.extractKeywords(rawKey);

    // Extract core question terms as context tolerance
    const qKeywords = this.extractKeywords(questionText).filter(
      kw => !['mengapa', 'bagaimana', 'jelaskan', 'berikan', 'contoh', 'contohnya', 'fungsi', 'perbedaan', 'kode', 'berikut'].includes(kw.toLowerCase())
    );
    const matchedQKeywords = qKeywords.filter(kw => this.isKeywordMatched(kw, studentNormalized, studentTokens));

    if (keywords.length === 0) {
      const tokenMatches = studentTokens.filter(st => keyNormalized.includes(st)).length;
      const keyTokenCount = keyNormalized.split(/\s+/).length;
      let ratio = keyTokenCount > 0 ? Math.min(1, tokenMatches / keyTokenCount) : 0.7;
      if (matchedQKeywords.length > 0) ratio = Math.max(ratio, 0.85);
      const score = Math.round(maxPoints * ratio);
      return {
        score,
        matchPercentage: Math.round(ratio * 100),
        matchedKeywords: matchedQKeywords,
        totalKeywordsCount: qKeywords.length || 1,
        feedback: `Kesesuaian konsep uraian ${Math.round(ratio * 100)}% (evaluasi konteks pertanyaan).`,
        aiGraded: false,
      };
    }

    const matchedKeywords: string[] = [];
    for (const kw of keywords) {
      if (this.isKeywordMatched(kw, studentNormalized, studentTokens)) {
        matchedKeywords.push(kw);
      }
    }

    const keywordMatchRatio = matchedKeywords.length / keywords.length;

    // Tolerance for logical answers: length, question relevance, and synonyms
    let toleranceBonus = 0;
    const answerWordCount = studentTokens.length;
    if (answerWordCount >= 15) toleranceBonus += 0.25;
    else if (answerWordCount >= 8) toleranceBonus += 0.15;

    if (matchedQKeywords.length > 0) {
      toleranceBonus += Math.min(0.25, matchedQKeywords.length * 0.1);
    }

    let finalRatio = Math.min(1.0, keywordMatchRatio + toleranceBonus);

    // If answer is coherent and matches major question context, give appropriate credit
    if (keywordMatchRatio >= 0.9) {
      finalRatio = 1.0;
    } else if (keywordMatchRatio >= 0.7) {
      finalRatio = Math.max(finalRatio, 0.85);
    }

    const calculatedScore = Math.max(1, Math.round(maxPoints * finalRatio));

    return {
      score: calculatedScore,
      matchPercentage: Math.round(finalRatio * 100),
      matchedKeywords: Array.from(new Set([...matchedKeywords, ...matchedQKeywords])),
      totalKeywordsCount: Math.max(keywords.length, matchedKeywords.length),
      feedback: `Evaluasi pemahaman konsep uraian ${Math.round(finalRatio * 100)}% (toleransi konteks & logika aktif).`,
      aiGraded: false,
    };
  }
}
