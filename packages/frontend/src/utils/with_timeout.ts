// with_timeout — bound a chain read so a hung RPC can NEVER freeze a loading state.
//
// Never hang forever (mirrors load_roster.js's private guard: "a read MUST always terminate — a partial result + a
// loud skip beats an infinite hang; the bug that trapped a 7-kiosk wallet on the create screen forever").
// The marketplace + runeforge (scribe) loaders were the two chain-direct reads that still lacked it — a slow
// or stalled personal-kiosk sweep left their spinner up forever. This rejects with a labelled error after
// `ms`, and clears the timer once the promise settles so a fast read never fires a spurious late rejection.
// Consumers keep their existing catch → honest error/empty state (LOUD law: never a silent infinite spinner).
export function with_timeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms)
    }),
  ])
}
