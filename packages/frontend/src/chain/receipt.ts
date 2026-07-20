// #23 gRPC receipt adapter (SSOT) — the Core API transaction result is a { Transaction | FailedTransaction }
// union whose effects carry `changedObjects` (with `idOperation`) + an `objectTypes` id→type map + `events`
// ({ eventType, json }). Every tx-result consumer in the app was written against the JSON-RPC receipt
// (`objectChanges[].{type,objectType,objectId}` + `events[].{type,parsedJson}` + `effects.status.status`), so
// this re-projects the gRPC receipt into that SAME shape (created objects only — the sole `type` consumers
// filter on) → consumer code (store.ts, run_tx callers) is unchanged across the jsonRpc→gRPC cutover.

export type NormalizedObjectChange = {
  type: 'created' | 'mutated'
  objectType: string
  objectId: string
  // post-tx version (gRPC `outputVersion`) — the dungeon place_at read-floor (dungeon_store) needs it off a MUTATED
  // object, so mutated changes are carried too (jsonRpc `objectChanges` also included mutations with `.version`).
  version: string | null
}

// Fight-cost ledger: the ONLY gas shape every consumer needs — string-encoded ints,
// mirrors gas_guard.js's own `effects.gasUsed` read so both money-decision code and display code agree.
export type NormalizedGasUsed = {
  computationCost: string
  storageCost: string
  storageRebate: string
}

export type NormalizedReceipt = {
  effects: { status: { status: string; error: string | null } }
  objectChanges: Array<NormalizedObjectChange>
  events: Array<{ type: string; parsedJson: any }>
  gasUsed: NormalizedGasUsed
}

/** Re-project a gRPC Core `waitForTransaction` result into the jsonRpc-ish receipt shape consumers parse. */
export function normalize_receipt(result: any): NormalizedReceipt {
  const tx = result?.Transaction ?? result?.FailedTransaction
  const success = !!result?.Transaction
  const object_types: Record<string, string> = tx?.objectTypes ?? {}
  // Created objects (the `type` most consumers filter on) AND mutated ones (place_at reads a mutated dungeon's
  // version). Deleted/unknown ops are dropped — no consumer reads them. `outputVersion` is the post-tx version.
  const objectChanges: NormalizedObjectChange[] = (tx?.effects?.changedObjects ?? [])
    .filter((o: any) => o?.idOperation === 'Created' || o?.outputState === 'ObjectWrite')
    .map((o: any) => ({
      type: o?.idOperation === 'Created' ? ('created' as const) : ('mutated' as const),
      objectId: o.objectId,
      objectType: object_types[o.objectId] ?? '',
      version: o.outputVersion ?? null,
    }))
  const events = (tx?.events ?? []).map((e: any) => ({ type: e.eventType, parsedJson: e.json }))
  const g = tx?.effects?.gasUsed ?? {}
  const gasUsed: NormalizedGasUsed = {
    computationCost: String(g.computationCost ?? 0),
    storageCost: String(g.storageCost ?? 0),
    storageRebate: String(g.storageRebate ?? 0),
  }
  return {
    effects: { status: { status: success ? 'success' : 'failure', error: tx?.effects?.status?.error ?? null } },
    objectChanges,
    events,
    gasUsed,
  }
}

/**
 * The objectId of the FIRST created object whose on-chain type ends with `type_suffix` (null if none).
 * Takes the RAW gRPC Core result (`{ Transaction }`), the same shape `normalize_receipt` consumes. One home
 * for the create-and-parse pattern the template/item publish adapters share.
 */
export function find_created(result: any, type_suffix: string): string | null {
  const tx = result?.Transaction
  const object_types: Record<string, string> = tx?.objectTypes ?? {}
  const created = (tx?.effects?.changedObjects ?? []).find(
    (o: any) => o?.idOperation === 'Created' && String(object_types[o.objectId] ?? '').endsWith(type_suffix)
  )
  return created?.objectId ?? null
}
