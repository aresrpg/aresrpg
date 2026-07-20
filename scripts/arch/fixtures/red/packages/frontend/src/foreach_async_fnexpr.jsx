// RED fixture — the function-expression variant, in a .jsx file ON PURPOSE: proves the semgrep
// net covers the component files outside the eslint FP layer (fp_law.config.mjs F-1 debt).
// Expected: 1 arch-foreach-async-dropped-promises finding.
export const save_all = (items, save_item) => {
  items.forEach(async function (item) {
    await save_item(item)
  })
}
