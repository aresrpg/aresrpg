import run, { SUCCESS, childs } from '../behavior.js'

export default async function repeat(node, state, context) {
  const [child] = childs(node)
  const child_result = await run(child, state, {
    ...context,
    path: `${context.path}.0`,
  })

  if (child_result.status === SUCCESS)
    return repeat(node, child_result.state, context)
  else return child_result
}
