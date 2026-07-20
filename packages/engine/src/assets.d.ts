// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Ambient module declarations for Vite asset imports (ENG-8). `import url from './x.glb?url'` and the
// generic `?url` / `?raw` / `?worker` suffixes resolve to a served URL string at bundle time; declare
// them so `tsc --checkJs` type-checks the character_avatar GLB import (and any future asset import)
// as a string rather than erroring on an unresolved module. Mirrors Vite's own `client.d.ts`.

declare module '*.glb?url' {
  const url: string
  export default url
}

declare module '*?url' {
  const url: string
  export default url
}
