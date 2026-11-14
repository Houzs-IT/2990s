// The live sources behind kpi-rule-targets.ts — all queries the rest of the POS
// already runs and caches (catalogue, fabric library + colours, the Fabric
// Converter's saved series names, special add-ons), so the KPI screens add no
// endpoint of their own.

import { useMemo } from 'react';
import type { HrFlagType } from '@2990s/shared/hr-commission';
import { useFabricColours, useFabricLibrary, useMfgCatalog, useSpecialAddons } from './queries';
import { useFabricSeriesNames } from './fabric-series-queries';
import { buildKpiTargetOptions, type KpiTargetOptions } from './kpi-rule-targets';

export interface KpiTargets {
  options: KpiTargetOptions;
  /** Any source still on its first load. */
  isLoading: boolean;
  /** Per type: did every source it is built from load? "Not in the catalogue"
   *  is only true when the catalogue was actually read — a failed read must not
   *  flag every rule as stale. */
  ready: Record<HrFlagType, boolean>;
  /** The saved series names failed: fabric entries fall back to code families
   *  (MONZA, KN …), so a series may show under its codes. */
  namesFailed: boolean;
}

export function useKpiTargets(): KpiTargets {
  const catalogQ = useMfgCatalog();
  const libraryQ = useFabricLibrary();
  const coloursQ = useFabricColours();
  const namesQ = useFabricSeriesNames();
  const specialsQ = useSpecialAddons();

  const options = useMemo(() => buildKpiTargetOptions({
    catalog: catalogQ.data ?? [],
    library: libraryQ.data ?? [],
    colours: coloursQ.data ?? [],
    savedNames: namesQ.data ?? [],
    specials: specialsQ.data ?? [],
  }), [catalogQ.data, libraryQ.data, coloursQ.data, namesQ.data, specialsQ.data]);

  const catalogOk = !!catalogQ.data && !catalogQ.error;
  const fabricOk = !!libraryQ.data && !libraryQ.error && !!coloursQ.data && !coloursQ.error;
  const specialOk = !!specialsQ.data && !specialsQ.error;
  /* One object per answer, not per render: the commission report memoises on
     it, and a fresh object every render would recompute a payroll on each. */
  const ready = useMemo(
    () => ({ product: catalogOk, category: catalogOk, fabric: fabricOk, special: specialOk }),
    [catalogOk, fabricOk, specialOk],
  );
  return {
    options,
    isLoading: catalogQ.isLoading || libraryQ.isLoading || coloursQ.isLoading
      || namesQ.isLoading || specialsQ.isLoading,
    ready,
    namesFailed: !!namesQ.error,
  };
}
