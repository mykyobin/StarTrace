// 서버가 돌려주는 안내 문구(detail)를 그대로 보여주려고 오류에 담아 던진다
async function call(path, options) {
  let res
  try {
    res = await fetch(path, options)
  } catch {
    throw new Error('서버에 연결할 수 없어요. backend 를 실행했는지 확인해 주세요.')
  }
  if (!res.ok) {
    let detail = '요청을 처리하지 못했어요.'
    try { detail = (await res.json()).detail || detail } catch { /* 본문이 JSON 이 아니면 기본 문구 */ }
    throw new Error(detail)
  }
  return res.json()
}

const post = (path, body) => call(path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const getStatus = () => call('/api/status')
export const getSky = () => call('/api/sky')
export const getStars = () => call('/api/stars')
export const getBodies = () => call('/api/bodies')
export const getStar = (id) => call(`/api/stars/${id}`)
export const getGuide = (id) => post('/api/guide', { star_id: id })
export const explore = (query) => post('/api/explore', { query })

const BLANK_LINE = String.fromCharCode(10, 10) // SSE 는 빈 줄로 이벤트를 구분한다

// 채팅은 SSE 로 온다. 진행 단계(progress)와 결과(result), 안내(error)를 하나씩 onEvent 로 넘긴다
export async function streamChat(starId, question, onEvent) {
  let res
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ star_id: starId, question }),
    })
  } catch {
    throw new Error('서버에 연결할 수 없어요. backend 를 실행했는지 확인해 주세요.')
  }
  if (!res.ok) {
    let detail = '요청을 처리하지 못했어요.'
    try { detail = (await res.json()).detail || detail } catch { /* 기본 문구 */ }
    throw new Error(detail)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf(BLANK_LINE)) >= 0) {
      const block = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const event = /^event: (.+)$/m.exec(block)?.[1]
      const data = /^data: (.+)$/m.exec(block)?.[1]
      if (event && data) onEvent(event, JSON.parse(data))
    }
  }
}
