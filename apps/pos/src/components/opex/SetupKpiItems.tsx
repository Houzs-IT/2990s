// ----------------------------------------------------------------------------
// OPEX ▸ Setup ▸ KPI items.
//
// A KPI item is a FIXED amount earned per unit sold — "sell this fabric series,
// earn RM 50" — as opposed to the percentage the rest of the scheme pays. What
// it can target all comes from the live POS library, so the picker is the
// catalogue, not a typed-in code:
//   Fabric series → a NAMED series (EMBRACE, HOMELY …), never a colour
//   Special       → a special-order add-on
//   Product       → one SKU
//   Category      → every item in a category (Sofa / Bedframe / …)
//
// ── THE 2026-11-15 REVAMP (owner) ───────────────────────────────────────────
// "为什么这个 fabric series 它不是显示 fabric series 的名字，而是这样乱码？" and
// "help me revamp for this ui, is so messy currently". It read raw library
// codes (MONS / EM / MONZA-HL-B01 …), a row per code, with every control
// inline on every row. Now:
//   · rules and the picker are named by series, resolved live
//     (lib/kpi-rule-targets.ts), and a rule whose codes no longer exist says so;
//   · one quiet row per rule, grouped by type, edited in a drawer
//     (KpiRuleDrawer) — the add form and the toggles left the table;
//   · QUANTITY TIERS: "这个 item 卖超过 5 个的话，本来是 40 块就会变成 50 块；
//     超过 10 个 item 的话，50 块就会变成 60 块" — every unit pays the step the
//     salesperson's count reached in the period (all-units, ruled the same
//     day). The arithmetic is @2990s/shared/hr-commission (v4).
//
// ── THE OPTION THIS SCREEN EXISTS FOR (Loo 2026-08-31) ──────────────────────
// "有一些 KPI item 它有一个 option，就是它可以同时算 product revenue …
//  product revenue 也会拿到 commission，但同样的，它 KPI item 那边也会拿到
//  special 的 KPI amount".
//
// OFF (the default, and every rule written before it): the fixed amount is
// earned INSTEAD of the percentage on the flagged portion, and that portion
// leaves the goods the percentage runs on.
// ON: earn BOTH — the fixed amount, and the portion stays in goods.
//
// ⚠️ Turning it on does not only change one line. The kept amount also counts
// toward the RM 100k personal and RM 400k showroom targets, so it can lift a
// salesperson into the higher tier — and lift the WHOLE showroom, which raises
// everyone in that room. The screen says so, because the form cannot show it.
//
// One more rule, enforced by the engine and stated here because it is not
// guessable: PRODUCT BEATS CATEGORY. A SKU named by a product rule ignores any
// category rule covering it, so one purchase never collects two bonuses.
// ----------------------------------------------------------------------------

import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, Pencil, Plus, Tag } from 'lucide-react';
import { fmtDate } from '@2990s/shared';
import { sortedQtyTiers, type HrFlagType } from '@2990s/shared/hr-commission';
import { useCommissionKpiItems, type CommissionKpiItem } from '../../lib/commission-api';
import { hrErrorMessage } from '../../lib/hr-wire';
import { fmtSen } from '../../lib/commission-format';
import { describeKpiRule, type KpiRuleView } from '../../lib/kpi-rule-targets';
import { useKpiTargets, type KpiTargets } from '../../lib/kpi-rule-targets-queries';
import { KpiRuleDrawer, TYPE_LABEL, TYPE_ORDER } from './KpiRuleDrawer';
import opex from './Opex.module.css';
import styles from './KpiItems.module.css';

/** Where a missing ref was looked for, in the words of the screen it lives on. */
const MISSING_WHERE: Record<HrFlagType, string> = {
  fabric: 'Not in the fabric library',
  special: 'Not an active add-on',
  product: 'Not in the catalogue',
  category: 'Not in the catalogue',
};

/** A rule's name and codes as they read TODAY — the stored label only while
 *  the sources load, or when they could not be read. */
const viewOf = (
  rule: CommissionKpiItem,
  options: KpiTargets['options'],
  ready: KpiTargets['ready'],
): KpiRuleView =>
  ready[rule.flagType]
    ? describeKpiRule(rule, options)
    : { name: rule.label || rule.ref, detail: null, missing: [], state: 'ok' };

export const SetupKpiItems = ({ canManage }: { canManage: boolean }) => {
  const { data: items, isLoading, error } = useCommissionKpiItems();
  const targets = useKpiTargets();
  /* null = closed · 'new' = a new rule · a rule = editing it. */
  const [editing, setEditing] = useState<CommissionKpiItem | 'new' | null>(null);

  const rules = useMemo(() => items ?? [], [items]);
  const { options, ready } = targets;
  const views = useMemo(
    () => new Map(rules.map((r) => [r.id, viewOf(r, options, ready)])),
    [rules, options, ready],
  );
  const nameOf = useCallback(
    (r: CommissionKpiItem) => views.get(r.id)?.name ?? (r.label || r.ref),
    [views],
  );

  /* One group per type, in the picker's order; active rules first, then by
     name, so the live scheme reads top-down and the switched-off rest sinks. */
  const groups = useMemo(() => TYPE_ORDER
    .map((type) => ({
      type,
      rules: rules
        .filter((r) => r.flagType === type)
        .sort((a, b) => Number(b.active) - Number(a.active)
          || nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true, sensitivity: 'base' })),
    }))
    .filter((g) => g.rules.length > 0), [rules, nameOf]);

  if (isLoading) return <p className={opex.muted}>Loading…</p>;
  if (error) return <p className={opex.error}>{hrErrorMessage(error)}</p>;

  const activeCount = rules.filter((r) => r.active).length;
  const bothCount = rules.filter((r) => r.active && r.countsAsRevenue).length;
  const cols = canManage ? 6 : 5;

  return (
    <div className={opex.card}>
      <div className={opex.cardHead}>
        <h2 className={opex.cardTitle}>
          <Tag size={16} strokeWidth={1.75} /> KPI items
        </h2>
        <span className={styles.headActions}>
          <span className={opex.chip}>{activeCount} active</span>
          {canManage && (
            <button
              type="button"
              className={`${opex.btn} ${opex.btnPrimary}`}
              onClick={() => setEditing('new')}
            >
              <Plus size={16} strokeWidth={1.75} /> New KPI item
            </button>
          )}
        </span>
      </div>
      <p className={opex.cardHint}>
        A fixed amount for each unit sold, on top of the percentage. A split sofa counts once per
        built sofa. Quantity tiers count each salesperson&rsquo;s units over the period on the
        Commission tab.
      </p>

      <div className={opex.tableWrap}>
        <table className={opex.table}>
          <thead>
            <tr>
              <th>Applies to</th>
              <th>Pays per unit</th>
              <th>Starts</th>
              <th>Product revenue</th>
              <th>Status</th>
              {canManage && <th aria-label="Actions" />}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.type}>
              <tr className={styles.groupRow}>
                <th colSpan={cols} scope="colgroup">
                  {TYPE_LABEL[g.type]}<span className={styles.groupCount}>{g.rules.length}</span>
                </th>
              </tr>
              {g.rules.map((r) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  view={views.get(r.id)!}
                  canManage={canManage}
                  onEdit={() => setEditing(r)}
                />
              ))}
            </tbody>
          ))}
          {groups.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={cols} className={styles.empty}>
                  No KPI items yet — only the percentage scheme pays.
                  {canManage && ' Add one with New KPI item.'}
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>

      {bothCount > 0 && (
        <p className={opex.notice}>
          <span className={opex.noticeTitle}>
            <AlertTriangle size={14} strokeWidth={1.75} /> {bothCount} rule
            {bothCount === 1 ? '' : 's'} currently earn{bothCount === 1 ? 's' : ''} both
          </span>
          <br />
          The amount those keep in product sales also counts toward the RM 100k personal target and
          the showroom target — so it can move someone into the higher tier, and can lift the whole
          showroom, which raises the rate for everyone in that room. Worth a look at the Commission
          tab before a payout.
        </p>
      )}

      <details className={styles.explain}>
        <summary>
          <ChevronRight size={16} strokeWidth={1.75} className={styles.explainChevron} />
          How KPI items pay
        </summary>
        <dl className={styles.explainBody}>
          <div>
            <dt>Instead of % — the default</dt>
            <dd>
              The fixed amount replaces the percentage on what it covers, and that part leaves
              product sales. A RM 3,000 sofa with a RM 125 fabric upgrade flagged at RM 50: product
              sales keeps RM 3,000, the salesperson earns the RM 50, the RM 125 drops out.
            </dd>
          </div>
          <div>
            <dt>Earns both</dt>
            <dd>
              Same RM 50, and the RM 125 stays in product sales — so it also earns the percentage
              and counts toward the personal and showroom targets.
            </dd>
          </div>
          <div>
            <dt>Quantity tiers</dt>
            <dd>
              Units are counted per salesperson over the period chosen on the Commission tab, from
              the rule&rsquo;s start date. Once the count passes a tier, every unit pays that
              tier&rsquo;s amount: RM 40, more than 5 → RM 50, more than 10 → RM 60 — selling 12
              pays 12 × RM 60.
            </dd>
          </div>
          <div>
            <dt>Two rules on one item</dt>
            <dd>
              A product rule beats a category rule — naming one SKU is a deliberate override of the
              blanket rate, so one purchase never collects both. Fabric series and special add-on
              rules target a different part of the same purchase and do stack.
            </dd>
          </div>
        </dl>
      </details>

      {editing && (
        <KpiRuleDrawer
          rule={editing === 'new' ? null : editing}
          view={editing === 'new' ? undefined : views.get(editing.id)}
          rules={rules}
          targets={targets}
          nameOf={nameOf}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};

const RuleRow = ({
  rule, view, canManage, onEdit,
}: {
  rule: CommissionKpiItem;
  view: KpiRuleView;
  canManage: boolean;
  onEdit: () => void;
}) => {
  const tiers = sortedQtyTiers(rule.qtyTiers);
  return (
    <tr className={rule.active ? undefined : styles.rowOff}>
      <td>
        <div className={styles.target}>
          <span className={styles.targetName}>{view.name}</span>
          {view.detail && <span className={styles.targetDetail}>{view.detail}</span>}
          {view.state !== 'ok' && (
            <span className={styles.targetFlags}>
              <span
                className={styles.chipWarn}
                title={view.state === 'missing'
                  ? 'Orders cannot carry these codes any more, so this rule may be paying nothing. Add it again on the current series, then delete this one.'
                  : `No longer offered: ${view.missing.join(', ')}`}
              >
                <AlertTriangle size={12} strokeWidth={1.75} />
                {view.state === 'missing' ? MISSING_WHERE[rule.flagType] : `${view.missing.length} code${view.missing.length === 1 ? '' : 's'} gone`}
              </span>
            </span>
          )}
        </div>
      </td>
      <td>
        <div className={styles.ladder}>
          <span className={styles.ladderBase}>{fmtSen(rule.bonusCenti)} each</span>
          {tiers.map((t) => (
            <span key={t.aboveQty} className={styles.ladderStep}>
              more than {t.aboveQty} sold → <strong>{fmtSen(t.bonusCenti)}</strong>
            </span>
          ))}
        </div>
      </td>
      <td className={rule.effectiveFrom ? undefined : opex.muted}>
        {rule.effectiveFrom ? fmtDate(rule.effectiveFrom) : 'Every order'}
      </td>
      <td>
        {rule.countsAsRevenue
          ? <span className={`${opex.chip} ${opex.chipHit}`}>Earns both</span>
          : <span className={opex.muted}>Instead of %</span>}
      </td>
      <td>
        <span className={styles.status}>
          <span className={`${styles.dot} ${rule.active ? styles.dotOn : styles.dotOff}`} />
          {rule.active ? 'Active' : 'Off'}
        </span>
      </td>
      {canManage && (
        <td className={opex.num}>
          <button
            type="button"
            className={opex.btn}
            aria-label={`Edit ${view.name}`}
            onClick={onEdit}
          >
            <Pencil size={16} strokeWidth={1.75} /> Edit
          </button>
        </td>
      )}
    </tr>
  );
};
