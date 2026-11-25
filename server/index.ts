import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import express from 'express';
import { isScenario, isSize, scenarios } from '../src/domain';
import { makeDraft } from './draft';
import { createStore, WorkflowError } from './store';

const app = express();
const store = createStore();
const port = Number(process.env.PORT ?? 4177);
const host = process.env.HOST ?? '127.0.0.1';
const options = process.env.LIVE_AI === '1' && process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL
  ? { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL }
  : undefined;
const inFlight = new Set<string>();
let liveCalls = 0;
app.disable('x-powered-by');
app.use('/api', express.json({ limit: '4kb' }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'GET' && !req.is('application/json')) {
    res.status(415).json({ error: 'JSON 요청만 지원해요.' });
    return;
  }
  const candidate = req.headers.cookie?.match(/(?:^|;\s*)afterorder=([a-f\d-]{36})(?:;|$)/u)?.[1];
  res.locals.session = candidate ?? randomUUID();
  if (!candidate) res.cookie('afterorder', res.locals.session, {
    httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 3_600_000,
  });
  next();
});

app.get('/api/state', (_req, res) => {
  res.json({ state: store.get(res.locals.session), liveEnabled: !!options });
});
app.post('/api/reset', (_req, res) => {
  res.json({ state: store.reset(res.locals.session) });
});
app.post('/api/claims', (req, res) => {
  const { order, size, memo } = req.body ?? {};
  if (!isScenario(order) || (size !== null && !isSize(size)) || typeof memo !== 'string' || memo.length > 350) {
    throw new WorkflowError('신청 내용을 다시 확인해 주세요.', 400);
  }
  const result = store.submit(res.locals.session, order, size, memo.trim());
  res.status(result.duplicate ? 200 : 201).json(result);
});
app.post('/api/claims/:order/decision', (req, res) => {
  const order = req.params.order;
  const { action, size } = req.body ?? {};
  if (!isScenario(order) || !['approve', 'request-info', 'confirm-size'].includes(action) ||
    (action === 'confirm-size' && !isSize(size))) {
    throw new WorkflowError('처리 내용을 다시 확인해 주세요.', 400);
  }
  res.json({ state: store.decide(res.locals.session, order, action, size) });
});
app.post('/api/claims/:order/draft', async (req, res) => {
  const order = req.params.order;
  const session: string = res.locals.session;
  if (!isScenario(order)) throw new WorkflowError('주문을 찾을 수 없어요.', 404);
  const snapshot = store.get(session);
  const claim = snapshot.claims[order];
  if (!claim || claim.status === 'approved') throw new WorkflowError('검토할 수 있는 접수 건이 없어요.');
  if (claim.draft) { res.json({ state: snapshot }); return; }
  if (inFlight.has(session)) throw new WorkflowError('초안을 아직 준비 중이에요.');

  // Only the built-in sample strings may leave the demo, even when live AI is enabled.
  const live = claim.memo === scenarios[order].memo && liveCalls < 20 ? options : undefined;
  if (live) liveCalls++;
  inFlight.add(session);
  try {
    const draft = await makeDraft(claim.memo, live);
    res.json({ state: store.saveDraft(session, order, claim.id, draft) });
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    res.json({
      state: store.saveDraft(session, order, claim.id, await makeDraft(claim.memo)),
      notice: '모델에 연결하지 못해 데모 예시로 표시했어요.',
    });
  } finally {
    inFlight.delete(session);
  }
});
app.use('/api', (_req, res) => res.status(404).json({ error: '요청을 찾을 수 없어요.' }));

if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true } });
  app.use(vite.middlewares);
} else {
  app.use(express.static(resolve('dist')));
  app.get('/', (_req, res) => res.sendFile(resolve('dist/index.html')));
}
const onError: express.ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof WorkflowError) { res.status(error.status).json({ error: error.message }); return; }
  if (error instanceof SyntaxError) { res.status(400).json({ error: '요청 형식이 올바르지 않아요.' }); return; }
  res.status(500).json({ error: '처리하지 못했어요. 잠시 후 다시 시도해 주세요.' });
};
app.use(onError);
app.listen(port, host, () => console.log(`Afterorder: http://${host}:${port}`));
