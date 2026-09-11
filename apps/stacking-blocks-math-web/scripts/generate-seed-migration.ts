import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SEED_PROBLEMS } from '../shared/seedProblems.ts';
const quote = (value: unknown) => "'" + String(value).replaceAll("'", "''") + "'";
const json = (value: unknown) => quote(JSON.stringify(value)) + '::jsonb';
const lines = ['-- UUID-backed built-in problems: attempts and snapshots use real foreign keys.', 'begin;'];
for (const p of SEED_PROBLEMS) {
  const hash = createHash('sha256').update('stacking:' + p.code).digest('hex');
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const values = [quote(id), quote(p.code), p.lesson, p.orderIndex, quote(p.problemType), quote(p.title), quote(p.prompt), p.grid.gridWidth, p.grid.gridDepth, p.grid.maxHeight, json(p.givenBlocks), json(p.startBlocks), json(p.given), json(p.choices), json(p.answer), quote(p.gradingMode), quote(p.hint), quote(p.explanation), p.difficulty, p.xp];
  lines.push(`insert into public.sb_problems (id,code,lesson,order_index,problem_type,title,prompt,grid_width,grid_depth,max_height,given_blocks,start_blocks,given,choices,answer,grading_mode,hint,explanation,difficulty,xp) values (${values.join(',')}) on conflict (id) do nothing;`);
}
lines.push('commit;');
writeFileSync('supabase/migrations/202609110002_seed.sql', lines.join('\n') + '\n');
