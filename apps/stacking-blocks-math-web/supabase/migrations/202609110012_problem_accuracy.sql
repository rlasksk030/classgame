-- Corrective migration for the audited built-in problem data.
-- The original seed migrations are append-only; this migration is safe to
-- apply after 202609110011 and brings already-installed rows in line with
-- shared/seedProblems.ts and the spatial convention audit.
begin;

update public.sb_problems
set answer = '{"kind":"blocks","blocks":[]}'::jsonb
where code = 'L1-03';

update public.sb_problems
set given_blocks = '[{"x":0,"y":0,"z":0},{"x":1,"y":0,"z":0},{"x":2,"y":0,"z":0},{"x":0,"y":0,"z":1},{"x":0,"y":1,"z":0},{"x":1,"y":1,"z":0}]'::jsonb,
    given = '{"projections":{"front":[[true,true,true],[true,true,false],[false,false,false]]},"shownFrom":"front","allowRotate":true}'::jsonb
where code = 'L2-01';

update public.sb_problems
set given_blocks = '[{"x":0,"y":0,"z":0},{"x":1,"y":0,"z":0},{"x":2,"y":0,"z":0},{"x":0,"y":0,"z":1},{"x":0,"y":1,"z":0},{"x":1,"y":1,"z":0}]'::jsonb,
    given = '{"projections":{"side":[[false,true,true],[false,false,true],[false,false,false]]},"shownFrom":"right","allowRotate":true}'::jsonb
where code = 'L2-03';

update public.sb_problems
set problem_type = 'CHOICE',
    prompt = '지금은 화면을 돌릴 수 없습니다.
이 정보만으로 전체 개수를 정확히 알 수 있을까요?',
    choices = '["정확히 알 수 있어요","가려진 곳의 정보가 더 필요해요"]'::jsonb,
    answer = '{"kind":"choice","index":1}'::jsonb
where code = 'L5-01';

-- L12-04 is derived from L2-01 but has its own stable row id/title.
update public.sb_problems
set given_blocks = '[{"x":0,"y":0,"z":0},{"x":1,"y":0,"z":0},{"x":2,"y":0,"z":0},{"x":0,"y":0,"z":1},{"x":0,"y":1,"z":0},{"x":1,"y":1,"z":0}]'::jsonb,
    given = '{"projections":{"front":[[true,true,true],[true,true,false],[false,false,false]]},"shownFrom":"front","allowRotate":true}'::jsonb
where code = 'L12-04';

commit;
