import type { ChangeEvent } from 'react';
import { Camera } from 'lucide-react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import s from './marketing.module.css';

const TOUCH = '(pointer: coarse)';

/* YH 2026-11-06: beside every photo upload, a phone or tablet can open the
   camera straight away. A desktop has no camera to point at a sofa, so it
   keeps only Upload. The shot goes through the same onFile as an upload. */
export function TakePhoto({ disabled, onFile }: { disabled?: boolean; onFile: (e: ChangeEvent<HTMLInputElement>) => void }) {
  const touch = useMediaQuery(TOUCH);
  if (!touch) return null;
  return (
    <label className={s.takePhoto}>
      <Camera size={16} strokeWidth={1.75} className={s.icon} />Take photo
      <input type="file" accept="image/*" capture="environment" className={s.hiddenFile} disabled={disabled} onChange={onFile} />
    </label>
  );
}
