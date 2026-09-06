import type { Tx } from '#config/database.config';
import { JOB, JobsRepository } from '#jobs/queue.repository';
import { CascadeRepository } from './cascade.repository';

export type BasketScope = Parameters<typeof CascadeRepository.cancelOpenBaskets>[0];

// Cancels open baskets; the engine is told to stop any that were already queued or running.
// Shared by every path that ends consent: leaving, removal, handover, dissolving and revoking a grant.
export async function cancelOpenBaskets(tx: Tx, scope: BasketScope) {
  const cancelled = await CascadeRepository.cancelOpenBaskets(scope, tx);
  for (const { id, wasStatus } of cancelled) {
    if (wasStatus === 'proposed') continue;
    await JobsRepository.enqueue(
      { kind: JOB.cancelBasket, payload: { basketId: id }, dedupeKey: `${JOB.cancelBasket}:${id}` },
      tx,
    );
  }
  return cancelled;
}
