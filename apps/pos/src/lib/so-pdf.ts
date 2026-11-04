import type { jsPDF as JsPdf } from 'jspdf';
import { COMPANY_LEGAL, RECEIPT_TERMS } from './legal';
import type { PrintableSO } from './so-doc';


export interface SalesOrderPdfOptions {
  paymentMethodLabel: string | null;
  isSimulation: boolean;
}

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_BOTTOM = PAGE_HEIGHT - 16;
const INK: [number, number, number] = [34, 31, 32];
const BURNT: [number, number, number] = [166, 71, 30];
const MUTED: [number, number, number] = [110, 110, 110];

const formatAmount = (amount: number): string =>
  amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatMoney = (amount: number): string => `MYR ${formatAmount(amount)}`;

const formatIsoDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const date = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const lastTableBottom = (doc: JsPdf, fallback: number): number =>
  (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fallback;

const signatureFormat = (dataUrl: string): 'PNG' | 'JPEG' =>
  /^data:image\/jpe?g/i.test(dataUrl) ? 'JPEG' : 'PNG';

export async function buildSalesOrderPdf(
  order: PrintableSO,
  { paymentMethodLabel, isSimulation }: SalesOrderPdfOptions,
): Promise<File> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const halfWidth = (PAGE_WIDTH - MARGIN * 2 - 6) / 2;
  const rightColumnX = MARGIN + halfWidth + 6;

  const ensureRoom = (y: number, neededHeight: number): number => {
    if (y + neededHeight <= CONTENT_BOTTOM) return y;
    doc.addPage();
    return MARGIN;
  };

  const drawLines = (lines: string[], x: number, y: number, width: number, lineHeight: number): number => {
    let cursorY = y;
    for (const line of lines) {
      const wrapped = doc.splitTextToSize(line, width) as string[];
      doc.text(wrapped, x, cursorY);
      cursorY += wrapped.length * lineHeight;
    }
    return cursorY;
  };

  const drawLabel = (text: string, x: number, y: number): void => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...BURNT);
    doc.text(text.toUpperCase(), x, y);
    doc.setTextColor(...INK);
  };

  doc.setTextColor(...INK);
  let y = MARGIN;

  if (isSimulation) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...BURNT);
    doc.text('SIMULATION — NOT A SALES ORDER', PAGE_WIDTH / 2, y, { align: 'center' });
    doc.setTextColor(...INK);
    y += 7;
  }

  const headerTop = y + 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(COMPANY_LEGAL.name, MARGIN, headerTop);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(`SSM ${COMPANY_LEGAL.ssm}`, MARGIN, headerTop + 4.5);
  doc.setTextColor(...INK);
  let leftY = drawLines([...COMPANY_LEGAL.hqLines], MARGIN, headerTop + 9.5, halfWidth + 20, 3.6);
  if (COMPANY_LEGAL.whatsapp) {
    leftY = drawLines([`WhatsApp: ${COMPANY_LEGAL.whatsapp}`], MARGIN, leftY + 1, halfWidth, 3.6);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('SALES ORDER', PAGE_WIDTH - MARGIN, headerTop, { align: 'right' });
  doc.setFontSize(10);
  doc.setTextColor(...BURNT);
  doc.text(order.id, PAGE_WIDTH - MARGIN, headerTop + 6, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(`Date: ${formatIsoDate(order.date)}`, PAGE_WIDTH - MARGIN, headerTop + 10.5, { align: 'right' });
  doc.setTextColor(...INK);
  y = Math.max(leftY, headerTop + 12) + 5;

  drawLabel('Order reference', MARGIN, y);
  drawLabel('Delivery estimate date', rightColumnX, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(order.id, MARGIN, y + 5);
  doc.text(order.deliveryDate ? formatIsoDate(order.deliveryDate) : 'To be confirmed', rightColumnX, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(`Placed ${formatIsoDate(order.date)}`, MARGIN, y + 9);
  doc.setTextColor(...INK);
  let paymentsY = y + 10;
  if (order.payments.length > 0) {
    drawLabel('Payments received', rightColumnX, paymentsY);
    paymentsY += 4;
    doc.setFontSize(8);
    for (const payment of order.payments) {
      doc.setFont('helvetica', 'normal');
      doc.text(payment.methodLabel, rightColumnX, paymentsY);
      doc.setFont('helvetica', 'bold');
      doc.text(formatMoney(payment.amount), PAGE_WIDTH - MARGIN, paymentsY, { align: 'right' });
      paymentsY += 3.6;
      if (payment.approvalCode) {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...MUTED);
        doc.text(`Ref ${payment.approvalCode}`, rightColumnX, paymentsY);
        doc.setTextColor(...INK);
        paymentsY += 3.6;
      }
    }
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Method: ${paymentMethodLabel ?? '—'}`, rightColumnX, paymentsY);
    paymentsY += 3.6;
  }
  y = Math.max(y + 12, paymentsY) + 4;

  drawLabel('Bill to', MARGIN, y);
  drawLabel('Sold by', rightColumnX, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(order.customerName || '—', MARGIN, y + 5);
  doc.text(order.soldByName, rightColumnX, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const billToLines = [...order.customerAddressLines, ...(order.customerPhone ? [order.customerPhone] : [])];
  const billToBottom = drawLines(billToLines, MARGIN, y + 9, halfWidth, 3.6);
  const soldByBottom = drawLines(order.soldByAddressLines, rightColumnX, y + 9, halfWidth, 3.6);
  y = Math.max(billToBottom, soldByBottom) + 3;

  autoTable(doc, {
    startY: y,
    head: [['SKU', 'Description', 'Qty', 'Unit Price (MYR)', 'Line Total (MYR)']],
    body: order.lines.map((line) => [
      line.sku,
      [
        line.description,
        line.sub,
        line.remark ? `Remark: ${line.remark}` : null,
        ...line.notes.map((note) => note.text),
      ].filter((part): part is string => Boolean(part)).join('\n'),
      String(line.qty),
      formatAmount(line.unitPrice),
      formatAmount(line.lineTotal),
    ]),
    theme: 'plain',
    rowPageBreak: 'avoid',
    styles: { fontSize: 8, cellPadding: 2, valign: 'top', textColor: INK, lineColor: [225, 220, 214], lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: [246, 239, 228], fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 12, halign: 'right' },
      3: { cellWidth: 28, halign: 'right' },
      4: { cellWidth: 28, halign: 'right' },
    },
    margin: { left: MARGIN, right: MARGIN, bottom: PAGE_HEIGHT - CONTENT_BOTTOM },
  });
  y = ensureRoom(lastTableBottom(doc, y) + 6, 34);

  const signatureHeight = 22;
  doc.setDrawColor(180);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.rect(MARGIN, y, halfWidth, signatureHeight);
  doc.setLineDashPattern([], 0);
  if (order.signature) {
    doc.addImage(order.signature, signatureFormat(order.signature), MARGIN + 2, y + 1, halfWidth - 4, signatureHeight - 2);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...BURNT);
  doc.text('Customer signature', MARGIN, y + signatureHeight + 4);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...MUTED);
  doc.text(
    [order.customerName, order.customerPhone].filter(Boolean).join(' · '),
    MARGIN,
    y + signatureHeight + 8,
  );
  doc.setTextColor(...INK);

  const totalRows: Array<[string, number]> = [
    ['Subtotal', order.subtotal],
    ['Paid to date', order.paid],
    ['Total', order.total],
  ];
  let totalsY = y + 4;
  doc.setFontSize(9);
  for (const [label, amount] of totalRows) {
    doc.setFont('helvetica', 'normal');
    doc.text(label, rightColumnX, totalsY);
    doc.text(formatMoney(amount), PAGE_WIDTH - MARGIN, totalsY, { align: 'right' });
    totalsY += 5;
  }
  doc.setDrawColor(...INK);
  doc.line(rightColumnX, totalsY - 2.5, PAGE_WIDTH - MARGIN, totalsY - 2.5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...BURNT);
  doc.text('Balance due', rightColumnX, totalsY + 2.5);
  doc.text(formatMoney(order.balance), PAGE_WIDTH - MARGIN, totalsY + 2.5, { align: 'right' });
  doc.setTextColor(...INK);
  y = Math.max(y + signatureHeight + 8, totalsY + 2.5) + 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const wrappedTerms = RECEIPT_TERMS.map(
    (term, index) => doc.splitTextToSize(`${index + 1}. ${term}`, PAGE_WIDTH - MARGIN * 2) as string[],
  );
  const termsHeight = 5 + wrappedTerms.reduce((sum, lines) => sum + lines.length * 3.2 + 0.8, 0);
  y = ensureRoom(y, termsHeight);
  drawLabel('Terms & conditions', MARGIN, y);
  y += 4.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  for (const lines of wrappedTerms) {
    doc.text(lines, MARGIN, y);
    y += lines.length * 3.2 + 0.8;
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(order.id, MARGIN, PAGE_HEIGHT - 8);
    doc.text(`${COMPANY_LEGAL.portalLabel} · ${formatIsoDate(order.date)}`, PAGE_WIDTH / 2, PAGE_HEIGHT - 8, { align: 'center' });
    doc.text(`Page ${page} of ${pageCount}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 8, { align: 'right' });
  }

  return new File([doc.output('blob')], `${order.id}.pdf`, { type: 'application/pdf' });
}

export const canShareFiles = (): boolean => {
  if (typeof navigator.canShare !== 'function') return false;
  const probe = new File([''], 'probe.pdf', { type: 'application/pdf' });
  return navigator.canShare({ files: [probe] });
};
