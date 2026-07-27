import { readFileSync } from 'node:fs'
import { create_fight_store } from './packages/fight/src/store.js'
import { parse_trace } from './packages/fight/src/trace_recorder.js'
const trace = parse_trace(readFileSync('trace.json', 'utf8'))
const store = create_fight_store()
for (const [idx, { msg, at }] of trace.inputs.entries()) {
  const before = store.getState().armed_spell_id
  store.getState().input(msg, at)
  const after = store.getState().armed_spell_id
  if (before !== after && idx >= 140) console.log(`idx ${idx} ${msg.type}${msg.cell != null ? ' cell ' + msg.cell + ' targetable ' + msg.targetable : ''}  armed: ${before} -> ${after}`)
}
