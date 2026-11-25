import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('normal exchange, duplicate HTTP request, persistent state and customer confirmation', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '주문 상품' })).toBeVisible();
  await expect(page.locator('img').first()).toHaveJSProperty('complete', true);
  expect(await page.locator('img').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('desktop-customer.png') });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: '교환 신청', exact: true }).click();
  await expect(page.getByRole('heading', { name: '교환 내역' })).toBeVisible();
  const duplicate = await page.request.post('/api/claims', { data: { order: 'standard', size: 'S', memo: '다른 메모' } });
  expect((await duplicate.json()).duplicate).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: '운영 콘솔에서 보기' }).click();
  await expect(page.getByText('M 사이즈가 조금 작아요. L 사이즈로 교환 부탁드립니다.')).toBeVisible();
  await page.getByRole('button', { name: '검토 초안 만들기' }).click();
  await expect(page.getByText('고객 요청 검토')).toBeVisible();
  await page.screenshot({ path: info.outputPath('desktop-operator.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: '교환 승인', exact: true }).click();
  await expect(page.getByText('운영자가 교환을 승인하고 재고 1개를 배정했어요.')).toBeVisible();
  const inventory = await page.request.get('/api/state');
  expect((await inventory.json()).state.stock.L).toBe(1);
  await page.getByRole('button', { name: '고객 화면에서 보기' }).click();
  await expect(page.getByRole('region', { name: '교환 내역' }).getByText('교환 승인').first()).toBeVisible();
});

test('sold-out claim blocks approval on mobile and at the API', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /재고 부족/ }).click();
  await expect(page.getByText(/선택한 사이즈가 품절/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('mobile-stock.png'), fullPage: true });
  await page.getByRole('button', { name: '교환 신청', exact: true }).click();
  await page.getByRole('button', { name: '운영 콘솔에서 보기' }).click();
  await expect(page.getByRole('button', { name: '교환 승인' })).toBeDisabled();
  const blocked = await page.request.post('/api/claims/soldout/decision', { data: { action: 'approve' } });
  expect(blocked.status()).toBe(409);
});

test('unclear memo is grounded, operator confirms manually, and reset restores the demo', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await page.getByRole('button', { name: /추가 확인 필요/ }).click();
  await page.getByRole('button', { name: '교환 신청', exact: true }).click();
  await page.getByRole('button', { name: '운영 콘솔에서 보기' }).click();
  await page.getByRole('button', { name: '검토 초안 만들기' }).click();
  await expect(page.getByText('희망 사이즈 확인 필요', { exact: true })).toBeVisible();
  await expect(page.getByText('한 사이즈 큰 걸로 바꿔주세요.').last()).toBeVisible();
  await expect(page.getByRole('button', { name: '교환 승인' })).toBeDisabled();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: info.outputPath('mobile-review.png'), fullPage: true });
  await page.getByRole('button', { name: '추가 확인 요청' }).click();
  await expect(page.getByText('고객에게 추가 확인을 요청했어요. (데모 기록)')).toBeVisible();
  await page.getByLabel('확인한 사이즈').selectOption('L');
  await page.getByRole('button', { name: '사이즈 반영' }).click();
  await expect(page.getByRole('button', { name: '교환 승인' })).toBeEnabled();
  await page.getByRole('button', { name: '데모 초기화', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '초기화', exact: true }).click();
  await expect(page.getByRole('heading', { name: '주문 상품' })).toBeVisible();
  expect((await (await page.request.get('/api/state')).json()).state.claims).toEqual({});
});
