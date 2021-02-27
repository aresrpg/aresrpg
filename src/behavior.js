import { Node } from 'xmldom/lib/dom.js'

import logger from './logger.js'
import { sequence, reactive_sequence } from './behavior/sequence.js'
import goto from './behavior/goto.js'
import get_biggest_damager from './behavior/damager.js'

const DEBUG = false // TODO: add a way to filter pino logs

const log = logger(import.meta)

const nodes = {
  sequence,
  'reactive-sequence': reactive_sequence,
  goto,
  get_biggest_damager,
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
  return result
}

export function childs(node) {
  return Array.from(node.childNodes).filter(
    (child) => child.nodeType === Node.ELEMENT_NODE
  )
}
