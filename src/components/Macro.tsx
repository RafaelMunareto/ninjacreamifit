export default function Macro({
  value,
  label,
  tone,
}: {
  value: string
  label: string
  tone: string
}) {
  return (
    <div className={`${tone} rounded-2xl px-1 py-2 text-center`}>
      <strong className="block text-sm">{value}</strong>
      <span className="block truncate text-[9px] font-bold uppercase tracking-wide">
        {label}
      </span>
    </div>
  )
}
