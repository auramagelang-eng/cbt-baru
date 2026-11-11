-- ============================================================================
--  CBT eQuiz Platform - Skema Database Supabase (PostgreSQL)
-- ----------------------------------------------------------------------------
--  Jalankan file ini SATU KALI di Supabase Dashboard -> SQL Editor -> Run.
--
--  Prinsip keamanan:
--   1. Row Level Security (RLS) AKTIF di semua tabel.
--   2. TIDAK ADA policy untuk role `anon` / `authenticated`, sehingga
--      publishable/anon key TIDAK BISA membaca atau menulis data apa pun.
--   3. Hanya `service_role` (dipakai server Express/Vercel, kuncinya tidak
--      pernah dikirim ke browser) yang boleh mengakses tabel.
--   4. Semua nilai jawaban siswa, kunci jawaban, dan nilai hasil disimpan
--      di server; client hanya menerima data yang sudah disanitasi.
--
--  Catatan relasi: foreign key sengaja tidak dipasang agar proses restore /
--  impor massal (backup JSON, Cloudflare D1) tidak gagal karena urutan insert.
--  Integritas relasi dijaga oleh lapisan aplikasi (src/server/supabase.ts).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. USERS (admin + peserta ujian / token login)
-- ----------------------------------------------------------------------------
create table if not exists public.cbt_users (
  id                text primary key,
  username          text not null,
  name              text not null,
  original_name     text,
  role              text not null default 'PARTICIPANT'
                      check (role in ('ADMIN', 'PARTICIPANT')),
  participant_code  text,
  token             text,
  active_device_id  text,
  ip_address        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists cbt_users_role_idx
  on public.cbt_users (role);
create index if not exists cbt_users_token_idx
  on public.cbt_users (upper(token));
create index if not exists cbt_users_code_idx
  on public.cbt_users (upper(participant_code));

-- ----------------------------------------------------------------------------
-- 2. EXAMS (pengaturan ujian)
-- ----------------------------------------------------------------------------
create table if not exists public.cbt_exams (
  id                        text primary key,
  title                     text not null,
  subject                   text not null default 'Umum',
  duration_minutes          integer not null default 60,
  total_questions           integer not null default 0,
  pass_percentage           integer not null default 70,
  token                     text,
  is_active                 boolean not null default true,
  shuffle_questions         boolean not null default true,
  shuffle_answers           boolean not null default true,
  max_violations            integer not null default 3,
  max_attempts              integer not null default 3,
  is_per_question_timed     boolean not null default false,
  question_duration_seconds integer not null default 30,
  is_strict_timer           boolean not null default true,
  show_instant_feedback     boolean not null default false,
  show_answer_keys          boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists cbt_exams_token_idx
  on public.cbt_exams (upper(token));
create index if not exists cbt_exams_active_idx
  on public.cbt_exams (is_active);

-- ----------------------------------------------------------------------------
-- 3. QUESTIONS (bank soal + kunci jawaban, hanya dibaca server)
-- ----------------------------------------------------------------------------
-- Catatan: satu soal bisa dipakai di beberapa ujian (fitur sinkronisasi bank
-- soal), karena itu primary key-nya gabungan (exam_id, id) — bukan id saja.
create table if not exists public.cbt_questions (
  id                    text not null,
  exam_id               text not null,
  position              integer not null default 0,
  type                  text not null,
  question_text         text not null,
  image_url             text,
  points                numeric not null default 0,
  options               jsonb not null default '[]'::jsonb,
  correct_option_id     text,
  essay_answer_key      text,
  essay_ai_rubric       jsonb,
  short_answer_key      text,
  short_answer_keys     jsonb,
  answer_key            jsonb,
  short_answer_multi_key jsonb,
  is_case_sensitive     boolean,
  updated_at            timestamptz not null default now(),
  constraint cbt_questions_pkey primary key (exam_id, id)
);

create index if not exists cbt_questions_exam_idx
  on public.cbt_questions (exam_id, position);

-- ----------------------------------------------------------------------------
-- 4. SESSIONS (jawaban berjalan + hasil akhir ujian)
--    Inilah sumber kebenaran (source of truth) pekerjaan siswa:
--    setiap auto-save jawaban langsung di-upsert ke tabel ini.
-- ----------------------------------------------------------------------------
create table if not exists public.cbt_sessions (
  session_id            text primary key,
  exam_id               text not null,
  participant_id        text not null,
  attempt_number        integer not null default 1,
  start_time            bigint not null default 0,
  end_time              bigint not null default 0,
  shuffled_questions    jsonb not null default '[]'::jsonb,
  answers               jsonb not null default '{}'::jsonb,
  violations_count      integer not null default 0,
  status                text not null default 'IN_PROGRESS'
                          check (status in ('IN_PROGRESS', 'COMPLETED', 'AUTO_SUBMITTED')),
  submitted_at          timestamptz,
  score                 numeric,
  max_score             numeric,
  current_question_index integer,
  active_device_id      text,
  ip_address            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists cbt_sessions_exam_idx
  on public.cbt_sessions (exam_id);
create index if not exists cbt_sessions_participant_idx
  on public.cbt_sessions (participant_id, exam_id);
create index if not exists cbt_sessions_status_idx
  on public.cbt_sessions (status);
create index if not exists cbt_sessions_submitted_idx
  on public.cbt_sessions (submitted_at desc);

-- ----------------------------------------------------------------------------
-- 5. VIOLATION LOGS (catatan anti-cheat)
-- ----------------------------------------------------------------------------
create table if not exists public.cbt_violation_logs (
  id                text primary key,
  session_id        text not null,
  participant_name  text not null default '',
  type              text not null,
  details           text not null default '',
  created_at        timestamptz not null default now()
);

create index if not exists cbt_violation_session_idx
  on public.cbt_violation_logs (session_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 6. Trigger updated_at otomatis (jejak audit kapan baris terakhir berubah)
-- ----------------------------------------------------------------------------
create or replace function public.cbt_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cbt_users_touch on public.cbt_users;
create trigger cbt_users_touch before update on public.cbt_users
  for each row execute function public.cbt_touch_updated_at();

drop trigger if exists cbt_exams_touch on public.cbt_exams;
create trigger cbt_exams_touch before update on public.cbt_exams
  for each row execute function public.cbt_touch_updated_at();

drop trigger if exists cbt_questions_touch on public.cbt_questions;
create trigger cbt_questions_touch before update on public.cbt_questions
  for each row execute function public.cbt_touch_updated_at();

drop trigger if exists cbt_sessions_touch on public.cbt_sessions;
create trigger cbt_sessions_touch before update on public.cbt_sessions
  for each row execute function public.cbt_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 7. Keamanan: RLS aktif, akses ditutup untuk anon/authenticated
--    (service_role otomatis melewati RLS)
-- ----------------------------------------------------------------------------
alter table public.cbt_users            enable row level security;
alter table public.cbt_exams            enable row level security;
alter table public.cbt_questions        enable row level security;
alter table public.cbt_sessions         enable row level security;
alter table public.cbt_violation_logs   enable row level security;

revoke all on public.cbt_users          from anon, authenticated;
revoke all on public.cbt_exams          from anon, authenticated;
revoke all on public.cbt_questions      from anon, authenticated;
revoke all on public.cbt_sessions       from anon, authenticated;
revoke all on public.cbt_violation_logs from anon, authenticated;

grant all on public.cbt_users           to service_role;
grant all on public.cbt_exams           to service_role;
grant all on public.cbt_questions       to service_role;
grant all on public.cbt_sessions        to service_role;
grant all on public.cbt_violation_logs  to service_role;

-- ----------------------------------------------------------------------------
-- 8. VIEW bantu untuk admin / laporan (rekapitulasi hasil per sesi)
-- ----------------------------------------------------------------------------
create or replace view public.cbt_results as
select
  s.session_id,
  s.exam_id,
  e.title                                as exam_title,
  s.participant_id,
  u.name                                 as participant_name,
  u.participant_code,
  s.attempt_number,
  s.status,
  s.score,
  s.max_score,
  case
    when coalesce(s.max_score, 0) > 0
      then round((s.score / s.max_score) * 100)
    else 0
  end                                    as percentage,
  s.violations_count,
  s.submitted_at,
  s.updated_at
from public.cbt_sessions s
left join public.cbt_users u on u.id = s.participant_id
left join public.cbt_exams e on e.id = s.exam_id;

revoke all on public.cbt_results from anon, authenticated;
grant select on public.cbt_results to service_role;

-- ----------------------------------------------------------------------------
-- 9. Segarkan cache skema PostgREST
--    Tanpa ini, API Supabase kadang masih membalas "Could not find the table
--    'public.cbt_questions' in the schema cache" beberapa saat setelah tabel
--    dibuat. Perintah berikut memaksa Supabase membaca ulang daftar tabel.
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- 10. Verifikasi: kelima tabel harus muncul sebagai hasil query di bawah.
-- ----------------------------------------------------------------------------
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'cbt_users',
    'cbt_exams',
    'cbt_questions',
    'cbt_sessions',
    'cbt_violation_logs'
  )
order by table_name;
