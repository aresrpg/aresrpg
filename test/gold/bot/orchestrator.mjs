// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const actor_step_key = (actor_id, step_id) => `${actor_id}:${step_id}`
const lane_step_key = (actor_id, step_index) => `${actor_id}#${step_index}`

function actor_registry(actors, minimum_actors) {
  if (!Number.isInteger(minimum_actors) || minimum_actors < 1)
    throw new Error(`minimum_actors must be a positive integer; got ${minimum_actors}`)
  if (!Array.isArray(actors) || actors.length < minimum_actors)
    throw new Error(`actor orchestrator needs at least ${minimum_actors} actors`)

  const registry = {}
  const addresses = new Set()
  for (const actor of actors) {
    if (!actor?.id || typeof actor.id !== 'string') throw new Error('every actor needs a string id')
    if (registry[actor.id]) throw new Error(`duplicate actor '${actor.id}'`)
    const address = actor.wallet?.address
    if (!address) throw new Error(`actor '${actor.id}' needs a wallet address`)
    if (!actor.backend) throw new Error(`actor '${actor.id}' needs a backend context`)
    if (!actor.selected_character?.character_id) throw new Error(`actor '${actor.id}' needs a selected_character`)
    if (addresses.has(address)) throw new Error(`wallet ${address} is assigned to more than one actor`)
    addresses.add(address)
    registry[actor.id] = actor
  }
  return registry
}

function validate_lanes(registry, lanes) {
  if (!lanes || typeof lanes !== 'object' || Array.isArray(lanes)) throw new Error('lanes must be an actor-step map')
  for (const actor_id of Object.keys(lanes))
    if (!registry[actor_id]) throw new Error(`lane references unknown actor '${actor_id}'`)

  const step_nodes = new Map()
  const graph = new Map()
  for (const actor_id of Object.keys(registry)) {
    const steps = lanes[actor_id] ?? []
    if (!Array.isArray(steps)) throw new Error(`lane '${actor_id}' must be an array`)
    const ids = new Set()
    for (let step_index = 0; step_index < steps.length; step_index += 1) {
      const step = steps[step_index]
      if (!step || typeof step !== 'object') throw new Error(`lane '${actor_id}' step ${step_index} must be an object`)
      const node = lane_step_key(actor_id, step_index)
      graph.set(node, new Set())
      if (step_index > 0) graph.get(lane_step_key(actor_id, step_index - 1)).add(node)
      if (step.id) {
        if (typeof step.id !== 'string') throw new Error(`lane '${actor_id}' step id must be a string`)
        if (ids.has(step.id)) throw new Error(`duplicate step '${actor_step_key(actor_id, step.id)}'`)
        if (step.barrier) throw new Error(`barrier '${actor_step_key(actor_id, step.id)}' cannot be a commit step`)
        ids.add(step.id)
        step_nodes.set(actor_step_key(actor_id, step.id), node)
      }
    }
  }

  for (const [actor_id, steps] of Object.entries(lanes)) {
    for (let step_index = 0; step_index < steps.length; step_index += 1) {
      const { barrier } = steps[step_index]
      if (!barrier) continue
      if (!barrier.actor || !barrier.step) throw new Error(`lane '${actor_id}' has an invalid barrier`)
      const target = actor_step_key(barrier.actor, barrier.step)
      const target_node = step_nodes.get(target)
      if (!target_node) throw new Error(`barrier references unknown commit '${target}'`)
      graph.get(target_node).add(lane_step_key(actor_id, step_index))
    }
  }

  assert_acyclic(graph)
  return step_nodes
}

function assert_acyclic(graph) {
  const indegree = new Map([...graph.keys()].map((node) => [node, 0]))
  for (const targets of graph.values())
    for (const target of targets) indegree.set(target, (indegree.get(target) ?? 0) + 1)
  const ready = [...indegree].filter(([, count]) => count === 0).map(([node]) => node)
  let visited = 0
  while (ready.length) {
    const node = ready.pop()
    visited += 1
    for (const target of graph.get(node) ?? []) {
      const next = indegree.get(target) - 1
      indegree.set(target, next)
      if (next === 0) ready.push(target)
    }
  }
  if (visited !== graph.size) throw new Error('actor barrier dependency cycle')
}

/**
 * Execute one sequential lane per actor, concurrently, through digest-anchored cross-actor barriers.
 * A labelled step is committed only after its executor returns a successful transaction digest.
 */
export async function run_actor_orchestrator({ actors, lanes, execute_step, minimum_actors = 4 }) {
  if (typeof execute_step !== 'function') throw new Error('execute_step must be a function')
  const registry = actor_registry(actors, minimum_actors)
  const step_nodes = validate_lanes(registry, lanes)
  const commits = {}
  const trace = []
  const barriers = new Map([...step_nodes.keys()].map((key) => [key, deferred()]))
  const stopped = deferred()
  let stop_error = null

  const stop = (error) => {
    if (stop_error) return
    stop_error = error instanceof Error ? error : new Error(String(error))
    stopped.resolve(stop_error)
  }

  async function wait_for_barrier(actor_id, barrier) {
    const key = actor_step_key(barrier.actor, barrier.step)
    const outcome = await Promise.race([
      barriers.get(key).promise.then((commit) => ({ commit })),
      stopped.promise.then((error) => ({ error })),
    ])
    if (outcome.error) throw outcome.error
    trace.push({ actor: actor_id, barrier: key, digest: outcome.commit.digest })
  }

  async function run_lane(actor) {
    try {
      const steps = lanes[actor.id] ?? []
      for (let step_index = 0; step_index < steps.length; step_index += 1) {
        if (stop_error) throw stop_error
        const step = steps[step_index]
        if (step.barrier) {
          await wait_for_barrier(actor.id, step.barrier)
          continue
        }
        const result = await execute_step({ actor, step, step_index, registry })
        trace.push({ actor: actor.id, step: step.id ?? step.do ?? step_index, ...result })
        if (!result?.ok) throw new Error(`actor '${actor.id}' step '${step.id ?? step.do ?? step_index}' failed`)
        if (!step.id) continue
        if (!result.digest) throw new Error(`actor '${actor.id}' committed step '${step.id}' without a digest`)
        const key = actor_step_key(actor.id, step.id)
        const commit = { actor: actor.id, step: step.id, ...result }
        commits[key] = commit
        barriers.get(key).resolve(commit)
      }
    } catch (error) {
      stop(error)
      throw error
    }
  }

  await Promise.all(Object.values(registry).map((actor) => run_lane(actor)))
  return { registry, commits, trace }
}
