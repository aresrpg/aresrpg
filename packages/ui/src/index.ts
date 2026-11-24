// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import './styles.css'

// Components: raw building blocks.
export {
  Button,
  NavigationRow,
  IconButton,
  KeyHint,
  SegmentedControl,
  Toggle,
  Field,
  Select,
  Slider,
} from './components/controls.tsx'
export {
  NativeModal,
  focus_modal,
  active_modal,
  observe_window_changes,
  suspend_native_modals,
} from './components/NativeModal.tsx'
export { Panel, GameWindow, ConfirmDialog } from './components/surfaces.tsx'

export { SelectionGrid } from './components/SelectionGrid.tsx'

export { Workspace, ValueBadge } from './components/workspaces.tsx'
export type { WorkspaceHeader } from './components/workspaces.tsx'

export { Collection, CollectionTile } from './components/Collection.tsx'

export { FilterMenu } from './components/FilterMenu.tsx'

export { DragScroll } from './components/DragScroll.tsx'

export { Ground } from './components/Ground.tsx'

export { CarvedIcon, type CarvedSymbol } from './components/CarvedIcon.tsx'
export { SuiLogo } from './components/SuiLogo.tsx'

export { FloatingWindow } from './components/FloatingWindow.tsx'
export { useWindowDrag } from './components/useWindowDrag.ts'

// Prebuilt: composed game surfaces.
export { CombatHud, ProgressBar, MobDetails, ProgressionCard } from './prebuilt/game.tsx'
export type { StatView, ItemView } from './prebuilt/game.tsx'

export { Vitals, vital_art } from './prebuilt/Vitals.tsx'
export { StakingRewards, StakingWalletRow } from './prebuilt/StakingRewards.tsx'
export { WalletView, WalletTransfer } from './prebuilt/Wallet.tsx'
export type { TransferLeg } from './prebuilt/Wallet.tsx'
export type { StakingRowFigure } from './prebuilt/StakingRewards.tsx'
export { SpellRow } from './prebuilt/SpellRow.tsx'
export { ItemSheet, ItemStatLine, StatGlyph, item_stat_display_range } from './prebuilt/ItemSheet.tsx'
export type { ItemSheetProps, ItemSheetField } from './prebuilt/ItemSheet.tsx'

export { MinimapView, MapView, MapInteraction } from './prebuilt/maps.tsx'

export { SettingsView, SettingRow, LanguageView } from './prebuilt/account.tsx'

export { SpellCard } from './prebuilt/SpellCard.tsx'
export type { SpellCardProps, SpellCardLevel, SpellCardLabels, SpellCardIcons } from './prebuilt/SpellCard.tsx'
export { SpellEffectList } from './prebuilt/SpellEffects.tsx'
export type {
  SpellArea,
  SpellCritical,
  SpellEffectDraft,
  SpellEffectIcon,
  SpellEffectListProps,
  SpellEffectRead,
} from './prebuilt/SpellEffects.tsx'

export {
  MarketCurrency,
  MarketListingIcon,
  MarketCategoryGlyph,
  MarketEmpty,
  MarketVolume,
  MarketCapitalization,
} from './prebuilt/MarketParts.tsx'
export type { MarketArt } from './prebuilt/MarketParts.tsx'
export { MarketAskList, MarketLotTable, MarketAskRow, MarketAskItem } from './prebuilt/MarketBrowse.tsx'
export {
  MarketOwnListings,
  MarketOwnListingStack,
  MarketListingHoverIcon,
  MarketSaleForm,
  MarketSaleSummary,
  MarketSaleAmount,
  MarketFloor,
} from './prebuilt/MarketSell.tsx'
export type { MarketOwnListing } from './prebuilt/MarketSell.tsx'
export { MarketHistory } from './prebuilt/MarketHistory.tsx'

export { InventoryCell } from './prebuilt/InventoryCell.tsx'
