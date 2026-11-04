import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { PrintableSO } from '../lib/so-doc';

const order: PrintableSO = {
  id: '2990-SO-2608-046',
  date: '2026-08-25',
  deliveryDate: null,
  paymentMethod: null,
  customerName: 'Isa',
  customerAddressLines: [],
  customerPhone: null,
  soldByName: '2990s PJ',
  soldByAddressLines: [],
  subtotal: 100,
  paid: 0,
  total: 100,
  balance: 100,
  payments: [],
  signature: null,
  lines: [],
};
const pdfFile = new File(['%PDF-'], '2990-SO-2608-046.pdf', { type: 'application/pdf' });
const sharing = vi.hoisted(() => ({ isSupported: true }));

vi.mock('../lib/so-doc', () => ({
  useSalesOrderDoc: () => ({ data: order, isLoading: false, error: null }),
}));
vi.mock('../lib/so-maintenance/so-dropdown-options-queries', () => ({
  usePaymentMethodLabels: () => ({}),
}));
vi.mock('../lib/so-pdf', () => ({
  buildSalesOrderPdf: vi.fn(async () => pdfFile),
  canShareFiles: () => sharing.isSupported,
}));

const { SalesOrderPrint } = await import('./SalesOrderPrint');

const renderPage = (): void => {
  render(
    <MemoryRouter initialEntries={['/print/sales-order/2990-SO-2608-046']}>
      <Routes>
        <Route path="/print/sales-order/:orderId" element={<SalesOrderPrint />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('SalesOrderPrint print or share button', () => {
  const printSpy = vi.fn();
  const shareSpy = vi.fn(async () => undefined);

  beforeEach(() => {
    window.print = printSpy;
    Object.defineProperty(navigator, 'share', { configurable: true, value: shareSpy });
  });
  afterEach(() => {
    cleanup();
    printSpy.mockClear();
    shareSpy.mockClear();
  });

  it('offers Print and Share PDF where the device can share files', async () => {
    sharing.isSupported = true;
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /print \/ share/i }));
    const shareItem = await screen.findByRole('menuitem', { name: 'Share PDF' });
    fireEvent.click(shareItem);
    await waitFor(() => expect(shareSpy).toHaveBeenCalledWith({ files: [pdfFile], title: 'Sales Order 2990-SO-2608-046' }));

    fireEvent.click(screen.getByRole('button', { name: /print \/ share/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Print' }));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('prints straight away where sharing files is not supported', () => {
    sharing.isSupported = false;
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /print \/ save as pdf/i }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
