// --- Small Shared Components ---

export function SectionDivider() {
  return <div className="w-full h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
}

export function SectionTitle({ title }: { title: string }) {
  return (
    <span className="text-[9px] tracking-[0.25em] uppercase font-semibold" style={{ color: '#6b7280' }}>
      {title}
    </span>
  )
}
