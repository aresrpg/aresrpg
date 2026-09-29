// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import inventory from './assets/carved_inventory.webp'
import stats from './assets/carved_stats.webp'
import spells from './assets/carved_spells.webp'
import jobs from './assets/carved_jobs.webp'
import runeforge from './assets/carved_runeforge.webp'
import map from './assets/carved_map.webp'
import fullscreen from './assets/carved_fullscreen.webp'
import characters from './assets/carved_characters.webp'
import leaderboard from './assets/carved_leaderboard.webp'
import mastery from './assets/carved_mastery.webp'
import kares from './assets/carved_kares.webp'
import encyclopedia from './assets/carved_encyclopedia.webp'
import marketplace from './assets/carved_marketplace.webp'
import airdrop from './assets/carved_airdrop.webp'
import kolizeum from './assets/carved_kolizeum.webp'
import settings from './assets/carved_settings.webp'
import admin from './assets/carved_admin.webp'

const ART = {
  inventory,
  stats,
  spells,
  jobs,
  runeforge,
  map,
  fullscreen,
  characters,
  leaderboard,
  mastery,
  kares,
  encyclopedia,
  marketplace,
  airdrop,
  kolizeum,
  settings,
  admin,
}
export type CarvedSymbol = keyof typeof ART
export const CarvedIcon = ({ name }: Readonly<{ name: CarvedSymbol }>) => (
  <span className="aui-carved-icon" aria-hidden="true">
    <img src={ART[name]} alt="" draggable={false} />
  </span>
)
