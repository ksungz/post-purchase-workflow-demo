import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessExchange, initialStock, scenarios } from '../src/domain';
import { groundedEvidence, makeDraft, memoSentences } from '../server/draft';
import { createStore } from '../server/store';

test('the deadline is inclusive and unchanged sizes are rejected', () => {
  assert.equal(assessExchange('L', initialStock, '2026-11-21', '2026-11-28'), 'received');
  assert.equal(assessExchange('L', initialStock, '2026-11-21', '2026-11-29'), 'expired');
  assert.equal(assessExchange('M', initialStock, '2026-11-21'), 'same-option');
});

test('repeated submissions preserve the original request and session isolation', (t) => {
  const store = createStore();
  t.after(store.close);
  const first = store.submit('visitor-a', 'standard', 'L', '원본');
  const second = store.submit('visitor-a', 'standard', 'S', '다른 요청');
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.deepEqual(second.state.claims.standard, first.state.claims.standard);
  assert.deepEqual(store.get('visitor-b').claims, {});
});

test('approval allocates stock exactly once, even if the decision is repeated', (t) => {
  const store = createStore();
  t.after(store.close);
  store.submit('visitor', 'standard', 'L', '');
  const approved = store.decide('visitor', 'standard', 'approve');
  assert.equal(approved.claims.standard?.status, 'approved');
  assert.equal(approved.stock.L, initialStock.L - 1);
  assert.throws(() => store.decide('visitor', 'standard', 'approve'), /이미 승인/);
  assert.equal(store.get('visitor').stock.L, initialStock.L - 1);
});

test('approval checks current inventory even if a request was eligible at intake', (t) => {
  const store = createStore();
  t.after(store.close);
  for (const order of ['standard', 'soldout', 'unclear'] as const) store.submit('visitor', order, 'L', '');
  store.decide('visitor', 'standard', 'approve');
  store.decide('visitor', 'soldout', 'approve');
  assert.throws(() => store.decide('visitor', 'unclear', 'approve'), /재고를 확인/);
  assert.equal(store.get('visitor').stock.L, 0);
});

test('stock and unknown sizes block approval until confirmed by an operator', (t) => {
  const store = createStore();
  t.after(store.close);
  const soldout = store.submit('visitor', 'soldout', 'XL', '');
  assert.equal(soldout.state.claims.soldout?.status, 'out-of-stock');
  assert.throws(() => store.decide('visitor', 'soldout', 'approve'), /재고를 확인/);
  const unclear = store.submit('visitor', 'unclear', null, scenarios.unclear.memo);
  assert.equal(unclear.state.claims.unclear?.status, 'needs-info');
  assert.throws(() => store.decide('visitor', 'unclear', 'approve'), /재고를 확인/);
  store.decide('visitor', 'unclear', 'request-info');
  assert.equal(store.decide('visitor', 'unclear', 'confirm-size', 'S').claims.unclear?.status, 'received');
  assert.equal(store.decide('visitor', 'unclear', 'approve').stock.S, initialStock.S - 1);
});

test('a draft cannot fill an unknown size, approve a claim, or reserve stock', async (t) => {
  const store = createStore();
  t.after(store.close);
  const claim = store.submit('visitor', 'unclear', null, scenarios.unclear.memo).state.claims.unclear!;
  const draft = await makeDraft(claim.memo);
  const state = store.saveDraft('visitor', 'unclear', claim.id, draft);
  assert.equal(state.claims.unclear?.size, null);
  assert.equal(state.claims.unclear?.status, 'needs-info');
  assert.deepEqual(state.stock, initialStock);
  assert.deepEqual(draft, { source: 'sample', evidence: [scenarios.unclear.memo] });
  store.reset('visitor');
  store.submit('visitor', 'unclear', null, 'new');
  assert.throws(() => store.saveDraft('visitor', 'unclear', claim.id, draft), /상태가 바뀌었어요/);
});

test('only exact input snippets can become live evidence', () => {
  const parts = memoSentences('사이즈가 작아요. 한 사이즈 큰 걸로 바꿔주세요.');
  assert.deepEqual(groundedEvidence(parts, [1]), ['한 사이즈 큰 걸로 바꿔주세요.']);
  assert.deepEqual(groundedEvidence(parts, []), []);
  for (const invalid of [[-1], [5], [0, 1, 0], ['L'], { index: 1 }, null]) {
    assert.throws(() => groundedEvidence(parts, invalid), /Invalid evidence/);
  }
});

test('the optional provider accepts a valid selection and rejects invented evidence', async (t) => {
  const options = { key: 'test-only', model: 'test-model' };
  let indexes: unknown = [1];
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    choices: [{ message: { content: JSON.stringify({ indexes }) } }],
  }));
  const memo = '잘 받았습니다. 한 사이즈 큰 걸로 바꿔주세요.';
  assert.deepEqual(await makeDraft(memo, options), { source: 'live', evidence: ['한 사이즈 큰 걸로 바꿔주세요.'] });
  indexes = ['L로 교환'];
  await assert.rejects(makeDraft(memo, options), /Invalid evidence/);
});
