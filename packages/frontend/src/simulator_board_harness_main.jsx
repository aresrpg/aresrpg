// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THROWAWAY board-pane harness (#2205) — NOT part of the app, NOT imported by main.tsx, NOT in the
// production bundle (a separate Vite HTML entry, and vite.config.ts declares no multi-entry input, so only
// index.html is ever built). Mounts the REAL `SimulatorBoardPane` — same module, same store, same lazy
// engine mount the /simulator page uses — with no chain, no auth, no roster, because the page itself sits
// behind the app's sign-in wall and a GPU-less VISITOR is exactly who this ticket is about.
//
// Same reason the create screen has `character-create-harness.html`: the pane's degrade must be driven in a
// real browser with a real dead WebGL context, and the wall is not part of what is being proven.
import './boot_shim'

import './index.css'
import './i18n'
import { createRoot } from 'react-dom/client'

import { SimulatorBoardPane } from './simulator/BoardPane'
import { boot_simulator } from './simulator/store'

// The pane is `flex-1 min-h-0` — it needs a sized flex column to live in, exactly as pages/simulator.tsx
// gives it. The stage is the only thing this harness adds.
const stage = document.createElement('div')
stage.style.position = 'fixed'
stage.style.inset = '0'
stage.style.display = 'flex'
stage.style.flexDirection = 'column'
stage.style.padding = '16px'
document.getElementById('root').appendChild(stage)

void boot_simulator().then(() => createRoot(stage).render(<SimulatorBoardPane />))
