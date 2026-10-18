export type SpellSynthesis = Readonly<{
  sample_rate: number
  samples: Readonly<Record<string, Float32Array<ArrayBuffer>>>
}>
export const synthesize_spell_audio: () => SpellSynthesis
