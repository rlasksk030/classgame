// Offline compiler for reviewed known-profile -> release transitions.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { catalogDigestQuery, identifier, literal, preservationGuard, schemaDelta } from './legacy-sql.ts';
import type { Catalog } from './database-state.ts';

export interface CapturedProfile { name: string; prefix: number; catalog: Catalog; digest: string; seeds: Record<string, unknown>[]; storagePolicies: Record<string, unknown>[] }
export interface LegacyTransition { from: string; to: string; query: string; evidenceQuery: string; dataMigrations: number[] }
export interface KnownSeedCorrection { code:'L1-03'; id:string; before:Record<string,unknown>; after:Record<string,unknown> }
export interface LegacyRecovery { migrationHashes: string[]; transitions: LegacyTransition[]; knownSeedCorrection?:KnownSeedCorrection }

// Only the fields changed by the historical corrective migration. Personal
// problems (class_id != null), activation flags, attempts and answer history stay put.
const correctionFields = ['problem_type', 'prompt', 'choices', 'answer', 'given_blocks', 'given'];
function content(row: Record<string, unknown>) { return Object.fromEntries(correctionFields.map(k => [k, row[k]])); }
const contentSql = `jsonb_build_object(${correctionFields.flatMap(k => [literal(k), `p.${identifier(k)}`]).join(',')})`;

/** One reviewed shipped defect, not a general seed overwrite policy. This
 * server-only contract authorizes no write by itself; the separate consent
 * planner must recheck the target row and all referenced learning records. */
export function compileKnownSeedCorrection(profiles:CapturedProfile[], full:CapturedProfile):KnownSeedCorrection {
  const fail=():never=>{throw new Error('KNOWN_SEED_CORRECTION_SOURCE_CHANGED');};
  const rows=full.seeds.filter(row=>row.code==='L1-03'&&row.class_id===null);
  if(rows.length!==1) return fail();
  const row=rows[0];
  if(row.id!=='95dd8f12-9215-430b-893c-d830c0368798') return fail();
  const after=content(row);
  const historical=profiles.filter(p=>p.prefix>0&&p.prefix<full.prefix).flatMap(p=>p.seeds.filter(s=>s.code==='L1-03'&&s.class_id===null));
  if(historical.some(s=>s.id!==row.id)) return fail();
  const variants=[...new Set(historical.map(s=>JSON.stringify(content(s))))].map(s=>JSON.parse(s) as Record<string,unknown>).filter(s=>!isDeepStrictEqual(s,after));
  if(variants.length!==1) return fail();
  const before=variants[0];
  if(correctionFields.some(k=>before[k]===undefined||after[k]===undefined)||before.problem_type!=='FREE_BUILD'||after.problem_type!=='FREE_BUILD'||!isDeepStrictEqual(before.answer,{kind:'count',value:6})||!isDeepStrictEqual(after.answer,{kind:'blocks',blocks:[]})||correctionFields.some(k=>k!=='answer'&&!isDeepStrictEqual(before[k],after[k]))) return fail();
  const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
  const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
  // Pin all six reviewed fields, including unchanged instructions/blocks. A
  // future source change requires a new explicit review, never a wider match.
  if(digest(before)!=='9ae71608349913413f7ffbd0bd5434152a89126a8e103be148c867c090928c81'||digest(after)!=='ef8a839a64c5c9376fa8e9ec480db85c95f8c0836518c5a944cd204c30624ce7') return fail();
  return {code:'L1-03',id:row.id,before,after};
}


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
  const corrections: string[] = []; const outdated: string[] = []; const outdatedDetails: Array<{code:unknown,predicate:string}> = [];
  for (const row of full.seeds) {
    const expected = content(row);
    const old = [...new Set(profiles.filter(p => p.prefix > 0 && p.prefix < 24).flatMap(p => p.seeds.filter(s => s.id === row.id).map(s => JSON.stringify(content(s)))))].filter(s => s !== JSON.stringify(expected));
    if (!old.length) continue;
    // JSON containment treats extra nested fields and reordered array choices as
    // a match. Only exact known content may ever be corrected automatically.
    const predicate = `p.class_id is null and p.id=${literal(row.id)}::uuid and (${old.map(s => `${contentSql} = ${literal(s)}::jsonb`).join(' or ')})`;
    outdated.push(`(select count(*)::int from public.sb_problems p where ${predicate})`);
    // Return checked-in codes and aggregate FK counts only, never the remote
    // row's ID/code/title/answer or any student/attempt payload.
    outdatedDetails.push({code:row.code,predicate});
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
    // Older profiles legitimately lack the Phase 5 tables. Only a proven absent
    // table means zero; an unexpected column contract yields unknown, not zero.
    const optionalReference = (table:string,column:string,type:string,query:string) => !p.catalog.tables.some(t=>t.name===table) ? '0' : p.catalog.columns.some(c=>c.table===table&&c.name===column&&c.type===type) ? query : 'null';
    const detailRows=outdatedDetails.map(({code,predicate})=>{
      const lessonProgress=optionalReference('sb_lesson_progress_records','problem_id','text',`(select count(*)::int from public.sb_lesson_progress_records r where r.problem_id in (p.id::text,${literal(code)},${literal(`seed:${code}`)}))`);
      // problem_ids accepts JSON in the current API. Inspect exact string values
      // recursively so nested containers are not silently counted as no usage.
      const practiceAssignment=optionalReference('sb_practice_assignments','problem_ids','jsonb',`(select count(*)::int from public.sb_practice_assignments a where jsonb_path_exists(a.problem_ids,'strict $.** ? (@ == $id || @ == $code || @ == $seed)',jsonb_build_object('id',p.id::text,'code',${literal(code)},'seed',${literal(`seed:${code}`)})))`);
      return `select jsonb_build_object('code',${literal(code)},'attemptCount',(select count(*)::int from public.sb_problem_attempts a where a.problem_id=p.id),'snapshotCount',(select count(*)::int from public.sb_block_snapshots b where b.problem_id=p.id),'progressCount',(select count(*)::int from public.sb_student_progress r where r.last_problem_id=p.id),'lessonProgressCount',${lessonProgress},'practiceAssignmentCount',${practiceAssignment}) detail from public.sb_problems p where ${predicate}`;
    });
    const staleDetails = detailRows.length ? `(select coalesce(jsonb_agg(d.detail order by d.detail->>'code'),'[]'::jsonb) from (${detailRows.join(' union all ')}) d)` : `'[]'::jsonb`;
    const evidenceQuery = `select jsonb_build_object('seedMissing',${missingSeeds},'seedOutdated',${staleSeeds},'storageMissing',${storageEvidence},'dataConflict',${duplicateSeeds}+${storageBucketConflict}+${storagePolicyConflict}+${identityConflicts},'progressMissing',${hasProgressEvidence ? progressEvidence : '0'},'duplicateSeedCount',${duplicateSeeds},'storageBucketConflictCount',${storageBucketConflict},'storagePolicyConflictCount',${storagePolicyConflict},'seedIdentityConflictCount',${identityConflicts},'customizedSeedCount',${customizedSeeds},'classProblemCount',${classProblems},'duplicateSeedReferencedCount',${referencedDuplicates},'outdatedSeedDetails',${staleDetails}) as evidence`;
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
do $evidence$ declare outcome jsonb; begin select evidence into outcome from (${latestEvidence}) q; if exists(select 1 from jsonb_each_text(outcome) where case when key in ('seedMissing','seedOutdated','storageMissing','progressMissing','dataConflict') then value::int<>0 else false end) then raise exception 'INSTALLER_DATA_POSTCONDITION_FAILED'; end if; end $evidence$;
commit;`;
    transitions.push({ from: p.name, to: target.name, query, evidenceQuery, dataMigrations: [2, 5, 8, 12, 22, 24] });
  }
  return { migrationHashes: hashes, transitions, knownSeedCorrection:compileKnownSeedCorrection(profiles,full) };
}
