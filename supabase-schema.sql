-- Snake leaderboard schema — paste this into Supabase → SQL Editor → run once.

-- One row per player: their display name + all-time best score.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  best_score  int  not null default 0,
  updated_at  timestamptz not null default now()
);

-- Row-Level Security: safe to expose the anon key because these rules govern
-- exactly what any client can read/write.
alter table public.profiles enable row level security;

-- Anyone (even logged out) can read the leaderboard.
create policy "profiles are viewable by everyone"
  on public.profiles for select
  using (true);

-- A logged-in user may create only their own profile row.
create policy "users insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- A logged-in user may update only their own profile row.
create policy "users update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
