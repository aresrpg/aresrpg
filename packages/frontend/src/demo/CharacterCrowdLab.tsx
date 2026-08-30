// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- React refs own benchmark cancellation tokens and one-shot query state. */
// Real production-path crowd benchmark: authored models, world entity door, rAF motion, measured frame intervals.

import type {
  CharacterAnimationName,
  CharacterAppearanceRender,
  CharacterEntityRender,
  EntityRender,
} from '@aresrpg/engine'
import { class_names } from '@aresrpg/immutable'
import { Activity, LoaderCircle, Play, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { load_character_appearance } from '../game/character_entities.ts'
import type { AppCopy } from '../i18n/copy.ts'

type BenchmarkPhase = 'idle' | 'run' | 'stop' | 'jump' | 'dance'
type CrowdActor = Readonly<{
  id: string
  appearance: CharacterAppearanceRender
  x: number
  y: number
  z: number
  offset: number
}>
type BenchmarkResult = Readonly<{
  phase: BenchmarkPhase
  fps: number
  p95_ms: number
  max_ms: number
  switch_ms: number
}>

const PHASES = Object.freeze([
  Object.freeze({ phase: 'idle' as const, duration_ms: 2_500, dynamic: false }),
  Object.freeze({ phase: 'run' as const, duration_ms: 4_000, dynamic: true }),
  Object.freeze({ phase: 'stop' as const, duration_ms: 2_500, dynamic: false }),
  Object.freeze({ phase: 'jump' as const, duration_ms: 3_000, dynamic: true }),
  Object.freeze({ phase: 'dance' as const, duration_ms: 3_000, dynamic: false }),
])
const PALETTES = Object.freeze([
  Object.freeze(['#f3eadb', '#2f8fe8', '#d9af57'] as const),
  Object.freeze(['#d9c1a7', '#d63838', '#2f3035'] as const),
  Object.freeze(['#f0d6bc', '#8f55d9', '#d7c363'] as const),
  Object.freeze(['#c89f7d', '#3ca66b', '#e8e3d5'] as const),
])
const ACTION_CLASS =
  'flex h-9 cursor-pointer items-center justify-center gap-1 border border-[#4a9eff]/30 bg-[#4a9eff]/7 px-1 text-[7px] tracking-[0.08em] text-[#67adff] uppercase hover:border-[#4a9eff]/60 disabled:cursor-not-allowed disabled:opacity-30'

const phase_animation = (phase: BenchmarkPhase): CharacterAnimationName =>
  phase === 'run' ? 'RUN' : phase === 'jump' ? 'JUMP' : phase === 'dance' ? 'DANCE' : 'IDLE'

const initial_crowd_amount = (): number => {
  const amount = Number(new URLSearchParams(globalThis.location.search).get('crowd'))
  return Number.isFinite(amount) && amount > 0 ? amount : 100
}

export const crowd_benchmark_entity = (
  actor: CrowdActor,
  phase: BenchmarkPhase,
  elapsed_ms: number
): CharacterEntityRender => {
  const wave = elapsed_ms / 1_000 + actor.offset
  const travel = phase === 'run' ? Math.sin(wave * 2.2) * 4 : 0
  const x = actor.x + Math.cos(actor.offset) * travel
  const z = actor.z + Math.sin(actor.offset) * travel
  const y = actor.y + (phase === 'jump' ? Math.abs(Math.sin(wave * 3.4)) * 1.8 : 0)
  return Object.freeze({
    id: actor.id,
    kind: 'character',
    presentation: 'crowd',
    appearance: actor.appearance,
    anchor: Object.freeze({ kind: 'world', position: Object.freeze([x, y, z] as const) }),
    facing: Object.freeze({ kind: 'yaw', yaw: phase === 'run' ? actor.offset + Math.PI / 2 : actor.offset }),
    animation: Object.freeze({ name: phase_animation(phase), time_scale: 1 }),
  })
}

export const crowd_benchmark_result = (
  phase: BenchmarkPhase,
  frame_deltas: readonly number[],
  switch_ms = 0
): BenchmarkResult => {
  if (frame_deltas.length === 0) return Object.freeze({ phase, fps: 0, p95_ms: 0, max_ms: 0, switch_ms })
  const ordered = frame_deltas.toSorted((left, right) => left - right)
  const average = frame_deltas.reduce((sum, delta) => sum + delta, 0) / frame_deltas.length
  return Object.freeze({
    phase,
    fps: Math.round(1_000 / average),
    p95_ms: Math.round((ordered[Math.floor((ordered.length - 1) * 0.95)] ?? 0) * 10) / 10,
    max_ms: Math.round((ordered.at(-1) ?? 0) * 10) / 10,
    switch_ms: Math.round(switch_ms * 10) / 10,
  })
}

const load_crowd = async (
  amount: number,
  ground_height: (x: number, z: number) => number
): Promise<readonly CrowdActor[]> => {
  const templates = await Promise.all(
    class_names.flatMap((classe) =>
      [true, false].map((male) =>
        load_character_appearance(
          Object.freeze({ id: `crowd_template_${classe}_${male}`, classe, male, colors: PALETTES[0]!, loadout: {} })
        )
      )
    )
  )
  const side = Math.ceil(Math.sqrt(amount))
  return Object.freeze(
    Array.from({ length: amount }, (_, index) => {
      const x = ((index % side) - (side - 1) / 2) * 2.3
      const z = (Math.floor(index / side) - (side - 1) / 2) * 2.3
      const template = templates[index % templates.length]!
      return Object.freeze({
        id: `demo_crowd_${index}`,
        appearance: Object.freeze({ ...template, colors: PALETTES[index % PALETTES.length]! }),
        x,
        y: ground_height(x, z),
        z,
        offset: (index / amount) * Math.PI * 2,
      })
    })
  )
}

const phase_entities = (
  actors: readonly CrowdActor[],
  phase: BenchmarkPhase,
  elapsed_ms: number
): readonly EntityRender[] => Object.freeze(actors.map((actor) => crowd_benchmark_entity(actor, phase, elapsed_ms)))

const measure_phase = (
  actors: readonly CrowdActor[],
  config: (typeof PHASES)[number],
  submit: (entities: readonly EntityRender[]) => void,
  current: () => boolean
): Promise<BenchmarkResult | null> =>
  new Promise((resolve) => {
    const started_at = performance.now()
    let previous = started_at
    let deltas: readonly number[] = Object.freeze([])
    submit(phase_entities(actors, config.phase, 0))
    const switch_ms = performance.now() - started_at
    const frame = (now: number): void => {
      if (!current()) return resolve(null)
      const elapsed = now - started_at
      deltas = Object.freeze([...deltas, now - previous])
      previous = now
      if (config.dynamic) submit(phase_entities(actors, config.phase, elapsed))
      if (elapsed >= config.duration_ms) return resolve(crowd_benchmark_result(config.phase, deltas, switch_ms))
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })

const CrowdBenchmarkStatus = ({
  count,
  loading,
  phase,
  results,
  text,
}: Readonly<{
  count: number
  loading: boolean
  phase: BenchmarkPhase | null
  results: readonly BenchmarkResult[]
  text: AppCopy['demo_page']
}>) => (
  <>
    {(loading || phase) && (
      <p className="text-[8px] tracking-[0.12em] text-[#67adff] uppercase">
        {loading ? text.crowd_loading : `${phase} · ${count}`}
      </p>
    )}
    {results.length > 0 && (
      <div
        className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 gap-y-1 text-[8px] tabular-nums"
        data-crowd-results=""
      >
        <span className="text-[#777b86]">{text.crowd_result}</span>
        <span className="text-[#777b86]">FPS</span>
        <span className="text-[#777b86]">P95</span>
        <span className="text-[#777b86]">MAX</span>
        <span className="text-[#777b86]">SWITCH</span>
        {results.map((result) => (
          <div className="contents" data-crowd-phase={result.phase} key={result.phase}>
            <span className="text-[#a3a5ad] uppercase">{result.phase}</span>
            <output className="text-right text-[#67adff]">{result.fps}</output>
            <output className="text-right text-[#c8963c]">{result.p95_ms}ms</output>
            <output className="text-right text-[#f87171]">{result.max_ms}ms</output>
            <output className="text-right text-[#d879ff]">{result.switch_ms}ms</output>
          </div>
        ))}
      </div>
    )}
  </>
)

export const CharacterCrowdLab = ({
  ground_height,
  set_active,
  submit,
  text,
}: Readonly<{
  ground_height: (x: number, z: number) => number
  set_active: (active: boolean) => void
  submit: (entities: readonly EntityRender[]) => void
  text: AppCopy['demo_page']
}>) => {
  const query_amount = initial_crowd_amount()
  const [amount, set_amount] = useState(query_amount)
  const [actors, set_actors] = useState<readonly CrowdActor[]>(Object.freeze([]))
  const [loading, set_loading] = useState(false)
  const [running, set_running] = useState(false)
  const [phase, set_phase] = useState<BenchmarkPhase | null>(null)
  const [results, set_results] = useState<readonly BenchmarkResult[]>(Object.freeze([]))
  const generation = useRef(0)

  const run = async (rows: readonly CrowdActor[]): Promise<void> => {
    const token = ++generation.current
    set_running(true)
    set_results(Object.freeze([]))
    let measured: readonly BenchmarkResult[] = Object.freeze([])
    for (const config of PHASES) {
      set_phase(config.phase)
      const result = await measure_phase(rows, config, submit, () => generation.current === token)
      if (!result) return
      measured = Object.freeze([...measured, result])
      set_results(measured)
    }
    submit(phase_entities(rows, 'idle', 0))
    set_phase(null)
    set_running(false)
  }

  const spawn = async (benchmark: boolean): Promise<void> => {
    const token = ++generation.current
    set_active(true)
    set_loading(true)
    set_running(false)
    set_results(Object.freeze([]))
    const rows = await load_crowd(Math.max(1, Math.min(200, Math.trunc(amount) || 100)), ground_height)
    if (generation.current !== token) return
    set_actors(rows)
    set_loading(false)
    submit(phase_entities(rows, 'idle', 0))
    if (benchmark) await run(rows)
  }

  const clear = (): void => {
    generation.current += 1
    set_actors(Object.freeze([]))
    set_loading(false)
    set_running(false)
    set_phase(null)
    set_results(Object.freeze([]))
    submit(Object.freeze([]))
    set_active(false)
  }

  useEffect(() => {
    if (query_amount <= 0) return
    void spawn(new URLSearchParams(globalThis.location.search).get('autobench') === '1')
    // Query automation is an initial-load test harness. StrictMode remounts restart canceled work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(
    () => () => {
      generation.current += 1
      submit(Object.freeze([]))
      set_active(false)
    },
    [set_active, submit]
  )

  return (
    <div className="grid gap-2 border-b border-white/8 py-3" data-crowd-benchmark-state={phase ?? 'ready'}>
      <h2 className="flex items-center gap-2 text-[8px] tracking-[0.18em] text-[#c8963c] uppercase">
        <Activity size={12} /> {text.crowd_load}
      </h2>
      <label className="grid gap-1 text-[7px] tracking-[0.14em] text-[#777b86] uppercase">
        {text.amount}
        <input
          className="h-9 border border-white/10 bg-bg px-2 text-[9px] text-[#d5d2cb] outline-none"
          disabled={loading || running}
          max={200}
          min={1}
          onChange={(event) => set_amount(Number(event.target.value))}
          type="number"
          value={amount}
        />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <button className={ACTION_CLASS} disabled={loading || running} onClick={() => void spawn(false)} type="button">
          {loading ? <LoaderCircle className="animate-spin" size={11} /> : <Play size={11} />} {text.spawn_group}
        </button>
        <button
          className={ACTION_CLASS}
          disabled={loading || running}
          onClick={() => void (actors.length > 0 ? run(actors) : spawn(true))}
          type="button"
        >
          <Activity size={11} /> {text.crowd_benchmark}
        </button>
        <button className={ACTION_CLASS} disabled={loading} onClick={clear} type="button">
          <RotateCcw size={11} /> {text.clear}
        </button>
      </div>
      <CrowdBenchmarkStatus count={actors.length} loading={loading} phase={phase} results={results} text={text} />
    </div>
  )
}
