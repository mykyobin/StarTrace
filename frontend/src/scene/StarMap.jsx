import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as Astronomy from 'astronomy-engine'
import * as THREE from 'three'
import { BASE_FOV, DEG, SEOUL, SKY_R, bvColor, clamp, gmstRad, sunDir, toVec, wrapPi } from './astro'
import { SPIN_LOOP_SEC, SUN_DISC, createBody, fetchSunImage } from './bodyRender'
import { PLANET_R, hasMoons, loadEphemeris, loadMoons, moonPositions } from './moons'
import { makeEarth } from './earth'

// 작은 창은 2배로 그려 선명하게, 큰 창은 그릴 픽셀 수를 이 안으로 묶는다.
// 예전처럼 늘 2~3배로 그리면 2560×1440 창에서 1,470만 픽셀이라 프레임이 50ms 넘게 걸렸다
// 240만도 이 PC에선 33ms라, 별 점이 가산 혼합으로 겹쳐 그려지는 비용을 감안해 130만으로 둔다
const PIXEL_BUDGET = 1_300_000
const pixelRatio = (w, h) => Math.max(0.75, Math.min(2, Math.sqrt(PIXEL_BUDGET / (w * h))))
const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const STAR_VERT = `
  attribute vec3 aColor; attribute float size; attribute float hl;
  uniform float uTime; uniform float uPR; uniform float uZoom; uniform float uPulse;
  varying vec3 vColor; varying float vHl;
  void main(){
    vColor = aColor; vHl = hl;
    float p = size * uZoom * (1.0 + hl * (0.8 + 0.4 * uPulse * sin(uTime * 3.0)));
    gl_PointSize = p * uPR;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`
const DRIFT_YAW = 0.9 * DEG           // 가만히 두면 하늘이 도는 속도(초당)
const DRIFT_PITCH = 6 * DEG           // 위아래로 천천히 흔들리는 폭
const DRIFT_PERIOD = 70               // 위아래 한 번 오가는 데 걸리는 초
const DRIFT_WAIT = 4000               // 마지막 조작 뒤 이만큼 지나야 움직이기 시작한다(ms)
const FOV_MIN = 0.15, FOV_MAX = 75 // 확대 한계(도). 0.15도면 목성이 화면 높이의 10분의 1쯤으로 보이는 망원경 배율
const TRUE_FOV = 2   // 이보다 확대하면 천체 표시가 실제 겉보기 크기 쪽으로 줄어든다(위성이 표시에 묻히지 않게)
const MOON_FOV = 4   // 이보다 확대하면 행성 둘레에 크기를 아는 주요 위성이 나온다
const C_KM_S = 299792.458
const ZOOM_CAP = 2.2             // 확대할수록 별 점이 커지되, 번져서 하늘을 덮지 않게 상한을 둔다

const STAR_FRAG = `
  varying vec3 vColor; varying float vHl;
  void main(){
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = smoothstep(0.30, 0.18, d);
    float a = core + exp(-d * d * 14.0) * 0.35;
    if (a < 0.01) discard;
    vec3 c = mix(vColor, vec3(1.0), core * 0.85);
    c = mix(c, vec3(0.85, 0.71, 0.42), vHl * 0.5 * (1.0 - core));
    gl_FragColor = vec4(c, a);
  }`

// 천구와 지구를 그리는 캔버스. 별 클릭은 onPick(id), 화면 전환은 ref 의 flyTo / release 로 한다.
const StarMap = forwardRef(function StarMap({ stars, bg, bodies, highlight, fast, drift, onPick, onTick }, ref) {
  const canvasRef = useRef(null)
  const labelsRef = useRef(null)
  const h = useRef({}) // 장면 안쪽 상태. React 렌더와 상관없이 프레임마다 바뀌는 값들
  const latest = useRef({})
  useEffect(() => { latest.current = { onPick, onTick, fast, drift } })

  useImperativeHandle(ref, () => ({
    flyTo: (id) => h.current.flyTo(id),
    release: () => h.current.release(),
    lookAt: (id) => h.current.lookAt?.(id),
  }))

  useEffect(() => {
    if (!stars.length) return undefined
    const canvas = canvasRef.current
    const labelsEl = labelsRef.current
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x04060c)
    const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 2000)
    camera.rotation.order = 'YXZ'
    scene.add(camera)
    const sky = new THREE.Group()
    scene.add(sky)

    // 별
    const n = stars.length
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n)
    const S = stars.map((s, i) => {
      const local = toVec(s.ra_hours * 15, s.dec_deg).multiplyScalar(SKY_R)
      pos.set([local.x, local.y, local.z], i * 3)
      const c = bvColor(s.bv)
      col.set(c.map((v) => v / 255), i * 3)
      size[i] = Math.max(5.5, Math.min(22, 12 - s.mag * 2.6))
      return { ...s, local }
    })
    const OBS = new Astronomy.Observer(SEOUL.lat, SEOUL.lon, 0)
    const B = bodies.map((b) => ({ ...b, mag: 0, astroName: b.id[0].toUpperCase() + b.id.slice(1), local: new THREE.Vector3(), magAt: 0 }))
    S.push(...B)
    const hlAll = new Float32Array(S.length) // 별 뒤에 천체 칸을 이어 붙인다
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('size', new THREE.BufferAttribute(size, 1))
    const hl = hlAll.subarray(0, n)
    geo.setAttribute('hl', new THREE.BufferAttribute(hl, 1))
    const starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPR: { value: 1 }, uZoom: { value: 1 }, uPulse: { value: REDUCE ? 0 : 1 } },
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    const points = new THREE.Points(geo, starMat)
    points.frustumCulled = false
    sky.add(points)

    // 배경 별: RAG 항목이 아닌 맨눈 별. 같은 셰이더로 작고 흐리게 그리고, 클릭은 받지 않는다
    const bgGeo = new THREE.BufferGeometry()
    const bn = bg.length
    const bpos = new Float32Array(bn * 3), bcol = new Float32Array(bn * 3), bsize = new Float32Array(bn)
    bg.forEach(([ra, dec, mag, ci], i) => {
      const v = toVec(ra * 15, dec).multiplyScalar(SKY_R * 1.01)
      bpos.set([v.x, v.y, v.z], i * 3)
      bcol.set(bvColor(ci).map((c) => (c / 255) * 0.75), i * 3)
      bsize[i] = Math.max(2.4, 7 - mag * 1.0)
    })
    bgGeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3))
    bgGeo.setAttribute('aColor', new THREE.BufferAttribute(bcol, 3))
    bgGeo.setAttribute('size', new THREE.BufferAttribute(bsize, 1))
    bgGeo.setAttribute('hl', new THREE.BufferAttribute(new Float32Array(bn), 1))
    const bgMat = starMat.clone()
    const bgPoints = new THREE.Points(bgGeo, bgMat)
    bgPoints.frustumCulled = false
    sky.add(bgPoints)

    // 태양계 천체: 하늘과 따로, 정사영 카메라로 3D 구를 그린다(지구와 같은 방식).
    // 위치, 자전, 밝은 쪽은 시각마다 astronomy-engine 으로 계산하고 표면은 NASA 공식 이미지(/nasa)를 입힌다
    const bodiesScene = new THREE.Scene()
    const bodiesCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
    const R = B.map((b) => { const r = createBody(b); r.px = 10; r.group.visible = false; bodiesScene.add(r.group); return r })
    const skyToView = new THREE.Quaternion()
    const radiusOf = (b) => (b.kind === 'sun' ? 30 : b.kind === 'moon' ? 20 : b.id === 'saturn' ? 10 : b.mag > 5.5 ? 7 : clamp(13 - 1.4 * b.mag, 8, 17))
    const updateBodies = (ms) => {
      const date = new Date(ms)
      B.forEach((b, j) => {
        const eq = Astronomy.Equator(b.astroName, date, OBS, false, true)
        b.local.copy(toVec(eq.ra * 15, eq.dec)).multiplyScalar(SKY_R * 0.99)
        b.distKm = eq.dist * Astronomy.KM_PER_AU
        R[j].setEphemeris(date)
        if (ms - b.magAt > 5000 || ms < b.magAt) { // 밝기는 천천히 바뀌어서 5초에 한 번만 구한다
          b.magAt = ms
          b.mag = Astronomy.Illumination(b.astroName, date).mag
          R[j].px = radiusOf(b)
        }
      })
    }
    updateBodies(Date.now())

    // 위성: 행성을 확대해 보면(MOON_FOV) 크기를 아는 주요 위성을 점과 이름으로 띄운다. 목록과 정밀 위치(JPL)는 처음 확대할 때 받는다.
    // 위치는 행성 중심 위치(km)를 지구에서 본 행성 위치에 더해 하늘 방향으로 바꾼다. 빛이 오는 시간만큼 앞 시각의 위치를 쓴다
    const SAT = B.map((b) => (hasMoons(b.id) ? { list: null, eph: null, items: [], on: false, at: null, px: 0 } : null))
    const sats = [] // 이번 프레임에 화면에 놓인 위성 { id, x, y } (누르기용)
    const satEls = new Map()
    const updateMoons = (ms) => SAT.forEach((st, j) => {
      if (!st?.on) return
      const b = B[j]
      if (!st.list) {
        st.list = []
        loadMoons(b.id).then((l) => { st.list = l.filter((m) => m.r) })
        loadEphemeris(b.id).then((e) => { st.eph = e })
      }
      const dir = b.local.clone().normalize()
      st.items = moonPositions(st.list, b.id, new Date(ms - (b.distKm / C_KM_S) * 1000), st.eph).map((m) => {
        const off = m.v.multiplyScalar(PLANET_R[b.id])
        return { ...m, far: off.dot(dir) > 0, local: dir.clone().multiplyScalar(b.distKm).add(off).normalize().multiplyScalar(SKY_R * 0.99) }
      })
    })
    // 태양은 SDO 가 방금 찍은 사진을 15분마다 새로 받아 쓴다
    const sunIdx = B.findIndex((b) => b.kind === 'sun')
    let sunAlive = true, sunTimer = 0
    const refreshSun = async () => {
      const r = await fetchSunImage('hmi').catch(() => null)
      if (r && sunAlive) R[sunIdx].setSunImage(r.img, r.observedAt)
    }
    if (sunIdx >= 0) { refreshSun(); sunTimer = setInterval(refreshSun, 15 * 60 * 1000) }

    // 천구 적도
    const ring = []
    for (let k = 0; k <= 128; k++) {
      const a = (k / 128) * 2 * Math.PI
      ring.push(new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(SKY_R * 0.999))
    }
    const eqGeo = new THREE.BufferGeometry().setFromPoints(ring)
    sky.add(new THREE.Line(eqGeo, new THREE.LineBasicMaterial({ color: 0xd8b56c, transparent: true, opacity: 0.16 })))

    // 서울 지평선. 세계 좌표가 지구 고정 좌표라서 천정은 하늘이 돌아도 한 자리에 있다
    const zenith = toVec(SEOUL.lon, SEOUL.lat)
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(zenith, -zenith.y).normalize()
    const east = toVec(SEOUL.lon + 90, 0) // 시간각 −6h 인 적도 점이 정동쪽
    const groundMat = new THREE.ShaderMaterial({
      uniforms: { uZenith: { value: zenith } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uZenith; varying vec3 vDir;
        void main(){ float h = dot(normalize(vDir), uZenith); gl_FragColor = vec4(0.035, 0.028, 0.02, smoothstep(0.01, -0.06, h) * 0.72); }`,
      transparent: true, depthWrite: false, side: THREE.BackSide,
    })
    const ground = new THREE.Mesh(new THREE.SphereGeometry(SKY_R * 0.97, 64, 32), groundMat)
    ground.renderOrder = 1 // 별 위에 덮어 지평선 아래 별을 어둡게 한다
    scene.add(ground)
    const hz = []
    for (let k = 0; k <= 128; k++) {
      const a = (k / 128) * 2 * Math.PI
      hz.push(north.clone().multiplyScalar(Math.cos(a)).addScaledVector(east, Math.sin(a)).multiplyScalar(SKY_R * 0.965))
    }
    const hzGeo = new THREE.BufferGeometry().setFromPoints(hz)
    const horizon = new THREE.Line(hzGeo, new THREE.LineBasicMaterial({ color: 0xd8b56c, transparent: true, opacity: 0.4 }))
    horizon.renderOrder = 2
    scene.add(horizon)

    // 지구: 하늘과 따로, 정사영 카메라로 화면 한가운데에 그린다. 원근 카메라로 그리면 확대할 때마다
    // 지구가 보이는 면적과 가장자리 모양이 달라진다. 방향만 하늘(세계 좌표)에 맞춰 돌린다
    const earth = makeEarth()
    const earthScene = new THREE.Scene()
    earthScene.add(earth.mesh)
    const earthCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
    let earthPx = 1 // 화면에서 지구의 반지름(px). 질문창과 겹치지 않을 만큼만 키운다
    const placeEarth = () => {
      const w = canvas.clientWidth, hgt = canvas.clientHeight
      earthCam.left = -w / 2; earthCam.right = w / 2; earthCam.top = hgt / 2; earthCam.bottom = -hgt / 2
      earthCam.updateProjectionMatrix()
      earthPx = 0.36 * Math.min(w, hgt) / 2
      earth.mesh.scale.setScalar(earthPx)
    }

    // 이름표
    const labels = S.map((s) => {
      const el = document.createElement('div')
      el.className = 'lbl'
      el.textContent = s.name_ko
      el.hidden = true
      labelsEl.append(el)
      return el
    })
    const marker = (text, cls, dir) => {
      const el = document.createElement('div')
      el.className = `lbl ${cls}`
      el.textContent = text
      el.hidden = true
      labelsEl.append(el)
      return { el, dir }
    }
    const dirs = [['북', north], ['동', east], ['남', north.clone().negate()], ['서', east.clone().negate()]]
      .map(([t, v]) => marker(t, 'dir', v.clone().multiplyScalar(SKY_R)))
    const eqLabel = marker('천구 적도', 'eq', new THREE.Vector3())

    // 시점
    const view = { yaw: 0, pitch: 0 }
    const applyView = () => camera.rotation.set(view.pitch, view.yaw, 0)
    const state = { ms: Date.now(), paused: false, busy: false, tween: null, labelsOn: true }
    let tweenDone = null
    const tweenView = (yaw, pitch, fov, dur) => new Promise((res) => {
      const y0 = view.yaw, p0 = view.pitch, f0 = camera.fov, dy = wrapPi(yaw - y0), t0 = performance.now()
      state.tween = (now) => {
        const k = dur > 0 ? Math.min(1, (now - t0) / dur) : 1
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
        view.yaw = y0 + dy * e
        view.pitch = p0 + (pitch - p0) * e
        applyView()
        camera.fov = f0 + (fov - f0) * e
        camera.updateProjectionMatrix()
        if (k >= 1) { state.tween = null; res() }
      }
      tweenDone = res
    })

    const worldDir = (i) => {
      sky.updateMatrixWorld()
      return S[i].local.clone().applyMatrix4(sky.matrixWorld).normalize()
    }
    const first = S.findIndex((s) => s.name_en === 'Betelgeuse')
    if (first >= 0) {
      sky.rotation.y = -gmstRad(state.ms) // 하늘 회전을 먼저 적용해야 방향이 맞는다
      const d = worldDir(first)
      view.yaw = Math.atan2(-d.x, -d.z)
      view.pitch = Math.asin(d.y) - 22 * DEG // 가운데의 지구에 가리지 않게 위쪽에 둔다
      applyView()
    }

    h.current.flyTo = async (id) => {
      const j = SAT.findIndex((st) => st?.items.some((m) => m.id === id)) // 위성은 그 행성 쪽으로 간다
      const i = j >= 0 ? n + j : S.findIndex((s) => s.id === id)
      if (i < 0) return
      state.busy = true
      state.paused = true
      earthTurn.yaw = earthTurn.pitch = 0 // 지구가 숨은 사이에 확대로 어긋난 방향을 되돌린다
      earth.mesh.visible = false
      state.labelsOn = false
      labelsEl.hidden = true
      const d = worldDir(i)
      await tweenView(Math.atan2(-d.x, -d.z), Math.asin(d.y), Math.min(5, camera.fov), REDUCE ? 0 : 1200)
    }
    h.current.lookAt = async (id) => {
      const i = S.findIndex((s) => s.id === id)
      if (i < 0 || state.busy) return
      state.busy = true
      const d = worldDir(i)
      // 별이 가운데의 지구에 가리지 않게 시선을 조금 아래로 둔다
      await tweenView(Math.atan2(-d.x, -d.z), clamp(Math.asin(d.y) - 24 * DEG, -85 * DEG, 85 * DEG), camera.fov, REDUCE ? 0 : 900)
      state.busy = false
    }
    h.current.release = async () => {
      // 열었던 천체가 가운데의 지구에 가리지 않게, 닫을 때 시선을 내려 천체를 지구 위쪽에 둔다
      await tweenView(view.yaw, clamp(view.pitch - 22 * DEG, -85 * DEG, 85 * DEG), BASE_FOV, REDUCE ? 0 : 800)
      earth.mesh.visible = true
      state.labelsOn = true
      labelsEl.hidden = false
      state.paused = false
      state.busy = false
    }
    h.current.setHighlight = (ids) => {
      hlAll.fill(0)
      S.forEach((s, i) => { if (ids.includes(s.id)) hlAll[i] = 1 })
      geo.attributes.hl.needsUpdate = true
    }

    const earthTurn = { yaw: 0, pitch: 0 }
    // 확대: 휠, 두 손가락 벌리기, 화면의 +/- 버튼. 커서(손가락) 아래의 하늘이 제자리에 남도록 시선을 같이 옮긴다
    const zoomAt = (k, cx, cy) => {
      const f0 = camera.fov, f1 = clamp(f0 * k, FOV_MIN, FOV_MAX)
      if (f1 === f0) return
      const nx = (cx / canvas.clientWidth) * 2 - 1, ny = 1 - (cy / canvas.clientHeight) * 2
      const t = (f) => Math.tan((f * DEG) / 2)
      const dYaw = Math.atan(nx * camera.aspect * t(f0)) - Math.atan(nx * camera.aspect * t(f1))
      const pitch = clamp(view.pitch + Math.atan(ny * t(f0)) - Math.atan(ny * t(f1)), -85 * DEG, 85 * DEG)
      earthTurn.yaw -= dYaw // 확대하느라 시점이 돌아간 만큼은 지구에 반영하지 않는다. 확대해도 지구는 그대로
      earthTurn.pitch += pitch - view.pitch
      view.yaw -= dYaw
      view.pitch = pitch
      camera.fov = f1
      camera.updateProjectionMatrix()
      applyView()
    }
    // 화면 좌표와 선택
    const tmp = new THREE.Vector3()
    const screenPos = (i) => project(tmp.copy(S[i].local).applyMatrix4(sky.matrixWorld))
    const behind = new THREE.Vector3()
    const project = (v) => {
      if (behind.copy(v).applyMatrix4(camera.matrixWorldInverse).z >= 0) return null
      tmp.copy(v)
      tmp.project(camera)
      return { x: ((tmp.x + 1) / 2) * canvas.clientWidth, y: ((1 - tmp.y) / 2) * canvas.clientHeight }
    }
    // 누른 자리의 별·천체·위성 id. 위성은 행성 바로 옆에 있어서 12px 안이면 위성을 먼저 고른다
    const pick = (x, y) => {
      let sat = null, satD = 12
      sats.forEach((m) => { const dd = Math.hypot(m.x - x, m.y - y); if (dd < satD) { satD = dd; sat = m.id } })
      if (sat) return sat
      let best = -1, bestD = 26
      S.forEach((_, i) => {
        const p = screenPos(i)
        if (!p) return
        const dd = Math.hypot(p.x - x, p.y - y)
        if (dd < bestD) { bestD = dd; best = i }
      })
      return best >= 0 ? S[best].id : null
    }
    let drag = null
    const touches = new Map() // 누르고 있는 손가락들. 둘이면 핀치 확대로 본다
    let pinch = 0
    const rect = () => canvas.getBoundingClientRect()
    const down = (e) => {
      if (state.busy) return
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      canvas.setPointerCapture(e.pointerId)
      if (touches.size === 2) {
        const [a, b] = [...touches.values()]
        pinch = Math.hypot(a.x - b.x, a.y - b.y)
        drag = null
        return
      }
      drag = { x: e.clientX, y: e.clientY, moved: false, yaw: view.yaw, pitch: view.pitch }
    }
    const move = (e) => {
      if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pinch && touches.size === 2 && !state.busy) {
        const [a, b] = [...touches.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        const r = rect()
        if (d > 0) zoomAt(pinch / d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top)
        pinch = d
        return
      }
      if (!drag) {
        if (!state.busy) { const r = rect(); canvas.style.cursor = pick(e.clientX - r.left, e.clientY - r.top) ? 'pointer' : 'grab' }
        return
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y
      if (Math.hypot(dx, dy) > 5) drag.moved = true
      if (!drag.moved) return
      const k = (camera.fov / BASE_FOV) * 0.0045
      view.yaw = drag.yaw + dx * k
      view.pitch = clamp(drag.pitch + dy * k, -85 * DEG, 85 * DEG)
      applyView()
      canvas.style.cursor = 'grabbing'
    }
    const up = (e) => {
      touches.delete(e.pointerId)
      if (touches.size < 2) pinch = 0
      if (!drag) return
      const d = drag
      drag = null
      canvas.style.cursor = 'grab'
      if (!d.moved) {
        const r = rect()
        const id = pick(e.clientX - r.left, e.clientY - r.top)
        if (id) latest.current.onPick?.(id)
      }
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    const cancel = (e) => { drag = null; touches.delete(e.pointerId); pinch = 0 }
    canvas.addEventListener('pointercancel', cancel)
    const wheel = (e) => {
      e.preventDefault() // 페이지가 스크롤되지 않게
      if (state.busy) return
      const r = rect()
      zoomAt(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.clientX - r.left, e.clientY - r.top)
    }
    canvas.addEventListener('wheel', wheel, { passive: false })

    const resize = () => {
      const w = canvas.clientWidth, hgt = canvas.clientHeight
      const pr = pixelRatio(w, hgt)
      renderer.setPixelRatio(pr)
      starMat.uniforms.uPR.value = bgMat.uniforms.uPR.value = pr // 점 크기는 버퍼 픽셀 단위라 배율을 따라간다
      renderer.setSize(w, hgt, false)
      camera.aspect = w / hgt
      camera.updateProjectionMatrix()
      placeEarth()
      bodiesCam.left = -w / 2; bodiesCam.right = w / 2; bodiesCam.top = hgt / 2; bodiesCam.bottom = -hgt / 2
      bodiesCam.updateProjectionMatrix()
    }
    window.addEventListener('resize', resize)
    resize()

    const labelDir = new THREE.Vector3()
    const earthEuler = new THREE.Euler()
    let raf = 0, last = performance.now(), lastTick = 0
    // 가만히 두면 하늘이 천천히 돌고 위아래로 흔들린다. 조작하면 멈추고, 지구는 제자리에 둔다
    let lastInput = performance.now()
    const touched = () => { lastInput = performance.now() }
    const inputEvents = ['pointerdown', 'wheel', 'keydown', 'touchstart']
    inputEvents.forEach((n) => window.addEventListener(n, touched, { passive: true }))
    const driftStep = (now, dt) => {
      const typing = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA'
      if (!latest.current.drift || camera.fov < TRUE_FOV || REDUCE || state.busy || state.tween || drag || pinch || typing || now - lastInput < DRIFT_WAIT) return
      const k = clamp(camera.fov / BASE_FOV, 0.15, 1) // 확대했을 땐 화면 속 움직임이 같게 느려진다
      const dYaw = DRIFT_YAW * (dt / 1000) * k
      const w = (2 * Math.PI) / DRIFT_PERIOD
      const pitch = clamp(view.pitch + Math.cos((now / 1000) * w) * DRIFT_PITCH * w * (dt / 1000) * k, -85 * DEG, 85 * DEG)
      earthTurn.yaw -= dYaw
      earthTurn.pitch += pitch - view.pitch
      view.yaw -= dYaw
      view.pitch = pitch
      applyView()
    }
    const frame = (now) => {
      const dt = Math.min(now - last, 100) // 탭이 가려졌다 돌아와도 한 번에 크게 움직이지 않게
      driftStep(now, dt)
      last = now
      if (!state.paused) state.ms = latest.current.fast ? state.ms + dt * 3600 : Date.now()
      const skyTurn = -gmstRad(state.ms) - sky.rotation.y
      sky.rotation.y += skyTurn
      // 크게 확대하면 하늘이 도는 만큼 시선도 따라 돌린다(망원경 추적). 안 그러면 0.15도 시야에서 행성이 1초에 30px씩 흘러간다
      if (camera.fov < TRUE_FOV && !state.busy && Math.abs(skyTurn) < 0.1) { view.yaw += skyTurn; earthTurn.yaw += skyTurn; applyView() }
      const sun = sunDir(state.ms)
      earth.mat.uniforms.uSun.value.copy(sun)
      if (!REDUCE) earth.mat.uniforms.uCloudT.value = (now / 1000) * 1800 // 구름은 1초에 30분씩 흘린다 (실제 빠르기로는 멈춰 보인다)
      state.tween?.(now)
      earth.mesh.quaternion.setFromEuler(earthEuler.set(view.pitch - earthTurn.pitch, view.yaw - earthTurn.yaw, 0, 'YXZ')).invert()
      starMat.uniforms.uTime.value = now / 1000
      starMat.uniforms.uZoom.value = Math.min(ZOOM_CAP, Math.sqrt(BASE_FOV / camera.fov))
      bgMat.uniforms.uTime.value = starMat.uniforms.uTime.value
      bgMat.uniforms.uZoom.value = starMat.uniforms.uZoom.value
      renderer.render(scene, camera)
      // 천체: 하늘 좌표를 화면 좌표로 돌려 3D 구를 하늘 위에 덧그린다
      skyToView.copy(camera.quaternion).invert().multiply(sky.quaternion)
      const cw = canvas.clientWidth, ch = canvas.clientHeight
      const zoomPx = Math.min(ZOOM_CAP, Math.sqrt(BASE_FOV / camera.fov))
      const pxPerRad = ch / (2 * Math.tan((camera.fov * DEG) / 2))
      const shrink = Math.min(1, camera.fov / TRUE_FOV)
      R.forEach((r, j) => {
        const p = screenPos(n + j)
        r.group.visible = !!p && p.x > -80 && p.x < cw + 80 && p.y > -80 && p.y < ch + 80
        if (SAT[j]) SAT[j].on = r.group.visible && camera.fov < MOON_FOV
        if (!r.group.visible) return
        r.group.position.set(p.x - cw / 2, ch / 2 - p.y, 0)
        // 표시 크기: 평소엔 밝기로 정한 크기, 크게 확대하면 실제 겉보기 크기(그보다 작아지지는 않는다). 태양 판은 원판이 가운데 일부다
        const truePx = (B[j].radius_km / B[j].distKm) * pxPerRad / (B[j].kind === 'sun' ? 1.6 * SUN_DISC : 1)
        const px = Math.max(truePx, r.px * zoomPx * shrink)
        r.group.scale.setScalar(px)
        // 자전을 한 바퀴 SPIN_LOOP_SEC 초로 빠르게 돌려 보인다(역행 자전은 거꾸로). 달은 늘 같은 면이라 돌리지 않는다
        if (!REDUCE) r.setTime?.(now / 1000) // 태양 불꽃
        if (!REDUCE && B[j].kind !== 'moon' && B[j].rotation_hours) {
          r.setTurn(Math.sign(B[j].rotation_hours) * ((now / 1000) * 2 * Math.PI) / SPIN_LOOP_SEC)
          r.setFlow((now / 1000) * ((Math.abs(B[j].rotation_hours) * 3600) / SPIN_LOOP_SEC)) // 띠의 바람도 같은 배속
        }
        if (SAT[j]) { SAT[j].at = p; SAT[j].px = px }
        r.applyView(skyToView)
        const below = labelDir.copy(B[j].local).applyMatrix4(sky.matrixWorld).dot(zenith) < 0
        r.dim.value = (B[j].mag > 5.5 ? 0.75 : 1) * (below ? 0.45 : 1) // 맨눈으로 안 보이는 천체와 지평선 아래 천체는 어둡게
      })
      renderer.autoClear = false
      renderer.clearDepth()
      renderer.render(bodiesScene, bodiesCam)
      renderer.autoClear = true
      if (earth.mesh.visible) {
        renderer.autoClear = false // 하늘 위에 지구만 덧그린다
        renderer.clearDepth()
        renderer.render(earthScene, earthCam)
        renderer.autoClear = true
      }
      sats.length = 0
      satEls.forEach((el) => { el.hidden = true })
      if (state.labelsOn) {
        sky.updateMatrixWorld()
        // 이름은 가까이 볼 때만 나온다. 확대 단계 L 이 오를수록 더 어두운 별까지, 천체는 거의 바로, 명왕성은 한참 확대해야
        const L = Math.log2(BASE_FOV / camera.fov)
        const earthSeen = earth.mesh.visible
        const earthX = canvas.clientWidth / 2, earthY = canvas.clientHeight / 2
        const shown = [] // 이름표끼리 겹치지 않게, 이미 놓인 자리를 기억해 둔다
        S.forEach((s, i) => {
          const el = labels[i]
          const lit = hlAll[i] > 0
          const show = lit || (i >= n ? L > (s.kind === 'dwarf' ? 1.8 : 0.3) : L > 0.3 && s.mag < -1.6 + 3 * L)
          const p = show && screenPos(i)
          if (p && earthSeen && Math.hypot(p.x - earthX, p.y - earthY) < earthPx) { el.hidden = true; return } // 지구 뒤에 가린 별
          if (!p || p.x < -50 || p.y < -20 || p.x > canvas.clientWidth || p.y > canvas.clientHeight) { el.hidden = true; return }
          el.hidden = false
          el.classList.toggle('hl', lit)
          el.classList.toggle('body', i >= n)
          el.classList.toggle('below', labelDir.copy(S[i].local).applyMatrix4(sky.matrixWorld).dot(zenith) < 0)
          el.style.transform = `translate(${Math.round(p.x + 10)}px, ${Math.round(p.y - 8)}px)`
          shown.push(p)
        })
        const place = (m) => {
          const p = project(m.dir)
          m.el.hidden = !p || p.x < 0 || p.y < 0 || p.x > canvas.clientWidth || p.y > canvas.clientHeight
          if (p) m.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, 6px)`
        }
        // 위성: 행성 뒤에 숨은 것과 지구에 가린 것은 빼고, 이름이 겹치면 큰 위성 이름만 남긴다
        const satBoxes = []
        SAT.forEach((st) => {
          if (!st?.on || !st.at) return
          st.items.slice().sort((a, b) => b.km - a.km).forEach((m) => {
            const p = project(new THREE.Vector3().copy(m.local).applyMatrix4(sky.matrixWorld))
            if (!p || p.x < 0 || p.y < 0 || p.x > canvas.clientWidth || p.y > canvas.clientHeight) return
            if (m.far && Math.hypot(p.x - st.at.x, p.y - st.at.y) < st.px) return
            if (earthSeen && Math.hypot(p.x - earthX, p.y - earthY) < earthPx) return
            let el = satEls.get(m.id)
            if (!el) {
              el = document.createElement('div')
              el.className = 'lbl sat'
              el.textContent = m.label
              labelsEl.append(el)
              satEls.set(m.id, el)
            }
            el.hidden = false
            el.style.transform = `translate(${Math.round(p.x - 2.5)}px, ${Math.round(p.y)}px) translateY(-50%)`
            const box = [p.x, p.y - 8, p.x + 10 + m.label.length * 7, p.y + 8]
            const clash = satBoxes.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])
            el.classList.toggle('quiet', clash)
            if (!clash) satBoxes.push(box)
            sats.push({ id: m.id, x: p.x, y: p.y })
          })
        })
        dirs.forEach(place)
        // 적도 이름표는 시선 바로 앞이 아니라 옆으로 비켜 둔다 (가운데 질문창과 겹치지 않게)
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
        const a = Math.atan2(-f.z, f.x) + 22 * DEG
        eqLabel.dir.set(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(SKY_R)
        place(eqLabel)
        const pe = project(eqLabel.dir)
        if (pe && shown.some((q) => Math.abs(q.x - pe.x) < 110 && Math.abs(q.y - pe.y) < 22)) eqLabel.el.hidden = true
        if (Math.hypot(f.x, f.z) < 0.35) eqLabel.el.hidden = true
      }
      if (now - lastTick > 250) {
        lastTick = now
        updateBodies(state.ms)
        updateMoons(state.ms)
        latest.current.onTick?.({ ms: state.ms, gmstHours: (gmstRad(state.ms) / DEG) / 15, sunAlt: Math.asin(sun.dot(zenith)) / DEG })
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      tweenDone?.()
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', cancel)
      canvas.removeEventListener('wheel', wheel)
      inputEvents.forEach((n) => window.removeEventListener(n, touched))
      sunAlive = false
      clearInterval(sunTimer)
      R.forEach((r) => r.dispose())
      labelsEl.replaceChildren()
      satEls.clear()
      geo.dispose()
      eqGeo.dispose()
      hzGeo.dispose()
      ground.geometry.dispose()
      groundMat.dispose()
      bgGeo.dispose()
      bgMat.dispose()
      starMat.dispose()
      earth.mesh.geometry.dispose()
      earth.mat.dispose()
      renderer.dispose()
    }
  }, [stars, bg, bodies])

  useEffect(() => { h.current.setHighlight?.(highlight) }, [highlight, stars, bg, bodies])

  return (
    <div className="map">
      <canvas ref={canvasRef} className="sky" role="img"
        aria-label="실제 밝은 별과 태양계 천체의 위치를 보여주는 천구. 휠이나 두 손가락으로 가까이 보면 이름이 나타나고, 천체를 누르면 상세 화면으로 이동합니다." />
      <div ref={labelsRef} className="labels" aria-hidden="true" />
    </div>
  )
})

export default StarMap
