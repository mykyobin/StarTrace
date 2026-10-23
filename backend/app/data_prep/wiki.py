import re
import time
from urllib.parse import quote

import requests

from app.config import settings

_last = 0.0


def api_get(params, lang="ko"):
    """위키백과 API 호출. 호출 간격과 재시도는 settings.yaml 값을 따른다."""
    global _last
    cfg = settings["wiki"]
    if not cfg["user_agent"]:
        raise RuntimeError("settings.yaml 의 wiki.user_agent 에 연락처를 넣어 주세요")
    url = f"https://{lang}.wikipedia.org/w/api.php"
    for attempt in range(cfg["retries"]):
        wait = cfg["min_interval_sec"] - (time.time() - _last)
        if wait > 0:
            time.sleep(wait)
        _last = time.time()
        try:
            r = requests.get(
                url,
                params={**params, "format": "json", "formatversion": 2},
                headers={"User-Agent": cfg["user_agent"]},
                timeout=20,
            )
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(2 ** attempt * 2)
                continue
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            if attempt == cfg["retries"] - 1:
                raise
            time.sleep(2 ** attempt * 2)
    raise RuntimeError("위키백과 호출에 실패했습니다")


def search(term, limit):
    """검색어 -> [{pageid, title, snippet}]"""
    d = api_get({"action": "query", "list": "search", "srsearch": term, "srlimit": limit, "srprop": "snippet"})
    out = []
    for r in d["query"]["search"]:
        snippet = re.sub(r"<[^>]+>|&quot;|&amp;", "", r["snippet"])
        out.append({"pageid": r["pageid"], "title": r["title"], "snippet": snippet})
    return out


# 본문 뒤쪽의 참고 구간은 근거로 쓸 내용이 없어서 잘라낸다
_TAIL = re.compile(r"\n==\s*(각주|외부 링크|같이 보기|참고 문헌|참고 자료|출처)\s*==.*", re.S)


def fetch(title, max_chars):
    """제목 -> {pageid, title, url, text}. 문서가 없으면 None."""
    d = api_get({"action": "query", "prop": "extracts", "explaintext": 1, "exsectionformat": "wiki",
                 "redirects": 1, "titles": title})
    p = d["query"]["pages"][0]
    if p.get("missing") or not p.get("extract"):
        return None
    text = _TAIL.sub("", p["extract"]).strip()[:max_chars]
    url = "https://ko.wikipedia.org/wiki/" + quote(p["title"].replace(" ", "_"))
    return {"pageid": p["pageid"], "title": p["title"], "url": url, "text": text}
