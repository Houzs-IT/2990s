import { authedFetch } from './apiClient';

/* Houzs refuses every direct SO line write that lacks an X-SO-Edit-Lease header
   (409 so_edit_lease_conflict, reason 'missing'). Same reserve → act → release
   protocol as Houzs's runSoVersionedMutation (vendor/scm/lib/so-versioned-mutation.ts). */
export async function withSoLineLease<T>(docNo: string, action: (leaseToken: string) => Promise<T>): Promise<T> {
  const path = `/mfg-sales-orders/${encodeURIComponent(docNo)}`;
  const token = crypto.randomUUID();
  const detail = await authedFetch<{ salesOrder?: { version?: number | string } }>(path);
  const version = Number(detail.salesOrder?.version);
  if (!Number.isInteger(version) || version < 1) throw new Error('This order has no version yet — refresh and try again.');
  const reserved = await authedFetch<{ version: number; leaseToken?: string }>(path, {
    method: 'PATCH',
    body: JSON.stringify({ version, reserveLineWrites: true, lineWriteLeaseToken: token }),
  });
  const leaseToken = reserved.leaseToken || token;
  try {
    return await action(leaseToken);
  } finally {
    // Never turn a committed action into a failure because the release failed; the lease expires on its own.
    await authedFetch(path, {
      method: 'PATCH',
      body: JSON.stringify({ version: reserved.version, completeLineWrites: true, lineWriteLeaseToken: leaseToken }),
    }).catch(() => undefined);
  }
}
