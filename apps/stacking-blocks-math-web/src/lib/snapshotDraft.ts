import type { BlockCoord } from '../../shared/types.ts';
export interface SnapshotDraft { blocks: BlockCoord[]; revision: string; dirty: boolean }
/** Identity is only a local namespace. Server authorization never relies on this value. */
export function draftKey(token: string | null, problemId: string): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.sid !== 'string' || typeof payload.cid !== 'string') return null;
    return `sb.draft.${payload.cid}.${payload.sid}.${problemId}`;
  } catch { return null; }
}
export function readDraft(key: string | null): SnapshotDraft | null {
  try { return key ? JSON.parse(localStorage.getItem(key) ?? 'null') : null; } catch { return null; }
}
export function writeDraft(key: string | null, blocks: BlockCoord[]): SnapshotDraft | null {
  if (!key) return null;
  const draft = { blocks, revision: crypto.randomUUID(), dirty: true };
  try { localStorage.setItem(key, JSON.stringify(draft)); return draft; } catch { return null; }
}
export function acknowledgeDraft(key: string | null, revision: string) {
  const current = readDraft(key);
  if (!key || current?.revision !== revision) return;
  try { localStorage.setItem(key, JSON.stringify({ ...current, dirty: false })); } catch { /* Keep recoverable draft. */ }
}
