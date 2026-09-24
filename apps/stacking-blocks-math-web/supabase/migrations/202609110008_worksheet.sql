-- 2026-09-24: worksheet import UI removed from the teacher page
-- (WorksheetImportPage.tsx / /teacher/worksheet-import deleted). This
-- table, its RLS policy, and the sb-worksheets/sb-problem-images
-- storage buckets below are left untouched for data preservation and
-- rollback; sb-problem-images also backs unrelated problem-image
-- display in student-api, so it stays in use regardless.
alter table public.sb_problems add column if not exists image_path text;
create table public.sb_worksheet_imports (
 id uuid primary key default gen_random_uuid(),teacher_id uuid not null references auth.users(id),class_id uuid not null references public.sb_classes(id),
 filename text not null,storage_path text not null,status text not null default 'UPLOADED' check(status in ('UPLOADED','REVIEW','APPROVED','PUBLISHED')),created_at timestamptz not null default now()
);
alter table public.sb_worksheet_imports enable row level security;
create policy sb_worksheet_teacher on public.sb_worksheet_imports for all to authenticated
 using(teacher_id=auth.uid() and public.sb_owns_class(class_id)) with check(teacher_id=auth.uid() and public.sb_owns_class(class_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('sb-worksheets','sb-worksheets',false,20971520,array['application/pdf','image/png','image/jpeg','image/webp']),
 ('sb-problem-images','sb-problem-images',false,5242880,array['image/png'])
on conflict(id) do nothing;
create policy sb_worksheet_files on storage.objects for all to authenticated
 using(bucket_id='sb-worksheets' and (storage.foldername(name))[1]=auth.uid()::text)
 with check(bucket_id='sb-worksheets' and (storage.foldername(name))[1]=auth.uid()::text);
create policy sb_problem_crops on storage.objects for all to authenticated
 using(bucket_id='sb-problem-images' and public.sb_owns_class(((storage.foldername(name))[1])::uuid))
 with check(bucket_id='sb-problem-images' and public.sb_owns_class(((storage.foldername(name))[1])::uuid));
