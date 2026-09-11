import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

/**
 * 교사용 Supabase 클라이언트 (Supabase Auth).
 * anon key 만 쓴다. service_role key 는 프런트엔드에 절대 넣지 않는다 (명세 8).
 * 학생 경로는 이 클라이언트를 쓰지 않고 Edge Function 만 호출한다.
 */
let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "Supabase 설정이 없습니다. .env.local 에 VITE_SUPABASE_URL 과 VITE_SUPABASE_PUBLISHABLE_KEY 를 넣어 주세요.",
    );
  }
  if (!cached) cached = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return cached;
}
