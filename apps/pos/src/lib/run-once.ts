/** Runs `run` unless a run on the same `flag` is still going. A second call
    while busy is dropped, not queued: a double-tap on "Complete order" must
    not claim a voucher twice or post a second SO. `onBusy` mirrors the flag
    into state so the button can show it. */
export const runOnce = async (
  flag: { current: boolean },
  run: () => Promise<void>,
  onBusy: (busy: boolean) => void,
): Promise<void> => {
  if (flag.current) return;
  flag.current = true;
  onBusy(true);
  try {
    await run();
  } finally {
    flag.current = false;
    onBusy(false);
  }
};
