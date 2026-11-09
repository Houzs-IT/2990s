// My orders › the Team card (ticket 2990-0045). Houzs sales-stats adds team*
// fields for a caller in a Team Directory team; the card shows only then.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SalesKpis } from './OrderStatus';
import type { SalesStatsRow } from '../lib/queries';

afterEach(cleanup);
vi.mock('../lib/supabase', () => ({ supabase: {} }));

const base: SalesStatsRow = {
  monthLabel: 'November 2026', monthStart: null, monthEnd: null, staffName: 'Scarlett',
  showroomScope: 'showroom',
  showroomTotal: 9000, showroomCount: 3, personalTotal: 2990, personalCount: 1,
  showroomProducts: 9000, showroomService: 0, showroomKpi: 0,
  personalProducts: 2990, personalService: 0, personalKpi: 0,
};

const stats = (data: SalesStatsRow) =>
  ({ data, error: null, isPlaceholderData: false }) as unknown as Parameters<typeof SalesKpis>[0]['stats'];

describe('SalesKpis — Team card', () => {
  it('shows the team total when the API sends one', () => {
    render(
      <SalesKpis
        stats={stats({ ...base, teamName: 'Kris Team', teamTotal: 45000, teamCount: 7, teamProducts: 45000, teamService: 0, teamKpi: 0 })}
        personalName="Scarlett"
        placeLabel={null}
      />,
    );
    expect(screen.getAllByText(/Kris Team/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('7 orders').length).toBeGreaterThan(0);
  });

  it('shows no Team card when the caller has no team (fields absent)', () => {
    render(<SalesKpis stats={stats(base)} personalName="Scarlett" placeLabel={null} />);
    expect(screen.queryByText(/Team/)).not.toBeInTheDocument();
  });
});
