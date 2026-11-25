export const sizes = ['S', 'M', 'L', 'XL'] as const;
export type Size = typeof sizes[number];
export type ScenarioId = 'standard' | 'soldout' | 'unclear';
export type ClaimStatus = 'received' | 'needs-info' | 'out-of-stock' | 'approved';
export type Draft = { source: 'sample' | 'live'; evidence: string[] };
export type ClaimEvent = { label: string; at: string };
export type Claim = {
  id: string;
  order: ScenarioId;
  size: Size | null;
  memo: string;
  status: ClaimStatus;
  draft: Draft | null;
  history: ClaimEvent[];
};

export const demoDate = '2026-11-25';
export const scenarios = {
  standard: {
    title: '정상 교환',
    detail: '희망 사이즈 재고 있음',
    orderNo: 'AO-261121-01',
    delivery: '2026-11-21',
    size: 'L',
    memo: 'M 사이즈가 조금 작아요. L 사이즈로 교환 부탁드립니다.',
  },
  soldout: {
    title: '재고 부족',
    detail: '희망 사이즈 품절',
    orderNo: 'AO-261121-02',
    delivery: '2026-11-21',
    size: 'XL',
    memo: 'XL 사이즈로 바꾸고 싶습니다.',
  },
  unclear: {
    title: '추가 확인 필요',
    detail: '희망 사이즈를 알 수 없음',
    orderNo: 'AO-261121-03',
    delivery: '2026-11-21',
    size: null,
    memo: '한 사이즈 큰 걸로 바꿔주세요.',
  },
} satisfies Record<ScenarioId, { title: string; detail: string; orderNo: string; delivery: string; size: Size | null; memo: string }>;

export const initialStock: Record<Size, number> = { S: 4, M: 3, L: 2, XL: 0 };
export const orderedSize: Size = 'M';
export const product = { name: '데일리 코튼 스웨트셔츠', color: '라일락', price: '49,000원' };

export type DemoState = { stock: Record<Size, number>; claims: Partial<Record<ScenarioId, Claim>> };
export const makeState = (): DemoState => ({ stock: { ...initialStock }, claims: {} });
export const isScenario = (value: unknown): value is ScenarioId =>
  typeof value === 'string' && Object.hasOwn(scenarios, value);
export const isSize = (value: unknown): value is Size => sizes.some((size) => size === value);

export function exchangeDeadline(delivery: string) {
  const date = new Date(delivery + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
}

export function assessExchange(size: Size | null, stock: Record<Size, number>, delivery: string, today = demoDate) {
  if (today > exchangeDeadline(delivery)) return 'expired' as const;
  if (!size) return 'needs-info' as const;
  if (size === orderedSize) return 'same-option' as const;
  return stock[size] > 0 ? 'received' as const : 'out-of-stock' as const;
}

export const statuses: Record<ClaimStatus, { title: string; color: string }> = {
  received: { title: '검토 대기', color: 'info' },
  'needs-info': { title: '정보 확인 필요', color: 'warning' },
  'out-of-stock': { title: '재고 부족', color: 'danger' },
  approved: { title: '교환 승인', color: 'success' },
};
