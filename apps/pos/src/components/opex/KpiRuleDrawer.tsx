// ----------------------------------------------------------------------------
// OPEX ▸ Setup ▸ KPI items ▸ the editor drawer — one rule, created or edited.
//
// Three questions, in the order a person answers them: what it pays on, what
// it pays (the base and any quantity tiers, with worked examples), and from
// when / whether it also keeps the revenue.
//
// An existing rule's TARGET is fixed here, as it is at the API: re-pointing a
// rule in place silently re-aims a bonus at a different product. Everything
// else — amounts, tiers, start date, the revenue option — edits in place and,
// like a rate, moves every open period's figures.
// ----------------------------------------------------------------------------

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Plus, Power, Search, Trash2, X } from 'lucide-react';
import type { HrFlagType } from '@2990s/shared/hr-commission';
import {
  useCreateCommissionKpiItem, useDeleteCommissionKpiItem, useUpdateCommissionKpiItem,
  type CommissionKpiItem,
} from '../../lib/commission-api';
import { hrErrorMessage } from '../../lib/hr-wire';
import { fmtSen } from '../../lib/commission-format';
import { ruleCovering, type KpiRuleView, type KpiTargetOption } from '../../lib/kpi-rule-targets';
import type { KpiTargets } from '../../lib/kpi-rule-targets-queries';
import {
  MAX_KPI_QTY_TIERS, draftFromRule, draftProblems, emptyDraft, firstOfMonthMY, hasProblems,
  newTierDraft, parseAmounts, previewRows, type KpiRuleDraft, type TierDraft,
} from './kpi-rule-form';
import opex from './Opex.module.css';
import styles from './KpiItems.module.css';

export const TYPE_LABEL: Record<HrFlagType, string> = {
  fabric: 'Fabric series',
  special: 'Special add-on',
  product: 'Product',
  category: 'Category',
};
export const TYPE_ORDER: HrFlagType[] = ['fabric', 'special', 'product', 'category'];

const SEARCH_HINT: Record<HrFlagType, string> = {
  fabric: 'Search fabric series or code',
  special: 'Search special add-ons',
  product: 'Search product name or code',
  category: 'Search categories',
};

/** How many options the list draws before asking for a narrower search. */
const LIST_CAP = 80;

export interface KpiRuleDrawerProps {
  /** null = a new rule. */
  rule: CommissionKpiItem | null;
  /** The edited rule's resolved name and codes. */
  view?: KpiRuleView;
  rules: readonly CommissionKpiItem[];
  targets: KpiTargets;
  nameOf: (r: CommissionKpiItem) => string;
  onClose: () => void;
}

export const KpiRuleDrawer = ({ rule, view, rules, targets, nameOf, onClose }: KpiRuleDrawerProps) => {
  const mode = rule ? 'edit' : 'create';
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const create = useCreateCommissionKpiItem();
  const update = useUpdateCommissionKpiItem();
  const remove = useDeleteCommissionKpiItem();

  const [draft, setDraft] = useState<KpiRuleDraft>(() => (rule ? draftFromRule(rule) : emptyDraft()));
  const [initial] = useState(() => JSON.stringify(draft));
  const [query, setQuery] = useState('');
  const [tried, setTried] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending || remove.isPending;
  const dirty = JSON.stringify(draft) !== initial;

  const problems = draftProblems(draft, { mode, rules, editingId: rule?.id, nameOf });
  const amounts = parseAmounts(draft);

  const close = () => {
    if (dirty && !busy && !window.confirm('Discard the changes to this KPI item?')) return;
    onClose();
  };

  /* Escape closes, like every drawer; focus lands in the panel ONCE, on open,
     so the key is heard without a click first. The listener reads `close`
     through a ref — it must see the current draft (dirty or not) without
     re-running the effect, which would pull focus out of the field being
     typed in on every keystroke. */
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const set = <K extends keyof KpiRuleDraft>(k: K, v: KpiRuleDraft[K]) => {
    setSaveError(null);
    setDraft((d) => ({ ...d, [k]: v }));
  };
  const setTier = (key: number, patch: Partial<TierDraft>) =>
    set('tiers', draft.tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const addTier = () => {
    const last = draft.tiers[draft.tiers.length - 1];
    const lastQty = last ? Number(last.aboveQty) : NaN;
    set('tiers', [...draft.tiers, newTierDraft(String(Number.isFinite(lastQty) && lastQty > 0 ? lastQty + 5 : 5))]);
  };

  const options = targets.options[draft.flagType];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.search.includes(q)) : options;
  }, [options, query]);

  const save = async () => {
    setTried(true);
    setSaveError(null);
    if (hasProblems(problems)) return;
    const { bonusCenti, qtyTiers } = amounts;
    try {
      if (rule) {
        await update.mutateAsync({
          id: rule.id, bonusCenti, qtyTiers,
          countsAsRevenue: draft.countsAsRevenue,
          effectiveFrom: draft.effectiveFrom || null,
        });
      } else {
        const t = draft.target!;
        await create.mutateAsync({
          flagType: draft.flagType, ref: t.ref, refs: t.refs, label: t.label,
          bonusCenti, qtyTiers,
          countsAsRevenue: draft.countsAsRevenue,
          effectiveFrom: draft.effectiveFrom || null,
        });
      }
      onClose();
    } catch (e) {
      setSaveError(hrErrorMessage(e));
    }
  };

  const toggleActive = async () => {
    if (!rule) return;
    setSaveError(null);
    try {
      await update.mutateAsync({ id: rule.id, active: !rule.active });
      onClose();
    } catch (e) {
      setSaveError(hrErrorMessage(e));
    }
  };

  const del = async () => {
    if (!rule) return;
    /* Deleting stops it paying in every OPEN period too. Closed periods keep
       their frozen figures. */
    if (!window.confirm(
      `Delete the KPI item for "${view?.name ?? nameOf(rule)}"?\n\nOpen periods will stop paying it. Turning it off instead keeps the record.`,
    )) return;
    setSaveError(null);
    try {
      await remove.mutateAsync(rule.id);
      onClose();
    } catch (e) {
      setSaveError(hrErrorMessage(e));
    }
  };

  const rows = !problems.amount && !problems.tiers ? previewRows(amounts.bonusCenti, amounts.qtyTiers) : [];

  return (
    <div className={styles.overlay} onClick={close}>
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.panelHead}>
          <h2 id={titleId} className={styles.panelTitle}>{rule ? 'Edit KPI item' : 'New KPI item'}</h2>
          <button type="button" className={opex.iconBtn} aria-label="Close" onClick={close}>
            <X size={20} strokeWidth={1.75} />
          </button>
        </header>

        <div className={styles.panelBody}>
          {/* ── 1 · what it pays on ─────────────────────────────────────── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}><span className={styles.stepNo}>1</span> What it pays on</h3>

            {rule ? (
              <>
                <div className={styles.fixedTarget}>
                  <span className={styles.targetDetail}>{TYPE_LABEL[rule.flagType]}</span>
                  <span className={styles.targetName}>{view?.name ?? nameOf(rule)}</span>
                  {view?.detail && <span className={styles.targetDetail}>{view.detail}</span>}
                </div>
                <p className={styles.hint}>
                  To point it at something else, add a new KPI item and delete this one — so the
                  change shows as one.
                </p>
              </>
            ) : (
              <>
                <div className={styles.segmented} role="radiogroup" aria-label="Type">
                  {TYPE_ORDER.map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={draft.flagType === t}
                      className={`${styles.segment} ${draft.flagType === t ? styles.segmentActive : ''}`}
                      onClick={() => { setQuery(''); setDraft((d) => ({ ...d, flagType: t, target: null })); }}
                    >
                      {TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>

                <label className={styles.searchBox}>
                  <Search size={16} strokeWidth={1.75} />
                  <input
                    type="search"
                    value={query}
                    placeholder={SEARCH_HINT[draft.flagType]}
                    aria-label={SEARCH_HINT[draft.flagType]}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>

                <TargetList
                  options={shown}
                  total={options.length}
                  loading={targets.isLoading}
                  picked={draft.target}
                  rules={rules}
                  nameOf={nameOf}
                  onPick={(o) => set('target', o)}
                />
                {draft.flagType === 'fabric' && targets.namesFailed && (
                  <p className={styles.hint}>
                    The saved series names could not be loaded, so fabrics are grouped by their codes.
                  </p>
                )}
                {tried && problems.target && <p className={styles.fieldError}>{problems.target}</p>}
                {problems.duplicate && <p className={styles.fieldError}>{problems.duplicate}</p>}
              </>
            )}
          </section>

          {/* ── 2 · what it pays ────────────────────────────────────────── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}><span className={styles.stepNo}>2</span> What it pays</h3>

            <label className={opex.field}>
              <span className={opex.label}>For each unit sold</span>
              <span className={styles.moneyField}>
                <span>RM</span>
                <input
                  type="number" min={0} step={10} inputMode="decimal"
                  value={draft.bonusRm}
                  placeholder="0"
                  onChange={(e) => set('bonusRm', e.target.value)}
                />
              </span>
            </label>
            {(tried || draft.bonusRm !== '') && problems.amount && (
              <p className={styles.fieldError}>{problems.amount}</p>
            )}

            <div className={opex.field}>
              <span className={opex.label}>Quantity tiers</span>
              <p className={styles.hint}>
                Pay more once a salesperson sells more of it in the period. When their count passes a
                tier, <strong>every</strong> unit pays that tier&rsquo;s amount.
              </p>
              <div className={styles.tierList}>
                {draft.tiers.map((t, i) => (
                  <div key={t.key} className={styles.tierRow}>
                    <span>More than</span>
                    <span className={styles.qtyBox}>
                      <input
                        type="number" min={1} step={1} inputMode="numeric"
                        aria-label={`Tier ${i + 1}: more than how many sold`}
                        value={t.aboveQty}
                        onChange={(e) => setTier(t.key, { aboveQty: e.target.value })}
                      />
                    </span>
                    <span>sold</span>
                    <ArrowRight size={16} strokeWidth={1.75} className={styles.tierArrow} />
                    <span className={`${styles.moneyField} ${styles.tierMoney}`}>
                      <span>RM</span>
                      <input
                        type="number" min={0} step={10} inputMode="decimal"
                        aria-label={`Tier ${i + 1}: amount for each unit`}
                        value={t.bonusRm}
                        onChange={(e) => setTier(t.key, { bonusRm: e.target.value })}
                      />
                    </span>
                    <span>each</span>
                    <button
                      type="button" className={opex.iconBtn}
                      aria-label={`Remove tier ${i + 1}`}
                      onClick={() => set('tiers', draft.tiers.filter((x) => x.key !== t.key))}
                    >
                      <Trash2 size={16} strokeWidth={1.75} />
                    </button>
                  </div>
                ))}
              </div>
              {draft.tiers.length < MAX_KPI_QTY_TIERS && (
                <div className={opex.actions}>
                  <button type="button" className={opex.btn} onClick={addTier}>
                    <Plus size={16} strokeWidth={1.75} /> Add a tier
                  </button>
                </div>
              )}
              {problems.tiers && !problems.amount && <p className={styles.fieldError}>{problems.tiers}</p>}
            </div>

            {rows.length > 0 && (
              <div className={styles.preview} aria-live="polite">
                <span className={styles.previewTitle}>What one salesperson earns in a period</span>
                <table className={styles.previewTable}>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.qty}>
                        <td>Sells {r.qty}</td>
                        <td className={r.aboveQty !== null ? styles.previewStep : undefined}>
                          {r.qty} × {fmtSen(r.eachCenti)}
                        </td>
                        <td>{fmtSen(r.totalCenti)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── 3 · from when, and the revenue option ───────────────────── */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}><span className={styles.stepNo}>3</span> When and how</h3>

            <div className={opex.field}>
              <span className={opex.label}>Starts from (SO date)</span>
              <div className={styles.dateRow}>
                {draft.effectiveFrom ? (
                  <>
                    <input
                      type="date"
                      aria-label="Starts from"
                      value={draft.effectiveFrom}
                      onChange={(e) => set('effectiveFrom', e.target.value)}
                    />
                    <button type="button" className={styles.linkBtn} onClick={() => set('effectiveFrom', '')}>
                      Every order instead
                    </button>
                  </>
                ) : (
                  <>
                    <span className={styles.targetName}>Every order, past months included</span>
                    <button
                      type="button" className={styles.linkBtn}
                      onClick={() => set('effectiveFrom', firstOfMonthMY())}
                    >
                      Set a start date
                    </button>
                  </>
                )}
              </div>
              <p className={styles.hint}>
                Orders dated before it neither earn it nor count toward its tiers. No payout period has
                been closed yet, so a rule with no start date also pays every month already gone.
              </p>
            </div>

            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={draft.countsAsRevenue}
                onChange={(e) => set('countsAsRevenue', e.target.checked)}
              />
              <span className={styles.checkText}>
                <span>Also counts as product revenue</span>
                <span className={styles.hint}>
                  {draft.countsAsRevenue
                    ? 'Earns both: the fixed amount, and what it covers stays in product sales — so it also earns the percentage and counts toward the personal and showroom targets.'
                    : 'Off: the fixed amount is paid instead of the percentage on what it covers, and that part leaves product sales.'}
                </span>
              </span>
            </label>
          </section>
        </div>

        <footer className={styles.panelFoot}>
          {saveError && <p className={`${opex.error} ${styles.footError}`}>{saveError}</p>}
          <div className={styles.footGroup}>
            {rule && (
              <>
                <button type="button" className={`${opex.btn} ${opex.btnDanger}`} disabled={busy} onClick={() => void del()}>
                  <Trash2 size={16} strokeWidth={1.75} /> Delete
                </button>
                <button type="button" className={opex.btn} disabled={busy} onClick={() => void toggleActive()}>
                  <Power size={16} strokeWidth={1.75} /> {rule.active ? 'Turn off' : 'Turn on'}
                </button>
              </>
            )}
          </div>
          <div className={styles.footGroup}>
            <button type="button" className={opex.btn} disabled={busy} onClick={close}>Cancel</button>
            <button
              type="button"
              className={`${opex.btn} ${opex.btnPrimary}`}
              disabled={busy || (tried && hasProblems(problems)) || !!problems.duplicate}
              onClick={() => void save()}
            >
              {create.isPending || update.isPending ? 'Saving…' : rule ? 'Save changes' : 'Save KPI item'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

/* ── the searchable target list ─────────────────────────────────────────── */

const TargetList = ({
  options, total, loading, picked, rules, nameOf, onPick,
}: {
  options: KpiTargetOption[];
  total: number;
  loading: boolean;
  picked: KpiTargetOption | null;
  rules: readonly CommissionKpiItem[];
  nameOf: (r: CommissionKpiItem) => string;
  onPick: (o: KpiTargetOption) => void;
}) => {
  const name = useId();
  if (loading && total === 0) {
    return <div className={styles.optionList}><div className={styles.listNote}>Loading…</div></div>;
  }
  if (options.length === 0) {
    return (
      <div className={styles.optionList}>
        <div className={styles.listNote}>{total === 0 ? 'Nothing to pick from yet.' : 'Nothing matches that search.'}</div>
      </div>
    );
  }
  const capped = options.slice(0, LIST_CAP);
  return (
    <ul className={styles.optionList} role="radiogroup" aria-label="Applies to">
      {capped.map((o) => {
        const taken = ruleCovering(o, rules);
        const isPicked = picked?.ref === o.ref && picked.flagType === o.flagType;
        return (
          <li key={`${o.flagType}:${o.ref}`}>
            <label
              className={`${styles.option} ${isPicked ? styles.optionPicked : ''} ${taken ? styles.optionTaken : ''}`}
              title={taken ? `Already paid by the ${nameOf(taken)} rule` : undefined}
            >
              <input
                type="radio"
                name={name}
                checked={isPicked}
                disabled={!!taken}
                onChange={() => onPick(o)}
              />
              <span className={styles.optionText}>
                <span className={styles.optionName}>{o.label}</span>
                {o.detail && <span className={styles.optionDetail}>{o.detail}</span>}
              </span>
              {taken && <span className={opex.chip}>Has a rule</span>}
            </label>
          </li>
        );
      })}
      {options.length > LIST_CAP && (
        <li className={styles.listNote}>{options.length - LIST_CAP} more — type to narrow the list.</li>
      )}
    </ul>
  );
};
