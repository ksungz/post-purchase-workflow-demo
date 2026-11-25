import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDownUp, ArrowLeftRight, ArrowRight, Check, CheckCircle2, ChevronRight, CircleHelp, ClipboardList, Clock3, Inbox, LayoutDashboard, Package, RotateCcw, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { assessExchange, exchangeDeadline, makeState, orderedSize, product, scenarios, sizes, statuses } from './domain';
import type { Claim, DemoState, ScenarioId, Size } from './domain';
import './style.css';

type Result = { state: DemoState; duplicate?: boolean; notice?: string; liveEnabled?: boolean };
type View = 'customer' | 'operator';
const scenarioIds = Object.keys(scenarios) as ScenarioId[];
const timeFormat = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' });
const shortDate = (day: string) => day.replaceAll('-', '.');

async function readApi(path: string, body?: object): Promise<Result> {
  const response = await fetch('/api/' + path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? '연결을 확인해 주세요.');
  return result;
}

function Badge({ claim }: { claim: Claim }) {
  const { title, color } = statuses[claim.status];
  return <span className={`badge ${color}`}><i />{title}</span>;
}

function ProductRow({ order }: { order: ScenarioId }) {
  const item = scenarios[order];
  return <div className="product">
    <img src="/lilac-sweatshirt.jpg" alt="라일락색 코튼 스웨트셔츠" width="88" height="88" />
    <div className="product-text">
      <span className="meta">{item.orderNo}</span>
      <strong>{product.name}</strong>
      <span>{product.color} / {orderedSize} · 1개</span>
    </div>
    <strong className="price">{product.price}</strong>
  </div>;
}

function Timeline({ claim }: { claim: Claim }) {
  return <ol className="timeline">
    {[...claim.history].reverse().map(({ label, at }, index) => <li key={`${at}-${index}`}>
      <span>{label}</span><time dateTime={at}>{timeFormat.format(new Date(at))}</time>
    </li>)}
  </ol>;
}

function Intake({ order, state, busy, send, go }: {
  order: ScenarioId; state: DemoState; busy: boolean;
  send: (path: string, body: object, feedback: string) => Promise<boolean>;
  go: () => void;
}) {
  const scenario = scenarios[order];
  const claim = state.claims[order];
  const [size, setSize] = useState<Size | null>(scenario.size);
  const [memo, setMemo] = useState(scenario.memo as string);
  const assessment = assessExchange(size, state.stock, scenario.delivery);
  async function submit(event: FormEvent) {
    event.preventDefault();
    await send('claims', { order, size, memo }, '교환 신청을 저장했어요.');
  }

  return <section className="panel intake" aria-labelledby="order-title">
    <header className="panel-head"><h2 id="order-title">{claim ? '교환 내역' : '주문 상품'}</h2>
      {claim ? <Badge claim={claim} /> : <span className="badge success"><i />배송 완료</span>}</header>
    <ProductRow order={order} />
    {claim ? <>
      <dl className="order-dates"><div><dt>희망 사이즈</dt><dd>{claim.size ?? '미확인'}</dd></div>
        <div><dt>처리 상태</dt><dd>{statuses[claim.status].title}</dd></div></dl>
      <h3 className="field-title">처리 기록</h3><Timeline claim={claim} />
      <div className="panel-footer"><button className="button primary" onClick={go}>운영 콘솔에서 보기 <ArrowRight /></button></div>
    </> : <form onSubmit={submit}>
      <dl className="order-dates"><div><dt>배송 완료일</dt><dd>{shortDate(scenario.delivery)}</dd></div>
        <div><dt>교환 신청 기한</dt><dd>{shortDate(exchangeDeadline(scenario.delivery))}</dd></div></dl>
      <div className="form-body">
        <fieldset>
          <legend>희망 사이즈</legend>
          <div className="sizes">
            {[...sizes, null].map((option) => <label className={size === option ? 'selected' : ''} key={option ?? 'unknown'}>
              <input name="size" type="radio" checked={size === option} onChange={() => setSize(option)} disabled={option === orderedSize} />
              <span>{option ?? '미정'}</span>
            </label>)}
          </div>
        </fieldset>
        {assessment === 'needs-info' && <p className="inline-feedback warning"><CircleHelp />운영자가 교환할 사이즈를 확인해요.</p>}
        {assessment === 'out-of-stock' && <p className="inline-feedback danger"><TriangleAlert />선택한 사이즈가 품절이에요. 운영자에게 확인을 요청할 수 있어요.</p>}
        {assessment === 'expired' && <p className="inline-feedback danger"><Clock3 />교환 신청 기한이 지났어요.</p>}
        <div className="memo-field">
          <label htmlFor="memo">교환 사유 <span>선택</span></label>
          <textarea id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={350} rows={3} placeholder="교환 사유를 남겨 주세요." />
          <span className="char-count">{memo.length} / 350</span>
        </div>
      </div>
      <div className="panel-footer"><button className="button primary" type="submit" disabled={busy || assessment === 'expired'}>
        {busy ? '저장 중…' : '교환 신청'} <ArrowRight />
      </button></div>
    </form>}
  </section>;
}

function Operator({ order, claim, stock, liveEnabled, busy, send, go }: {
  order: ScenarioId; claim: Claim; stock: DemoState['stock']; liveEnabled: boolean; busy: boolean;
  send: (path: string, body: object, feedback: string) => Promise<boolean>;
  go: () => void;
}) {
  const [confirmed, setConfirmed] = useState('');
  const approved = claim.status === 'approved';
  const available = claim.size !== null && stock[claim.size] > 0;
  const needsCheck = !claim.size || claim.status === 'needs-info';
  const path = `claims/${order}/`;
  return <section className="panel operator" aria-labelledby="operator-title">
    <header className="panel-head"><h2 id="operator-title">교환 요청 상세</h2><Badge claim={claim} /></header>
    <ProductRow order={order} />
    <dl className="order-dates"><div><dt>희망 사이즈</dt><dd>{claim.size ?? '미확인'}</dd></div>
      <div><dt>현재 재고</dt><dd>{claim.size ? `${stock[claim.size]}개` : '확인 전'}</dd></div></dl>
    <div className="operator-main">
      <div className="memo-review">
        <h3>고객 메모 원문</h3>
        <p>{claim.memo || '입력된 메모가 없어요.'}</p>
      </div>
      {(claim.draft || !approved) && <section className="draft-box" aria-labelledby="draft-title">
        <div className="draft-heading"><Sparkles /><h3 id="draft-title">운영자 검토 초안</h3>
          <span className="tag">{claim.draft?.source === 'live' ? 'AI 근거 추출' : !claim.draft && liveEnabled ? 'AI 연결 가능' : '데모 예시'}</span></div>
        {claim.draft ? <div className="draft-output">
          <strong>{needsCheck ? '희망 사이즈 확인 필요' : available || approved ? '고객 요청 검토' : '다른 사이즈 또는 대기 여부 확인'}</strong>
          {claim.draft.evidence.length ? <ul>{claim.draft.evidence.map((sentence, index) => <li key={index}>{sentence}</li>)}</ul> : <p>메모에서 확인할 근거가 없어요.</p>}
        </div> : <button className="button secondary" disabled={busy} onClick={() => void send(path + 'draft', {}, '검토 초안을 저장했어요.')}>
          <Sparkles /> 검토 초안 만들기
        </button>}
      </section>}
      {!approved && <div className="operator-actions">
        <label htmlFor="confirmed-size">확인한 사이즈</label>
        <div className="inline-form">
          <select id="confirmed-size" value={confirmed} onChange={(e) => setConfirmed(e.target.value)}>
            <option value="">선택</option>
            {sizes.filter((s) => s !== orderedSize).map((s) => <option value={s} key={s}>{s} · 재고 {stock[s]}개</option>)}
          </select>
          <button className="button secondary" disabled={!confirmed || busy} onClick={() => {
            void send(path + 'decision', { action: 'confirm-size', size: confirmed }, '확인한 사이즈를 저장했어요.');
          }}>사이즈 반영</button>
        </div>
      </div>}
    </div>
    <div className="panel-footer">
      {approved ? <button className="button secondary" onClick={go}>고객 화면에서 보기 <ArrowRight /></button> : <>
        <button className="button secondary" disabled={busy} onClick={() => void send(path + 'decision', { action: 'request-info' }, '추가 확인 요청을 기록했어요.')}>추가 확인 요청</button>
        <button className="button primary" disabled={busy || claim.status !== 'received' || !available} onClick={() => void send(path + 'decision', { action: 'approve' }, '교환을 승인했어요.')}>
          <Check /> 교환 승인
        </button>
      </>}
    </div>
    <div className="operator-history"><h3>처리 기록</h3><Timeline claim={claim} /></div>
  </section>;
}

function App() {
  const [view, setView] = useState<View>('customer');
  const [order, setOrder] = useState<ScenarioId>('standard');
  const [state, setState] = useState(makeState);
  const [ready, setReady] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const claim = state.claims[order];

  const load = async () => {
    setError('');
    try {
      const result = await readApi('state');
      setState(result.state); setLiveEnabled(!!result.liveEnabled); setReady(true);
    } catch { setError('서버에 연결하지 못했어요. 다시 시도해 주세요.'); }
  };
  useEffect(() => { void load(); }, []);

  async function send(path: string, body: object, feedback: string) {
    if (busy) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await readApi(path, body);
      setState(result.state);
      setNotice(result.notice ?? (result.duplicate ? '이미 접수된 교환이에요.' : feedback));
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : '잠시 후 다시 시도해 주세요.');
      return false;
    } finally { setBusy(false); }
  }

  function selectView(next: View) {
    setView(next); setError(''); setNotice('');
    if (next === 'operator' && !state.claims[order]) {
      setOrder(scenarioIds.find((id) => state.claims[id]) ?? order);
    }
  }

  return <>
    <header className="top">
      <div className="top-inner">
        <div className="brand"><span className="brand-icon"><ArrowLeftRight /></span><span>Afterorder<small>EXCHANGE DESK</small></span></div>
        <nav className="tabs" aria-label="작업 화면">
          <button aria-pressed={view === 'customer'} onClick={() => selectView('customer')}><Package /> 고객 화면</button>
          <button aria-pressed={view === 'operator'} onClick={() => selectView('operator')}><LayoutDashboard /> 운영 콘솔 {Object.keys(state.claims).length > 0 && <span className="count">{Object.keys(state.claims).length}</span>}</button>
        </nav>
        <div className="top-tools"><span className="demo-pill"><i /> 데모 모드</span>
          <button className="icon-button" title="데모 초기화" aria-label="데모 초기화" disabled={!ready || busy} onClick={() => setResetOpen(true)}><RotateCcw /></button></div>
      </div>
    </header>
    <main className="layout">
      <div className="page-head">
        <div className="breadcrumb"><span>주문 관리</span><ChevronRight /> <span>{view === 'customer' ? '교환 신청' : '운영 콘솔'}</span></div>
        <h1>{view === 'customer' ? '사이즈 교환' : '교환 운영 콘솔'}</h1>
      </div>
      <div className="workspace">
        <aside className="scenarios" aria-labelledby="scenario-heading">
          <h2 id="scenario-heading">데모 시나리오</h2>
          <div className="scenario-list">
            {scenarioIds.map((id, index) => {
              const entry = scenarios[id];
              const Icon = id === 'standard' ? ArrowDownUp : id === 'soldout' ? Package : CircleHelp;
              return <button key={id} className={`scenario ${id}`} aria-pressed={order === id} disabled={!ready || busy}
                onClick={() => { setOrder(id); setError(''); setNotice(''); }}>
                <span className="scenario-icon"><Icon /></span>
                <span className="scenario-label"><strong>{entry.title}</strong><small>{entry.detail}</small></span>
                <span className="scenario-index">0{index + 1}</span>
              </button>;
            })}
          </div>
        </aside>
        <div className="main-col" aria-busy={busy}>
          <div className="message" role="status">{notice}</div>
          <div className="message error" role="alert">{error}</div>
          {!ready ? <div className="panel empty">{error ? <button className="button secondary" onClick={() => void load()}>다시 연결</button> : <p>주문을 불러오는 중…</p>}</div>
            : view === 'customer'
              ? <Intake key={order} order={order} state={state} busy={busy} send={send} go={() => selectView('operator')} />
              : claim
                ? <Operator key={claim.id} order={order} claim={claim} stock={state.stock} liveEnabled={liveEnabled} busy={busy} send={send} go={() => selectView('customer')} />
                : <section className="panel empty"><Inbox /><h2>접수된 교환이 없어요</h2><button className="button secondary" onClick={() => selectView('customer')}>고객 화면으로 <ArrowRight /></button></section>}
        </div>
        <aside className="context" aria-label="교환 정책과 재고">
          <div className="context-block"><div className="context-title"><ShieldCheck /><h2>교환 기준</h2></div>
            <dl><div><dt>신청 기한</dt><dd>배송 완료 후 7일</dd></div><div><dt>가능 범위</dt><dd>동일 상품, 다른 사이즈</dd></div><div><dt>재고 배정</dt><dd>운영자 승인 시</dd></div></dl>
          </div>
          <div className="context-block"><div className="context-title"><ClipboardList /><h2>사이즈별 재고</h2></div>
            <dl className="stock-list">{sizes.map((s) => <div key={s}><dt>{s}</dt>
              <dd><span className={state.stock[s] ? 'available' : 'missing'}>{state.stock[s] ? `${state.stock[s]}개` : '품절'}</span></dd></div>)}</dl>
          </div>
        </aside>
      </div>
      <footer className="footer"><CheckCircle2 /> 가상 주문과 재고로 구성된 포트폴리오 데모</footer>
    </main>
    {resetOpen && <ResetDialog cancel={() => setResetOpen(false)} reset={async () => {
      if (await send('reset', {}, '데모를 초기화했어요.')) {
        setResetOpen(false); setOrder('standard'); setView('customer');
      }
    }} busy={busy} error={error} />}
  </>;
}

function ResetDialog({ cancel, reset, busy, error }: { cancel: () => void; reset: () => void; busy: boolean; error: string }) {
  return <dialog className="dialog" ref={(node) => { if (node && !node.open) node.showModal(); }}
    onCancel={(event) => { event.preventDefault(); if (!busy) cancel(); }} aria-labelledby="reset-title">
    <h2 id="reset-title">데모를 초기화할까요?</h2>
    <p>이 브라우저에서 만든 교환 요청과 재고 변경을 초기화해요.</p>
    {error && <p className="error">{error}</p>}
    <div className="dialog-actions">
      <button className="button secondary" autoFocus disabled={busy} onClick={cancel}>취소</button>
      <button className="button primary" disabled={busy} onClick={reset}>초기화</button>
    </div>
  </dialog>;
}

createRoot(document.getElementById('root')!).render(<App />);
