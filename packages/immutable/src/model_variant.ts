// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type ModelVariantIdentity = Readonly<{ basename: string; variant: string | null }>

export const MODEL_VARIANT_SEPARATOR = '__'

/** An exact model wins; otherwise `basename__variant` names one material variant explicitly. */
export const model_variant_identity = (
  identity: string,
  available_basenames: readonly string[]
): ModelVariantIdentity | null => {
  if (available_basenames.includes(identity)) return Object.freeze({ basename: identity, variant: null })
  const [basename, variant, overflow] = identity.split(MODEL_VARIANT_SEPARATOR)
  return basename && variant && overflow === undefined && available_basenames.includes(basename)
    ? Object.freeze({ basename, variant })
    : null
}
