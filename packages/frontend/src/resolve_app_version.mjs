// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// D260 fix — v1.12.37 PROD INCIDENT (github.com/aresrpg/aresrpg): the sidebar/version-badge
// player-facing tag rendered `VE771893` — git's raw abbreviated commit SHA (e771893) with a `v`
// prefix, CSS-uppercased by the house label idiom — instead of the release semver.
//
// Root cause: this used to be `env_app_version || describe_tags() || pkg_version` (the
// try/catch existed because "a git-less build (Vercel remote) never breaks" — a false
// assumption: Vercel's remote build DOES check out `.git`, it just doesn't fetch tags, so
// `git describe --tags --always` doesn't throw there, it silently returns the raw abbreviated
// commit SHA instead of a semver). Empirically confirmed a SECOND failure shape in a full local
// clone (tags present, HEAD 39 commits past the last tag): `git describe` returned
// `v1.12.37-39-g706c680` — still not a clean semver.
//
// Fix: the player-facing version is ALWAYS packages/frontend's own package.json `version` — set
// once by the release ritual, present in every build (local/CI/Vercel), never git-state-dependent.
// Pure and parameterless on purpose: nothing left to inject a SHA/tag-describe string through.
// (A separate build SHA still exists for Sentry release tagging — GIT_SHA in vite.config.ts —
// that's a support/debugging concern, unaffected by this fix.)
export function resolve_app_version(pkg_version) {
  return pkg_version
}
