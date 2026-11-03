/* Houzs answers a refused Save / Proceed with
   { error: 'validation_failed', message, problems: [{ code, message, line?, field? }] }.
   With 2+ problems `message` is only "N things need fixing…", so the list must
   come from `problems`. Returns each problem's message, in order. */
export const saveProblemMessages = (payload: Record<string, unknown> | null): string[] => {
  const raw = payload?.problems;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => (p && typeof (p as { message?: unknown }).message === 'string' ? (p as { message: string }).message : ''))
    .filter((m) => m !== '');
};
