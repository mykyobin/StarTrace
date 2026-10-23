import { useCallback, useEffect, useRef, useState } from 'react'
import ChatPanel from '../components/ChatPanel'
import GuidePanel from '../components/GuidePanel'
import { bvColor } from '../scene/astro'
import BodyGlobe from '../scene/BodyGlobe'
import { fmtDec, fmtMag, fmtRA } from '../format'

// 사진이 없는 별에 쓰는 대체 그림. 등급과 색으로 그린다
function PlaceholderPhoto({ star }) {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    const W = (c.width = c.height = Math.round(c.clientWidth * 2) || 800)
    const g = c.getContext('2d')
    g.fillStyle = '#000'
    g.fillRect(0, 0, W, W)
    const [r, gg, b] = bvColor(star.bv)
    const r0 = W * (0.05 + Math.max(0, 2 - star.mag) * 0.025)
    const grd = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, r0 * 5)
    grd.addColorStop(0, '#fff')
    grd.addColorStop(0.12, '#fff')
    grd.addColorStop(0.3, `rgb(${r},${gg},${b})`)
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, W, W)
  }, [star])
  return <canvas ref={ref} className="photo-canvas" />
}

// DSS 필름은 밝은 별에서 포화돼 중심이 하얀 다각형 덩어리로 뭉개진다. 가운데에서 이어진 포화 영역을 찾아
// 그 면적과 같은 크기의 부드러운 별빛으로 다시 그리고, 별의 색(B-V)을 후광에 살짝 입힌다. 둘레의 실제 별밭과 회절 무늬는 그대로다.
function softenCore(d, w, h, color) {
  const SAT = 250
  const v = (x, y) => d.data[(y * w + x) * 4]
  const start = (h >> 1) * w + (w >> 1)
  if (d.data[start * 4] < SAT) return
  const seen = new Uint8Array(w * h)
  const stack = [start]
  seen[start] = 1
  let n = 0, sx = 0, sy = 0
  while (stack.length) {
    const p = stack.pop()
    const x = p % w, y = (p / w) | 0
    n++; sx += x; sy += y
    for (const q of [p - 1, p + 1, p - w, p + w]) {
      if (q < 0 || q >= w * h || seen[q] || (Math.abs((q % w) - x) > 1)) continue
      if (d.data[q * 4] >= SAT) { seen[q] = 1; stack.push(q) }
    }
  }
  if (n < 12) return
  const cx = sx / n, cy = sy / n, R = Math.sqrt(n / Math.PI) * 1.15
  const lo = (c, r) => Math.max(0, Math.floor(c - r)), hi = (c, r, m) => Math.min(m - 1, Math.ceil(c + r))
  let ring = 0, rc = 0
  for (let y = lo(cy, R * 1.4); y <= hi(cy, R * 1.4, h); y++) {
    for (let x = lo(cx, R * 1.4); x <= hi(cx, R * 1.4, w); x++) {
      const t = Math.hypot(x - cx, y - cy) / R
      if (t > 1.05 && t < 1.4) { ring += v(x, y); rc++ }
    }
  }
  const edge = rc ? ring / rc : 150
  const m = Math.max(...color)
  const col = color.map((c) => c / m)
  const reach = R * 3.5
  for (let y = lo(cy, reach); y <= hi(cy, reach, h); y++) {
    for (let x = lo(cx, reach); x <= hi(cx, reach, w); x++) {
      const dist = Math.hypot(x - cx, y - cy)
      if (dist > reach) continue
      let g = v(x, y)
      if (dist < R) {
        const t = dist / R, k = (t ** 1.4) * (3 - 2 * (t ** 1.4)) // 중심 255 에서 가장자리 밝기로 부드럽게
        g = 255 * (1 - k) + edge * k
      }
      const tint = 0.55 * (1 - (g / 255) ** 4) * Math.exp(-((dist / reach) ** 2))
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) d.data[i + c] = g * (1 - tint + tint * col[c])
    }
  }
}

// DSS 필름은 배경이 회색이라 그대로 두면 하늘이 뿌옇다. 중앙값을 검은 점으로 잡아 늘려서
// 어두운 하늘 위에 별이 도드라지게 한다. 원본 사진은 그대로 서버에 있다.
function SkyPhoto({ star, survey, onFail }) {
  const ref = useRef(null)
  useEffect(() => {
    let alive = true
    const img = new Image()
    img.onerror = () => alive && onFail()
    img.onload = () => {
      if (!alive) return
      const c = ref.current
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height)
      const hist = new Uint32Array(256)
      for (let i = 0; i < d.data.length; i += 4) hist[d.data[i]]++
      let acc = 0, black = 0
      const half = (d.data.length / 4) / 2
      while (black < 255 && acc + hist[black] < half) acc += hist[black++]
      const span = Math.max(1, 255 - black)
      for (let i = 0; i < d.data.length; i += 4) {
        const v = Math.round(255 * Math.pow(Math.max(0, d.data[i] - black) / span, 0.8))
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v
      }
      softenCore(d, c.width, c.height, bvColor(star.bv))
      g.putImageData(d, 0, 0)
    }
    img.src = `/api/stars/${star.id}/photo?survey=${survey || 'dss'}`
    return () => { alive = false }
  }, [star.id, star.bv, survey, onFail])
  return <canvas ref={ref} className="photo-canvas" role="img" aria-label={`${star.name_ko} 주변 하늘 사진`} />
}

// 행성·달·태양: 실제 NASA 이미지를 입힌 3D 천체. 출처와 가공 여부를 사진 아래에 적는다
function BodyFigure({ star, onOpen }) {
  const img = star.image
  return (
    <figure className="photo">
      <BodyGlobe body={star} onMoon={onOpen} />
      <figcaption>
        {img ? (
          <>
            이미지: {img.credit} ·{' '}
            <a href={img.page} target="_blank" rel="noopener noreferrer" className="src-inline">원본 페이지</a>. {img.note}
            {img.status === 'pending-source' && ' 공식 표면 지도를 받기 전이라 색으로 그린 표면이에요.'}
          </>
        ) : '이미지 준비 중이라 색으로 그린 표면이에요.'}
        {' '}자전축 기울기와 밝은 쪽은 지금 서울에서 보이는 실제 모습이에요.
        {star.kind === 'sun' && ' 원판 둘레에 타오르는 불꽃은 분위기를 살리려고 그린 그림이에요(실제 홍염·코로나는 이렇게 밝게 보이지 않아요).'}
      </figcaption>
    </figure>
  )
}

// 위성: 공식 지도가 있으면 행성처럼 3D 구로, 둥글지 않은 작은 위성은 공식 사진으로 보여준다.
// '행성 둘레 배치' 탭은 모행성과 위성들의 지금 배치 안에서 이 위성을 짚어 준다. 이미지가 없는 위성은 배치만 있다
function MoonFigure({ star, onOpen }) {
  const img = star.image
  const own = img?.kind === 'photo' ? 'photo' : img ? 'globe' : null
  const [tab, setTab] = useState(own || 'system')
  const [photoFailed, setPhotoFailed] = useState(false)
  const view = tab === 'photo' && photoFailed ? 'system' : tab
  return (
    <div className="photo">
      {own && (
        <div className="globe-tabs" role="group" aria-label="위성 모습 보기">
          <button type="button" className="pill" aria-pressed={view === own} onClick={() => setTab(own)}>{own === 'photo' ? '사진' : '3D 모습'}</button>
          <button type="button" className="pill" aria-pressed={view === 'system'} onClick={() => setTab('system')}>행성 둘레 배치</button>
        </div>
      )}
      {view === 'system' ? (
        <figure className="photo">
          <BodyGlobe body={star.planet_body} focus={star.code} onMoon={onOpen} />
          <figcaption>
            {star.planet_body.name_ko} 둘레 위성들의 지금 배치예요. 금색 고리가 {star.name_ko}이고, 다른 위성을 누르면 그 위성으로 넘어가요.
            {' '}위성 위치: JPL 궤도 자료와 Horizons 위치 계산.
            {!own && ' 이 위성은 공식 전체 지도나 사진을 아직 넣지 않았어요.'}
          </figcaption>
        </figure>
      ) : (
        <figure className="photo">
          {view === 'photo'
            ? <img className="photo-img" src={`/nasa/${star.id}_photo.jpg`} alt={`${star.name_ko} 사진`} onError={() => setPhotoFailed(true)} />
            : <BodyGlobe body={star} />}
          <figcaption>
            이미지: {img.credit} ·{' '}
            <a href={img.page} target="_blank" rel="noopener noreferrer" className="src-inline">원본 페이지</a>. {img.note}
            {view === 'globe' && ' 늘 같은 면이 행성을 향해 있고, 지금 지구에서 보이는 방향과 밝은 쪽이에요.'}
          </figcaption>
        </figure>
      )}
    </div>
  )
}

// 별: 관측된 색·온도로 그린 3D 표면과, NASA 서베이로 찍은 실제 하늘 사진을 탭으로 바꿔 본다
function StarFigure({ star }) {
  const [tab, setTab] = useState('sky')
  const photos = star.photos || []
  const [survey, setSurvey] = useState(photos[0]?.survey || '2mass')
  return (
    <div className="photo">
      <div className="globe-tabs" role="group" aria-label="별 모습 보기">
        <button type="button" className="pill" aria-pressed={tab === 'sky'} onClick={() => setTab('sky')}>실제 하늘 사진</button>
        <button type="button" className="pill" aria-pressed={tab === 'sim'} onClick={() => setTab('sim')}>표면 모습(그림)</button>
        {tab === 'sky' && photos.length > 1 && photos.map((p) => (
          <button key={p.survey} type="button" className="pill" aria-pressed={survey === p.survey} onClick={() => setSurvey(p.survey)}>{p.label}</button>
        ))}
      </div>
      {tab === 'sky' ? <Photo star={star} survey={survey} /> : (
        <figure className="photo">
          <BodyGlobe star={star} />
          <figcaption>관측된 색지수와 표면 온도로 그린 모습이에요. 별의 표면은 가장 큰 망원경으로도 점으로 찍혀서 실제 사진이 아니에요.</figcaption>
        </figure>
      )}
    </div>
  )
}

function Photo({ star, survey }) {
  // 어느 별의 사진이 실패했는지 기억해서, 별을 바꾸면 다시 사진을 시도한다
  const [failedId, setFailedId] = useState(null)
  const failed = failedId === star.id
  const fail = useCallback(() => setFailedId(star.id), [star.id]) // 매 렌더마다 새 함수면 사진을 계속 다시 받는다
  return (
    <figure className="photo">
      {failed
        ? <PlaceholderPhoto star={star} />
        : <SkyPhoto star={star} survey={survey} onFail={fail} />}
      <figcaption>
        {failed
          ? '이 별은 받아 둔 사진이 없어서 등급과 색으로 그린 그림을 보여줘요.'
          : survey === 'dss'
            ? '사진: NASA SkyView를 거친 Digitized Sky Survey (가로 1°). 저작권은 원본 사진판에 따라 AAO, UK SERC/PPARC, Caltech, AURA 등이 가져요. 밝은 별은 필름이 포화돼 번져 보여요.'
            : survey === 'wise'
              ? '사진: NASA WISE 위성의 중적외선(3.4μm) 하늘 사진을 NASA SkyView로 받았어요. 색은 눈에 보이는 색이 아니에요.'
              : '사진: 2MASS 근적외선(J·H·K) 하늘 사진을 NASA SkyView로 받아 합쳤어요(UMass와 IPAC/Caltech, NASA·NSF 지원). 색은 눈에 보이는 색이 아니에요.'}
      </figcaption>
    </figure>
  )
}

export default function StarDetail({ star, thread, asking, onAsk, guide, onGuide, onBack, onOpen }) {
  const title = useRef(null)
  useEffect(() => { // 키보드·스크린리더가 새 화면에서 시작하게. 위성↔행성으로 넘어가면 맨 위부터 보이게
    title.current?.focus({ preventScroll: true })
    title.current?.closest('.detail')?.scrollTo(0, 0)
  }, [star.id])
  const sat = star.kind === 'satellite'
  const [more, setMore] = useState(false)
  const facts = star.facts || [
    ['별자리', star.constellation],
    ['겉보기 등급', fmtMag(star.mag)],
    // "약 497.95 광년"은 실제보다 정밀해 보인다. 10광년 넘으면 정수로 둔다
    ['거리', star.dist_ly != null ? `약 ${star.dist_ly.toLocaleString('ko-KR', { maximumFractionDigits: star.dist_ly < 10 ? 1 : 0 })} 광년` : '기록 없음'],
    ['분광형', star.spectral || '기록 없음'],
    ['색지수 B−V', star.bv != null ? star.bv.toFixed(2) : '기록 없음'],
    ['적경', fmtRA(star.ra_hours)],
    ['적위', fmtDec(star.dec_deg)],
    ['서울에서', star.seoul],
    ['잘 보이는 달', `${star.best_month}월 무렵 (저녁 9시 기준)`],
  ]
  return (
    <section className="detail" aria-labelledby="dName">
      <div className="d-wrap">
        <div className="d-nav">
          <button className="pill" type="button" onClick={onBack}>← 별지도로</button>
          {sat && <button className="pill" type="button" onClick={() => onOpen(star.planet)}>← {star.planet_body.name_ko}</button>}
        </div>
        <div className="d-grid">
          {sat ? <MoonFigure key={star.id} star={star} onOpen={onOpen} /> : star.kind ? <BodyFigure star={star} onOpen={onOpen} /> : <StarFigure star={star} />}
          <div className="info">
            <p className="eyebrow">{star.constellation} · {star.name_en}</p>
            <h1 id="dName" ref={title} tabIndex={-1}>{star.name_ko}</h1>
            <dl className="facts">
              {facts.map(([k, v]) => (<div key={k} className="fact"><dt>{k}</dt><dd>{v}</dd></div>))}
            </dl>
            {star.intro && (
              <p className={`desc${more ? '' : ' clamp'}`}>
                {star.intro.text}
                <a className="src" href={star.intro.url} target="_blank" rel="noopener noreferrer">
                  {star.intro.lang === 'en' ? '영어 위키백과' : '위키백과'}: {star.intro.title}
                </a>
              </p>
            )}
            {star.intro && star.intro.text.length > 160 && (
              <button type="button" className="more" aria-expanded={more} onClick={() => setMore(!more)}>{more ? '접기' : '더 보기'}</button>
            )}
          </div>
          {sat ? (
            <p className="note">위성은 질문·관측 가이드 자료에 아직 없어요. 위성 이야기는 {star.planet_body.name_ko} 화면의 질문창에서 물어보세요.</p>
          ) : (
            <>
              <GuidePanel guide={guide?.result} loading={guide?.loading} error={guide?.error} onOpen={() => onGuide(star.id)} />
              <ChatPanel thread={thread} asking={asking} onAsk={(q) => onAsk(star.id, q)} body={!!star.kind} />
            </>
          )}
        </div>
      </div>
    </section>
  )
}
