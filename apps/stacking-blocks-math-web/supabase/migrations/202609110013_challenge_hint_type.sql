-- Persist the representation selected as a peer challenge hint.
-- Existing rows remain compatible and use heightMap as the safe default.
begin;
alter table public.sb_shared_challenges
  add column if not exists hint_type text not null default 'heightMap';
alter table public.sb_shared_challenges
  drop constraint if exists sb_shared_challenges_hint_type_check;
alter table public.sb_shared_challenges
  add constraint sb_shared_challenges_hint_type_check
  check (hint_type in ('views', 'heightMap', 'layers'));
commit;
