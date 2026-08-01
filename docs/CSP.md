<!-- SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available -->

# Content-Security-Policy

Defense-in-depth for a wallet-bearing origin. The policy ships from
`packages/frontend/vercel.json` (`headers` block) — the deploy-time seam, applied to every response.

It **enforces** (#853). `vercel.json` is strict JSON (Vercel's schema sets
`additionalProperties: false`, so it can carry neither comments nor a note key) — this file is the
policy's one home for _why each source is in it_. The header name is pinned by
`packages/frontend/test/csp_enforcing_header.test.js`, which also asserts the source inventory below
line for line and re-derives the two `script-src` hashes from `index.html` — a stale hash under
enforcement is a blank page for every player, so it is measured, never trusted.

The report-only header is **gone**, not kept alongside: there is no report endpoint, so a second copy
of the same policy string would duplicate the one home for zero extra signal — an enforced violation
already prints in the console of the session that hit it.

## Origin inventory — every source, and where it comes from

A source is in the policy because something in the tree resolves to it. Delete a source only after
its row's origin is gone.

| Directive               | Source                                                                    | Provenance                                                                                      |
| ----------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `connect-src`           | `https://rpc.aresrpg.world`                                               | `packages/frontend/src/env.ts` `RPC_URL` — the `/v1` read layer                                 |
| `connect-src`           | `https://sponsor.aresrpg.world`                                           | `VITE_SPONSOR_URL` in the **deployed** build (`env.ts` defaults to same-origin `/api/sponsor`)  |
| `connect-src`           | `https://assets.aresrpg.world`                                            | `packages/frontend/public/asset_manifest.json` `aggregator` — corpora fetched as JSON           |
| `connect-src`           | `https://api.enoki.mystenlabs.com`                                        | `@mysten/enoki` `registerEnokiWallets` (`src/auth/index.ts`) — zkLogin                          |
| `connect-src`           | `https://graphql.testnet.sui.io`                                          | `src/auth/index.ts` `SuiGraphQLClient`                                                          |
| `connect-src`           | `https://fullnode.{testnet,mainnet}.sui.io`, `sui-mainnet.mystenlabs.com` | `packages/sdk/src/sui.js` — both network branches                                               |
| `connect-src`           | `https://{testnet,mainnet}.mvr.mystenlabs.com`                            | `@mysten/sui` MVR name resolution (present in the built bundle)                                 |
| `connect-src`           | `https://o4508074408214528.ingest.de.sentry.io`                           | the `VITE_SENTRY_DSN` host, read off the **served production bundle** (`assets/env-*.js`)       |
| `connect-src`           | `wss://relay.aresrpg.world`                                               | `env.ts` `RELAY_URL` — the p2p signaling relay we run (`src/p2p/lobby-room.js`), one exact host |
| `img-src` / `media-src` | `https://assets.aresrpg.world`, `data:`, `blob:`                          | item/spell/mob art, the hack-mode radio, canvas and object-URL sources                          |
| `style-src`             | `'unsafe-inline'`, `https://fonts.googleapis.com`                         | React `style={{…}}` props are style _attributes_ (CSP3 requires it); the JetBrains Mono sheet   |
| `font-src`              | `https://fonts.gstatic.com`, `data:`                                      | `index.html` font link                                                                          |
| `script-src`            | `'wasm-unsafe-eval'`                                                      | the Draco decoder (`/draco/*.wasm`, `three` `DRACOLoader`)                                      |
| `script-src`            | two `sha256-…`                                                            | the two inline classic scripts in `index.html` (mobile manifest, D146 boot shim)                |
| `worker-src`            | `'self' blob:`                                                            | the engine worker pools (`packages/engine`) and Draco's blob worker                             |

## Deliberately loose, with the reason

- **`style-src 'unsafe-inline'`** — required by React inline styles; removing it means eliminating
  every `style={{…}}` prop, not a header change.

## What the flip was proven on

A production `vite build` was served on loopback with this exact header (read out of `vercel.json`,
never retyped) and driven in a real Blink: the world landing boots, the voxel world renders, the
engine's workers and the router's three surfaces run, and the network log shows
`assets.aresrpg.world`, `fonts.googleapis.com`, `fonts.gstatic.com` and `rpc.aresrpg.world` actually
contacted — zero `securitypolicyviolation`, zero page errors. The run carries a positive control (an
image from an origin the policy does not allow) which **is** blocked, so a green run cannot be the
green of a page that requested nothing.

The hashes are pinned mechanically instead of being moved to `public/`: Vite copies both inline
classic scripts into `dist/index.html` byte-for-byte, so hashing the source file is the same
measurement with none of the indirection.

## Still undriven — the watch list after the flip

Local driving cannot reach these, so they are watched on the `edge` soak rather than gated on:

- A Google zkLogin sign-in (`api.enoki.mystenlabs.com`, `accounts.google.com`,
  `graphql.testnet.sui.io`) and a sponsored transaction (`sponsor.aresrpg.world`). Every routed
  screen renders only for a signed-in address (`app.tsx`: `in_app = !!address`) and the dev wallet is
  DEV-only, so a production-shaped build has no local way in. Watch `form-action` on the sign-in: an
  OAuth flow using `response_mode=form_post` submits a form to Google, which `form-action 'self'`
  would refuse. Installed Enoki uses a top-level popup with `response_type=id_token` and a fragment
  callback — a redirect-mode flow, unaffected.
- A browser-extension wallet (Sui Wallet / Suiet) — extension-injected page scripts are the one class
  local driving cannot observe.
- `connect-src wss:` narrowing to the app's own relays, blocked on the trystero relay-config bug.

Re-derive the hashes with:

```sh
cd packages/frontend && bunx vite build
python3 - <<'PY'
import re, base64, hashlib
html = open('dist/index.html', encoding='utf-8').read()
for m in re.finditer(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S):
    print('sha256-' + base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode())
PY
```
