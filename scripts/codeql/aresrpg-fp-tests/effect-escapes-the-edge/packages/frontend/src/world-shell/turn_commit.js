// A generic helper OUTSIDE fight/ — pulled into fold territory the moment the fold calls it.
// RED D — nondeterminism on a path the reducer folds over (interprocedural, cross-file).
export const decide = (s) => Date.now() > s.deadline

// GREEN — never called from the fold: out of reach, out of scope.
export const unrelated_effect = () => fetch('/elsewhere')
