// Offline compiler for reviewed known-profile -> release transitions.
import { readFile } from 'node:fs/promises';
import { catalogDigestQuery, identifier, literal, preservationGuard, schemaDelta } from './legacy-sql.ts';
import type { Catalog } from './database-state.ts';

export interface CapturedProfile { name: string; prefix: number; catalog: Catalog; digest: string; seeds: Record<string, unknown>[]; storagePolicies: Record<string, unknown>[] }
export interface LegacyTransition { from: string; to: string; query: string; evidenceQuery: string; dataMigrations: number[] }
export interface LegacyRecovery { migrationHashes: string[]; transitions: LegacyTransition[] }

// Only the fields changed by the historical corrective migration. Personal
// problems (class_id != null), activation flags, attempts and answer history stay put.
const correctionFields = ['problem_type', 'prompt', 'choices', 'answer', 'given_blocks', 'given'];
function content(row: Record<string, unknown>) { return Object.fromEntries(correctionFields.map(k => [k, row[k]])); }
const contentSql = `jsonb_build_object(${correctionFields.flatMap(k => [literal(k), `p.${identifier(k)}`]).join(',')})`;

export async function compileRecovery(profiles: CapturedProfile[], hashes: string[], catalogSql: string): Promise<LegacyRecovery> {
  const full = profiles.find(p => p.name === 'history-prefix-24')!;
  const manual = profiles.find(p => p.name === 'manual-required-progress-contract')!;
  const previous = profiles.find(p => p.name === 'manual-previous-contract')!;
  const originalDelta = await readFile('qa/live-required-progress/sql/20261003051402_actual_use_required_progress_delta.sql', 'utf8');
  const releaseMigration = await readFile('supabase/migrations/20261002104459_live_v4_compatibility.sql', 'utf8');
  // Explicit, reviewed promote-only delta; no history replay or completion demotion.
  const progressSql = releaseMigration.slice(releaseMigration.indexOf('lock table public.sb_student_progress'), releaseMigration.indexOf('-- One service-role RPC'));
  if (!progressSql.endsWith('\n\n')) throw new Error('PROGRESS_DELTA_BOUNDARY_CHANGED');
  const requiredCte = progressSql.slice(progressSql.indexOf('with required'), progressSql.indexOf('insert into public.sb_student_progress'));
  const activityCte = progressSql.slice(progressSql.indexOf('with activity_evidence'), progressSql.lastIndexOf('insert into public.sb_student_progress'));
  const progressEvidence = `(${requiredCte} select count(*)::int from candidates c left join public.sb_student_progress p using(student_id,lesson) where p.student_id is null or not p.completed or p.completed_at is null)
    + (${activityCte} select count(*)::int from activity a left join public.sb_student_progress p using(student_id,lesson) where p.student_id is null or (a.completed and not p.completed))`;
  const seedInsertRows = full.seeds.map(row => Object.fromEntries(Object.entries(row).filter(([k]) => !['created_at', 'updated_at'].includes(k))));
  const seedColumns = Object.keys(seedInsertRows[0]);
  const seedInsert = `insert into public.sb_problems(${seedColumns.map(identifier).join(',')}) select ${seedColumns.map(c => `s.${identifier(c)}`).join(',')} from jsonb_populate_recordset(null::public.sb_problems,${literal(JSON.stringify(seedInsertRows))}::jsonb) s where not exists(select 1 from public.sb_problems p where p.id=s.id or (p.class_id is null and p.code=s.code)) on conflict do nothing;`;
  // Corrections apply only to exact shipped historical content variants, never
  // overwrite a teacher's edited content or later code-driven seeds.
  const corrections: string[] = []; const outdated: string[] = [];
  for (const row of full.seeds) {
    const expected = content(row);
    const old = [...new Set(profiles.filter(p => p.prefix > 0 && p.prefix < 24).flatMap(p => p.seeds.filter(s => s.id === row.id).map(s => JSON.stringify(content(s)))))].filter(s => s !== JSON.stringify(expected));
    if (!old.length) continue;
    // JSON containment treats extra nested fields and reordered array choices as
    // a match. Only exact known content may ever be corrected automatically.
    const predicate = `p.class_id is null and p.id=${literal(row.id)}::uuid and (${old.map(s => `${contentSql} = ${literal(s)}::jsonb`).join(' or ')})`;
    outdated.push(`(select count(*)::int from public.sb_problems p where ${predicate})`);
    corrections.push(`update public.sb_problems p set ${correctionFields.map(c => `${identifier(c)}=s.${identifier(c)}`).join(',')} from jsonb_populate_record(null::public.sb_problems,${literal(JSON.stringify(expected))}::jsonb) s where ${predicate};`);
  }
  const missingSeeds = `(select count(*)::int from jsonb_array_elements(${literal(JSON.stringify(full.seeds.map(s => ({ id: s.id, code: s.code }))))}::jsonb) s where not exists(select 1 from public.sb_problems p where p.class_id is null and (p.id=(s->>'id')::uuid or p.code=s->>'code')))`;
  const staleSeeds = outdated.length ? outdated.join('+') : '0';
  const duplicateSeeds = `(select count(*)::int from (select code from public.sb_problems where class_id is null and code in (${full.seeds.map(s => literal(s.code)).join(',')}) group by code having count(*)>1) d)`;
  const identityConflicts = `(select count(*)::int from jsonb_array_elements(${literal(JSON.stringify(full.seeds.map(s=>({id:s.id,code:s.code}))))}::jsonb) s join public.sb_problems p on p.id=(s->>'id')::uuid where p.class_id is not null or p.code is distinct from s->>'code')`;
  const knownContents = full.seeds.flatMap(row => [...new Set(profiles.flatMap(p => p.seeds.filter(s => s.id === row.id).map(s => JSON.stringify(content(s)))))].map(s => ({ id: row.id, code: row.code, content: JSON.parse(s) })));
  const customizedSeeds = `(select count(*)::int from public.sb_problems p where p.class_id is null and (p.id in (${full.seeds.map(s => `${literal(s.id)}::uuid`).join(',')}) or p.code in (${full.seeds.map(s => literal(s.code)).join(',')})) and not exists(select 1 from jsonb_array_elements(${literal(JSON.stringify(knownContents))}::jsonb) s where (p.id=(s->>'id')::uuid or p.code=s->>'code') and ${contentSql}=s->'content'))`;
  const classProblems = '(select count(*)::int from public.sb_problems where class_id is not null)';
  const referencedDuplicates = `(select count(*)::int from public.sb_problems p where p.class_id is null and p.code in (${full.seeds.map(s=>literal(s.code)).join(',')}) and (select count(*) from public.sb_problems d where d.class_id is null and d.code=p.code)>1 and (exists(select 1 from public.sb_problem_attempts a where a.problem_id=p.id) or exists(select 1 from public.sb_block_snapshots s where s.problem_id=p.id)))`;
  const storageInsert = `insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('sb-worksheets','sb-worksheets',false,20971520,array['application/pdf','image/png','image/jpeg','image/webp']),('sb-problem-images','sb-problem-images',false,5242880,array['image/png']) on conflict(id) do nothing;`;
  const worksheet = await readFile('supabase/migrations/202609110008_worksheet.sql', 'utf8');
  const storagePolicies = worksheet.slice(worksheet.indexOf('create policy sb_worksheet_files')).trim();
  const policyNames = ['sb_worksheet_files', 'sb_problem_crops'];
  const policyStatements = storagePolicies.split(/;\s*(?=create policy)/).map(s => s.replace(/;$/, ''));
  const storageDelta = storageInsert + '\n' + policyNames.map((name, i) => `do $storage$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname=${literal(name)}) then ${policyStatements[i]}; end if; end $storage$;`).join('\n');
  const storageEvidence = `(select count(*)::int from (values('sb-worksheets'),('sb-problem-images')) b(id) where not exists(select 1 from storage.buckets s where s.id=b.id)) + (select count(*)::int from (values('sb_worksheet_files'),('sb_problem_crops')) p(name) where not exists(select 1 from pg_policies s where schemaname='storage' and tablename='objects' and policyname=p.name))`;
  const storageBucketConflict = `(select count(*)::int from storage.buckets where id in ('sb-worksheets','sb-problem-images') and public)`;
  const storagePolicyConflict = `(select count(*)::int from pg_policies p where schemaname='storage' and tablename='objects' and policyname in ('sb_worksheet_files','sb_problem_crops') and not exists(select 1 from jsonb_array_elements(${literal(JSON.stringify(full.storagePolicies))}::jsonb) e where to_jsonb(p)=e))`;
  const digestQuery = catalogDigestQuery(catalogSql);
  const transitions: LegacyTransition[] = [];
  for (const p of profiles.filter(p => p.name !== 'fresh-empty')) {
    const target = p.name.startsWith('manual-') ? manual : full;
    const hasProgressEvidence = ['sb_challenge_solves', 'sb_projects'].every(n => p.catalog.tables.some(t => t.name === n)) && p.catalog.columns.some(c => c.table === 'sb_problems' && c.name === 'class_id');
    const evidenceQuery = `select jsonb_build_object('seedMissing',${missingSeeds},'seedOutdated',${staleSeeds},'storageMissing',${storageEvidence},'dataConflict',${duplicateSeeds}+${storageBucketConflict}+${storagePolicyConflict}+${identityConflicts},'progressMissing',${hasProgressEvidence ? progressEvidence : '0'},'duplicateSeedCount',${duplicateSeeds},'storageBucketConflictCount',${storageBucketConflict},'storagePolicyConflictCount',${storagePolicyConflict},'seedIdentityConflictCount',${identityConflicts},'customizedSeedCount',${customizedSeeds},'classProblemCount',${classProblems},'duplicateSeedReferencedCount',${referencedDuplicates}) as evidence`;
    const ddl = p.name === previous.name
      // Preserve the already reviewed manual RPC bodies/defaults, apply the exact
      // existing delta inside our stronger whole-catalog transaction guard.
      ? originalDelta.replace(/^begin;$/m, '').replace(/^commit;$/m, '')
      : schemaDelta(p.catalog, target.catalog);
    const protect = preservationGuard(p.catalog);
    const locks = p.catalog.tables.map(t => `public.${identifier(t.name)}`).sort().join(',');
    const guard = (digest: string) => `do $catalog$ declare actual text; begin select digest into actual from (${digestQuery}) d; if actual is distinct from ${literal(digest)} then raise exception 'INSTALLER_CATALOG_CHANGED'; end if; end $catalog$;`;
    const latestEvidence = evidenceQuery.replace(hasProgressEvidence ? progressEvidence : "'progressMissing',0", hasProgressEvidence ? progressEvidence : `'progressMissing',${progressEvidence}`);
    const query = `begin;
set local lock_timeout='5s'; set local statement_timeout='60s';
set local search_path=pg_catalog,public;
select pg_advisory_xact_lock(hashtext('sb_installer_legacy_upgrade_v1'));
lock table ${locks} in access exclusive mode;
${guard(p.digest)}
${protect.before}
${ddl}
${seedInsert}
${corrections.join('\n')}
${storageDelta}
${progressSql}
${protect.after}
${guard(target.digest)}
do $evidence$ declare outcome jsonb; begin select evidence into outcome from (${latestEvidence}) q; if exists(select 1 from jsonb_each_text(outcome) where key in ('seedMissing','seedOutdated','storageMissing','progressMissing','dataConflict') and value::int<>0) then raise exception 'INSTALLER_DATA_POSTCONDITION_FAILED'; end if; end $evidence$;
commit;`;
    transitions.push({ from: p.name, to: target.name, query, evidenceQuery, dataMigrations: [2, 5, 8, 12, 22, 24] });
  }
  return { migrationHashes: hashes, transitions };
}
