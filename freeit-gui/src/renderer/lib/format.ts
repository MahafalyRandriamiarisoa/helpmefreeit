const UNITS = ['B', 'K', 'M', 'G', 'T', 'P']

export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  let value = bytes
  for (const unit of UNITS) {
    if (Math.abs(value) < 1024) {
      return unit === 'B' ? `${Math.round(value)} B` : `${value.toFixed(1)} ${unit}`
    }
    value /= 1024
  }
  return `${value.toFixed(1)} E`
}

export function sizeColor(bytes: number): string {
  if (bytes >= 10 * 1024 ** 3) return 'var(--color-size-huge)'
  if (bytes >= 1 * 1024 ** 3) return 'var(--color-size-large)'
  if (bytes >= 500 * 1024 ** 2) return 'var(--color-size-medium)'
  if (bytes >= 100 * 1024 ** 2) return 'var(--color-size-normal)'
  if (bytes >= 10 * 1024 ** 2) return 'var(--color-size-small)'
  return 'var(--color-size-tiny)'
}

export function barColor(ratio: number): string {
  if (ratio >= 0.8) return 'var(--color-bar-critical)'
  if (ratio >= 0.5) return 'var(--color-bar-warning)'
  if (ratio >= 0.2) return 'var(--color-bar-info)'
  return 'var(--color-bar-ok)'
}

export function parseSize(value: string): number {
  const match = value.trim().toUpperCase().match(/^(\d+(?:\.\d+)?)\s*([BKMGTP]?)I?$/)
  if (!match) return 0
  const num = parseFloat(match[1])
  const unit = match[2] || 'B'
  const multipliers: Record<string, number> = {
    B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5
  }
  return Math.floor(num * (multipliers[unit] ?? 1))
}
