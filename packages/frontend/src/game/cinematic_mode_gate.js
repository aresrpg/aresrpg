// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/**
 * Resolve a requested cinematic state against the deployment channel. Vercel production is the sole
 * exception; preview, development, and local builds keep the existing enabled-by-default behaviour.
 * @param {boolean} requested
 * @param {string} deploy_env
 */
export function resolve_cinematic_active(requested, deploy_env) {
  return deploy_env !== 'production' && !!requested
}

/** Resolve against Vite's existing build-time Vercel channel. The fallback keeps non-Vite/local consumers ON. */
export function resolve_build_cinematic_active(requested) {
  return resolve_cinematic_active(requested, typeof __DEPLOY_ENV__ === 'string' ? __DEPLOY_ENV__ : '')
}
