import { describe, expect, it } from 'vitest';
import { saveProblemMessages } from './so-problems';

describe('saveProblemMessages', () => {
  it('lists every problem message in order', () => {
    expect(
      saveProblemMessages({
        error: 'validation_failed',
        message: '2 things need fixing before this can be saved.',
        problems: [
          { code: 'variants_incomplete', message: 'LOTTI-L(LHF) — Fabrics is required' },
          { code: 'variants_incomplete', message: 'LOTTI-2A(RHF) — Fabrics is required' },
        ],
      }),
    ).toEqual(['LOTTI-L(LHF) — Fabrics is required', 'LOTTI-2A(RHF) — Fabrics is required']);
  });
  it('is empty for a body without problems or with junk entries', () => {
    expect(saveProblemMessages(null)).toEqual([]);
    expect(saveProblemMessages({ error: 'x' })).toEqual([]);
    expect(saveProblemMessages({ problems: [null, { code: 'a' }, { message: '' }] })).toEqual([]);
  });
});
