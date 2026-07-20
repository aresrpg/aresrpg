// ChipRow — the QTY_STEPS-pattern chip strip (bordered row of tiny toggle chips), generalized. ONE home:
// marketplace character filters, kolizeum format/access filters, and any future chip strip. Clicking the
// active chip clears it (null = "all") unless `required` pins one always-on.

export function ChipRow<T extends string>({
  options,
  active,
  on_pick,
  required = false,
}: {
  options: readonly T[]
  active: T | null
  on_pick: (value: T | null) => void
  required?: boolean
}) {
  return (
    <div className="flex items-center border border-border" style={{ width: 'fit-content' }}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => on_pick(active === o && !required ? null : o)}
          className="px-2 py-0.5 text-[9px] tracking-[0.1em] uppercase cursor-pointer transition-colors whitespace-nowrap"
          style={
            active === o
              ? { color: '#c8963c', background: 'rgba(200,150,60,0.1)' }
              : { color: '#6b7280', background: 'transparent' }
          }
        >
          {o}
        </button>
      ))}
    </div>
  )
}
