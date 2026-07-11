-- Anti-cheat lockdown — run in Supabase → SQL Editor (after deploying the
-- submit-score Edge Function).

-- 1) Clients can no longer UPDATE their row directly (so best_score can't be
--    set from the browser console). Scores are written only by the Edge
--    Function, which uses the service role and bypasses RLS.
drop policy if exists "users update their own profile" on public.profiles;

-- 2) New profiles must start at 0 — stop a cheater from inserting a high score
--    when first creating their profile.
drop policy if exists "users insert their own profile" on public.profiles;
create policy "users insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id and best_score = 0);
