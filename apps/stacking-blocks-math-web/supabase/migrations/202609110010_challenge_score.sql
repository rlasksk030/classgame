alter table public.sb_challenge_solves add column if not exists score integer not null default 0 check (score between 0 and 2);
