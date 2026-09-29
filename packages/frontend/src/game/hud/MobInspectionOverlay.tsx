import { dispatch_app, useAppStore } from '../../store.ts'
import type { AppCopy } from '../../i18n/copy.ts'
import { MobDetailsDialog, catalog_mob, type MobLookup, type ItemLookup } from './MobDetailsDialog.tsx'

export const MobInspectionOverlay = ({
  copy,
  mob_for = catalog_mob,
  item_for,
}: Readonly<{ copy: AppCopy; mob_for?: MobLookup; item_for?: ItemLookup }>) => {
  const dialog = useAppStore(({ navigation }) => navigation.dialog)
  const mob_type = dialog?.startsWith('mob:') ? dialog.slice(4) : null
  const mob = mob_type ? mob_for(mob_type) : undefined
  if (!mob) return null
  return (
    <MobDetailsDialog
      mob={mob}
      item_for={item_for}
      copy={copy}
      close={() => {
        dispatch_app({ type: 'dialog/open', dialog: null })
      }}
    />
  )
}
