import { useCallback, useEffect, useRef, useState } from 'react'
import { explore, getBodies, getGuide, getSky, getStar, getStars, getStatus, streamChat } from './api'
import AskBar from './components/AskBar'
import StarMap from './scene/StarMap'
import { SEOUL, bvColor } from './scene/astro'
import StarDetail from './views/StarDetail'
import { fmtMag } from './format'

const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const hm = (h) => `${String(Math.floor(h)).padStart(2, '0')}h ${String(Math.floor((h % 1) * 60)).padStart(2, '0')}m`
const skyState = (alt) => (alt > 0 ? '낮' : alt > -18 ? '박명' : '밤')

// 상태에 따라 화면 위에 띄우는 안내
function problemOf(status, loadError) {
  if (loadError) return loadError
  if (!status) return null
  if (!status.key_set) return 'API 키가 설정되지 않았어요. backend/.env 의 ANTHROPIC_API_KEY 와 OPENAI_API_KEY 를 채우면 질문과 조건 찾기를 쓸 수 있어요.'
  if (status.meta_chunks === 0) return '색인이 없어요. backend 폴더에서 python scripts/index_stars.py 를 먼저 실행해 주세요.'
  return null
}

export default function App() {
  const map = useRef(null)
  const flash = useRef(null)
  const [stars, setStars] = useState([])
  const [bg, setBg] = useState([])
  const [bodies, setBodies] = useState([])
  const [status, setStatus] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [results, setResults] = useState([])
  const [message, setMessage] = useState('')
  const [searching, setSearching] = useState(false)
  const [fast, setFast] = useState(false)
  const [drift, setDrift] = useState(!REDUCE) // 움직임 줄이기를 켠 사람은 자동 이동을 꺼 둔다
  const [clock, setClock] = useState(null)
  const [detail, setDetail] = useState(null)
  const busy = useRef(false)
  // 별마다 대화를 따로 보관한다. 별을 바꿔도 이전 대화가 섞이지 않는다
  const [threads, setThreads] = useState({})
  const [asking, setAsking] = useState(false)
  const msgId = useRef(0)
  const [guides, setGuides] = useState({}) // 관측 가이드 결과도 별마다 보관한다
  const returnFocus = useRef(null)


  useEffect(() => {
    // 별·배경·천체가 따로 도착하면 천구를 그때마다 다시 만들게 되어 화면이 늦게 뜬다. 한꺼번에 받아 한 번에 그린다
    Promise.all([
      getStars(),
      getSky().catch(() => []),     // 배경 별이나 천체가 없어도 서비스는 돈다
      getBodies().catch(() => []),
    ]).then(([s, b, bo]) => { setStars(s); setBg(b); setBodies(bo) }).catch((e) => setLoadError(e.message))
    getStatus().then(setStatus).catch(() => {})
  }, [])

  const search = async (query) => {
    setSearching(true)
    setMessage('')
    try {
      const { results: found } = await explore(query)
      setResults(found)
      if (!found.length) setMessage('조건에 맞는 별을 찾지 못했어요. 별자리, 색, 밝기를 바꿔서 다시 써 보세요.')
      if (found.length === 1) open(found[0].id)
      else if (found.length) map.current.lookAt(found[0].id) // 결과 쪽 하늘로 시점을 옮긴다
    } catch (e) {
      setResults([])
      setMessage(e.message)
    } finally {
      setSearching(false)
    }
  }

  const animate = (from, to, ms) => flash.current.animate(
    [from, to], { duration: REDUCE ? 1 : ms, fill: 'forwards', easing: 'ease-in' }).finished

  const open = useCallback(async (id) => {
    if (busy.current) return
    busy.current = true
    if (detail) { // 상세 화면 안에서 행성↔위성으로 넘어간다. 지도로 돌아가지 않는다
      try { setDetail(await getStar(id)) } catch (e) { setMessage(e.message) }
      busy.current = false
      return
    }
    returnFocus.current = document.activeElement
    const star = stars.find((s) => s.id === id)
    const body = bodies.find((b) => b.id === id)
    const loading = getStar(id)
    await map.current.flyTo(id)
    // 흰 섬광 대신 별 고유색을 어둡게 눌러 번지게 한다. 화면이 하얗게 터지면 암적응이 깨진다
    const [r, g, b] = (body ? body.color : bvColor(star?.bv)).map((v) => Math.round(v * 0.42))
    flash.current.style.setProperty('--c', `rgb(${r}, ${g}, ${b})`)
    await animate({ opacity: 0, transform: 'scale(.15)' }, { opacity: 1, transform: 'scale(1.6)' }, 520)
    try {
      setDetail(await loading)
    } catch (e) {
      setMessage(e.message)
      await map.current.release()
      await animate({ opacity: 1 }, { opacity: 0 }, 300)
      busy.current = false
      return
    }
    await animate({ opacity: 1, transform: 'scale(1.6)' }, { opacity: 0, transform: 'scale(1.6)' }, 420)
    busy.current = false
    return star
  }, [stars, bodies, detail])

  const edit = (starId, id, change) => setThreads((t) => ({
    ...t,
    [starId]: t[starId].map((m) => (m.id === id ? { ...m, ...(typeof change === 'function' ? change(m) : change) } : m)),
  }))

  const ask = async (starId, question) => {
    if (asking) return
    setAsking(true)
    const userId = ++msgId.current
    const botId = ++msgId.current
    setThreads((t) => ({
      ...t,
      [starId]: [...(t[starId] || []), { id: userId, role: 'user', text: question },
        { id: botId, role: 'bot', status: 'pending', steps: ['질문을 보내는 중'] }],
    }))
    try {
      await streamChat(starId, question, (event, data) => {
        if (event === 'progress') edit(starId, botId, (m) => ({ steps: [...m.steps, data.text] }))
        else if (event === 'result') {
          edit(starId, botId, { status: 'done', text: data.answer, citations: data.citations, noCitation: data.no_citation })
        } else if (event === 'error') edit(starId, botId, { status: 'error', error: data.message })
      })
      edit(starId, botId, (m) => (m.status === 'pending' ? { status: 'error', error: '답이 도착하지 않았어요. 다시 시도해 주세요.' } : {}))
    } catch (e) {
      edit(starId, botId, { status: 'error', error: e.message })
    } finally {
      setAsking(false)
    }
  }

  const openGuide = async (starId) => {
    setGuides((g) => ({ ...g, [starId]: { loading: true } }))
    try {
      const result = await getGuide(starId)
      setGuides((g) => ({ ...g, [starId]: { result } }))
    } catch (e) {
      setGuides((g) => ({ ...g, [starId]: { error: e.message } }))
    }
  }

  const close = async () => {
    if (busy.current || !detail) return
    busy.current = true
    setDetail(null)
    await map.current.release()
    busy.current = false
    if (returnFocus.current?.isConnected) returnFocus.current.focus()
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const problem = problemOf(status, loadError)
  const highlight = results.map((r) => r.id)
  // 캔버스는 키보드로 고를 수 없어서, 지도에 이름이 붙는 밝은 별을 버튼으로도 둔다
  const bright = [...bodies, ...stars.filter((s) => s.mag < 1.0).sort((a, b) => a.mag - b.mag)]

  return (
    <>
      <StarMap ref={map} stars={stars} bg={bg} bodies={bodies} highlight={highlight} fast={fast} drift={drift} onPick={open} onTick={setClock} />

      <div className="ui" inert={!!detail}>
        <header className="hud-top">
          <div className="brand">Star Trace<small>실제 별을 따라가며 묻는 별지도</small></div>
          <div className="clock">
            <div><b>{clock ? new Date(clock.ms).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'medium' }) : '--'}</b></div>
            <div>서울 하늘 <b>{clock ? skyState(clock.sunAlt) : '--'}</b>{clock && ` · 해 고도 ${Math.round(clock.sunAlt).toString().replace('-', '−')}°`}</div>
            <div>서울 항성시 <b>{clock ? hm((((clock.gmstHours + SEOUL.lon / 15) % 24) + 24) % 24) : '--'}</b></div>
            <div className="hud-btns">
              <button className="pill" type="button" aria-pressed={drift} onClick={() => setDrift(!drift)}>자동 이동</button>
              <button className="pill" type="button" aria-pressed={fast} onClick={() => setFast(!fast)}>빨리 감기 1초=1시간</button>
            </div>
          </div>
        </header>
        {problem && <p className="banner" role="alert">{problem}</p>}
        <nav className="quick" aria-label="밝은 별과 태양계 천체 바로 가기">
          <ul>
            {bright.map((s) => (
              <li key={s.id}><button type="button" className="chip" onClick={() => open(s.id)}>{s.name_ko}{s.mag != null && <span className="m">{fmtMag(s.mag)}</span>}</button></li>
            ))}
          </ul>
        </nav>
        <AskBar onSearch={search} results={results} busy={searching} message={message} onOpen={open} />
        <p className="legend">어두운 땅은 서울의 지평선 아래, 지구의 금색 점은 서울이에요 · 지구 사진: NASA Visible Earth · 별 자료: HYG Database (CC BY-SA 4.0) · 행성 자료: NASA Exoplanet Archive</p>
      </div>

      <div ref={flash} className="flash" aria-hidden="true" />
      {detail && <StarDetail star={detail} thread={threads[detail.id] || []} asking={asking} onAsk={ask} guide={guides[detail.id]} onGuide={openGuide} onBack={close} onOpen={open} />}
    </>
  )
}
