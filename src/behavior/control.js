import run, { SUCCESS, RUNNING, FAILURE, childs } from '../behavior.js'

/**
 * Create a control node
 * @param {*} expected_status   a function that return the expected status
 *                              to continue running the next child
 * @returns {*} nodes
 *          reactive: a node that restart when the status is
 *                    different than expected_status
 *          normal:   a node that keep executing the same node
 *                    if it returns RUNNING
 */
function create_control(expected_status) {
  async function run_child(child, { result, index }, context) {
    const { status, state } = result

    if (status === expected_status()) {
      const child_result = await run(child, state, context)

      return { result: child_result, index: context.index }
    } else return { result, index }
  }

  function child_reducer(context, offset = 0) {
    return async (intermediate, child, index) =>
      await run_child(child, await intermediate, {
        ...context,
        path: `${context.path}.${offset + index}`,
        index,
      })
  }

  return {
    async reactive(node, state, context) {
      const { result } = await childs(node).reduce(child_reducer(context), {
        result: {
          status: expected_status(),
          state,
        },
      })

      return result
    },
    async normal(node, state, context) {
      const last = state[context.path] ?? 0

      const { index, result } = await childs(node)
        .slice(last)
        .reduce(child_reducer(context, last), {
          result: {
            status: expected_status(),
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
    },
  }
}

export const { normal: sequence, reactive: reactive_sequence } = create_control(
  () => SUCCESS
)

export const { normal: fallback, reactive: reactive_fallback } = create_control(
  () => FAILURE
)
