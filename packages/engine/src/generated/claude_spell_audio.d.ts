import type { ClaudeSoundEvent, ClaudeSpell } from './claude_spell_source.js'
export const create_audio_source: (
  recordings: Readonly<Record<string, string>>,
  onset: Readonly<Record<string, number>>,
  lead: Readonly<Record<string, number>>,
  plan: (spell: ClaudeSpell) => readonly ClaudeSoundEvent[]
) => Readonly<{
  A: {
    on: boolean
    ready: boolean
    ctx?: AudioContext
    master?: GainNode
    bus?: GainNode
    s: Record<string, AudioBuffer>
  }
  boot_audio: () => Promise<void>
  play_spell: (spell: ClaudeSpell, stretch: number) => void
  fresh_bus: () => void
}>
