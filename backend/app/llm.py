import json
import time

from langchain_anthropic import ChatAnthropic
from langchain_openai import OpenAIEmbeddings

from app.config import ROOT, api_key, settings

LOG = ROOT / "data/cache/usage.jsonl"


class NoKeyError(RuntimeError):
    pass


def _key(name):
    k = api_key(name)
    if not k:
        raise NoKeyError(f"{name} 가 비어 있습니다")
    return k


def _log(model, tin, tout, what):
    price = settings["prices"][model]   # 100만 토큰당 달러
    usd = (tin * price["input"] + tout * price["output"]) / 1_000_000
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps({"t": int(time.time()), "model": model, "what": what,
                            "in": tin, "out": tout, "usd": round(usd, 6)}) + "\n")
    return usd


def spent():
    """지금까지 쓴 API 비용 추정치 합계 (달러)."""
    if not LOG.exists():
        return 0.0
    return round(sum(json.loads(line)["usd"] for line in LOG.read_text(encoding="utf-8").splitlines() if line), 4)


def ask(role, prompt, what):
    """role: 'fast' 또는 'answer'. 응답 글자만 돌려주고 사용량은 로그에 남긴다."""
    cfg = settings["llm"]
    model = cfg["fast_model"] if role == "fast" else cfg["answer_model"]
    chat = ChatAnthropic(model=model, api_key=_key("ANTHROPIC_API_KEY"),
                         max_tokens=cfg["max_output_tokens"], timeout=60,
                         # 기본값이 추론 켜짐이라 출력 한도를 추론이 먹고 답이 잘린다. 끈다 (끄는 값은 모델마다 다르다)
                         thinking={"type": cfg.get("thinking_off", {}).get(model, "disabled")})
    msg = chat.invoke(prompt)
    u = msg.usage_metadata or {}
    _log(model, u.get("input_tokens", 0), u.get("output_tokens", 0), what)
    return msg.text


def embedder():
    cfg = settings["embedding"]
    return OpenAIEmbeddings(model=cfg["model"], api_key=_key("OPENAI_API_KEY"))


def log_embedding(texts, what):
    # 응답에 토큰 수가 안 와서 한국어 기준으로 글자 수의 절반을 토큰으로 잡는다 (추정)
    _log(settings["embedding"]["model"], sum(len(t) for t in texts) // 2, 0, what)
