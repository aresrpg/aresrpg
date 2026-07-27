import { readFileSync } from 'node:fs'
import { create_fight_store } from './packages/fight/src/store.js'
import { parse_trace } from './packages/fight/src/trace_recorder.js'
import { engine_view, committed_truth, committed_mob_hp, is_my_turn, cast_presenting, presenting } from './packages/fight/src/project.js'

const trace = parse_trace(readFileSync('trace.json', 'utf8'))
const store = create_fight_store()
const MARKS = new Set([145, 231, 246, 259, 310])
for (const [idx, { msg, at }] of trace.inputs.entries()) {
  if (MARKS.has(idx)) {
    const s = store.getState()
    const v = engine_view(s)
    const ct = committed_truth(s)
    console.log('=== BEFORE input', idx, JSON.stringify(msg).slice(0, 120))
    console.log('   armed', s.armed_spell_id, 'my_turn', is_my_turn(s), 'busy', s.busy, 'presenting', presenting(s), 'cast_presenting', cast_presenting(s))
    console.log('   my_key', s.my_key, 'active', s.active)
    const me = v.fighters?.get?.(s.ctx?.my_entity_id) ?? null
    console.log('   view fighters keys', [...(v.fighters?.keys?.() ?? [])])
    console.log('   committed fighters', JSON.stringify(ct.fighters))
    console.log('   mob hp committed', [0,1,2].map(i => committed_mob_hp(s, i)))
  }
  store.getState().input(msg, at)
}
