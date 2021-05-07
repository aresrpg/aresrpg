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
import random from './behavior/random.js'
import sleep from './behavior/sleep.js'

import { debug } from './index.js'

const DEBUG = false // TODO: add a way to filter pino logs

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
  random,
  sleep,
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
  if (DEBUG) log.debug({ path, status: result.status.toString() }, 'Runned')
  debug.behavior({ context: node_context, result })
  return result
}

export function childs(node) {
  return Array.from(node.childNodes).filter(
    (child) => child.nodeType === Node.ELEMENT_NODE
  )
}
