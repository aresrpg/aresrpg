// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { AddFundsModal } from '../../src/components/AddFundsModal.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import '../../src/tailwind.css'

const copy = await load_app_copy('en')
const Fixture = () => {
  const [open, set_open] = useState(true)
  const [address, set_address] = useState(`0x${'11'.repeat(32)}`)
  return (
    <>
      <button type="button" onClick={() => set_open(true)}>
        Open funding
      </button>
      <button type="button" onClick={() => set_address(`0x${'22'.repeat(32)}`)}>
        Switch recipient
      </button>
      {open && (
        <AddFundsModal
          address={address}
          copy={copy}
          network={new URLSearchParams(location.search).has('testnet') ? 'testnet' : 'mainnet'}
          on_close={() => set_open(false)}
        />
      )}
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
