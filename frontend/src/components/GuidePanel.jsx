import { AnswerText, Citations } from './ChatPanel'

const STATUS_TEXT = {
  rises: (o) => `서울에서 뜨고 지는 ${o.source === 'ephemeris' ? '천체' : '별'}예요. 가장 높이 올라올 때 고도 약 ${Math.round(o.max_alt)}°입니다.`,
  circumpolar: (o) => `서울에서는 지평선 아래로 지지 않는 ${o.source === 'ephemeris' ? '천체' : '주극성'}이에요. 가장 높을 때 고도 약 ${Math.round(o.max_alt)}°입니다.`,
  never: () => '서울에서는 지평선 위로 떠오르지 않아서 볼 수 없어요. 더 남쪽 지역에서 볼 수 있습니다.',
}

const alt = (p) => (p.alt < 0 ? '지평선 아래' : `고도 ${Math.round(p.alt)}°`)

function Event({ name, p }) {
  return (
    <div className="g-event">
      <dt>{name}</dt>
      <dd><b>{p.label}</b> · {p.dir}쪽 ({p.az}°){name === '남중' && <> · {alt(p)}</>}</dd>
    </div>
  )
}

// 도메인 특화 기능: 관측 가이드. 계산한 부분과 위키 근거로 쓴 부분을 나눠서 보여준다
export default function GuidePanel({ guide, loading, error, onOpen }) {
  const o = guide?.observe
  return (
    <section className="guide" aria-labelledby="guideTitle">
      <h2 id="guideTitle">관측 가이드</h2>
      {!guide && (
        <>
          <p className="notice">서울에서 언제 어느 쪽 하늘에 뜨는지 계산하고, 하늘에서 찾는 요령을 문서 근거로 알려줘요.</p>
          <button type="button" className="go" disabled={loading} onClick={onOpen}>
            {loading ? '계산하는 중…' : '관측 가이드 보기'}
          </button>
          {error && <p className="error">{error}</p>}
        </>
      )}
      {o && (
        <>
          <p className="g-status">{STATUS_TEXT[o.status](o)}</p>
          <dl className="g-events">
            {o.rise && <Event name="뜸" p={o.rise} />}
            <Event name="남중" p={o.transit} />
            {o.set && <Event name="짐" p={o.set} />}
          </dl>
          <ul className="g-night" aria-label="오늘 밤 고도">
            {o.night.map((p) => (
              <li key={p.label} className={p.alt > 5 ? 'up' : ''}>
                <span>{p.label}</span>
                <b>{alt(p)}</b>
                {p.alt > 0 && <span>{p.dir}쪽</span>}
              </li>
            ))}
          </ul>
          <p className="no-cite">
            계산 기준: {o.source === 'ephemeris' ? '오늘 날짜로 계산한 천체 위치(행성은 날마다 움직여요)' : '별 목록의 좌표'}, 서울(37.57°N, 126.98°E), 대기 굴절 반영.
            낮에는 하늘이 밝아 별이 보이지 않고, 날씨와 건물·산은 고려하지 않았어요.
          </p>
          <h3>하늘에서 찾는 요령</h3>
          {guide.tips && (
            <>
              <AnswerText text={guide.tips.answer} />
              <Citations list={guide.tips.citations} none={guide.tips.no_citation} />
            </>
          )}
          {guide.tips_error && <p className="error">{guide.tips_error}</p>}
        </>
      )}
    </section>
  )
}
