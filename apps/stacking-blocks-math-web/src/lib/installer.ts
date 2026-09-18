import { INSTALLATION_CONFIG_KEY } from "./config.ts";

export const INSTALLER_PROGRESS_KEY = "stacking-installer-progress";

export type InstallerStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface InstallerProgress {
  installationId: string;
  step: InstallerStep;
  classId?: string;
  className?: string;
  studentCount?: number;
  updatedAt: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function validStep(value: unknown): value is InstallerStep {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 8;
}

export function readInstallerProgress(installationId: string): InstallerProgress | null {
  if (!isBrowser() || !installationId) return null;
  try {
    const raw = localStorage.getItem(INSTALLER_PROGRESS_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<InstallerProgress>;
    if (candidate.installationId !== installationId || !validStep(candidate.step)) return null;
    return {
      installationId,
      step: candidate.step,
      classId: typeof candidate.classId === "string" ? candidate.classId : undefined,
      className: typeof candidate.className === "string" ? candidate.className : undefined,
      studentCount: typeof candidate.studentCount === "number" ? candidate.studentCount : undefined,
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
    };
  } catch {
    return null;
  }
}

/** 설치 위치만 저장한다. 교사 비밀번호, PIN, access token은 저장하지 않는다. */
export function saveInstallerProgress(progress: InstallerProgress): void {
  if (!isBrowser()) return;
  localStorage.setItem(INSTALLER_PROGRESS_KEY, JSON.stringify({ ...progress, updatedAt: new Date().toISOString() }));
}

export function clearInstallerProgress(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(INSTALLER_PROGRESS_KEY);
}

export function installerStorageIsScopedToInstallation(): boolean {
  if (!isBrowser()) return true;
  try {
    const config = localStorage.getItem(INSTALLATION_CONFIG_KEY);
    const progress = localStorage.getItem(INSTALLER_PROGRESS_KEY);
    if (!config || !progress) return true;
    const parsedConfig = JSON.parse(config) as { installationId?: unknown };
    const parsedProgress = JSON.parse(progress) as { installationId?: unknown };
    return typeof parsedConfig.installationId === "string" && parsedConfig.installationId === parsedProgress.installationId;
  } catch {
    return false;
  }
}
