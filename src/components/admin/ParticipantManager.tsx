import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Key,
  Search,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Eye,
  X,
  AlertTriangle,
  Trash2,
  Unlock,
  Smartphone,
  CheckCircle2,
  FileSpreadsheet,
  Sparkles,
  ChevronDown,
  Download,
  Upload,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { api } from '../../services/api';
import { VaultStorage } from '../../services/vaultStorage';
import { User, ViolationLog } from '../../types/cbt';

export const ParticipantManager: React.FC = () => {
  const [participants, setParticipants] = useState<User[]>([]);
  const [violations, setViolations] = useState<ViolationLog[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedLogsParticipant, setSelectedLogsParticipant] = useState<User | null>(null);

  // Single Add Custom Participant Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newToken, setNewToken] = useState('');
  const [isSubmittingNew, setIsSubmittingNew] = useState(false);

  // Reset & Class Switch Modal State
  const [isResetClassModalOpen, setIsResetClassModalOpen] = useState(false);
  const [resetModalTab, setResetModalTab] = useState<'RESET_ONLY' | 'NEW_CLASS_GENERATE' | 'NEW_CLASS_PASTE'>('RESET_ONLY');
  const [isProcessingReset, setIsProcessingReset] = useState(false);

  // Class Generator inputs
  const [classPrefix, setClassPrefix] = useState('XII-RPL-1');
  const [classStudentCount, setClassStudentCount] = useState<number>(36);
  const [classTokenPrefix, setClassTokenPrefix] = useState('');

  // Paste / Import list
  const [pasteRawText, setPasteRawText] = useState('');
  const [clearPreviousClass, setClearPreviousClass] = useState(true);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Add Participant Dropdown toggle
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);

  const fetchParticipantsAndViolations = async () => {
    setIsLoading(true);
    try {
      const [pRes, vRes] = await Promise.all([
        api.get('/participants'),
        api.get('/violations'),
      ]);
      const serverParticipants: User[] = pRes.data.data || [];
      setParticipants(serverParticipants);
      VaultStorage.saveParticipants(serverParticipants);
      setViolations(vRes.data.data || []);
    } catch (e) {
      console.error('Gagal memuat peserta dari server/Cloudflare:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchParticipantsAndViolations();
  }, []);

  const handleCreateSingleParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newCode) return;
    setIsSubmittingNew(true);
    try {
      await api.post('/participants', {
        name: newName,
        participantCode: newCode,
        token: newToken || newCode,
      });
      setIsAddModalOpen(false);
      setNewName('');
      setNewCode('');
      setNewToken('');
      await fetchParticipantsAndViolations();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Gagal menambahkan peserta');
    } finally {
      setIsSubmittingNew(false);
    }
  };

  const handleGenerateBatch = async () => {
    setIsAddMenuOpen(false);
    try {
      await api.post('/participants/batch', { count: 10 });
      await fetchParticipantsAndViolations();
    } catch (e) {
      console.error(e);
    }
  };

  const handleUnlockSingleParticipant = async (participantId: string, name: string) => {
    try {
      const res = await api.post('/session/unlock-participant', { participantId });
      alert(res.data?.message || `Kunci perangkat "${name}" berhasil dibuka! Seluruh data pengerjaan ujian tetap aman tersimpan.`);
      if (selectedLogsParticipant?.id === participantId) {
        setSelectedLogsParticipant(null);
      }
      await fetchParticipantsAndViolations();
    } catch (e: any) {
      console.error('Gagal membuka kunci perangkat', e);
      alert(e.response?.data?.error || 'Gagal membuka kunci perangkat');
    }
  };

  const handleResetSingleParticipant = async (participantId: string, name: string) => {
    if (window.confirm(
      `Buka Kunci Perangkat untuk "${name}"?\n\n` +
      `✓ Kunci browser/perangkat akan dibuka sehingga siswa dapat login di perangkat baru.\n` +
      `✓ SELURUH DATA JAWABAN & SKOR SISWA TETAP AMAN (TIDAK DIHAPUS).\n\n` +
      `Lanjutkan buka kunci perangkat?`
    )) {
      try {
        const res = await api.post('/session/unlock-participant', { participantId });
        alert(res.data?.message || `Kunci perangkat "${name}" berhasil dibuka! Seluruh data jawaban tetap aman tersimpan.`);
        if (selectedLogsParticipant?.id === participantId) {
          setSelectedLogsParticipant(null);
        }
        await fetchParticipantsAndViolations();
      } catch (e: any) {
        console.error('Gagal membuka kunci perangkat peserta', e);
        alert(e.response?.data?.error || 'Gagal membuka kunci perangkat peserta');
      }
    }
  };

  const handleDeleteSingleParticipant = async (participantId: string, name: string) => {
    if (window.confirm(`Hapus akun peserta "${name}" secara permanen?`)) {
      try {
        await api.delete(`/participants/${participantId}`);
        VaultStorage.deleteParticipant(participantId);
        await fetchParticipantsAndViolations();
      } catch (e: any) {
        alert(e.response?.data?.error || 'Gagal menghapus peserta');
      }
    }
  };

  const handleUnlockAllDevices = async () => {
    if (window.confirm('Buka kunci (unlock) seluruh perangkat untuk semua peserta?\n\nPeserta yang berpindah laptop/komputer akan dapat langsung login kembali.')) {
      try {
        const res = await api.post('/session/unlock-devices', {});
        alert(res.data.message || 'Semua kunci perangkat berhasil dibuka!');
        await fetchParticipantsAndViolations();
      } catch (e: any) {
        alert(e.response?.data?.error || 'Gagal membuka kunci perangkat');
      }
    }
  };

  const handleClearAllParticipants = async () => {
    const count = participants.length;
    if (window.confirm(`PERINGATAN KERAS: Apakah Anda yakin ingin MENGHAPUS SELURUH ${count} PESERTA?\n\nSemua akun peserta, sesi ujian, dan log anticheat akan dihapus.`)) {
      try {
        const res = await api.post('/participants/clear-all', {});
        VaultStorage.saveParticipants([]);
        alert(res.data.message || 'Seluruh daftar peserta berhasil dikosongkan!');
        await fetchParticipantsAndViolations();
      } catch (e: any) {
        alert(e.response?.data?.error || 'Gagal mengosongkan peserta');
      }
    }
  };

  // Execution from Modal: Mode 1 (Reset Sesi Ujian untuk Kelas Berikutnya)
  const executeResetSessionsOnly = async () => {
    setIsProcessingReset(true);
    try {
      const res = await api.post('/session/reset-all', {
        examId: 'ALL',
        clearDeviceLocks: true,
      });
      alert(res.data.message || 'Semua sesi ujian berhasil di-reset untuk kelas baru!');
      setIsResetClassModalOpen(false);
      await fetchParticipantsAndViolations();
    } catch (e: any) {
      alert(e.response?.data?.error || 'Gagal mereset sesi ujian');
    } finally {
      setIsProcessingReset(false);
    }
  };

  // Execution from Modal: Mode 2 (Generate New Class Batch)
  const executeGenerateNewClass = async () => {
    if (!classPrefix.trim()) {
      alert('Nama/Prefix Kelas tidak boleh kosong');
      return;
    }
    const count = Math.max(1, Math.min(100, classStudentCount || 36));
    const items: Array<{ name: string; participantCode: string; token?: string }> = [];
    const prefixClean = classPrefix.trim().toUpperCase().replace(/\s+/g, '-');
    const tokenPrefixClean = (classTokenPrefix || prefixClean).trim().toUpperCase().replace(/[\/\-\_\s]/g, '');

    for (let i = 1; i <= count; i++) {
      const numStr = String(i).padStart(2, '0');
      items.push({
        name: `Siswa ${classPrefix} No ${numStr}`,
        participantCode: `${prefixClean}-${numStr}`,
        token: `${tokenPrefixClean}${numStr}`,
      });
    }

    setIsProcessingReset(true);
    try {
      const res = await api.post('/participants/import-class', {
        participants: items,
        clearExisting: clearPreviousClass,
      });
      alert(res.data.message || `Berhasil membuat kelas ${classPrefix} dengan ${items.length} peserta!`);
      setIsResetClassModalOpen(false);
      await fetchParticipantsAndViolations();
    } catch (e: any) {
      alert(e.response?.data?.error || 'Gagal membuat peserta kelas baru');
    } finally {
      setIsProcessingReset(false);
    }
  };

  // Parsed preview from pasted text or uploaded Excel/CSV
  const parsedPreview = React.useMemo(() => {
    if (!pasteRawText.trim()) return [];
    const lines = pasteRawText.split('\n').map((l) => l.trim()).filter(Boolean);
    const result: Array<{ name: string; participantCode: string; token: string }> = [];

    lines.forEach((line, idx) => {
      // Split by tab, comma, semicolon, or pipe
      const parts = line.split(/[,\t;|]/).map((p) => p.trim()).filter(Boolean);
      const numStr = String(idx + 1).padStart(2, '0');
      if (parts.length === 0) return;

      if (parts.length === 1) {
        // Name only provided -> auto-generate code and token
        result.push({
          name: parts[0],
          participantCode: `P${numStr}`,
          token: `P${numStr}`,
        });
      } else if (parts.length === 2) {
        // Could be [Nama, Token] (recommended) OR [Kode, Nama]
        const isPart0Code = !parts[0].includes(' ') && parts[1].includes(' ');
        if (isPart0Code) {
          result.push({
            name: parts[1],
            participantCode: parts[0].toUpperCase(),
            token: parts[0].toUpperCase(),
          });
        } else {
          // Standard: [Nama Siswa, Token Peserta]
          result.push({
            name: parts[0],
            participantCode: parts[1].toUpperCase(),
            token: parts[1].toUpperCase(),
          });
        }
      } else if (parts.length >= 3) {
        // Could be [Kode, Nama, Token] OR [Nama, Kode, Token]
        const isPart0Code = !parts[0].includes(' ') && parts[1].includes(' ');
        if (isPart0Code) {
          // [Kode, Nama, Token]
          result.push({
            participantCode: parts[0].toUpperCase(),
            name: parts[1],
            token: parts[2].toUpperCase(),
          });
        } else {
          // [Nama, Kode, Token]
          result.push({
            name: parts[0],
            participantCode: parts[1].toUpperCase(),
            token: parts[2].toUpperCase(),
          });
        }
      }
    });

    return result;
  }, [pasteRawText]);

  const handleDownloadTemplate = () => {
    const headers = ['Kode Peserta', 'Nama Siswa', 'Token Peserta'];
    const sampleRows = [
      ['RPL-01', 'Ahmad Subagyo', 'TKN001'],
      ['RPL-02', 'Budi Santoso', 'TKN002'],
      ['RPL-03', 'Citra Lestari', 'TKN003'],
      ['RPL-04', 'Dedi Kurniawan', 'TKN004'],
      ['RPL-05', 'Eka Rahmawati', 'TKN005'],
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
    ws['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template Siswa & Token');
    XLSX.writeFile(wb, 'Template_Impor_Siswa_dan_Token.xlsx');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
        if (!data || data.length === 0) {
          alert('Berkas Excel / CSV kosong');
          return;
        }

        // Header mapping
        const headerRow = (data[0] || []).map((h: any) => String(h || '').trim().toLowerCase());
        let nameIdx = headerRow.findIndex((h) => /nama|name|peserta|siswa/.test(h));
        let tokenIdx = headerRow.findIndex((h) => /token|pass|pin|kunci/.test(h));
        let codeIdx = headerRow.findIndex((h) => /kode|nis|nisn|id|username/.test(h));

        const hasHeader = nameIdx !== -1 || tokenIdx !== -1 || codeIdx !== -1;
        const startRow = hasHeader ? 1 : 0;

        if (!hasHeader) {
          if (data[0].length >= 3) {
            codeIdx = 0;
            nameIdx = 1;
            tokenIdx = 2;
          } else if (data[0].length === 2) {
            nameIdx = 0;
            tokenIdx = 1;
          } else {
            nameIdx = 0;
          }
        }

        const lines: string[] = [];
        for (let r = startRow; r < data.length; r++) {
          const row = data[r];
          if (!row || row.length === 0) continue;
          const nameVal = nameIdx !== -1 && row[nameIdx] !== undefined ? String(row[nameIdx]).trim() : '';
          const tokenVal = tokenIdx !== -1 && row[tokenIdx] !== undefined ? String(row[tokenIdx]).trim() : '';
          const codeVal = codeIdx !== -1 && row[codeIdx] !== undefined ? String(row[codeIdx]).trim() : '';

          if (!nameVal && !tokenVal && !codeVal) continue;

          if (codeVal && nameVal && tokenVal) {
            lines.push(`${codeVal}, ${nameVal}, ${tokenVal}`);
          } else if (nameVal && tokenVal) {
            lines.push(`${nameVal}, ${tokenVal}`);
          } else if (nameVal) {
            lines.push(nameVal);
          }
        }

        if (lines.length > 0) {
          setPasteRawText(lines.join('\n'));
        } else {
          alert('Tidak ditemukan data siswa yang valid pada berkas');
        }
      } catch (err) {
        console.error('Error membaca berkas excel:', err);
        alert('Gagal membaca berkas Excel/CSV. Pastikan format berkas valid.');
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  // Execution from Modal: Mode 3 (Paste / Import Siswa & Token)
  const executePasteNewClass = async () => {
    if (parsedPreview.length === 0) {
      alert('Silakan tempelkan data nama dan token siswa, atau unggah file Excel/CSV terlebih dahulu');
      return;
    }

    setIsProcessingReset(true);
    try {
      const res = await api.post('/participants/import-class', {
        participants: parsedPreview,
        clearExisting: clearPreviousClass,
      });
      alert(res.data.message || `Berhasil mengimpor ${parsedPreview.length} peserta dengan token!`);
      setIsResetClassModalOpen(false);
      setPasteRawText('');
      await fetchParticipantsAndViolations();
    } catch (e: any) {
      alert(e.response?.data?.error || 'Gagal mengimpor daftar peserta');
    } finally {
      setIsProcessingReset(false);
    }
  };

  const getParticipantViolations = (p: User): ViolationLog[] => {
    return violations.filter(
      (v) =>
        v.participantName.toLowerCase() === p.name.toLowerCase() ||
        (p.participantCode && v.participantCode === p.participantCode) ||
        (v.participantId && v.participantId === p.id)
    );
  };

  const filtered = participants.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.participantCode?.toLowerCase().includes(search.toLowerCase()) ||
      p.token?.toLowerCase().includes(search.toLowerCase())
  );

  const handleExportParticipantsExcel = () => {
    if (participants.length === 0) {
      alert('Belum ada data peserta untuk diekspor!');
      return;
    }

    const headers = [
      'No',
      'Kode Peserta',
      'Nama Peserta',
      'Token Akses',
      'Status Ujian',
      'Kunci Perangkat',
      'Total Pelanggaran',
    ];

    const rows = filtered.map((p, idx) => {
      const vCount = getParticipantViolations(p).length;
      const isLocked = !p.activeDeviceId;
      let statusText = 'Belum Mulai';
      if (p.activeStatus?.status === 'IN_PROGRESS') {
        statusText = 'Sedang Mengerjakan';
      } else if (p.activeStatus?.status === 'COMPLETED') {
        statusText = 'Selesai Ujian';
      }

      return [
        idx + 1,
        p.participantCode || `P${String(idx + 1).padStart(3, '0')}`,
        p.name,
        p.token || '-',
        statusText,
        isLocked ? 'Terkunci di Perangkat' : 'Bebas',
        vCount,
      ];
    });

    const worksheetData = [
      ['DAFTAR AKUN PESERTA & KREDENSIAL LOGIN CBT'],
      [`Tanggal Ekspor: ${new Date().toLocaleString('id-ID')}`],
      [`Total Peserta: ${filtered.length} Siswa`],
      [],
      headers,
      ...rows,
    ];

    const ws = XLSX.utils.aoa_to_sheet(worksheetData);
    ws['!cols'] = [
      { wch: 6 },
      { wch: 18 },
      { wch: 30 },
      { wch: 16 },
      { wch: 22 },
      { wch: 24 },
      { wch: 18 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Daftar Peserta');

    const safeDate = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Daftar_Peserta_CBT_${safeDate}.xlsx`);
  };

  const activeTestingCount = participants.filter(p => p.activeStatus?.status === 'IN_PROGRESS').length;
  const completedCount = participants.filter(p => p.activeStatus?.status === 'COMPLETED').length;
  const lockedDevicesCount = participants.filter(p => !p.activeDeviceId).length;

  return (
    <div className="space-y-6">
      {/* Header & Clean Toolbar */}
      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              Manajemen Peserta & Sesi Kelas
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Kelola akun peserta ujian, pantau status realtime, dan reset sesi untuk pergantian rombel kelas
            </p>
          </div>

          {/* Unified Structured Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* 1. Reset / Switch Class Button */}
            <button
              type="button"
              onClick={() => {
                setResetModalTab('RESET_ONLY');
                setIsResetClassModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-amber-300 dark:border-amber-800/80 bg-amber-50 hover:bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>Reset / Ganti Kelas</span>
            </button>

            {/* 2. Unlock Devices Button */}
            <button
              type="button"
              onClick={handleUnlockAllDevices}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-700/60 shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
              title="Buka kunci login browser/perangkat jika siswa berganti komputer"
            >
              <Unlock className="w-3.5 h-3.5 text-teal-600 shrink-0" />
              <span>Buka Kunci Perangkat</span>
            </button>

            {/* 3. Add Participant Dropdown Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
              >
                <UserPlus className="w-3.5 h-3.5 shrink-0" />
                <span>+ Tambah Peserta</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${isAddMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {isAddMenuOpen && (
                <div className="absolute right-0 mt-1 w-52 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl shadow-xl z-30 py-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      setResetModalTab('NEW_CLASS_PASTE');
                      setIsResetClassModalOpen(true);
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-zinc-800 flex items-center gap-2 text-slate-800 dark:text-zinc-200 font-medium cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-teal-600" />
                    <span>Impor Siswa & Token (Excel/Paste)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      setResetModalTab('NEW_CLASS_GENERATE');
                      setIsResetClassModalOpen(true);
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-zinc-800 flex items-center gap-2 text-slate-800 dark:text-zinc-200 font-medium cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Generate Rombel Kelas Baru</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddMenuOpen(false);
                      setIsAddModalOpen(true);
                    }}
                    className="w-full text-left px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-zinc-800 flex items-center gap-2 text-slate-800 dark:text-zinc-200 font-medium cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5 text-emerald-600" />
                    <span>+ Peserta Custom (Nama & Token)</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerateBatch}
                    className="w-full text-left px-3.5 py-2 hover:bg-slate-50 dark:hover:bg-zinc-800 flex items-center gap-2 text-slate-800 dark:text-zinc-200 font-medium cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    <span>+10 Peserta Cepat</span>
                  </button>
                </div>
              )}
            </div>

            {/* 4. Refresh Button */}
            <button
              type="button"
              onClick={fetchParticipantsAndViolations}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-700/60 shadow-2xs transition-colors cursor-pointer whitespace-nowrap"
              title="Perbarui data peserta"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 shadow-xs">
          <div className="text-[11px] font-medium text-slate-500">Total Akun Peserta</div>
          <div className="text-xl font-bold font-mono text-slate-900 dark:text-zinc-100 mt-0.5">
            {participants.length} Siswa
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/50 shadow-xs">
          <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">Sedang Mengerjakan</div>
          <div className="text-xl font-bold font-mono text-amber-700 dark:text-amber-400 mt-0.5">
            {activeTestingCount} Siswa
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-900/50 shadow-xs">
          <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Sudah Selesai Ujian</div>
          <div className="text-xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-0.5">
            {completedCount} Siswa
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200/70 dark:border-indigo-900/50 shadow-xs">
          <div className="text-[11px] font-medium text-indigo-700 dark:text-indigo-400">Perangkat Terkunci</div>
          <div className="text-xl font-bold font-mono text-indigo-700 dark:text-indigo-400 mt-0.5">
            {lockedDevicesCount} Terikat
          </div>
        </div>
      </div>

      {/* Filter and Table Tools */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative max-w-md w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama, kode peserta (P001/RPL01), atau token..."
            className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 placeholder:text-slate-400"
          />
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {participants.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleExportParticipantsExcel}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-800 px-3 py-1.5 rounded-xl transition-colors cursor-pointer whitespace-nowrap shadow-2xs"
                title="Unduh daftar akun dan token peserta ke Microsoft Excel (.xlsx)"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Ekspor Peserta (.xlsx)</span>
              </button>

              <button
                type="button"
                onClick={handleClearAllParticipants}
                className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 px-3 py-1.5 rounded-xl transition-colors cursor-pointer font-medium whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Kosongkan Peserta</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Participants DataTable */}
      <Card className="border-slate-200 dark:border-zinc-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-zinc-800/80 text-slate-500 border-b border-slate-200 dark:border-zinc-800 font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">No</th>
                <th className="px-4 py-3 whitespace-nowrap">Kode Peserta</th>
                <th className="px-4 py-3 whitespace-nowrap">Nama Peserta</th>
                <th className="px-4 py-3 whitespace-nowrap">Token Akses</th>
                <th className="px-4 py-3 whitespace-nowrap">Status Sesi</th>
                <th className="px-4 py-3 whitespace-nowrap">Kunci Device</th>
                <th className="px-4 py-3 whitespace-nowrap">Log Anticheat</th>
                <th className="px-4 py-3 text-right whitespace-nowrap">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    {participants.length === 0
                      ? 'Belum ada peserta terdaftar. Klik "+ Tambah Peserta" atau "Reset / Ganti Kelas" untuk mulai membuat akun kelas baru.'
                      : 'Tidak ditemukan peserta yang sesuai pencarian.'}
                  </td>
                </tr>
              ) : (
                filtered.map((p, index) => {
                  const pViolations = getParticipantViolations(p);
                  const violationCount = pViolations.length || p.activeStatus?.violationsCount || 0;
                  const isLocked = Boolean(p.activeDeviceId);

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-zinc-800/40 transition-colors">
                      <td className="px-4 py-3 text-slate-400 font-mono whitespace-nowrap">{index + 1}</td>
                      <td className="px-4 py-3 font-bold font-mono text-slate-900 dark:text-zinc-100 whitespace-nowrap">
                        {p.participantCode}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-zinc-200 whitespace-nowrap">{p.name}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-1 rounded border border-emerald-200 dark:border-emerald-800 font-bold">
                          {p.token}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {p.activeStatus?.status === 'IN_PROGRESS' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-800 shadow-xs">
                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                            <span>
                              Soal #{p.activeStatus.currentQuestionIndex} / {p.activeStatus.totalQuestions} ({p.activeStatus.answeredCount} Terjawab)
                            </span>
                          </span>
                        ) : p.activeStatus?.status === 'COMPLETED' ? (
                          <Badge variant="emerald" size="sm">
                            Selesai (Nilai {p.activeStatus.score}/{p.activeStatus.maxScore})
                          </Badge>
                        ) : p.activeStatus?.status === 'AUTO_SUBMITTED' ? (
                          <Badge variant="rose" size="sm">
                            Auto-Submitted ({p.activeStatus.violationsCount}x Pelanggaran)
                          </Badge>
                        ) : (
                          <Badge variant="slate" size="sm">
                            Siap / Belum Login
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {isLocked ? (
                          <div className="flex items-center gap-1.5">
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                              title={`Device ID: ${p.activeDeviceId}`}
                            >
                              <Smartphone className="w-3 h-3" />
                              Terkunci
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUnlockSingleParticipant(p.id, p.name)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-teal-50 hover:bg-teal-100 dark:bg-teal-950 dark:hover:bg-teal-900/60 text-teal-700 dark:text-teal-300 border border-teal-300 dark:border-teal-700 transition-colors cursor-pointer shadow-2xs"
                              title="Buka kunci perangkat ini (Data jawaban siswa tetap aman tersimpan)"
                            >
                              <Unlock className="w-2.5 h-2.5" />
                              <span>Buka Kunci</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-medium">Bebas</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedLogsParticipant(p)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                            violationCount > 0
                              ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-300 dark:border-rose-800 hover:bg-rose-100'
                              : 'bg-slate-50 text-slate-600 dark:bg-zinc-800 dark:text-zinc-300 border-slate-200 dark:border-zinc-700 hover:bg-slate-100'
                          }`}
                        >
                          <ShieldAlert className={`w-3.5 h-3.5 ${violationCount > 0 ? 'text-rose-600' : 'text-slate-400'}`} />
                          <span>{violationCount}x Pelanggaran</span>
                          <Eye className="w-3 h-3 ml-0.5 opacity-60" />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          {isLocked && (
                            <button
                              type="button"
                              onClick={() => handleUnlockSingleParticipant(p.id, p.name)}
                              title="Buka kunci perangkat peserta (Data jawaban tetap aman)"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-teal-300 dark:border-teal-800 text-teal-700 dark:text-teal-300 bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/40 text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap shadow-2xs"
                            >
                              <Unlock className="w-3 h-3" />
                              <span>Buka Kunci</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleResetSingleParticipant(p.id, p.name)}
                            title="Buka kunci perangkat peserta tanpa menghapus data jawaban"
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Reset Device</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSingleParticipant(p.id, p.name)}
                            title="Hapus akun peserta"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* MODAL 1: Reset Sesi Ujian / Ganti Kelas Baru */}
      {isResetClassModalOpen && (
        <div className="fixed inset-0 z-50 bg-zinc-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-zinc-800 max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-zinc-100 text-base flex items-center gap-2">
                  <RotateCcw className="w-5 h-5 text-amber-600" />
                  Reset Sesi Peserta / Ganti Kelas Baru
                </h3>
                <p className="text-xs text-slate-500">
                  Digunakan saat ujian di 1 kelas selesai dan berpindah ke kelas/rombongan berikutnya
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsResetClassModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Selection Tabs */}
            <div className="grid grid-cols-3 gap-1 bg-slate-100 dark:bg-zinc-800 p-1 rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setResetModalTab('RESET_ONLY')}
                className={`py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                  resetModalTab === 'RESET_ONLY'
                    ? 'bg-white dark:bg-zinc-900 text-amber-700 dark:text-amber-400 shadow-xs'
                    : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>1. Reset Sesi Saja</span>
              </button>
              <button
                type="button"
                onClick={() => setResetModalTab('NEW_CLASS_GENERATE')}
                className={`py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                  resetModalTab === 'NEW_CLASS_GENERATE'
                    ? 'bg-white dark:bg-zinc-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>2. Buat Kelas Baru</span>
              </button>
              <button
                type="button"
                onClick={() => setResetModalTab('NEW_CLASS_PASTE')}
                className={`py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                  resetModalTab === 'NEW_CLASS_PASTE'
                    ? 'bg-white dark:bg-zinc-900 text-teal-700 dark:text-teal-400 shadow-xs'
                    : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>3. Impor Siswa & Token</span>
              </button>
            </div>

            {/* TAB 1: Reset Sesi Ujian (Gunakan Peserta yang Ada) */}
            {resetModalTab === 'RESET_ONLY' && (
              <div className="space-y-4 pt-2">
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                  <div className="font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0" />
                    Pilihan Tepat Jika Akun Peserta Tetap (Misal: P001 s.d P036 / D1-R2)
                  </div>
                  <p className="leading-relaxed">
                    Sistem akan menghapus seluruh data sesi pengerjaan, skor hasil, log anti-cheat realtime, dan melepaskan semua kunci browser/perangkat. Akun peserta tetap ada sehingga siswa kelas berikutnya langsung bisa login.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 text-xs space-y-1 text-slate-600 dark:text-zinc-300">
                  <div>• Jumlah Akun Peserta: <span className="font-bold font-mono text-slate-900 dark:text-zinc-100">{participants.length} Siswa</span></div>
                  <div>• Sesi Aktif Berjalan: <span className="font-bold font-mono text-amber-600">{activeTestingCount} Sesi</span></div>
                  <div>• Kunci Perangkat: <span className="font-bold font-mono text-indigo-600">{lockedDevicesCount} Terkunci (Akan Dibuka)</span></div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-zinc-800">
                  <Button variant="outline" size="sm" onClick={() => setIsResetClassModalOpen(false)}>
                    Batal
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={executeResetSessionsOnly}
                    disabled={isProcessingReset}
                    className="bg-amber-600 hover:bg-amber-700 text-white font-bold"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${isProcessingReset ? 'animate-spin' : ''}`} />
                    {isProcessingReset ? 'Mereset Sesi...' : 'Eksekusi Reset Sesi Kelas'}
                  </Button>
                </div>
              </div>
            )}

            {/* TAB 2: Generate Batch Kelas Baru (e.g. XII-RPL-1) */}
            {resetModalTab === 'NEW_CLASS_GENERATE' && (
              <div className="space-y-4 pt-2">
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200">
                  <p className="font-medium">
                    Hasilkan akun peserta baru secara otomatis dengan penomoran urut rapi untuk kelas/jurusan baru lengkap dengan Token Peserta.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                      Nama / Prefix Kelas *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Contoh: XII-RPL-1, 10-TKJ-2"
                      value={classPrefix}
                      onChange={(e) => setClassPrefix(e.target.value)}
                      className="w-full px-3 py-2 text-xs uppercase font-mono rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-slate-900 dark:text-zinc-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                      Jumlah Peserta (Siswa)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={classStudentCount}
                      onChange={(e) => setClassStudentCount(parseInt(e.target.value) || 36)}
                      className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-slate-900 dark:text-zinc-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    Prefix Token Akses Peserta (Opsional)
                  </label>
                  <input
                    type="text"
                    placeholder="Kosongkan untuk mengikuti format kelas (misal: XIIRPL101)"
                    value={classTokenPrefix}
                    onChange={(e) => setClassTokenPrefix(e.target.value)}
                    className="w-full px-3 py-2 text-xs uppercase font-mono rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-slate-900 dark:text-zinc-100"
                  />
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 text-xs space-y-1">
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-zinc-300">Pratinjau Kode Peserta: </span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                      {classPrefix.trim().toUpperCase() || 'KELAS'}-01 s.d {classPrefix.trim().toUpperCase() || 'KELAS'}-{String(classStudentCount || 36).padStart(2, '0')}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-zinc-300">Pratinjau Token Akses Peserta: </span>
                    <span className="font-mono text-teal-600 dark:text-teal-400 font-bold">
                      {((classTokenPrefix || classPrefix).trim().toUpperCase().replace(/[\/\-\_\s]/g, '') || 'KELAS')}01 s.d {((classTokenPrefix || classPrefix).trim().toUpperCase().replace(/[\/\-\_\s]/g, '') || 'KELAS')}{String(classStudentCount || 36).padStart(2, '0')}
                    </span>
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 dark:text-zinc-300 select-none">
                  <input
                    type="checkbox"
                    checked={clearPreviousClass}
                    onChange={(e) => setClearPreviousClass(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600 cursor-pointer"
                  />
                  <span>Hapus peserta & bersihkan seluruh sesi ujian kelas sebelumnya</span>
                </label>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-zinc-800">
                  <Button variant="outline" size="sm" onClick={() => setIsResetClassModalOpen(false)}>
                    Batal
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={executeGenerateNewClass}
                    disabled={isProcessingReset}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${isProcessingReset ? 'animate-spin' : ''}`} />
                    {isProcessingReset ? 'Membuat Kelas...' : `Buat Kelas (${classStudentCount} Siswa & Token)`}
                  </Button>
                </div>
              </div>
            )}

            {/* TAB 3: Impor / Paste Siswa & Token */}
            {resetModalTab === 'NEW_CLASS_PASTE' && (
              <div className="space-y-4 pt-2">
                <div className="p-3.5 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-xs text-teal-900 dark:text-teal-200 space-y-2">
                  <p className="font-semibold flex items-center gap-1.5">
                    <FileSpreadsheet className="w-4 h-4 text-teal-600 shrink-0" />
                    Impor Data Siswa & Token Login Peserta
                  </p>
                  <p className="leading-relaxed text-[11px] text-teal-800 dark:text-teal-300">
                    Siswa login di halaman depan hanya menggunakan <strong>Token Peserta</strong> dan <strong>Token Ujian</strong>. Masukkan Nama beserta Token Peserta agar kredensial peserta langsung aktif.
                  </p>
                </div>

                {/* Toolbar: Upload Excel & Download Template */}
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-zinc-800/60 p-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs">
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold bg-white dark:bg-zinc-900 border border-teal-300 dark:border-teal-800 text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/50 shadow-2xs transition-colors cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-teal-600" />
                      <span>Unggah File Excel / CSV</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium text-slate-600 dark:text-zinc-300 hover:text-slate-900 hover:bg-slate-200/50 dark:hover:bg-zinc-700 transition-colors cursor-pointer text-[11px]"
                    title="Unduh format tabel Excel yang sudah memiliki kolom Nama dan Token"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-500" />
                    <span>Unduh Template Excel</span>
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300">
                      Tempel Data Siswa & Token (1 Baris per Siswa) *
                    </label>
                    <span className="text-[10px] text-slate-400">
                      Format: <code className="bg-slate-100 dark:bg-zinc-800 px-1 py-0.5 rounded">Nama, Token</code> atau <code className="bg-slate-100 dark:bg-zinc-800 px-1 py-0.5 rounded">Kode, Nama, Token</code>
                    </span>
                  </div>
                  <textarea
                    rows={6}
                    value={pasteRawText}
                    onChange={(e) => setPasteRawText(e.target.value)}
                    placeholder={`Ahmad Subagyo, TKN001\nBudi Santoso, TKN002\nCitra Lestari, TKN003\nDedi Kurniawan, TKN004\n\nAtau format 3 kolom (Kode, Nama, Token):\nRPL-01, Ahmad Subagyo, TKN001\nRPL-02, Budi Santoso, TKN002`}
                    className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-slate-900 dark:text-zinc-100 placeholder:text-slate-400"
                  />
                </div>

                {/* Live Preview Table of Parsed Data */}
                {parsedPreview.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Terdeteksi {parsedPreview.length} Siswa Lengkap dengan Token Akses
                      </span>
                      <span className="text-[10px] text-slate-400">Pratinjau Data Impor</span>
                    </div>

                    <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-zinc-800 shadow-2xs">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-zinc-800/90 text-slate-500 font-semibold uppercase text-[10px] sticky top-0 border-b border-slate-200 dark:border-zinc-800">
                          <tr>
                            <th className="px-3 py-1.5 w-10">No</th>
                            <th className="px-3 py-1.5">Nama Siswa</th>
                            <th className="px-3 py-1.5">Kode Peserta</th>
                            <th className="px-3 py-1.5">Token Peserta</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
                          {parsedPreview.map((item, idx) => (
                            <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-zinc-800/40">
                              <td className="px-3 py-1 text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                              <td className="px-3 py-1 font-medium text-slate-800 dark:text-zinc-200">{item.name}</td>
                              <td className="px-3 py-1 font-mono text-slate-600 dark:text-zinc-400 text-[11px]">{item.participantCode}</td>
                              <td className="px-3 py-1">
                                <span className="font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded text-[11px] font-bold border border-emerald-200 dark:border-emerald-800">
                                  {item.token}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 dark:text-zinc-300 select-none">
                  <input
                    type="checkbox"
                    checked={clearPreviousClass}
                    onChange={(e) => setClearPreviousClass(e.target.checked)}
                    className="w-4 h-4 rounded text-teal-600 cursor-pointer"
                  />
                  <span>Hapus peserta & bersihkan seluruh sesi ujian kelas sebelumnya</span>
                </label>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-zinc-800">
                  <Button variant="outline" size="sm" onClick={() => setIsResetClassModalOpen(false)}>
                    Batal
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={executePasteNewClass}
                    disabled={isProcessingReset || parsedPreview.length === 0}
                    className="bg-teal-600 hover:bg-teal-700 text-white font-bold"
                  >
                    <FileSpreadsheet className={`w-3.5 h-3.5 ${isProcessingReset ? 'animate-spin' : ''}`} />
                    {isProcessingReset
                      ? 'Mengimpor...'
                      : parsedPreview.length > 0
                      ? `Impor ${parsedPreview.length} Siswa & Token`
                      : 'Impor Siswa & Token'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 2: Participant Anti-Cheat Violation Log Modal */}
      {selectedLogsParticipant && (
        <div className="fixed inset-0 z-50 bg-zinc-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-zinc-800 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-zinc-100 text-base flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-rose-600" />
                  Log Pelanggaran Anti-Cheat Peserta
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedLogsParticipant.name} (Kode: {selectedLogsParticipant.participantCode})
                </p>
              </div>
              <button
                onClick={() => setSelectedLogsParticipant(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {getParticipantViolations(selectedLogsParticipant).length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 space-y-2">
                <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center mx-auto">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <p>Tidak ada catatan pelanggaran untuk peserta ini. Peserta mengerjakan dengan tertib.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {getParticipantViolations(selectedLogsParticipant).map((v, idx) => (
                  <div
                    key={v.id || idx}
                    className="p-3 rounded-xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {v.type}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {new Date(v.timestamp).toLocaleTimeString('id-ID')}
                      </span>
                    </div>
                    <p className="text-slate-700 dark:text-zinc-300 text-[11px]">{v.details}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => handleResetSingleParticipant(selectedLogsParticipant.id, selectedLogsParticipant.name)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-300 dark:border-teal-800 text-teal-700 dark:text-teal-300 bg-teal-50 hover:bg-teal-100 text-xs font-semibold cursor-pointer"
                title="Buka kunci perangkat peserta (Data jawaban siswa tetap aman tersimpan)"
              >
                <Unlock className="w-3.5 h-3.5" />
                Buka Kunci Perangkat (Data Aman)
              </button>
              <Button variant="outline" size="sm" onClick={() => setSelectedLogsParticipant(null)}>
                Tutup
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Add Single Custom Participant */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-zinc-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateSingleParticipant}
            className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-zinc-800 max-w-md w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-slate-900 dark:text-zinc-100 text-base flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-emerald-600" />
                Tambah Peserta Ujian Custom (D1/R2)
              </h3>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                  Nama Lengkap Peserta *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Peserta D1/R2 No 01"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-slate-900 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                  Kode Peserta (Username / Room Code) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: D1-R2-01"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono uppercase rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-slate-900 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                  Token Login Akses (Kosongkan jika sama dengan Kode)
                </label>
                <input
                  type="text"
                  placeholder="Contoh: D1R201"
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono uppercase rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-slate-900 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-zinc-800">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsAddModalOpen(false)}>
                Batal
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={isSubmittingNew}>
                {isSubmittingNew ? 'Menyimpan...' : 'Simpan Peserta'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
