import { projectRefFromUrl, validateRuntimeSupabaseConfig, type RuntimeSupabaseConfig } from './config.ts';
import { InstallerClientError, type InstallerAccessibleProject, type InstallerClient, type InstallerPublicTarget, type InstallerStatusResponse } from './installerClient.ts';

export type VerifiedInstallerSession = { target: InstallerPublicTarget; status: InstallerStatusResponse };

/** Recovery comes only from persisted public config, never a typed project ref. */
export function existingInstallerTarget(config: RuntimeSupabaseConfig | null): InstallerPublicTarget | undefined {
  if (!config) return undefined;
  const projectRef = projectRefFromUrl(config.supabaseUrl);
  if (!projectRef || !/^[a-z0-9-]{8,64}$/.test(projectRef) || config.supabaseUrl !== `https://${projectRef}.supabase.co`) {
    throw new InstallerClientError('INSTALLER_EXISTING_CONFIG_INVALID', 0, '기존 설치 정보의 프로젝트 주소가 일치하지 않습니다. 기존 설치 링크를 확인해 주세요.');
  }
  return { projectRef, projectUrl: config.supabaseUrl, release: 'spatial-math-v1' };
}

/** Public local config is not proof of authorization. This GET must use the
 * HttpOnly session cookie issued by this bind (or restored after a reload). */
export async function verifyInstallerSession(client: InstallerClient, target: InstallerPublicTarget): Promise<VerifiedInstallerSession> {
  const status = await client.getStatus(target);
  if (!['DRIFT_REQUIRES_REVIEW', 'NEW', 'PARTIAL', 'INSTALLED', 'UPDATE_REQUIRED', 'BROKEN'].includes(status.status)) {
    throw new InstallerClientError('INSTALLER_STATUS_UNVERIFIED', 0, '설치 세션의 상태를 확인하지 못했습니다. 다시 연결해 주세요.');
  }
  return { target, status };
}

export async function bindInstallerOAuthProject(
  client: InstallerClient,
  project: InstallerAccessibleProject,
  installationId: string,
  expectedProjectRef: string | null,
  verifyPublicConnection: (url: string, key: string) => Promise<void>,
  savedConfig?: RuntimeSupabaseConfig | null,
): Promise<VerifiedInstallerSession & { config: RuntimeSupabaseConfig }> {
  if (expectedProjectRef && project.ref !== expectedProjectRef) {
    throw new InstallerClientError('INSTALLER_TARGET_MISMATCH', 403, '기존 수업 프로젝트와 다른 프로젝트입니다. 기존 프로젝트를 선택해 주세요.');
  }
  const projectUrl = `https://${project.ref}.supabase.co`;
  const cached = savedConfig && existingInstallerTarget(savedConfig)?.projectRef === project.ref && validateRuntimeSupabaseConfig(savedConfig) ? savedConfig.supabasePublishableKey : undefined;
  const result = await client.createSession({ projectRef: project.ref, projectUrl, release: 'spatial-math-v1', ...(cached ? {publishableKey: cached} : {}) });
  if (result.status !== 'AUTHORIZED') {
    throw new InstallerClientError('INSTALLER_SESSION_REQUIRED', 401, '연결 세션의 권한을 확인하지 못했습니다. 다시 연결해 주세요.');
  }
  if (result.publicKeyError) {
    const code = result.publicKeyError.code;
    const message = code === 'INSTALLER_PUBLIC_KEY_UNAUTHORIZED' ? 'Supabase 설치 권한이 만료되었습니다. 선택한 프로젝트를 유지하고 Supabase를 다시 연결해 주세요.' : code === 'INSTALLER_PUBLIC_KEY_FORBIDDEN' ? '프로젝트는 연결되었지만 Supabase 계정의 API 키 조회 권한이 없습니다. 권한을 확인한 뒤 같은 프로젝트에서 다시 시도해 주세요.' : code === 'INSTALLER_PUBLIC_KEY_RATE_LIMITED' ? '공개 키 조회 요청이 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.' : code.startsWith('INSTALLER_PUBLIC_KEY_PROBE_') ? '공개 키를 받았지만 프로젝트 연결 확인에 실패했습니다. 선택한 프로젝트에서 다시 시도해 주세요.' : '프로젝트는 연결되었지만 사용 가능한 공개 키를 확인하지 못했습니다. 선택한 프로젝트에서 다시 시도해 주세요.';
    throw new InstallerClientError(code, 0, message);
  }
  const config = { installationId, supabaseUrl: projectUrl, supabasePublishableKey: result.publishableKey ?? '' };
  if (!validateRuntimeSupabaseConfig(config)) {
    throw new InstallerClientError('INSTALLER_PUBLIC_CONFIG_MISSING', 0, '프로젝트의 공개 연결 키를 확인하지 못했습니다. 다시 연결해 주세요.');
  }
  const verified = await verifyInstallerSession(client, { projectRef: project.ref, projectUrl, publishableKey: config.supabasePublishableKey, release: 'spatial-math-v1' });
  await verifyPublicConnection(projectUrl, config.supabasePublishableKey);
  return { ...verified, config };
}

/** Never return to the teacher on a failed/partial update. An already
 * installed session needs no mutation; all other states require completion
 * and a second cookie-authenticated status check. */
export async function completeInstallerReconnect(client: InstallerClient, verified: VerifiedInstallerSession): Promise<void> {
  if (verified.status.status === 'INSTALLED') return;
  if (verified.status.status === 'DRIFT_REQUIRES_REVIEW') {
    throw new InstallerClientError('INSTALLER_MANUAL_REVIEW_REQUIRED', 409, '자동 업데이트로 변경하기 전에 확인이 필요합니다.');
  }
  const job = await client.update(verified.target);
  if (job.status !== 'COMPLETE') {
    throw new InstallerClientError('INSTALLER_UPDATE_INCOMPLETE', 0, '업데이트가 완료되지 않았습니다. 상태를 확인한 뒤 다시 시도해 주세요.');
  }
  const after = await verifyInstallerSession(client, verified.target);
  if (after.status.status !== 'INSTALLED') {
    throw new InstallerClientError('INSTALLER_UPDATE_UNVERIFIED', 0, '업데이트 후 설치 완료 상태를 확인하지 못했습니다. 다시 확인해 주세요.');
  }
}
