import { describe, expect, it } from 'vitest';
import {
  buildKpiTargetOptions, categoryLabel, codesSummary, describeKpiRule, ruleCovering,
  type KpiTargetSources,
} from './kpi-rule-targets';

/* The owner's screenshot (2026-11-15): the fabric picker read MONS / D / EM /
   MONZA-HL-B01 … — library ids — and asked why it was not the series names.
   Fixtures follow the live shapes after Houzs's 2026-11-13 rename (EMBRACE =
   EM-01..EM-13 under library id EM). */

const lib = (id: string) => ({ id, label: id });
const col = (fabricId: string, colourId: string) => ({ fabricId, colourId, label: colourId });
const named = (fabric_code: string, series: string) => ({ fabric_code, series });

const SOURCES: KpiTargetSources = {
  catalog: [
    { code: 'ANNSA-3S', name: 'ANNSA 3 Seater', category: 'SOFA' },
    { code: 'DLV-01', name: 'Delivery', category: 'SERVICE' },
    { code: 'BF-Q', name: 'Bedframe Queen', category: 'BEDFRAME' },
  ],
  library: ['EM', 'BROWNIE', 'HG1313', 'MONZA-HL', 'MONZA-FL', 'D'].map(lib),
  colours: [
    col('EM', 'EM-01'), col('EM', 'EM-02'),
    col('BROWNIE', 'BROWNIE-01'), col('BROWNIE', 'BROWNIE-11'),
    col('HG1313', 'HG1313-01'),
    col('MONZA-HL', 'MONZA-HL-01'), col('MONZA-FL', 'MONZA-FL-01'),
    col('D', 'D-01'),
  ],
  savedNames: [
    named('EM-01', 'EMBRACE'), named('EM-02', 'EMBRACE'),
    named('BROWNIE-01', 'HOMELY'), // BROWNIE-11 has no saved series
    named('HG1313-01', 'BELONG'),
  ],
  specials: [
    { code: 'Latex Seat', label: 'Latex Seat', active: true },
    { code: 'OLD', label: 'Retired add-on', active: false },
  ],
};

const options = buildKpiTargetOptions(SOURCES);

describe('the fabric picker lists series, not library codes', () => {
  it('names each entry by its saved series, with the codes as detail', () => {
    const embrace = options.fabric.find((o) => o.label === 'EMBRACE')!;
    expect(embrace).toMatchObject({ ref: 'EM', refs: ['EM'], detail: 'EM · 2 colours' });
    expect(options.fabric.map((o) => o.label)).toContain('BELONG');
    expect(options.fabric.map((o) => o.label)).not.toContain('EM');
  });

  it('a series over several library ids saves its series key and every id', () => {
    const monza = options.fabric.find((o) => o.label === 'MONZA')!;
    expect(monza.ref).toBe('MONZA');
    expect(monza.refs).toEqual(['MONZA-HL', 'MONZA-FL']);
  });

  it('merges saved series that share one library id — a rule on either would pay both', () => {
    const homely = options.fabric.find((o) => o.refs.includes('BROWNIE'))!;
    expect(homely.label).toBe('HOMELY / BROWNIE');
    expect(options.fabric.filter((o) => o.refs.includes('BROWNIE'))).toHaveLength(1);
  });

  it('is searchable by name or by any code under it', () => {
    expect(options.fabric.find((o) => o.label === 'EMBRACE')!.search).toContain('em');
    expect(options.fabric.find((o) => o.label === 'MONZA')!.search).toContain('monza-fl');
  });
});

describe('the other pickers', () => {
  it('products are named, coded, and never a service line', () => {
    // sorted by name: "ANNSA 3 Seater" before "Bedframe Queen"
    expect(options.product.map((o) => o.ref)).toEqual(['ANNSA-3S', 'BF-Q']);
    expect(options.product.find((o) => o.ref === 'ANNSA-3S')).toMatchObject({ label: 'ANNSA 3 Seater', detail: 'ANNSA-3S' });
    expect(options.product.some((o) => o.ref === 'DLV-01')).toBe(false);
  });

  it('categories read as words and keep their code as the ref', () => {
    expect(options.category.map((o) => [o.ref, o.label])).toEqual([['BEDFRAME', 'Bedframe'], ['SOFA', 'Sofa']]);
    expect(categoryLabel('FABRIC_ACCESSORY')).toBe('Sofa accessory');
    expect(categoryLabel('NEW_THING')).toBe('New thing');
  });

  it('special add-ons offer only the active ones', () => {
    expect(options.special.map((o) => o.ref)).toEqual(['Latex Seat']);
  });
});

describe('describeKpiRule — a rule named by what its codes belong to today', () => {
  it('a legacy one-code rule reads as its series', () => {
    expect(describeKpiRule({ flagType: 'fabric', ref: 'BROWNIE', label: 'BROWNIE' }, options))
      .toMatchObject({ name: 'HOMELY / BROWNIE', state: 'ok', missing: [] });
    expect(describeKpiRule({ flagType: 'fabric', ref: 'EM', label: 'EMBRACE' }, options))
      .toMatchObject({ name: 'EMBRACE', detail: 'EM · 2 colours', state: 'ok' });
  });

  it('a rule whose codes no longer exist says so — the KN rules after the 11-13 rename', () => {
    expect(describeKpiRule({ flagType: 'fabric', ref: 'KN01', label: 'KN01' }, options))
      .toEqual({ name: 'KN01', detail: null, missing: ['KN01'], state: 'missing' });
    // a stored name that is not the code keeps the code as detail
    expect(describeKpiRule({ flagType: 'fabric', ref: 'KN01', label: 'Aegean' }, options))
      .toMatchObject({ name: 'Aegean', detail: 'KN01', state: 'missing' });
  });

  it('a rule on part of a series says it covers only that part', () => {
    expect(describeKpiRule({ flagType: 'fabric', ref: 'MONZA-HL', label: 'MONZA-HL' }, options))
      .toMatchObject({ name: 'MONZA', detail: 'Only MONZA-HL, not the whole series', state: 'ok' });
  });

  it('a series rule with one code gone is partial, and names the missing one', () => {
    expect(describeKpiRule({ flagType: 'fabric', ref: 'MONZA', refs: ['MONZA-HL', 'MONZA-XX'] }, options))
      .toMatchObject({ name: 'MONZA', missing: ['MONZA-XX'], state: 'partial' });
  });

  it('other types resolve the same way', () => {
    expect(describeKpiRule({ flagType: 'product', ref: 'ANNSA-3S' }, options).name).toBe('ANNSA 3 Seater');
    expect(describeKpiRule({ flagType: 'special', ref: 'OLD', label: 'Retired add-on' }, options).state).toBe('missing');
  });
});

describe('ruleCovering — the double-pay guard', () => {
  const rules = [
    { id: '1', flagType: 'fabric' as const, ref: 'BROWNIE', active: true },
    { id: '2', flagType: 'fabric' as const, ref: 'D', active: false },
  ];
  it('finds the active rule already paying on any of an option\'s refs', () => {
    const homely = options.fabric.find((o) => o.refs.includes('BROWNIE'))!;
    expect(ruleCovering(homely, rules)?.id).toBe('1');
  });
  it('ignores a switched-off rule, and the rule being edited', () => {
    const d = options.fabric.find((o) => o.refs.includes('D'))!;
    expect(ruleCovering(d, rules)).toBeNull();
    const homely = options.fabric.find((o) => o.refs.includes('BROWNIE'))!;
    expect(ruleCovering(homely, rules, '1')).toBeNull();
  });
});

describe('codesSummary', () => {
  it('lists a few codes and counts the rest', () => {
    expect(codesSummary(['A'])).toBe('A');
    expect(codesSummary(['A', 'B', 'C'])).toBe('A, B, C');
    expect(codesSummary(['A', 'B', 'C', 'D', 'E'])).toBe('A, B +3 more');
  });
});
