import { InstallerError, type InstallerTarget } from "./contract.ts";
import type { SupabaseManagementBackend } from "./management-api.ts";

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

  constructor(management: SupabaseManagementBackend, fetchImpl: FetchLike = fetch) {
    this.#management = management;
    this.#fetch = fetchImpl;
  }

  async createTeacherAccount(target: InstallerTarget, email: string, password: string): Promise<TeacherAccountResult> {
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) throw new InstallerError("INSTALLER_TEACHER_ACCOUNT_EMAIL_INVALID", "target", "이메일 주소를 확인해 주세요.");
    if (password.length < 8) throw new InstallerError("INSTALLER_TEACHER_ACCOUNT_PASSWORD_WEAK", "target", "비밀번호는 8자 이상이어야 합니다.");
    const serviceRole = await this.#management.getServiceRoleCredential(target);
    if (!serviceRole) throw new InstallerError("INSTALLER_TEACHER_ACCOUNT_KEY_MISSING", "target", "교사 계정을 만들 권한 키를 찾을 수 없습니다.");
    try {
      return await serviceRole.use(async (key) => {
        const response = await this.#fetch(`${target.projectUrl.replace(/\/$/, "")}/auth/v1/admin/users`, {
          method: "POST",
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
      });
    } finally {
      serviceRole.dispose();
    }
  }
}
