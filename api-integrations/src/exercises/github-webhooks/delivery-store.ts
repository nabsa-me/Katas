/**
 * Port: remembers which deliveries have been accepted, so a redelivery (same `X-GitHub-Delivery`) has no second
 * effect. The handler depends on this interface only; the adapter is in memory here and a database in production:
 *
 * - DynamoDB: `PutItem` with `ConditionExpression: 'attribute_not_exists(deliveryId)'`; a
 *   `ConditionalCheckFailedException` means "already claimed". A TTL attribute expires old ids.
 * - Postgres: `INSERT INTO webhook_deliveries (delivery_id) VALUES ($1) ON CONFLICT DO NOTHING`; zero rows
 *   inserted means "already claimed".
 *
 * Either way the check and the write are one atomic operation. "Read, then write if absent" is not: two copies of
 * the same delivery arriving together would both see "absent".
 */
export interface DeliveryStore {
  /** Records the id and returns true, or returns false if it was already recorded. Atomic. */
  claim(deliveryId: string): Promise<boolean>;
  /** Forgets an id whose processing failed, so that a redelivery can process it again. */
  release(deliveryId: string): Promise<void>;
}

export function createInMemoryDeliveryStore(): DeliveryStore {
  const claimed = new Set<string>();
  return {
    // No `await` between the check and the add: JavaScript runs them as one step, so this is atomic in-process.
    async claim(deliveryId) {
      if (claimed.has(deliveryId)) return false;
      claimed.add(deliveryId);
      return true;
    },
    async release(deliveryId) {
      claimed.delete(deliveryId);
    },
  };
}
