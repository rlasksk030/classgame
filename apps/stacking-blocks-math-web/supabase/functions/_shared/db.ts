import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@^2.45.4";

/**
 * service_role 클라이언트.
 * 이 키는 Edge Function 안에서만 존재하며, 프런트엔드 번들에 들어가지 않는다 (명세 8).
 */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase 환경변수가 없습니다.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** 호출자가 로그인한 교사인지 확인하고 user id 를 돌려준다. */
export async function requireTeacher(req: Request): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return null;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;

  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

/** 그 학급이 이 교사 것인지 확인한다. */
export async function teacherOwnsClass(
  db: SupabaseClient,
  teacherId: string,
  classId: string,
): Promise<boolean> {
  const { data } = await db
    .from("sb_classes")
    .select("id")
    .eq("id", classId)
    .eq("teacher_id", teacherId)
    .maybeSingle();
  return Boolean(data);
}
