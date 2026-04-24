/**
 * Shared relay pool used for NIP-46 remote signer transport.
 *
 * Lives as a singleton so multiple signers share connections to the same relays.
 * The pool is constructed lazily so apps that never use a remote signer don't pay
 * the cost of opening web sockets.
 */

import { RelayPool } from "applesauce-relay";
import { NostrConnectSigner } from "applesauce-signers";
import type {
  NostrPool,
  NostrPublishMethod,
  NostrSubscriptionMethod,
} from "applesauce-signers";

let _pool: RelayPool | null = null;
let _adapter: NostrPool | null = null;
let _wired = false;

export function getRelayPool(): RelayPool {
  if (!_pool) _pool = new RelayPool();
  return _pool;
}

/**
 * Adapter that exposes the RelayPool as the {@link NostrPool} shape that
 * `applesauce-signers` expects. The pool's `subscription` returns an
 * `Observable<NostrEvent | "EOSE">` which is a valid `ObservableInput`, and
 * the publish returns a Promise of results — both shapes match directly so no
 * extra rxjs operators are needed.
 */
export function getNostrPool(): NostrPool {
  if (_adapter) return _adapter;
  const pool = getRelayPool();

  const subscription: NostrSubscriptionMethod = (relays, filters) =>
    pool.subscription(relays, filters);

  const publish: NostrPublishMethod = (relays, event) =>
    pool.publish(relays, event);

  _adapter = { subscription, publish };
  return _adapter;
}

/**
 * Wire the NostrConnectSigner class with global publish/subscribe methods so
 * any NostrConnectSigner instance constructed without an explicit `pool`
 * falls back to our shared pool. Idempotent.
 */
export function ensureNostrConnectWired(): void {
  if (_wired) return;
  const adapter = getNostrPool();
  NostrConnectSigner.subscriptionMethod = adapter.subscription;
  NostrConnectSigner.publishMethod = adapter.publish;
  _wired = true;
}
