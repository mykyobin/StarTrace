import { useEffect, useRef, useState } from 'react'

const SUGGEST = ['어떤 별이야?', '왜 이런 색이야?', '서울에서 언제 볼 수 있어?', '이 별의 가장 큰 특징은?']
const SUGGEST_BODY = ['어떤 천체야?', '왜 이런 색으로 보여?', '서울에서 언제 볼 수 있어?', '이 천체의 가장 큰 특징은?']
const CITE = /(\[근거\s*\d+\])/
// 출처 종류마다 배지 색을 달리해서 근거가 어디서 왔는지 한눈에 보이게 한다
const BADGE = { '위키백과': 'wiki', 'NASA Exoplanet Archive': 'nasa', '항목 메타데이터': 'meta' }

// 본문의 [근거 N] 표기를 눈에 띄게 한다
export function AnswerText({ text }) {
  return (
    <p className="answer">
      {text.split(CITE).map((part, i) => (CITE.test(part) ? <span key={i} className="cite">{part}</span> : part))}
    </p>
  )
}

// 답변에 실제로 인용된 근거만 보여주고, 출처 종류를 배지로 구분한다
export function Citations({ list, none }) {
  if (none) return <p className="no-cite">이 답변에는 인용된 근거 문서가 없어요.</p>
  return (
    <ul className="cites" aria-label="답변에 사용한 근거">
      {list.map((c) => (
        <li key={c.n}>
          <span className="cite">[근거 {c.n}]</span>
          <span className={`badge ${BADGE[c.type] || 'meta'}`}>{c.type}</span>
          {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</a> : c.title}
        </li>
      ))}
    </ul>
  )
}

function Pending({ steps }) {
  return (
    <div className="pending" role="status">
      <ul>
        {steps.map((s, i) => <li key={i} className={i === steps.length - 1 ? 'now' : ''}>{s}</li>)}
      </ul>
    </div>
  )
}

export default function ChatPanel({ thread, asking, onAsk, body = false }) {
  const [text, setText] = useState('')
  const box = useRef(null)

  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }) }, [thread])

  const submit = (e) => {
    e.preventDefault()
    if (!text.trim() || asking) return
    onAsk(text.trim())
    setText('')
  }

  return (
    <div className="chat">
      <h2>{body ? '이 천체에 대해 묻기' : '이 별에 대해 묻기'}</h2>
      {!thread.length && (
        <div className="sugg">
          {(body ? SUGGEST_BODY : SUGGEST).map((q) => (
            <button key={q} type="button" className="chip" disabled={asking} onClick={() => onAsk(q)}>{q}</button>
          ))}
        </div>
      )}
      {thread.length > 0 && (
        <div className="log" ref={box}>
          {thread.map((m) => (m.role === 'user'
            ? <div key={m.id} className="q">{m.text}</div>
            : (
              <div key={m.id} className="a" aria-live="polite">
                {m.status === 'pending' && <Pending steps={m.steps} />}
                {m.status === 'error' && <p className="error">{m.error}</p>}
                {m.status === 'done' && (
                  <>
                    <AnswerText text={m.text} />
                    <Citations list={m.citations} none={m.noCitation} />
                  </>
                )}
              </div>
            )))}
        </div>
      )}
      <form className="field" onSubmit={submit}>
        <label className="sr" htmlFor="chatInput">질문</label>
        <input id="chatInput" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off"
          placeholder="궁금한 점을 물어보세요" maxLength={500} />
        <button className="go" disabled={asking}>{asking ? '답하는 중…' : '보내기'}</button>
      </form>
    </div>
  )
}
