// BUILD-TIME visibility gate for the non-production wallet-standard connect path (#73).
//
// zkLogin (Google/Enoki) needs pre-registered OAuth redirect URLs, so it cannot complete on Vercel
// preview deployments (their URLs are dynamic) — preview builds would otherwise be unloggable. The
// wallet-standard connect path fills that gap, but ONLY off production: a v* release build from master
// must never surface it. The deployment environment is injected at build time (vite `define`
// __DEPLOY_ENV__ = process.env.VERCEL_ENV — see vite.config.ts) so the decision is a static constant the
// bundler folds, never a runtime toggle and never a CSS hide.

/**
 * PURE gate. `deploy_env` is the deployment environment string (Vercel VERCEL_ENV: 'production' |
 * 'preview' | 'development', or '' when building outside Vercel — i.e. local `vite` dev/build).
 * @returns whether the wallet-connect option may render. Only a Vercel *production* deployment hides it;
 *   preview, Vercel-development, and every local build (deploy_env '') show it.
 */
export function wallet_connect_enabled(deploy_env: string): boolean {
  return deploy_env !== 'production'
}

declare const __DEPLOY_ENV__: string

/** Resolve the gate against the build-time injected deployment environment. Guarded `typeof` so importing
 *  this module never throws where the define is absent (e.g. a bun unit-test runtime) — there it reads ''. */
export function is_wallet_connect_enabled(): boolean {
  return wallet_connect_enabled(typeof __DEPLOY_ENV__ === 'string' ? __DEPLOY_ENV__ : '')
}
