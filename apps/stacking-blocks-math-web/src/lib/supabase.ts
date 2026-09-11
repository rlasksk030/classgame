import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getResolvedSupabaseConfig } from "./config.ts";

/**
 * 교사용 Supabase 클라이언트 (Supabase Auth).
 * anon key 만 쓴다. service_role key 는 프런트엔드에 절대 넣지 않는다 (명세 8).
 * 학생 경로는 이 클라이언트를 쓰지 않고 Edge Function 만 호출한다.
 */
let cached: SupabaseClient | null = null;
let cachedFor = "";

export function getSupabase(): SupabaseClient {
  const config = getResolvedSupabaseConfig();
  if (!config) {
    throw new Error(
      "Supabase 설정이 없습니다. /setup에서 공개 연결 설정을 등록해 주세요.",
    );
  }
  const cacheKey = `${config.supabaseUrl}|${config.supabasePublishableKey}`;
  if (!cached || cachedFor !== cacheKey) {
    cached = createClient(config.supabaseUrl, config.supabasePublishableKey);
    cachedFor = cacheKey;
  }
  return cached;
}
