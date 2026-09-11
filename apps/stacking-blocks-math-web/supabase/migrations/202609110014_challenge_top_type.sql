-- Allow the lesson 9 top-view-only card while keeping the peer challenge enum closed.
begin;
alter table public.sb_shared_challenges
  drop constraint if exists sb_shared_challenges_challenge_type_check;
alter table public.sb_shared_challenges
  add constraint sb_shared_challenges_challenge_type_check
  check (challenge_type in ('views', 'top', 'heightMap', 'layers'));
alter table public.sb_shared_challenges
  drop constraint if exists sb_shared_challenges_hint_type_check;
alter table public.sb_shared_challenges
  add constraint sb_shared_challenges_hint_type_check
  check (hint_type in ('views', 'top', 'heightMap', 'layers'));
commit;
