// PRE-FLIGHT "MUST SAY WHY" leaf (a generic refusal with zero indication of the actual
// reason): the gRPC Core simulate result's ExecutionError carries a STRUCTURAL `$kind` tag for every failure
// class, not only MoveAbort — parseGrpcExecutionError (@mysten/sui/dist/grpc/core.mjs) also emits
// CommandArgumentError / TypeArgumentError / IndexError / ObjectIdError / SizeError / CoinDenyListError /
// CongestedObjects / Unknown, each carrying a `message` sourced from the NODE's free-text `description` —
// OPTIONAL, so it can be empty or absent (parseGrpcExecutionError then falls back to the literal "Unknown
// error"). Relying on that text alone means a gas/object-class refusal either leaks an unlocalized server
// string or, when `description` is empty, collapses to total silence. The `$kind` tag itself is ALWAYS
// present and structurally reliable — classify on it, not on the unreliable prose. Congestion/consensus-object
// contention reuses the existing lock-race copy (same "retry, nothing charged" shape); every argument/type/
// index/object/size mismatch is a stale-reference class. Kind names mirror the source grpc enum
// (@mysten/sui/dist/grpc/proto/sui/rpc/v2/execution_status.d.mts, ExecutionError_ExecutionErrorKind).
// Extracted from abort_copy.js as its own leaf (600-LoC law — abort_copy.js was already at the ceiling) —
// abort_copy.js's humanize_tx_error stays THE ONE decoder every caller imports; this is an internal helper
// it composes, never a second player-facing entry point.
const STRUCTURAL_KIND_COPY = {
  CommandArgumentError: 'errors.tx_stale_reference',
  TypeArgumentError: 'errors.tx_stale_reference',
  IndexError: 'errors.tx_stale_reference',
  ObjectIdError: 'errors.tx_stale_reference',
  SizeError: 'errors.tx_stale_reference',
  CoinDenyListError: 'errors.tx_stale_reference',
  CongestedObjects: 'errors.tx_lock_race_retry',
}

/** Walk the raw/cause chain for a gRPC ExecutionError's `$kind` union tag (parseGrpcExecutionError's output) that
 *  classifies to house copy — MoveAbort is handled separately (abort_copy.js's parse_move_abort) and never
 *  reaches here. Bounded walk, mirrors parse_move_abort's own cause traversal. Returns the i18n KEY, or null
 *  when the kind is absent/unclassified (never invent a reason for a kind this table doesn't recognize yet).
 *  @param {unknown} error @returns {string | null} */
export function structural_kind_copy(error) {
  let current = error
  const seen = new Set()
  for (let depth = 0; depth < 6 && current != null && !seen.has(current); depth += 1) {
    seen.add(current)
    const kind = /** @type {any} */ (current)?.$kind
    if (typeof kind === 'string' && STRUCTURAL_KIND_COPY[kind]) return STRUCTURAL_KIND_COPY[kind]
    current = /** @type {any} */ (current)?.cause
  }
  return null
}
