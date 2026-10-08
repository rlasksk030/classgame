import { InstallerError, type InstallerTarget } from "./contract.ts";
import type { SupabaseManagementBackend } from "./management-api.ts";
import { assertTargetBinding } from './security.ts';

interface FetchLike {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface TeacherAccountResult {
  created: boolean;
  alreadyExists: boolean;
}

export interface TeacherAccountProvisioner {
  createTeacherAccount(target: InstallerTarget, email: string, password: string): Promise<TeacherAccountResult>;
}

/**
 * Creates a Supabase Auth user directly on the installed project, so a teacher
 * never has to open the Supabase Dashboard and add an Auth user by hand.
 *
 * The service_role key is fetched server-side via the Management API,
 * wrapped in an EphemeralCredential the instant it is read, used exactly
 * once for this one admin call, and disposed in a `finally` block. It is
 * never logged, stored, or sent to the browser.
 */
export class ManagementTeacherAccountProvisioner implements TeacherAccountProvisioner {
  readonly #management: SupabaseManagementBackend;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(management: SupabaseManagementBackend, fetchImpl: FetchLike = fetch, timeoutMs = 15_000) {
    this.#management = management;
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
  }

  async createTeacherAccount(target: InstallerTarget, email: string, password: string): Promise<TeacherAccountResult> {
    assertTargetBinding(target);
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) throw new InstallerError("INSTALLER_TEACHER_ACCOUNT_EMAIL_INVALID", "target", "이메일 주소를 확인해 주세요.");
    if (password.length < 8) throw new InstallerError("INSTALLER_TEACHER_ACCOUNT_PASSWORD_WEAK", "target", "비밀번호는 8자 이상이어야 합니다.");
    const serviceRole = await this.#management.getServiceRoleCredential(target);
    if (!serviceRole) throw new InstallerError("INSTALLER_TEACHER_ACCOUNT_KEY_MISSING", "target", "교사 계정을 만들 권한 키를 찾을 수 없습니다.");
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new InstallerError('INSTALLER_TEACHER_ACCOUNT_TIMEOUT', 'target', '교사 계정 생성 응답이 늦습니다. 먼저 로그인을 확인한 뒤 다시 시도해 주세요.')); }, this.#timeoutMs); });
    try {
      // A timed-out create can already have succeeded upstream. Never retry
      // this write automatically; the normal duplicate-email path is safe.
      return await Promise.race([deadline, serviceRole.use(async (key) => {
        const response = await this.#fetch(`https://${target.projectRef}.supabase.co/auth/v1/admin/users`, {
          method: "POST",
          redirect: 'error',
          signal: controller.signal,
          headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ email: trimmedEmail, password, email_confirm: true }),
        });
        if (response.status === 400 || response.status === 422) {
          const body: unknown = await response.json().catch(() => undefined);
          const detail = body && typeof body === "object" ? String((body as { msg?: unknown }).msg ?? (body as { message?: unknown }).message ?? "") : "";
          if (/already.*registered|already exists|duplicate/i.test(detail)) return { created: false, alreadyExists: true };
          throw new InstallerError("INSTALLER_TEACHER_ACCOUNT_REJECTED", "target", "교사 계정을 만들지 못했습니다. 이메일 형식을 확인해 주세요.");
        }
        if (!response.ok) throw new InstallerError("INSTALLER_TEACHER_ACCOUNT_FAILED", "target", "교사 계정을 만들지 못했습니다.");
        return { created: true, alreadyExists: false };
      })]);
    } catch (error) {
      if (error instanceof InstallerError) throw error;
      throw new InstallerError('INSTALLER_TEACHER_ACCOUNT_FAILED', 'target', '교사 계정을 만들지 못했습니다. 연결 상태를 확인해 주세요.');
    } finally {
      clearTimeout(timeout);
      serviceRole.dispose();
    }
  }
}
