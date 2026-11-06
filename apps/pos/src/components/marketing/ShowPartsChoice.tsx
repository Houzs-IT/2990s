/* "Show as: x + y | Total" — whether a sofa's diagram writes its length and
   depth as the components' parts (worked out from the layout) or as one
   number. Saved per record (length_show_parts, 0224; YH 2026-11-06). */
import s from './marketing.module.css';

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
