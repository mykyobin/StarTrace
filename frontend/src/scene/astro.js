import * as THREE from 'three'

export const DEG = Math.PI / 180
export const SKY_R = 500
export const BASE_FOV = 60
export const SEOUL = { lat: 37.57, lon: 126.98 }

// 적경·적위(도) -> 단위 벡터. y 가 천구 북극이고 적경은 x 에서 -z 쪽으로 늘어난다
export const toVec = (lonDeg, latDeg) => new THREE.Vector3(
  Math.cos(latDeg * DEG) * Math.cos(lonDeg * DEG),
  Math.sin(latDeg * DEG),
  -Math.cos(latDeg * DEG) * Math.sin(lonDeg * DEG),
)

// 그리니치 항성시(라디안)
export function gmstRad(ms) {
  const jd = ms / 864e5 + 2440587.5
  const g = (280.46061837 + 360.98564736629 * (jd - 2451545)) % 360
  return (g < 0 ? g + 360 : g) * DEG
}

// 지구 고정 좌표계에서 본 태양 방향. 균시차는 무시한다
export function sunDir(ms) {
  const d = new Date(ms)
  const doy = (ms - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5
  const decl = -23.44 * Math.cos((2 * Math.PI / 365) * (doy + 10))
  const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600
  return toVec(-15 * (utcH - 12), decl)
}

// B-V 색지수 -> RGB(0~255)
const BV = [[-0.33, [155, 176, 255]], [0, [202, 215, 255]], [0.3, [248, 247, 255]], [0.6, [255, 244, 234]],
  [1.0, [255, 210, 161]], [1.5, [255, 186, 120]], [2.0, [255, 156, 90]]]
export function bvColor(bv) {
  if (bv == null) return [255, 244, 234]
  if (bv <= BV[0][0]) return BV[0][1]
  for (let i = 1; i < BV.length; i++) {
    if (bv <= BV[i][0]) {
      const [a, ca] = BV[i - 1]
      const [b, cb] = BV[i]
      const t = (bv - a) / (b - a)
      return ca.map((v, j) => Math.round(v + (cb[j] - v) * t))
    }
  }
  return BV[BV.length - 1][1]
}

export const wrapPi = (a) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
