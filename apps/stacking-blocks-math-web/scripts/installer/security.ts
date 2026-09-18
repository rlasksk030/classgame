import { randomBytes } from "node:crypto";
import { InstallerError } from "./contract.ts";

const SECRET_NAMES = /(?:token|secret|password|pin|authorization|service[_-]?role|access[_-]?key)/i;

export function generateFunctionSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function redactInstallerValue(value: unknown): string {
  if (typeof value !== "string") return "[REDACTED]";
  return SECRET_NAMES.test(value) ? "[REDACTED]" : value;
}

export function redactInstallerObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactInstallerObject);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SECRET_NAMES.test(key) ? "[REDACTED]" : redactInstallerObject(child);
  }
  return output;
}

export function assertSafeTarget(target: { environment: string; projectRef: string }, productionRef: string): void {
  if (target.environment === "PRODUCTION" || target.projectRef === productionRef) {
    throw new InstallerError("PRODUCTION_TARGET_BLOCKED", "target", "운영 프로젝트에는 설치할 수 없습니다.");
  }
}

export function assertTargetBinding(target: { projectRef: string; projectUrl: string }): void {
  let url: URL;
  try { url = new URL(target.projectUrl); } catch { throw new InstallerError("INSTALLER_TARGET_URL_INVALID", "target", "Supabase 프로젝트 주소가 올바르지 않습니다."); }
  if (url.protocol !== "https:" || !/^[a-z0-9-]{8,64}$/.test(target.projectRef)) throw new InstallerError("INSTALLER_TARGET_URL_INVALID", "target", "Supabase 프로젝트 주소가 올바르지 않습니다.");
  const expectedHost = `${target.projectRef}.supabase.co`;
  if (url.hostname !== expectedHost) throw new InstallerError("INSTALLER_TARGET_MISMATCH", "target", "Supabase 프로젝트 주소와 ID가 일치하지 않습니다.");
}

/** Keeps privileged credentials outside returned state and logging paths. */
export class EphemeralCredential {
  #value: string | undefined;

  constructor(value: string) {
    if (!value.trim()) throw new InstallerError("INSTALLER_CREDENTIAL_MISSING", "target", "설치 권한 연결이 필요합니다.");
    this.#value = value;
  }

  use<T>(fn: (value: string) => Promise<T>): Promise<T> {
    if (!this.#value) return Promise.reject(new InstallerError("INSTALLER_CREDENTIAL_DISPOSED", "target", "설치 권한 연결이 만료되었습니다."));
    return fn(this.#value);
  }

  dispose(): void {
    this.#value = undefined;
  }

  get disposed(): boolean {
    return this.#value === undefined;
  }
}
