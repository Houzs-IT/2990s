/* A length that can be typed as parts, x + y = length (0224, YH 2026-11-05).
   "+" splits the input into parts; "+" again adds one, × removes one, and
   removing down to one part goes back to the plain length. While parts are in
   use the total is their sum, shown read-only. */
import { Plus, X } from 'lucide-react';
import { MAX_LENGTH_PARTS, partsTotal } from './marketing-model';
import s from './marketing.module.css';

export interface LengthValue {
  /** The length's input text; kept at the parts' sum while there are parts. */
  value: string;
  parts: string[] | null;
}

const sumText = (parts: string[]): string => String(partsTotal(parts) ?? '');

export const LengthPartsInput = ({ value, parts, onChange, label, placeholder, inputClass }: LengthValue & {
  onChange: (v: LengthValue) => void;
  /** What the length is, for the inputs' aria-labels ("Length"). */
  label: string;
  placeholder?: string;
  inputClass: string;
}) => {
  const setParts = (next: string[]) =>
    onChange(next.length < 2 ? { value: next[0] ?? '', parts: null } : { value: sumText(next), parts: next });
  const num = { type: 'number', inputMode: 'numeric', min: 1, max: 1000, step: 1 } as const;
  if (!parts) {
    return (
      <>
        <input {...num} value={value} placeholder={placeholder} aria-label={`${label} in cm`} className={inputClass}
          onChange={(e) => onChange({ value: e.target.value, parts: null })} />
        <button type="button" className={s.ghostBtn} aria-label={`Type the ${label.toLowerCase()} as parts`} title="Type it as parts (x + y)"
          onClick={() => setParts([value, ''])}>
          <Plus size={16} strokeWidth={1.75} />
        </button>
      </>
    );
  }
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className={s.lengthPart}>
          {i > 0 && <span className={s.inchUnit}>+</span>}
          <input {...num} value={p} placeholder={`Part ${i + 1}`} aria-label={`${label} part ${i + 1} in cm`} className={inputClass}
            onChange={(e) => setParts(parts.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" className={s.ghostBtn} aria-label={`Remove part ${i + 1}`}
            onClick={() => setParts(parts.filter((_, j) => j !== i))}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </span>
      ))}
      {parts.length < MAX_LENGTH_PARTS && (
        <button type="button" className={s.ghostBtn} aria-label="Add a part" onClick={() => setParts([...parts, ''])}>
          <Plus size={16} strokeWidth={1.75} />
        </button>
      )}
      <span className={s.inchUnit} aria-label={`${label} total`}>= {value || '—'}</span>
    </>
  );
};

/** "Show as: x + y | Total" — whether the record prints its parts. */
export const ShowPartsChoice = ({ show, onChange, disabled }: { show: boolean; onChange: (show: boolean) => void; disabled?: boolean }) => (
  <span className={s.inchRow} role="group" aria-label="Show the length as">
    <span className={s.inchUnit}>Show as</span>
    {([[true, 'x + y'], [false, 'Total']] as const).map(([v, text]) => (
      <button key={text} type="button" disabled={disabled} aria-pressed={show === v}
        className={`${s.actionChip} ${show === v ? s.chipOn : ''}`} onClick={() => onChange(v)}>
        {text}
      </button>
    ))}
  </span>
);
