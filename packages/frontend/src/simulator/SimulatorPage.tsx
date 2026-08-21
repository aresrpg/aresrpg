// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Local fight setup. The roster authors characters; the board alone owns both teams' placement.

import type { FightBlobShape } from '@aresrpg/engine'
import { Dices, Droplets, Play, Plus, Swords } from 'lucide-react'
import { useState } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { can_start_simulator_fight } from '../modules/simulator.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import type { SceneHandle } from '../game/core/scene_feed.ts'

import { SimulatorBoardPane } from './BoardPane.tsx'
import { CharacterRow } from './CharacterRow.tsx'
import { simulator_fight_setup } from './fight_setup.ts'
import { CharacterModal } from './CharacterModal.tsx'

const template = (source: string, values: Readonly<Record<string, string | number>>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), source)

const SimulatorPage = ({ copy, scene }: Readonly<{ copy: AppCopy; scene: SceneHandle }>) => {
  const simulator = useAppStore((state) => state.simulator)
  const [editing, set_editing] = useState<string | 'new' | null>(null)
  const [blob_color, set_blob_color] = useState('#35b34a')
  const [blob_range, set_blob_range] = useState(3)
  const [blob_shape, set_blob_shape] = useState<FightBlobShape>('per_cell')
  const [blob_enabled, set_blob_enabled] = useState(false)
  const text = copy.simulator_page

  return (
    <section className="pointer-events-auto relative flex min-h-full flex-1 flex-col overflow-hidden border border-white/8 bg-[#09090f]">
      <header className="z-10 flex h-14 shrink-0 items-center gap-4 border-b border-white/8 bg-[#111119]/94 px-5">
        <Swords aria-hidden="true" className="text-[#c8963c]" size={15} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[11px] font-semibold tracking-[0.18em] uppercase">{text.title}</h1>
          <p className="mt-0.5 text-[8px] tracking-[0.14em] text-[#6b7280] uppercase">{text.local_only}</p>
        </div>
        <span className="text-[8px] tracking-[0.16em] text-[#6b7280] uppercase">
          {template(text.board_seed, { seed: simulator.seed.toString() })}
        </span>
        <button
          className="flex cursor-pointer items-center gap-2 border border-white/10 px-3 py-2 text-[8px] tracking-[0.14em] text-[#a3a5ad] uppercase hover:border-[#c8963c]/40 hover:text-[#c8963c]"
          onClick={() => dispatch_app({ type: 'simulator/board_rerolled' })}
          type="button"
        >
          <Dices size={12} /> {text.reroll}
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-white/8 bg-[#0d0d14]/92">
          <header className="flex items-center gap-2 border-b border-white/8 px-3 py-3">
            <h2 className="min-w-0 flex-1 text-[9px] tracking-[0.2em] text-[#67adff] uppercase">{text.characters}</h2>
            <button
              className="flex cursor-pointer items-center gap-1 border border-[#4a9eff]/25 px-2 py-1.5 text-[8px] tracking-[0.12em] text-[#67adff] uppercase hover:border-[#4a9eff]/50"
              onClick={() => set_editing('new')}
              type="button"
            >
              <Plus size={10} /> {text.create_character}
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {simulator.characters.length === 0 ? (
              <p className="m-2 border border-dashed border-white/10 px-3 py-5 text-center text-[8px] leading-4 tracking-[0.12em] text-[#6b7280] uppercase">
                {text.no_characters}
              </p>
            ) : (
              simulator.characters.map((character) => {
                const placement = Object.entries(simulator.character_placements).find(
                  ([, character_id]) => character_id === character.id
                )
                return (
                  <button
                    className="flex min-h-[60px] w-full cursor-pointer items-center gap-2.5 border-b border-white/6 px-3 py-2 text-left hover:bg-white/3"
                    key={character.id}
                    onClick={() => set_editing(character.id)}
                    type="button"
                  >
                    <CharacterRow
                      active={placement !== undefined}
                      character={character}
                      level_label={template(text.level, { level: character.level })}
                    />
                  </button>
                )
              })
            )}
          </div>
          <section className="shrink-0 border-t border-white/8 p-3">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="flex min-w-0 flex-1 items-center gap-2 text-[8px] tracking-[0.18em] text-[#8b8f99] uppercase">
                <Droplets aria-hidden="true" size={11} /> {text.blob_debug}
              </h3>
              <label className="flex cursor-pointer items-center gap-2 text-[7px] tracking-[0.11em] text-[#777b86] uppercase">
                {text.blob_click}
                <input
                  checked={blob_enabled}
                  className="size-3 cursor-pointer accent-[#4a9eff]"
                  onChange={(event) => set_blob_enabled(event.target.checked)}
                  type="checkbox"
                />
              </label>
            </div>
            <div className="grid grid-cols-[1fr_70px] gap-2">
              <label className="flex items-center justify-between border border-white/8 bg-black/20 px-2 py-1.5 text-[7px] tracking-[0.12em] text-[#777b86] uppercase">
                {text.blob_color}
                <input
                  className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0"
                  onChange={(event) => set_blob_color(event.target.value)}
                  type="color"
                  value={blob_color}
                />
              </label>
              <label className="flex items-center gap-1 border border-white/8 bg-black/20 px-2 py-1.5 text-[7px] tracking-[0.12em] text-[#777b86] uppercase">
                {text.blob_range}
                <input
                  className="min-w-0 flex-1 bg-transparent text-right text-[#d5d2cb] outline-none"
                  max={8}
                  min={1}
                  onChange={(event) => set_blob_range(Number(event.target.value))}
                  type="number"
                  value={blob_range}
                />
              </label>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['per_cell', 'single'] as const).map((shape) => (
                <button
                  className={`cursor-pointer border px-2 py-1.5 text-[7px] tracking-[0.11em] uppercase ${
                    blob_shape === shape
                      ? 'border-[#4a9eff]/45 bg-[#4a9eff]/10 text-[#67adff]'
                      : 'border-white/8 text-[#777b86] hover:border-white/18'
                  }`}
                  key={shape}
                  onClick={() => set_blob_shape(shape)}
                  type="button"
                >
                  {shape === 'per_cell' ? text.blob_per_cell : text.blob_single}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className="relative min-h-0 overflow-hidden bg-[#08090e]">
          <SimulatorBoardPane
            scene={scene}
            blob_debug={
              blob_enabled
                ? Object.freeze({
                    color: Number.parseInt(blob_color.slice(1), 16),
                    range: blob_range,
                    shape: blob_shape,
                  })
                : null
            }
            copy={copy}
          />
          <div className="pointer-events-none absolute right-3 bottom-3 left-3 flex items-end justify-between gap-3">
            <p className="border border-white/8 bg-black/55 px-3 py-2 text-[8px] tracking-[0.12em] text-[#8b8f99] uppercase backdrop-blur">
              {text.board_hint}
            </p>
            <button
              className="pointer-events-auto flex h-11 cursor-pointer items-center gap-2 border border-[#c8963c]/40 bg-[linear-gradient(135deg,rgba(200,150,60,0.22),rgba(103,173,255,0.10))] px-5 text-[9px] tracking-[0.18em] text-[#f0c474] uppercase shadow-[0_0_30px_rgba(200,150,60,0.08)] disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!can_start_simulator_fight(simulator)}
              onClick={() => {
                dispatch_app({
                  type: 'fight/opened',
                  mode: 'local',
                  setup: simulator_fight_setup(simulator),
                  seed: simulator.seed,
                })
                dispatch_app({ type: 'fight/input', input: { type: 'start' }, origin: 'local' })
              }}
              type="button"
            >
              <Play size={12} /> {text.start_fight}
            </button>
          </div>
        </div>
      </div>

      {editing && (
        <CharacterModal
          character={editing === 'new' ? null : (simulator.characters.find(({ id }) => id === editing) ?? null)}
          close={() => set_editing(null)}
          copy={copy}
          created={set_editing}
        />
      )}
    </section>
  )
}

export default SimulatorPage
