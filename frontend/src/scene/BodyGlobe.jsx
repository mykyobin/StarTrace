import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { bvColor } from './astro'
import { RINGS, SPIN_LOOP_SEC, createBody, createStar, fetchSunImage, ringOuter, tempFromBV, viewFromEarth } from './bodyRender'
import { hasMoons as planetHasMoons, loadEphemeris, loadMoons, moonPositions } from './moons'

const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const RANGES = [['planet', '행성'], ['major', '주요 위성'], ['all', '전체 위성']]

const nameOf = (id) => id[0].toUpperCase() + id.slice(1)

// 상세 화면의 큰 3D 천체 한 개.
//  - 행성·달: NASA 이미지(없으면 색으로 그린 표면)를 입힌 구. 자전축 기울기와 밝은 쪽은 지금 서울에서 보이는 실제 모습이다.
//    고리와 위성은 행성 그림자에 들면 어두워지고, 고리와 큰 위성은 행성 표면에 그림자를 드리운다.
//  - 태양: SDO 가 방금 찍은 사진.
//  - 별(star 만 있을 때): 관측된 색과 온도로 그린 표면. 쌀알 무늬가 끓고 천천히 돈다.
// 자전만 빠르게 돌린다. 몇 배인지 화면 구석에 적고, 동작 줄이기를 켠 사람에게는 돌리지 않는다.
// 위성 점을 누르면 onMoon(위성 id). focus(JPL 번호)를 주면 그 위성을 금색 고리로 표시하고, 그 위성이 보이는 범위로 연다.
export default function BodyGlobe({ body, star, focus, onMoon }) {
  const ref = useRef(null)
  const moonsRef = useRef(null)
  const [info, setInfo] = useState({ source: null, observedAt: null })
  // 행성의 자전을 한 바퀴 SPIN_LOOP_SEC 초에 돌려 보이는 배속. 태양은 사진이 실시간이라, 달은 지구에 늘 같은 면을 보여서 돌리지 않는다.
  // 위성(satellite)은 공전 주기에 한 바퀴 도는 동주기 자전이라 공전도 같은 배속으로 빨라진 셈이다
  const speed = body && body.kind !== 'sun' && body.kind !== 'moon' ? Math.max(1, Math.round((Math.abs(body.rotation_hours) * 3600) / SPIN_LOOP_SEC)) : null
  const [sunKind, setSunKind] = useState('hmi')
  const withMoons = !!body && planetHasMoons(body.id)
  // 보는 범위: 버튼(range)으로 정하고 휠로 넓히거나 좁힌다. 장면을 다시 만들지 않게 ref 로 넘긴다
  const [range, setRange] = useState('planet')
  const rangeRef = useRef('planet')
  const zoomRef = useRef(null)
  const [moonInfo, setMoonInfo] = useState(null)
  const turned = useRef(new THREE.Quaternion()) // 사용자가 끌어 돌린 만큼. 장면을 다시 만들어도 이어진다
  const [isTurned, setIsTurned] = useState(false)
  const [majors, setMajors] = useState([]) // 키보드로도 고를 수 있게 크기를 아는 위성을 버튼으로 둔다
  const onMoonRef = useRef(onMoon)
  useEffect(() => { onMoonRef.current = onMoon })

  const pick = (r) => { rangeRef.current = r; zoomRef.current = null; setRange(r) }

  useEffect(() => {
    const canvas = ref.current
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    const scene = new THREE.Scene()
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000) // 구 반지름이 px 단위라 깊이 범위를 넉넉히 둔다
    const isSun = body?.kind === 'sun'

    let thing // { group, ... }
    const sat = body?.kind === 'satellite'
    const astroName = nameOf(body?.planet || body?.id || 'sun') // 위성은 모행성 기준(자전축·햇빛·보는 방향)
    if (body) {
      thing = createBody({ ...body, astroName, planetAstro: sat ? astroName : undefined })
    } else {
      thing = createStar(bvColor(star.bv))
    }
    scene.add(thing.group)

    // 보이는 범위(span): 화면 가로 절반에 담는 거리, 행성 반지름 단위. 행성 보기는 행성(과 고리)이 꽉 차게
    const spans = { planet: 1, major: 1, all: 1 }
    let span = 1
    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight
      renderer.setSize(w, h, false)
      cam.left = -w / 2; cam.right = w / 2; cam.top = h / 2; cam.bottom = -h / 2
      cam.updateProjectionMatrix()
      const r = Math.min(w, h) * (isSun || thing.sunMaterial ? 0.27 : Math.min(0.36, 0.45 / ringOuter(body?.id))) // 고리가 있으면 고리까지 담는다
      spans.planet = w / 2 / r
      if (!withMoons) span = spans.planet
      const box = moonsRef.current
      if (box) Object.assign(box.style, { left: `${canvas.offsetLeft}px`, top: `${canvas.offsetTop}px`, width: `${w}px`, height: `${h}px` })
    }
    resize()
    span = spans.planet
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let sunAlive = true
    const loadSun = async () => {
      const r = await fetchSunImage(sunKind).catch(() => null)
      if (r && sunAlive) { thing.setSunImage(r.img, r.observedAt); setInfo((i) => ({ ...i, observedAt: r.observedAt, source: 'live' })) }
    }
    if (isSun) loadSun()

    // 끌면 어느 방향으로든 돌려 볼 수 있다(좌우로 끌면 세로축, 위아래로 끌면 가로축). 놓으면 그 속도로 조금 더 돌다 멈추고,
    // 자전은 그동안에도 계속된다. 돌린 방향은 '보는 방향 되돌리기'를 누를 때까지 남는다
    let drag = null, vel = { x: 0, y: 0 }
    const turnBy = (dx, dy) => turned.current.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(dy * 0.008, dx * 0.008, 0)))
    const down = (e) => { drag = { x: e.clientX, y: e.clientY, t: performance.now() }; vel = { x: 0, y: 0 }; canvas.setPointerCapture(e.pointerId) }
    const move = (e) => {
      if (!drag) return
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y, t = performance.now(), dt = Math.max(1, t - drag.t)
      turnBy(dx, dy)
      vel = { x: dx / dt, y: dy / dt }
      drag = { x: e.clientX, y: e.clientY, t }
      if ((dx || dy) && !isSun) setIsTurned(true)
    }
    const up = () => { if (drag && performance.now() - drag.t > 80) vel = { x: 0, y: 0 }; drag = null } // 멈췄다 놓으면 관성 없이
    // 휠: 위성이 있는 행성만 보는 범위를 넓히고 좁힌다
    const wheel = (e) => {
      if (!withMoons) return
      e.preventDefault()
      zoomRef.current = Math.min(spans.all * 1.3, Math.max(spans.planet * 0.7, (zoomRef.current ?? span) * Math.exp(e.deltaY * 0.0015)))
      if (rangeRef.current) { rangeRef.current = null; setRange(null) }
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('wheel', wheel, { passive: false })

    // 위성: 목록이 오면 점을 만들고, 1초마다 위치를 다시 구한다(정밀 위치는 늦게 올 수 있다)
    let alive = true, list = [], eph = null, dots = [], pos = [], posAt = 0, lastInfo = '', framed = !focus
    // 위성 자신: 지금 행성 쪽 방향을 1초마다 다시 구한다(정밀 위치가 오면 그것으로). 늘 같은 면이 행성을 본다
    let self = null, selfDir = 1, selfAt = 0
    if (sat) {
      loadMoons(body.planet).then((l) => { if (alive) { self = l.find((m) => m.code === body.code) || null; selfDir = self?.i > 90 ? -1 : 1 } })
      loadEphemeris(body.planet).then((e) => { if (alive) { eph = e; selfAt = 0 } })
    }
    const clickMoon = (e) => { const id = e.target.closest('.moon-dot')?.dataset.id; if (id) onMoonRef.current?.(id) }
    const moonBox = moonsRef.current
    moonBox.addEventListener('click', clickMoon)
    if (withMoons) {
      loadMoons(body.id).then((l) => {
        if (!alive) return
        list = l
        dots = l.map((m) => {
          const el = document.createElement('span')
          const me = m.code === focus
          el.className = `moon-dot${m.r ? ' major' : ''}${m.irregular ? ' irregular' : ''}${me ? ' focus' : ''}${onMoonRef.current ? ' link' : ''}`
          el.dataset.id = `sat-${m.code}`
          if (m.r || me) el.textContent = m.label
          moonsRef.current.appendChild(el)
          return el
        })
        setMajors(l.filter((m) => m.r).sort((a, b) => b.r - a.r).map((m) => [`sat-${m.code}`, m.label]))
        posAt = 0
      })
      loadEphemeris(body.id).then((e) => { if (alive) { eph = e; posAt = 0; lastInfo = '' } })
    }
    const placeMoons = (now, view) => {
      if (now - posAt > 1000 && list.length) {
        posAt = now
        pos = moonPositions(list, body.id, new Date(), eph)
        thing.setMoons(pos)
        const far = (sel) => Math.max(...pos.filter(sel).map((p) => p.v.length()))
        const big = pos.some((p) => p.km >= 200) ? (p) => p.km >= 200 : (p) => p.r // 주요 위성 보기는 반지름 200km 넘는 위성까지 (화성은 둘 다)
        spans.major = Math.max(spans.planet, far(big) * 1.08)
        spans.all = Math.max(spans.major, far(() => true) * 1.04)
        const me = !framed && pos.find((p) => p.code === focus)
        if (me) { // 고른 위성이 화면에 들어오는 가장 좁은 범위로 연다
          framed = true
          const r = me.v.length() < spans.planet * 0.9 ? 'planet' : me.v.length() < spans.major * 0.95 ? 'major' : 'all'
          rangeRef.current = r
          setRange(r)
          span = spans[r]
        }
      }
      const w = canvas.clientWidth, h = canvas.clientHeight
      const scale = w / 2 / span
      moonsRef.current?.classList.toggle('no-labels', span < spans.planet * 1.6) // 행성 보기에서는 이름을 달지 않는다
      const sun = thing.local.sun
      const behind = [], shadowed = [], boxes = [], labelAt = []
      dots.forEach((el, i) => {
        const m = pos[i]
        if (!m) return
        const p = m.v.clone().applyQuaternion(view)
        const x = w / 2 + p.x * scale, y = h / 2 - p.y * scale
        const hide = (p.z < 0 && Math.hypot(p.x, p.y) < 1) || x < -40 || x > w + 40 || y < -40 || y > h + 40
        const t = m.v.dot(sun)
        const dark = t < 0 && m.v.clone().addScaledVector(sun, -t).length() < 1 // 행성 그림자 속
        if (m.r && p.z < 0 && Math.hypot(p.x, p.y) < 1) behind.push(m.label)
        if (m.r && dark) shadowed.push(m.label)
        el.style.visibility = hide ? 'hidden' : 'visible'
        if (hide) return
        el.classList.toggle('eclipsed', dark)
        if (m.r) el.style.setProperty('--d', `${Math.min(16, Math.max(5, 2 * m.r * scale))}px`) // 큰 위성은 실제 크기, 너무 작으면 5px
        el.style.transform = `translate(${x}px, ${y}px)`
        if (m.r || m.code === focus) labelAt.push([m.code === focus ? Infinity : m.km, el, x, y])
      })
      // 이름이 겹치면 큰 위성 이름만 남긴다
      labelAt.sort((a, b) => b[0] - a[0]).forEach(([, el, x, y]) => {
        const bw = el.textContent.length * 6.5 + 6, box = [x - bw / 2, y + 2, x + bw / 2, y + 16]
        const clash = boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])
        el.classList.toggle('quiet', clash)
        if (!clash) boxes.push(box)
      })
      const exact = pos.filter((p) => p.exact).length
      const s = JSON.stringify([pos.length, exact, !!eph, behind, shadowed])
      if (s !== lastInfo) { lastInfo = s; setMoonInfo({ total: pos.length, exact, loading: !eph, behind, shadowed }) }
    }

    let raf = 0, lastDraw = 0
    const t0 = performance.now()
    const t0Wall = Date.now()
    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      if (REDUCE && !drag && now - lastDraw < 500) return // 동작 줄이기: 돌리지 않고 가끔만 다시 그린다 (이미지가 늦게 와도 보이게)
      const dt = Math.min(100, now - (lastDraw || now))
      lastDraw = now
      if (!drag && !REDUCE && Math.hypot(vel.x, vel.y) > 0.002) { // 놓은 뒤의 관성
        turnBy(vel.x * dt, vel.y * dt)
        const k = Math.pow(0.94, dt / 16)
        vel = { x: vel.x * k, y: vel.y * k }
      }
      if (body && !isSun) {
        const real = new Date()
        // 자전만 앞당긴 시각으로 계산하고, 위상과 자전축 기울기는 지금 시각 그대로 둔다
        const spinDate = REDUCE || !speed ? real : new Date(t0Wall + (now - t0) * speed)
        if (sat && self && now - selfAt > 1000) {
          selfAt = now
          thing.setToPlanet(moonPositions([self], body.planet, real, eph)[0].v.negate())
        }
        thing.setEphemeris(real, spinDate)
        // 위성은 지금 실제 방향에서 공전(=자전)만 앞당겨 돌린다. 거대 행성은 띠마다 다른 바람에 밀려 흐른다
        if (sat && !REDUCE) thing.setTurn((selfDir * 2 * Math.PI * (now - t0)) / 1000 / SPIN_LOOP_SEC)
        if (!REDUCE && speed) thing.setFlow(((now - t0) / 1000) * speed)
        if (withMoons) {
          const target = zoomRef.current ?? spans[rangeRef.current]
          span = REDUCE ? target : span * Math.pow(target / span, 0.15) // 보는 범위를 부드럽게 바꾼다
          thing.group.scale.setScalar(canvas.clientWidth / 2 / span)
        } else thing.group.scale.setScalar(canvas.clientWidth / 2 / spans.planet)
        const view = viewFromEarth({ astroName }, real).premultiply(turned.current) // 끌어 돌린 만큼 보는 방향을 돌린다(위성·고리·빛도 함께)
        thing.applyView(view)
        if (withMoons) placeMoons(now, view)
      } else {
        thing.group.scale.setScalar(canvas.clientWidth / 2 / spans.planet)
        if (isSun && !REDUCE) thing.setTime((now - t0) / 1000)
        if (!body) {
          thing.uniforms.uTime.value = REDUCE ? 0 : (now - t0) / 1000
          thing.globe.rotation.y = REDUCE ? 0.6 : ((now - t0) / 1000) * 0.08
          thing.globe.rotation.x = 0.35
          thing.group.quaternion.copy(turned.current)
        }
      }
      renderer.render(scene, cam)
    }
    raf = requestAnimationFrame(frame)
    const sourceTimer = setInterval(() => setInfo((i) => (thing.state && i.source !== thing.state.source ? { ...i, source: thing.state.source } : i)), 1000)

    return () => {
      alive = false
      sunAlive = false
      dots.forEach((el) => el.remove())
      moonBox.removeEventListener('click', clickMoon)
      clearInterval(sourceTimer)
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel)
      thing.dispose()
      renderer.dispose()
    }
  }, [body, star, sunKind, speed, withMoons, focus])

  const label = body ? `${body.name_ko}의 3D 모습` : `${star.name_ko}의 표면 모습(관측값으로 그린 그림)`
  const zoomedOut = withMoons && range !== 'planet'
  const mi = moonInfo
  return (
    <>
    <div className="globe">
      {(withMoons || isTurned) && (
        <div className="globe-tabs" role="group" aria-label="보는 범위 (휠로도 바꿀 수 있어요)">
          {withMoons && RANGES.map(([k, t]) => <button key={k} type="button" className="pill" aria-pressed={range === k} onClick={() => pick(k)}>{t}</button>)}
          {isTurned && <button type="button" className="pill" onClick={() => { turned.current.identity(); setIsTurned(false) }}>보는 방향 되돌리기</button>}
        </div>
      )}
      {body?.kind === 'sun' && (
        <div className="globe-tabs" role="group" aria-label="태양 사진 종류">
          <button type="button" className="pill" aria-pressed={sunKind === 'hmi'} onClick={() => setSunKind('hmi')}>가시광(흑점)</button>
          <button type="button" className="pill" aria-pressed={sunKind === 'aia171'} onClick={() => setSunKind('aia171')}>자외선(코로나)</button>
        </div>
      )}
      <canvas ref={ref} className="globe-canvas" role="img" aria-label={label} />
      <div ref={moonsRef} className="globe-moons" aria-hidden="true" />
      <div className="globe-meta" aria-live="polite">
        {speed && !zoomedOut && <span>자전 속도 실제의 약 {speed.toLocaleString('ko-KR')}배</span>}
        {body?.kind === 'sun' && info.observedAt && <span>SDO 촬영 {new Date(info.observedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>}
        {!body && <span>표면 온도 약 {Math.round(tempFromBV(star.bv ?? 0.6) / 100) * 100}K (색지수에서 계산)</span>}
        {body && body.kind !== 'sun' && info.source === 'fallback' && <span>NASA 이미지 준비 중이라 색으로 그렸어요</span>}
        {RINGS[body?.id]?.note && !zoomedOut && <span>{RINGS[body.id].note}</span>}
        {zoomedOut && mi && <span>위성 {mi.total}개 지금 위치 · 정밀 {mi.exact}개{mi.loading ? '(JPL 에서 받는 중)' : ''}{mi.exact < mi.total && ', 나머지는 평균 궤도로 계산한 근사 위치'}</span>}
        {withMoons && (mi?.behind.length > 0 || mi?.shadowed.length > 0) && (
          <span>{[mi.behind.length && `${body.name_ko} 뒤: ${mi.behind.join(', ')}`, mi.shadowed.length && `그림자 속: ${mi.shadowed.join(', ')}`].filter(Boolean).join(' · ')}</span>
        )}
      </div>
    </div>
      {onMoon && majors.length > 0 && (
        <nav className="moon-list" aria-label={`${body.name_ko}의 주요 위성`}>
          <span>주요 위성</span>
          {majors.map(([id, label]) => (
            <button key={id} type="button" className="chip" aria-current={id === `sat-${focus}` ? 'page' : undefined} onClick={() => onMoon(id)}>{label}</button>
          ))}
        </nav>
      )}
    </>
  )
}
