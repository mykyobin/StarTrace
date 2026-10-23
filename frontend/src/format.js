export const fmtMag = (m) => (m < 0 ? '−' : '') + Math.abs(m).toFixed(2)

export function fmtRA(hours) {
  const t = Math.round(hours * 3600)
  const pad = (v) => String(v).padStart(2, '0')
  return `${pad(Math.floor(t / 3600))}h ${pad(Math.floor((t % 3600) / 60))}m ${pad(t % 60)}s`
}

export function fmtDec(deg) {
  const t = Math.round(Math.abs(deg) * 3600)
  const pad = (v) => String(v).padStart(2, '0')
  return `${deg < 0 ? '−' : '+'}${Math.floor(t / 3600)}° ${pad(Math.floor((t % 3600) / 60))}′ ${pad(t % 60)}″`
}
