/** Shape checks only. A key becomes usable only after the selected project's
 * Auth endpoint accepts it; decoding a JWT is not signature verification. */
export function publicKeyKind(value: unknown, projectRef: string): 'publishable' | 'anon' | undefined {
  if (typeof value !== 'string' || value !== value.trim()) return undefined;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return 'publishable';
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload?.role === 'anon' && (payload.ref === undefined || payload.ref === projectRef)) return 'anon';
  } catch { /* Not a public JWT. Never log its contents. */ }
  return undefined;
}
export function activeApiKey(item: Record<string, unknown>): boolean {
  return item.disabled !== true && item.enabled !== false && !item.revoked_at && !item.deleted_at &&
    (item.status === undefined || item.status === null || ['active','enabled','ACTIVE','ENABLED'].includes(String(item.status)));
}
