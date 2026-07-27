// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { fileURLToPath } from 'node:url'

import { plugin } from 'bun'

const default_avatar_import = /assets\/characters\/senshi_male\.glb\?url$/
const default_avatar_stub = fileURLToPath(new URL('../stubs/default_avatar_url.js', import.meta.url))

plugin({
  name: 'default-avatar-cdn-url',
  setup(build) {
    build.onResolve({ filter: default_avatar_import }, () => ({ path: default_avatar_stub }))
  },
})
