/**
 * Stamp a failure raised after transaction submission with the digest that proves gas was already burned.
 * Mutate ordinary Error objects so their original stack/cause survive; wrap frozen objects and primitives.
 * @param {unknown} error
 * @param {unknown} digest
 * @returns {unknown}
 */
export function attach_executed_digest(error, digest) {
  const value = typeof digest === 'string' ? digest : String(digest ?? '')
  if (!value) return error
  if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
    try {
      Object.defineProperty(error, 'digest', {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      })
      return error
    } catch {
      // Frozen/non-extensible errors are wrapped below without discarding the original cause.
    }
  }
  const message = String(/** @type {any} */ (error)?.message ?? error ?? 'Transaction failed after submission')
  return Object.assign(new Error(message, { cause: error }), { digest: value })
}

/**
 * Find a submission digest on an error or its cause chain. The bounded walk also tolerates hostile cyclic data.
 * @param {unknown} error
 * @returns {string|null}
 */
export function error_executed_digest(error) {
  let current = error
  const seen = new Set()
  for (let depth = 0; depth < 8 && current && !seen.has(current); depth += 1) {
    seen.add(current)
    const digest = /** @type {any} */ (current)?.digest
    if (typeof digest === 'string' && digest) return digest
    current = /** @type {any} */ (current)?.cause
  }
  return null
}

/**
 * The digest's dual: POSITIVE pre-execution provenance. True only for an error the throw site itself proved
 * never signed/sent — `tx_error(raw, { preflight: true })` stamps the house `SimulationError` name (the S-54
 * gas-guard's dry-run refusal: ZERO gas, NO digest). STRUCTURAL check only (the name, walked up the cause
 * chain like the digest) — never message text: for the burn-law latch a false "transient" could burn gas, so
 * only the thrower's own marker is admissible. Callers must still let a digest outrank this (a finality wrap
 * can layer a digest on ANY error — proof of execution always wins).
 * @param {unknown} error
 * @returns {boolean}
 */
export function error_preflight_marked(error) {
  let current = error
  const seen = new Set()
  for (let depth = 0; depth < 8 && current && !seen.has(current); depth += 1) {
    seen.add(current)
    if (/** @type {any} */ (current)?.name === 'SimulationError') return true
    current = /** @type {any} */ (current)?.cause
  }
  return false
}
