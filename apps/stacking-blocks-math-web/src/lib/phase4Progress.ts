import type { Lesson12ProgressRecord, ProgressRepository } from '../../shared/phase4.ts';

export interface ReviewSessionState { seed: number; index: number; answers: Record<string, unknown>; done: Record<string, boolean>; records: Record<string, Lesson12ProgressRecord>; practiceCount: 5 | 10 | 15 | 20; selfEvaluation: { confidence?: number; favoriteConcept?: string; selfPraise?: string }; }

export class LocalProgressRepository implements ProgressRepository {
  constructor(private readonly key: string) {}
  private read(): Record<string, Lesson12ProgressRecord> { try { return JSON.parse(localStorage.getItem(`${this.key}:records`) ?? '{}') as Record<string, Lesson12ProgressRecord>; } catch { return {}; } }
  async save(record: Lesson12ProgressRecord) { const rows = this.read(); rows[record.problemId] = record; try { localStorage.setItem(`${this.key}:records`, JSON.stringify(rows)); } catch { /* private mode */ } }
  async load(scope: Pick<Lesson12ProgressRecord, 'installationId'|'classId'|'studentId'|'lessonId'|'setId'>) { return Object.values(this.read()).filter(row => row.installationId === scope.installationId && row.classId === scope.classId && row.studentId === scope.studentId && row.lessonId === scope.lessonId && row.setId === scope.setId).sort((a, b) => a.questionIndex - b.questionIndex); }
  readSession(fallbackSeed = 1): ReviewSessionState { try { const value = JSON.parse(localStorage.getItem(`${this.key}:session`) ?? 'null') as Partial<ReviewSessionState> | null; if (value && typeof value === 'object') { const count = [5, 10, 15, 20].includes(Number(value.practiceCount)) ? Number(value.practiceCount) as ReviewSessionState['practiceCount'] : 5; return { seed: Number(value.seed) || fallbackSeed, index: Number(value.index) || 0, answers: value.answers ?? {}, done: value.done ?? {}, records: value.records ?? {}, practiceCount: count, selfEvaluation: value.selfEvaluation ?? {} }; } } catch { /* ignore malformed local data */ } return { seed: fallbackSeed, index: 0, answers: {}, done: {}, records: {}, practiceCount: 5, selfEvaluation: {} }; }
  writeSession(state: ReviewSessionState) { try { localStorage.setItem(`${this.key}:session`, JSON.stringify(state)); localStorage.setItem(`${this.key}:seed`, String(state.seed)); } catch { /* private mode */ } }
}
