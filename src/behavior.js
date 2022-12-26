import { Node } from 'xmldom/lib/dom.js'

import logger from './logger.js'
import {
  sequence,
  reactive_sequence,
  fallback,
  reactive_fallback,
} from './behavior/control.js'
import goto from './behavior/goto.js'
import get_biggest_damager from './behavior/damager.js'
import set_target from './behavior/set_target.js'
import target_position from './behavior/target_position.js'
import random_block_position from './behavior/random_position.js'
import random_look_around from './behavior/random_look_around.js'
import look_at_player from './behavior/look_at_player.js'
import random from './behavior/random.js'
import sleep from './behavior/sleep.js'
import repeat from './behavior/repeat.js'
import attack_target from './behavior/attack_target.js'
import debug from './debug.js'

const log = logger(import.meta)

const nodes = {
  sequence,
  'reactive-sequence': reactive_sequence,
  fallback,
  'reactive-fallback': reactive_fallback,
  goto,
  get_biggest_damager,
  set_target,
  target_position,
  random_block_position,
  random_look_around,
  look_at_player,
  random,
  sleep,
  repeat,
  attack_target,
}

export const SUCCESS = Symbol('SUCCESS')
export const RUNNING = Symbol('RUNNING')
export const FAILURE = Symbol('FAILURE')

export default async function run(node, state, context) {
  const path = `${context.path}.${node.tagName}`
  const node_context = {
    ...context,
    path,
  }
  const result = await nodes[node.tagName](node, state, node_context)
  log.debug({ path, status: result.status.toString() }, 'Ran')
  debug.behavior?.({ context: node_context, result })
  return result
}

export function childs(node) {
  return Array.from(node.childNodes).filter(
    child => child.nodeType === Node.ELEMENT_NODE
  )
}
