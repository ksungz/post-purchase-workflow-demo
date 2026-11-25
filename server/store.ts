import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { assessExchange, makeState, scenarios } from '../src/domain';
import type { Claim, DemoState, Draft, ScenarioId, Size } from '../src/domain';

export class WorkflowError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export function createStore() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, seen INTEGER NOT NULL)');
  const read = db.prepare('SELECT data FROM sessions WHERE id = ?');
  const save = db.prepare('INSERT INTO sessions VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, seen = excluded.seen');
  const prune = db.prepare('DELETE FROM sessions WHERE seen < ? OR id IN (SELECT id FROM sessions ORDER BY seen DESC LIMIT -1 OFFSET 300)');
  function get(session: string): DemoState {
    const row = read.get(session);
    return row ? JSON.parse(String(row.data)) as DemoState : makeState();
  }
  function put(session: string, state: DemoState) {
    const now = Date.now();
    save.run(session, JSON.stringify(state), now);
    prune.run(now - 3_600_000);
    return state;
  }
  function change(session: string, operation: (state: DemoState) => void) {
    // These synchronous reads and writes run inside one SQLite transaction.
    db.exec('BEGIN IMMEDIATE');
    try {
      const state = get(session);
      operation(state);
      put(session, state);
      db.exec('COMMIT');
      return state;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  function event(claim: Claim, label: string) {
    claim.history.push({ label, at: new Date().toISOString() });
  }
  function assessment(order: ScenarioId, size: Size | null, state: DemoState) {
    const status = assessExchange(size, state.stock, scenarios[order].delivery);
    if (status === 'expired') throw new WorkflowError('교환 신청 기한이 지났어요.');
    if (status === 'same-option') throw new WorkflowError('기존 주문과 다른 사이즈를 선택해 주세요.');
    return status;
  }

  return {
    get,
    reset: (session: string) => put(session, makeState()),
    submit(session: string, order: ScenarioId, size: Size | null, memo: string) {
      let duplicate = false;
      const state = change(session, (state) => {
        if (state.claims[order]) { duplicate = true; return; }
        const status = assessment(order, size, state);
        const claim: Claim = { id: randomUUID(), order, size, memo, status, draft: null, history: [] };
        event(claim, '고객이 교환을 신청했어요.');
        if (status === 'needs-info') event(claim, '희망 사이즈를 확인할 수 없어요.');
        if (status === 'out-of-stock') event(claim, '희망 사이즈의 재고가 없어요.');
        state.claims[order] = claim;
      });
      return { state, duplicate };
    },
    decide(session: string, order: ScenarioId, action: 'approve' | 'request-info' | 'confirm-size', size?: Size) {
      return change(session, (state) => {
        const claim = state.claims[order];
        if (!claim) throw new WorkflowError('접수 내역을 찾을 수 없어요.', 404);
        if (claim.status === 'approved') throw new WorkflowError('이미 승인된 교환이에요.');
        if (action === 'request-info') {
          if (claim.status === 'needs-info' && claim.history.some(({ label }) => label === '고객에게 추가 확인을 요청했어요. (데모 기록)')) return;
          claim.status = 'needs-info';
          event(claim, '고객에게 추가 확인을 요청했어요. (데모 기록)');
        } else if (action === 'confirm-size' && size) {
          claim.status = assessment(order, size, state);
          claim.size = size;
          event(claim, `운영자가 희망 사이즈를 ${size}(으)로 확인했어요.`);
        } else if (action === 'approve') {
          if (claim.status !== 'received' || !claim.size || assessment(order, claim.size, state) !== 'received') {
            throw new WorkflowError('희망 사이즈와 재고를 확인한 뒤 승인할 수 있어요.');
          }
          state.stock[claim.size]--;
          claim.status = 'approved';
          event(claim, '운영자가 교환을 승인하고 재고 1개를 배정했어요.');
        } else {
          throw new WorkflowError('처리할 수 없는 요청이에요.', 400);
        }
      });
    },
    saveDraft(session: string, order: ScenarioId, id: string, draft: Draft) {
      return change(session, (state) => {
        const claim = state.claims[order];
        if (!claim || claim.id !== id || claim.status === 'approved') {
          throw new WorkflowError('접수 상태가 바뀌었어요. 최신 내역을 확인해 주세요.');
        }
        if (!claim.draft) {
          claim.draft = draft;
          event(claim, draft.source === 'live' ? 'AI가 검토용 근거를 골랐어요.' : '데모 검토 초안을 표시했어요.');
        }
      });
    },
    close: () => db.close(),
  };
}
