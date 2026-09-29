// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createContext, useCallback, useContext, useState, type RefObject } from 'react'
import { focus_modal } from '@aresrpg/ui'

export type Inspection = Readonly<{ kind: 'item' | 'mob' | 'world'; id: string }>
type OpenInspection = (kind: Inspection['kind']) => (id: string) => void
export const InspectionContext = createContext<OpenInspection | null>(null)
export const inspection_identity = ({ kind, id }: Inspection) => `${kind}:${id}`

export const useInspections = (root: Readonly<RefObject<HTMLElement | null>>) => {
  const parent = useContext(InspectionContext)
  const [inspections, set_inspections] = useState<readonly Inspection[]>([])
  const open = useCallback(
    (kind: Inspection['kind']) => (id: string) => {
      const next = { kind, id }
      if (!id || focus_modal(inspection_identity(next), root.current)) return
      set_inspections((current) =>
        current.some((row) => inspection_identity(row) === inspection_identity(next)) ? current : [...current, next]
      )
    },
    [root]
  )
  const close = useCallback(
    (entry: Inspection) =>
      set_inspections((current) => current.filter((row) => inspection_identity(row) !== inspection_identity(entry))),
    []
  )
  return { inspections, open: parent ?? open, close }
}
