// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect } from 'react'
import { useStore } from 'zustand'

import { env } from '../env.ts'

import { create_blast_runtime } from './blast.ts'

// Creating the reducer store is inert; the first mounted consumer starts the shared reader.
const runtime = create_blast_runtime({ network: env.network, rpc_url: env.sui_rpc_url })

export const useBlastSale = () => {
  const state = useStore(runtime.store)
  useEffect(() => runtime.start(), [])
  return state
}
