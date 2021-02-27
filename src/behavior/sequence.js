import run, { SUCCESS, childs, RUNNING } from '../behavior.js'

async function run_child(child, { result, index }, context) {
  const { status, state } = result

  if (status === SUCCESS) {
    const child_result = await run(child, state, context)

    return { result: child_result, index: context.index }
  } else return { result, index }
}

function child_reducer(context) {
  return async (intermediate, child, index) =>
    await run_child(child, await intermediate, {
      ...context,
      path: `${context.path}.${index}`,
      index,
    })
}

export async function sequence(node, state, context) {
  const last = state[context.path] ?? 0

  const { index, result } = await childs(node)
    .slice(last)
    .reduce(child_reducer(context), {
      result: {
        status: SUCCESS,
        state,
      },
    })

  /* Restart on SUCCESS and FAILURE */
  const next = result.status !== RUNNING ? 0 : last + index

  return {
    ...result,
    state: {
      ...result.state,
      [context.path]: next,
    },
  }
}

export async function reactive_sequence(node, state, context) {
  const { result } = await childs(node).reduce(child_reducer(context), {
    result: {
      status: SUCCESS,
      state,
    },
  })

  return result
}
