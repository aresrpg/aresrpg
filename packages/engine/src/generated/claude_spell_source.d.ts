// Type boundary for the mechanically extracted, unmodified author program.
export type ClaudeSpell = Readonly<{
  cls: string
  name: string
  el: string
  path: string
  ap: number
  fx?: number
  tok: string
  stat: number
  shape: number
  size: number
  push: number
  heavy: number
  frost: number
  trap: number
  ghost: string
  cx: number
  tx: number
  st: number
  icon: number
  stay: number
  refund: number
  on: string
  proj: number
  swap: number
  seed: number
  cast: number
  fly: number
  dx?: number
  does?: string
}>
export type ClaudeSoundEvent = Readonly<{
  step: number
  t: number
  name: string
  o: Readonly<{
    gain?: number
    pan?: number | readonly [number, number]
    rate?: number
    dur?: number
    lp?: number
    hp?: number
    from?: number
  }>
}>
export type ClaudeUniforms = Readonly<Record<string, number | readonly number[]>>
export type ClaudeSpellRuntime = Readonly<{
  catalog: Readonly<Record<string, readonly ClaudeSpell[]>>
  palettes: Readonly<
    Record<
      string,
      Readonly<{ id: number; dot: string; c1: readonly number[]; c2: readonly number[]; c3: readonly number[] }>
    >
  >
  tokens: Readonly<Record<string, readonly (readonly number[])[]>>
  lead: Readonly<Record<string, number>>
  hold: number
  impact_speed: number
  trap_wait: number
  select: (classe: string, name: string, overrides?: Readonly<Partial<ClaudeSpell>>) => ClaudeSpell
  frame: (time: number, width: number, height: number, pixel_ratio?: number, reduced_motion?: boolean) => ClaudeUniforms
  sound_plan: () => readonly ClaudeSoundEvent[]
}>
export const SOURCE_SHA256: string
export const create_source: () => ClaudeSpellRuntime
