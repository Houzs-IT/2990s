import { describe, expect, it, vi } from 'vitest';
import { buildSalesOrderPdf } from './so-pdf';
import chineseFontDataUrl from '../assets/fonts/NotoSansSC-Regular-gb2312.ttf?inline';
import type { PrintableSO } from './so-doc';

const order: PrintableSO = {
  id: '2990-SO-2608-046',
  date: '2026-08-25',
  deliveryDate: null,
  paymentMethod: 'merchant',
  customerName: 'Isa',
  customerAddressLines: ['No.49, Jalan Eco Grandeur 9/1', '42300 Bandar Puncak Alam, Selangor'],
  customerPhone: '+60136781101',
  soldByName: '2990s PJ',
  soldByAddressLines: ['51, Jln Utara, PJS 12', '46200 Petaling Jaya, Selangor'],
  subtotal: 3190,
  paid: 1620,
  total: 3190,
  balance: 1570,
  payments: [
    { id: 'p1', date: '2026-08-25', methodLabel: 'Merchant (MBB)', approvalCode: '007322', amount: 1620 },
  ],
  signature: null,
  lines: Array.from({ length: 40 }, (_, index) => ({
    sku: `XAMMAR-${index}`,
    description: 'SOFA XAMMAR',
    sub: '2A(LHF) + L(RHF) · SEAT 24 / LEG 6"',
    notes: [{ text: 'PWP voucher issued: PWP-7683RMDW', tone: 'unused' as const }],
    remark: index === 0 ? 'Deliver after 6pm' : null,
    qty: 1,
    unitPrice: 2990,
    lineTotal: 2940,
  })),
};

const pdfText = async (file: File): Promise<string> =>
  new TextDecoder('latin1').decode(await file.arrayBuffer());

describe('buildSalesOrderPdf', () => {
  it('returns a named PDF file carrying the order, totals and every page footer', async () => {
    const file = await buildSalesOrderPdf(order, { paymentMethodLabel: null, isSimulation: false });

    expect(file.name).toBe('2990-SO-2608-046.pdf');
    expect(file.type).toBe('application/pdf');
    const text = await pdfText(file);
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('MYR 1,570.00');
    expect(text).toContain('Remark: Deliver after 6pm');
    expect(text).toContain('XAMMAR-39');
    expect(text).toMatch(/Page 1 of [2-9]/);
    expect(text).not.toContain('SIMULATION');
  });

  it('marks a simulation build so it is never mistaken for a real order', async () => {
    const file = await buildSalesOrderPdf(order, { paymentMethodLabel: null, isSimulation: true });
    expect(await pdfText(file)).toContain('SIMULATION');
  });

  it('embeds the Chinese font only when the order carries Chinese text', async () => {
    const fontBase64 = chineseFontDataUrl.slice(chineseFontDataUrl.indexOf(',') + 1);
    const loadChineseFont = vi.fn(async () => Uint8Array.from(atob(fontBase64), (character) => character.charCodeAt(0)).buffer);

    await buildSalesOrderPdf(order, { paymentMethodLabel: null, isSimulation: false, loadChineseFont });
    expect(loadChineseFont).not.toHaveBeenCalled();

    const chineseOrder = { ...order, customerName: '黄鹏川', lines: order.lines.slice(0, 1).map((line) => ({ ...line, remark: '晚上送货' })) };
    const file = await buildSalesOrderPdf(chineseOrder, { paymentMethodLabel: null, isSimulation: false, loadChineseFont });
    expect(loadChineseFont).toHaveBeenCalledTimes(1);
    expect(await pdfText(file)).toContain('/FontName /NotoSansSC');
  });
});
