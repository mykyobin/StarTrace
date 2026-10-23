import { useState } from 'react'
import { fmtMag } from '../format'

// 시안 1 가운데의 질문창. 자연어 조건을 보내고, 맞는 별을 카드로 보여준다.
export default function AskBar({ onSearch, results, busy, message, onOpen }) {
  const [text, setText] = useState('')

  const submit = (e) => {
    e.preventDefault()
    if (text.trim() && !busy) onSearch(text.trim())
  }

  return (
    <section className="ask" aria-label="별 찾기">
      <form className="field" onSubmit={submit}>
        <label className="sr" htmlFor="askInput">찾고 싶은 별의 조건</label>
        <input id="askInput" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off"
          placeholder="예: 오리온자리의 붉은 초거성, 맨눈으로 보이는 행성" />
        <button className="go" disabled={busy}>{busy ? '찾는 중…' : '찾기'}</button>
      </form>
      <div className="results" aria-live="polite">
        {results.map((s) => (
          <button key={s.id} type="button" className="chip" onClick={() => onOpen(s.id)}>
            {s.name_ko}
            <span className="m">{s.constellation} · {fmtMag(s.mag)}등급</span>
          </button>
        ))}
        {message && <p className="notice">{message}</p>}
      </div>
      <p className="hint">별과 행성을 누르거나 조건으로 찾아 보세요 · 스크롤하면 확대돼 이름이 나타나요</p>
    </section>
  )
}
