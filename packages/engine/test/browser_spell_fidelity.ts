import { FRAGMENT } from '../src/generated/claude_spell_fragment.js'
import { create_source } from '../src/generated/claude_spell_source.js'
import { create_spell_gl } from '../src/claude_spell_gl.ts'
import { claude_spell_game_shader } from '../src/claude_spell_shader.ts'

export const create_spell_fidelity_probe = async (urls: readonly string[]) => {
  const original = create_spell_gl(FRAGMENT),
    adapted = create_spell_gl(claude_spell_game_shader()),
    control = create_spell_gl(
      claude_spell_game_shader().replace('uniform bool aresGame;', 'const bool aresGame = false;')
    )
  await Promise.all([original.prepare(urls), adapted.prepare(urls), control.prepare(urls)])
  const width = 320,
    height = 224
  for (const renderer of [original, adapted, control]) renderer.resize(width, height)
  const pixels = (
    renderer: ReturnType<typeof create_spell_gl>,
    uniforms: ReturnType<ReturnType<typeof create_source>['frame']>
  ) => {
    const { gl } = renderer,
      mask = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, mask)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    renderer.render(null, mask, [
      { uniforms: { ...uniforms, aresGame: 0 }, cells: new Uint8Array(4), width: 1, height: 1 },
    ])
    const bytes = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
    gl.deleteTexture(mask)
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Shader fidelity GL error')
    return bytes
  }
  return (classe: string, name: string, seconds: number) => {
    const source = create_source()
    source.select(classe, name)
    const frame = source.frame(seconds, width, height)
    const left = pixels(original, frame),
      right = pixels(adapted, frame)
    const reference = pixels(control, frame)
    let maximum = 0,
      changed = 0,
      significant = 0,
      control_changed = 0
    for (let index = 0; index < left.length; index += 1) {
      const difference = Math.abs(left[index]! - right[index]!)
      maximum = Math.max(maximum, difference)
      changed += Number(difference > 0)
      significant += Number(difference > 1)
      control_changed += Number(reference[index] !== left[index])
    }
    return { maximum, changed, significant, control_changed }
  }
}
