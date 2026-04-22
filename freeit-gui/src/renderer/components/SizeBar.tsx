import { barColor } from '../lib/format'

interface SizeBarProps {
  ratio: number
  width?: number
}

export function SizeBar({ ratio, width = 160 }: SizeBarProps) {
  const clampedRatio = Math.max(0, Math.min(1, ratio))
  const color = barColor(clampedRatio)

  return (
    <div
      className="relative rounded-sm overflow-hidden"
      style={{
        width,
        height: 6,
        background: 'var(--bg-hover)'
      }}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-sm transition-all duration-300"
        style={{
          width: `${clampedRatio * 100}%`,
          background: color,
          opacity: 0.85
        }}
      />
    </div>
  )
}
