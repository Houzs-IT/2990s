/* "Show as: x + y | Total" — whether a sofa's diagram writes its length and
   depth as the components' parts (worked out from the layout) or as one
   number. Saved per record (length_show_parts, 0224; YH 2026-11-06). */
import s from './marketing.module.css';
import { partsTotal } from './marketing-model';

export const ShowPartsChoice = ({ show, onChange, disabled }: { show: boolean; onChange: (show: boolean) => void; disabled?: boolean }) => (
  <span className={s.inchRow} role="group" aria-label="Show the size as">
    <span className={s.inchUnit}>Show as</span>
    {([[true, 'x + y'], [false, 'Total']] as const).map(([v, text]) => (
      <button key={text} type="button" disabled={disabled} aria-pressed={show === v}
        className={`${s.actionChip} ${show === v ? s.chipOn : ''}`} onClick={() => onChange(v)}>
        {text}
      </button>
    ))}
  </span>
);

/* "Width by component: [120] + [100] = 220" — a size typed one component at a
   time (YH 2026-11-06). Each box starts at that component's own size. */
export const PartsRow = ({ label, parts, onChange }: { label: string; parts: string[]; onChange: (parts: string[]) => void }) => (
  <>
    <div className={s.compsTitle}>{label} by component</div>
    <div className={`${s.inchRow} ${s.inchRowWrap}`}>
      {parts.map((x, i) => (
        <span key={i} className={s.lengthPart}>
          {i > 0 && <span className={s.inchUnit}>+</span>}
          <input type="number" inputMode="numeric" min={1} max={1000} value={x} aria-label={`Component ${i + 1} ${label.toLowerCase()} (cm)`}
            onChange={(e) => onChange(parts.map((p, j) => (j === i ? e.target.value : p)))} className={`${s.input} ${s.inchInput}`} />
        </span>
      ))}
      <span className={s.inchUnit}>= {partsTotal(parts) ?? '—'}</span>
    </div>
  </>
);
