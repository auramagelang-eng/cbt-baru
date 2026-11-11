# Penyimpanan Supabase & Deploy Vercel

Panduan ini menjelaskan cara menyambungkan aplikasi CBT ini ke **Supabase** sebagai
database permanen, lalu mengunggahnya ke **Vercel**.

---

## 1. Ringkasan arsitektur

Sebelumnya seluruh data hanya hidup di memori server dan ditulis ke `db_store.json`.
Di Vercel filesystem bersifat *read-only* dan sementara, sehingga cara itu tidak bisa
dipakai. Sekarang:

```
Browser  ->  Express/Vercel Function  ->  cache in-memory (cepat, untuk 40 peserta)
                                              |
                                              +--> Supabase (permanen, sumber kebenaran)
```

- **Baca** soal & peserta dilayani dari cache in-memory sehingga 40 peserta bisa ujian
  bersamaan tanpa saling menunggu query database.
- **Tulis** (soal, user, jawaban, pelanggaran, hasil) langsung dikirim ke Supabase
  (*write-through*). Endpoint simpan jawaban **menunggu konfirmasi database** sebelum
  membalas `200 OK`.
- **Vercel** menjalankan banyak instance. Setiap instance melakukan *hydrate* penuh dari
  Supabase saat cold start, menyegarkan cache tiap ±10 detik, dan mengambil satu sesi
  langsung dari database bila belum ada di cache (*read-through*).
- **Database bermasalah?** Tulisan dicoba ulang 3x (backoff), lalu disimpan di antrean
  retry. Endpoint jawaban membalas `503 + retryable: true` sehingga aplikasi peserta
  **tidak menghapus** salinan jawaban di `localStorage` dan mengirim ulang otomatis.

File terkait:

| File | Fungsi |
| --- | --- |
| `supabase/schema.sql` | Skema tabel, index, trigger `updated_at`, RLS + view hasil |
| `src/server/supabase.ts` | Klien Supabase, mapping data, antrean tulis + retry, hydrate/refresh |
| `src/server/persistence.ts` | Kontrak backend penyimpanan (Supabase / no-op) |
| `src/server/db.ts` | Cache in-memory + hook write-through |
| `src/server/app.ts` | Aplikasi Express, error handler, middleware sinkronisasi DB |
| `api/index.ts` | Entry Vercel (satu function untuk semua `/api/*`) |
| `vercel.json` | Build Vite + routing API + SPA fallback |

---

## 2. Setup Supabase (sekali saja)

1. Buat project di <https://supabase.com> (region terdekat, mis. Singapore).
2. Buka **SQL Editor** → **New query** → tempel seluruh isi `supabase/schema.sql` → **Run**.
   Semua tabel berawalan `cbt_`:
   - `cbt_users` — admin & peserta (token login, kunci perangkat)
   - `cbt_exams` — pengaturan ujian
   - `cbt_questions` — bank soal + kunci jawaban
   - `cbt_sessions` — sesi ujian: **jawaban berjalan + nilai/hasil akhir**
   - `cbt_violation_logs` — catatan anti-cheat
   - view `cbt_results` — rekap hasil siap dibaca admin
3. Buka **Project Settings → API Keys** → salin **`service_role`** (secret key).
   Jangan pakai `anon` / publishable key: RLS sengaja menolak semua akses dari key itu.

> Keamanan: RLS aktif di semua tabel tanpa policy untuk `anon`/`authenticated`, jadi
> kunci publik tidak bisa membaca soal, jawaban, atau nilai. Hanya server (yang memegang
> `service_role`) yang bisa mengakses data. Service role key **hanya** dibaca di server
> dan tidak pernah dikirim ke browser.

---

## 3. Environment variables

### Lokal (`.env`, sudah di-ignore git)

```env
SUPABASE_URL="https://xxxxxxxxxxxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="service-role-key-dari-dashboard"
```

### Vercel

**Project → Settings → Environment Variables** (Production + Preview):

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | URL project Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key |
| `GEMINI_API_KEY` | (opsional) untuk penilaian esai AI |

Tanpa dua variabel Supabase, aplikasi tetap jalan memakai file lokal dan
`/api/health` akan menampilkan `"mode": "file"`. Setelah env diisi, nilainya berubah
menjadi `"mode": "supabase"`.

---

## 4. Migrasi data yang sudah ada

Saat pertama kali terhubung, aplikasi memeriksa apakah database masih kosong:

- **Kosong** → seluruh data yang sedang ada di memori (dari `db_store.json`) otomatis
  diunggah ke Supabase: admin, peserta, ujian, bank soal, dan sesi/nilai yang tersimpan.
- **Sudah ada isinya** → cache dimuat dari Supabase (data lama di file tidak menimpa).

Cara paling aman memigrasikan data produksi lama:

1. Jalankan aplikasi **di lokal** dengan `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   yang benar (file `db_store.json` ikut terbaca).
2. Cek log: `[Supabase] Database kosong -> mengunggah data awal ...` lalu
   `[Supabase] Data awal berhasil diunggah.`
3. Baru deploy ke Vercel.

Alternatif dari dashboard admin: **Database → Backup** (unduh JSON), lalu setelah deploy
gunakan **Sync Backup / Restore** — endpoint tersebut sekarang menunggu data benar-benar
tersimpan di Supabase (`persisted: true`).

---

## 5. Deploy ke Vercel

1. Push repository ke GitHub, lalu **Add New → Project** di Vercel dan import repo.
2. Framework terdeteksi **Vite**. Biarkan:
   - Build Command: `npm run build`
   - Output Directory: `dist`
   (sudah tertulis juga di `vercel.json`)
3. Isi environment variables pada langkah 3, lalu **Deploy**.
4. Setelah selesai, buka `https://<domain>/api/health`. Contoh hasil yang benar:

```json
{
  "status": "ok",
  "storage": { "mode": "supabase", "pendingWrites": 0, "failedWrites": 0 }
}
```

`vercel.json` mengatur:

- `api/index.ts` → satu serverless function (`maxDuration` 60 detik, memory 1024 MB)
  yang menangani seluruh `/api/*`; `db_store.json` ikut dibundel untuk bootstrap.
- Rewrite `/api/(.*)` → `/api` agar path asli sampai ke Express.
- Rewrite sisanya → `/index.html` agar React Router tidak 404 saat refresh.

---

## 6. 40 peserta bersamaan

Yang sudah ditangani aplikasi:

- **Auto-save terjadwal** di browser (debounce beberapa detik) + pengiriman massal
  (`/api/session/batch-save`), bukan satu request per soal.
- **Single-payload** saat mulai ujian: semua soal dikirim dalam satu response.
- **Write-through per sesi**: satu baris `cbt_sessions` berisi jawaban + progres, jadi
  auto-save hanya satu upsert kecil (±1–3 KB), bukan menulis ulang seluruh database.
- **Index database** untuk pencarian token peserta, token ujian, sesi per peserta/ujian,
  status sesi, dan soal per ujian.
- **Retry + dead-letter queue**: gangguan jaringan sesaat tidak menggagalkan ujian.
- **Read-through & refresh** agar dashboard admin dan instance Vercel lain tetap sinkron.
- **Error handler global**: satu request gagal dibalas JSON rapi, proses/instance tidak
  ikut mati (dashboard admin tidak "blank" atau 500 tanpa pesan).

Perkiraan beban: 40 peserta × auto-save tiap ±4 detik ≈ **10–13 tulisan/detik** saat
puncak. Ini masih ringan untuk Supabase. Bila peserta bertambah jauh lebih banyak:

- Naikkan paket Supabase (CPU/compute) atau gunakan region yang sama dengan pengguna.
- Pertimbangkan menaikkan `SUPABASE_REFRESH_MS` (default 10000 ms) bila ingin lebih
  hemat query; dashboard tetap akurat karena refresh berjalan per request.
- Jangan mengubah `SUPABASE_SERVICE_ROLE_KEY` menjadi anon key — RLS akan memblokir tulis.

---

## 7. Jaminan data (skenario gagal)

| Skenario | Yang terjadi |
| --- | --- |
| Database down saat siswa menekan simpan | Server balas `503 retryable`, jawaban tetap di `localStorage` + memori server, dikirim ulang otomatis, lalu masuk database |
| Database pulih | Antrean retry otomatis tersimpan (diuji: `failedWrites` kembali `0`) |
| Instance Vercel berganti / cold start | Semua data dimuat ulang dari Supabase (ujian & nilai tetap ada) |
| Admin menutup browser / dashboard error | Data ujian & jawaban sudah tersimpan di Supabase; tidak bergantung pada sesi admin |
| Server crash / restart | Jawaban terakhir yang sudah di-ACK `200` aman di database |
| Salah satu endpoint error | Dibalas JSON `{ error }`, instance tetap hidup, request lain tidak terpengaruh |

Catatan: bila `503` muncul, aplikasi peserta akan terus mencoba; **jangan** menutup
browser sebelum status tersimpan kembali normal.

---

## 8. Checklist setelah deploy

1. `/api/health` → `status: ok`, `storage.mode: supabase`.
2. Login admin (`ahmad` / password admin saat ini), buka dashboard → daftar ujian & peserta
   tampil (berarti hydrate dari Supabase berhasil).
3. Buka Supabase → **Table Editor** → `cbt_exams`, `cbt_questions`, `cbt_users`:
   jumlah baris harus sama dengan data di dashboard.
4. Dari satu perangkat peserta: verifikasi token → mulai ujian → jawab 1 soal → tunggu
   auto-save → cek `cbt_sessions` (kolom `answers` berisi jawaban).
5. Selesaikan ujian → cek baris `cbt_sessions` berubah `status = COMPLETED`, `score`
   dan `submitted_at` terisi; hasil muncul di menu Hasil & Analitik admin.
6. Buka dua perangkat peserta berbeda sekaligus untuk memastikan tidak saling mengganggu.

---

## 9. Catatan keamanan lanjutan (opsional)

- Password admin masih tertanam di kode (`src/server/services/AuthService.ts`) — untuk
  produksi sebaiknya dipindahkan ke environment variable/hash.
- Token login peserta disimpan sebagai teks di `cbt_users`; bila perlu, tambahkan kolom
  hash + rotasi token berkala.
- Aktifkan **Point-in-Time Recovery / backup harian** pada paket Supabase berbayar untuk
  perlindungan tambahan.

## Membuat tabel otomatis (opsional, tapi disarankan)

Bila muncul error `Could not find the table 'public.cbt_questions' in the schema cache`,
tabel `cbt_*` belum ada di project Supabase. Ada dua cara memperbaikinya:

1. **Manual (paling cepat):** buka Supabase Dashboard -> SQL Editor -> tempel seluruh isi
   `supabase/schema.sql` -> Run. Skrip ini aman dijalankan berulang kali.
2. **Otomatis:** tambahkan env `SUPABASE_DB_URL` di server/Vercel. Nilainya dari
   Supabase Dashboard -> Settings -> Database -> Connection string (URI, sertakan password).
   Saat tabel belum ada, server akan membuatnya sendiri dari `supabase/schema.sql`
   (dibundel sebagai `src/server/schemaSql.ts`), lalu menyambung ulang.

Setelah tabel tersedia, `/api/health` harus menampilkan `"mode":"supabase"`, `"reason":"ok"`,
`"durable":true`.
