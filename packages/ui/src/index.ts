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

export { PreviewSurface } from './components/PreviewSurface.tsx'

export { SelectionGrid } from './components/SelectionGrid.tsx'

export { Workspace, ValueBadge, ChoiceRail } from './components/workspaces.tsx'
export type { WorkspaceHeader, ChoiceRow } from './components/workspaces.tsx'

export { Collection, CollectionTile } from './components/Collection.tsx'
export type { CollectionEntry } from './components/Collection.tsx'

export { FilterMenu } from './components/FilterMenu.tsx'
export type { FilterOption } from './components/FilterMenu.tsx'

export { DragScroll } from './components/DragScroll.tsx'

export { CarvedIcon, type CarvedSymbol } from './components/CarvedIcon.tsx'

export { FloatingWindow } from './components/FloatingWindow.tsx'
export { useWindowDrag } from './components/useWindowDrag.ts'

export { NotificationCard } from './components/NotificationCard.tsx'
export type { NotificationCardProps } from './components/NotificationCard.tsx'

// Prebuilt: composed game surfaces.
export { CombatHud, ProgressBar, MobDetails, ProgressionCard } from './prebuilt/game.tsx'
export type { StatView, ItemView } from './prebuilt/game.tsx'

export { Vitals, vital_art } from './prebuilt/Vitals.tsx'
export { StakingRewards, StakingWalletRow } from './prebuilt/StakingRewards.tsx'
export { WalletView, WalletTransfer } from './prebuilt/Wallet.tsx'
export type { WalletAmount, TransferLeg } from './prebuilt/Wallet.tsx'
export type { StakingRewardLane, StakingRowFigure } from './prebuilt/StakingRewards.tsx'
export { SpellRow } from './prebuilt/SpellRow.tsx'
export { ItemSheet, ItemStatLine, StatGlyph, StatDelta, item_stat_display_range } from './prebuilt/ItemSheet.tsx'
export type { ItemSheetProps, ItemSheetStat, ItemSheetDamage, ItemSheetField } from './prebuilt/ItemSheet.tsx'

export { MinimapView, MapView, MapInteraction } from './prebuilt/maps.tsx'

export { SettingsView, SettingRow, WalletBalances, LanguageView } from './prebuilt/account.tsx'

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
  SpellEffectView,
  SpellGlyph,
} from './prebuilt/SpellEffects.tsx'

export {
  SuiMark,
  MarketCurrency,
  MarketListingIcon,
  MarketCategoryGlyph,
  MarketCount,
  MarketEmpty,
  MarketVolume,
  MarketCapitalization,
  MarketDisclaimer,
  MarketPage,
} from './prebuilt/MarketParts.tsx'
export type { MarketArt, MarketGlyph, MarketNotice, MarketTabs } from './prebuilt/MarketParts.tsx'
export {
  MarketBrowse,
  MarketCharacterBrowse,
  MarketItemBrowse,
  MarketItemDetail,
  MarketItemSummary,
  MarketLotColumns,
  MarketAskList,
  MarketLotTable,
  MarketAskRow,
  MarketAskItem,
} from './prebuilt/MarketBrowse.tsx'
export type {
  MarketFilter,
  MarketPagerProps,
  MarketLevelInput,
  MarketChoice,
  MarketTemplate,
  MarketSelection,
  MarketLot,
  MarketSeller,
} from './prebuilt/MarketBrowse.tsx'
export {
  MarketSell,
  MarketOwnListings,
  MarketOwnListingStack,
  MarketListingHoverIcon,
  MarketSaleForm,
  MarketSaleSummary,
  MarketSaleAmount,
  MarketFloor,
} from './prebuilt/MarketSell.tsx'
export type {
  MarketOwnListing,
  MarketWithdraw,
  MarketListingSection,
  MarketSellableCharacter,
} from './prebuilt/MarketSell.tsx'
export { MarketHistory } from './prebuilt/MarketHistory.tsx'
export type { MarketSale, MarketHistoryLabels } from './prebuilt/MarketHistory.tsx'

export { InventoryCell } from './prebuilt/InventoryCell.tsx'
export type { InventoryCellProps } from './prebuilt/InventoryCell.tsx'
