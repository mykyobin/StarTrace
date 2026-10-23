// 행성 위성의 지금 위치. 세 가지 출처를 정밀한 순서로 쓴다.
//  1. 목성 갈릴레이 위성 4개: astronomy-engine JupiterMoons
//  2. 크기가 알려진 주요 위성: 서버가 JPL Horizons 에서 받아 둔 하루치 위치(20분 간격)를 시각으로 보간
//  3. 나머지 작은 위성(400여 개)과 Horizons 를 못 받았을 때: JPL 평균 궤도 요소로 케플러 궤도를 푼 근사 위치
import * as Astronomy from 'astronomy-engine'
import * as THREE from 'three'

const D = Math.PI / 180
// 행성 적도 반지름(km). 위치를 이 단위로 돌려준다
export const PLANET_R = { mars: 3396.19, jupiter: 71492, saturn: 60268, uranus: 25559, neptune: 24764, pluto: 1188.3 }
const ASTRO = { mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune', pluto: 'Pluto' }
const GALILEAN = { Io: 'io', Europa: 'europa', Ganymede: 'ganymede', Callisto: 'callisto' }
const OBLIQ = 23.4392911 * D

// ICRF 벡터(천문 좌표 x,y,z)를 장면 좌표로. bodyRender 의 eqj 와 같다
const toScene = (x, y, z) => new THREE.Vector3(x, z, -y)
const pole = (ra, dec) => [Math.cos(dec * D) * Math.cos(ra * D), Math.cos(dec * D) * Math.sin(ra * D), Math.sin(dec * D)]

const cache = {}
export const hasMoons = (planet) => planet in PLANET_R
export function loadMoons(planet) {
  cache[planet] ??= fetch(`/api/moons/${planet}`).then((r) => (r.ok ? r.json() : { moons: [] })).catch(() => ({ moons: [] }))
    .then((d) => d.moons.map(prepare))
  return cache[planet]
}
// 처음엔 서버가 Horizons 에 위성마다 묻느라 수십 초 걸릴 수 있다. 못 받으면 null
export const loadEphemeris = (planet) => fetch(`/api/moons/${planet}/ephemeris`).then((r) => (r.ok ? r.json() : null)).catch(() => null)

function fromEphemeris(eph, code, date) {
  const rows = eph?.vectors[code]
  if (!rows) return null
  const f = (date.getTime() / 1000 - eph.start) / eph.step
  const k = Math.floor(f)
  if (k < 0 || k + 1 >= rows.length) return null
  const t = f - k, a = rows[k], b = rows[k + 1]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

// 기준면(극 p)을 ICRF 로 옮기는 축. x 는 기준면이 ICRF 적도와 만나는 오름교점 방향(z × p)
function basisFor(p) {
  const z = new THREE.Vector3(...p).normalize()
  const x = new THREE.Vector3(0, 0, 1).cross(z).normalize()
  const y = new THREE.Vector3().crossVectors(z, x)
  return [x, y, z]
}

function prepare(m) {
  let p
  if (m.frame === 'ecliptic') p = [0, -Math.sin(OBLIQ), Math.cos(OBLIQ)]
  else if (m.frame === 'laplace') p = pole(m.ra, m.dec)
  else { const n = Astronomy.RotationAxis(ASTRO[m.planet], new Date(Date.UTC(2000, 0, 1, 12))).north; p = [n.x, n.y, n.z] }
  return { ...m, basis: basisFor(p), label: m.ko || m.name, irregular: m.frame === 'ecliptic' }
}

function kepler(M, e) {
  let E = e < 0.8 ? M : Math.PI
  for (let k = 0; k < 12; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
  return E
}

// 평균 궤도 요소 -> 행성 중심 ICRF 위치(km). 교점은 Pnode 주기로 뒤로, 근점은 Papsis 주기로 앞으로 돈다.
// P 는 평균 근점이각의 주기다(갈릴레이 위성으로 맞춰 봄: 가니메데·칼리스토 0.2° 이내).
// shortcut: 공명으로 근점이 거꾸로 도는 위성(이오·유로파 등)은 부호를 몰라 틀린다. 이오·유로파는 정밀 계산으로 대신한다
export function elementsPosition(m, date) {
  const days = date.getTime() / 86400000 + 2440587.5 - m.epoch
  const yrs = days / 365.25
  const dNode = m.Pnode ? -360 * yrs / m.Pnode : 0
  const dW = m.Papsis ? 360 * yrs / m.Papsis : 0
  const node = (m.node + dNode) * D, w = (m.w + dW) * D, inc = m.i * D
  const M = ((m.M + 360 * days / m.P) % 360) * D
  const E = kepler(M, m.e)
  const xp = m.a * (Math.cos(E) - m.e), yp = m.a * Math.sqrt(1 - m.e * m.e) * Math.sin(E)
  // 근점 -> 기준면: Rz(node) Rx(i) Rz(w)
  const cw = Math.cos(w), sw = Math.sin(w), cn = Math.cos(node), sn = Math.sin(node), ci = Math.cos(inc), si = Math.sin(inc)
  const x1 = xp * cw - yp * sw, y1 = xp * sw + yp * cw
  const x2 = x1, y2 = y1 * ci, z2 = y1 * si
  const X = x2 * cn - y2 * sn, Y = x2 * sn + y2 * cn, Z = z2
  const [bx, by, bz] = m.basis
  return [bx.x * X + by.x * Y + bz.x * Z, bx.y * X + by.y * Y + bz.y * Z, bx.z * X + by.z * Y + bz.z * Z]
}

// 한 행성의 위성 전부: { id(상세 화면 주소), code, name, label, km(반지름), r(행성 반지름 단위, 모르면 null), irregular, exact(정밀 위치인지), v(장면 좌표, 행성 반지름 단위) }
export function moonPositions(list, planet, date, eph) {
  const R = PLANET_R[planet]
  const gal = planet === 'jupiter' ? Astronomy.JupiterMoons(date) : null
  return list.map((m) => {
    let p = null, exact = true
    if (gal && GALILEAN[m.name]) { const s = gal[GALILEAN[m.name]]; p = [s.x * Astronomy.KM_PER_AU, s.y * Astronomy.KM_PER_AU, s.z * Astronomy.KM_PER_AU] }
    else p = fromEphemeris(eph, m.code, date)
    if (!p) { p = elementsPosition(m, date); exact = false }
    return { id: `sat-${m.code}`, code: m.code, name: m.name, label: m.label, km: m.r, r: m.r ? m.r / R : null, irregular: m.irregular, exact, v: toScene(...p).multiplyScalar(1 / R) }
  })
}
