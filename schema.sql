-- ============================================
-- MyBanker: Supabase テーブル設計
-- Supabaseダッシュボードの「SQL Editor」にこの内容を貼り付けて実行してください
-- ============================================

-- ユーザーごとのアプリデータを1行ずつ保存するテーブル
-- これまでwindow.storageに保存していたJSON全体を、そのままここに保存します
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 更新日時を自動で更新するための仕組み
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
  before update on public.user_profiles
  for each row
  execute function public.set_updated_at();

-- Row Level Security（ユーザーごとにデータを分離する、最も重要な設定）
alter table public.user_profiles enable row level security;

-- 自分のデータだけ読める
create policy "Users can view own profile"
  on public.user_profiles for select
  using (auth.uid() = user_id);

-- 自分のデータだけ作成できる
create policy "Users can insert own profile"
  on public.user_profiles for insert
  with check (auth.uid() = user_id);

-- 自分のデータだけ更新できる
create policy "Users can update own profile"
  on public.user_profiles for update
  using (auth.uid() = user_id);

-- 自分のデータだけ削除できる
create policy "Users can delete own profile"
  on public.user_profiles for delete
  using (auth.uid() = user_id);
