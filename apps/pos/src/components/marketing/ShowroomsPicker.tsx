// The showrooms a new product goes to (owner 2026-11-12) — the launch form's
// Showroom field, which used to take one. It reads like the select it stands
// in for and opens a list to tick, since a product can go to several showrooms
// at once. Not in the design handoff, so it is built from the form's own
// pieces: the select's box, the ⋯ menu's popover.

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { showroomLabel } from './marketing-model';
import type { ShowroomOption } from '../../lib/marketing-api';
import s from './marketing.module.css';

export const ShowroomsPicker = ({ showrooms, value, onChange }: {
  showrooms: ShowroomOption[];
  /** The ids ticked. */
  value: readonly string[];
  /** The ids ticked now, in the list's order. */
  onChange: (ids: string[]) => void;
}) => {
  const [open, setOpen] = useState(false);
  const picked = showrooms.filter((o) => value.includes(o.id));
  const text = picked.length === 0 ? 'Choose showroom…'
    : picked.length === 1 ? showroomLabel(picked[0]!)
    : `${picked.length} showrooms`;
  const toggle = (id: string) =>
    onChange(showrooms.filter((o) => (o.id === id ? !value.includes(id) : value.includes(o.id))).map((o) => o.id));

  return (
    <div
      className={s.pickWrap}
      onKeyDown={(e) => {
        // Escape closes the list, not the form behind it.
        if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); }
      }}
    >
      <button
        type="button"
        className={`${s.select} ${s.pickBtn}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Showroom: ${text}`}
        disabled={showrooms.length === 0}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={s.pickText}>{text}</span>
        <ChevronDown size={16} strokeWidth={1.75} className={s.icon} />
      </button>
      {open && (
        <>
          <div className={s.rpScrim} onClick={() => setOpen(false)} />
          <div className={s.pickPop} role="group" aria-label="Showrooms">
            <div className={s.pickList}>
              {showrooms.map((o) => (
                <label key={o.id} className={s.pickItem}>
                  <input type="checkbox" className={s.pickCheck} checked={value.includes(o.id)} onChange={() => toggle(o.id)} />
                  <span>{showroomLabel(o)}</span>
                </label>
              ))}
            </div>
            <button type="button" className={s.pickDone} onClick={() => setOpen(false)}>Done</button>
          </div>
        </>
      )}
    </div>
  );
};
