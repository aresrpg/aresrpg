// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type ModelVariantIdentity = Readonly<{ basename: string; variant: string | null }>

export const MODEL_VARIANT_SEPARATOR = '__'

/** Exact assets and explicit variants share the protector families' published naming grammar. */
export const model_variant_identity = (
  identity: string,
  available_basenames: readonly string[]
): ModelVariantIdentity | null => {
  if (available_basenames.includes(identity)) return Object.freeze({ basename: identity, variant: null })
  const protector = /^protector_([a-z0-9]+(?:_[a-z0-9]+)*?)(?:_(gaia|bricheton))?$/u.exec(identity)
  const variant_identity = protector
    ? `protector_${protector[2] ?? 'miner'}${MODEL_VARIANT_SEPARATOR}${protector[1]}`
    : identity
  const [basename, variant, overflow] = variant_identity.split(MODEL_VARIANT_SEPARATOR)
  return basename && variant && overflow === undefined && available_basenames.includes(basename)
    ? Object.freeze({ basename, variant })
    : null
}
