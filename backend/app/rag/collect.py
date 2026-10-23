import json
import re
from datetime import date

from app import llm
from app.config import ROOT, settings
from app.data_prep import wiki
from app.rag.prompts import P1_TERMS, P2_SELECT

DOCS = ROOT / "data/docs"


def parse_json_array(text):
    """LLM 응답에서 JSON 배열만 꺼낸다. 못 읽으면 빈 배열."""
    m = re.search(r"\[.*?\]", text, re.S)
    if not m:
        return []
    try:
        v = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    return v if isinstance(v, list) else []


def _key(term):
    return re.sub(r"\s+", "", term).lower()


def is_known(term, known):
    """이미 수집한 검색어와 같거나, 띄어쓰기를 무시하고 한쪽이 다른 쪽에 들어 있으면 같은 검색어로 본다.

    LLM 은 같은 질문에도 '시리우스 B' / '시리우스B' / '시리우스 B 백색왜성'처럼 표현을 조금씩 바꿔서,
    글자 그대로만 비교하면 같은 주제를 다시 수집한다.
    """
    k = _key(term)
    return any(k in _key(t) or _key(t) in k for t in known)


def extract_terms(star, question=None):
    cfg = settings["collect"]
    q = f"사용자 질문: {question}" if question else ""
    out = llm.ask("fast", P1_TERMS.format(n=cfg["max_terms"], question_line=q, **_info(star)), "P1 terms")
    terms = [t.strip() for t in parse_json_array(out) if isinstance(t, str) and t.strip()]
    return terms[:cfg["max_terms"]]


def select_candidates(star, cands):
    cfg = settings["collect"]
    lines = "\n".join(f"{i}. {c['title']} - {c['snippet']}" for i, c in enumerate(cands, 1))
    out = llm.ask("fast", P2_SELECT.format(n=cfg["max_docs"] - 1, candidates=lines, **_info(star)), "P2 select")
    picked = {i for i in parse_json_array(out) if isinstance(i, int) and 1 <= i <= len(cands)}
    return picked


def _info(star):
    return {"name_ko": star["name_ko"], "name_en": star["name_en"], "constellation": star["constellation"]}


def load(star_id):
    p = DOCS / f"{star_id}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def collect(star, question=None):
    """별 하나의 위키 문서를 수집해 data/docs/{id}.json 에 저장한다.

    이미 수집한 별이고 새 질문이 없으면 건드리지 않는다. 질문이 있으면 새 검색어만 수집한다.
    돌려주는 값은 (전체 기록, 이번에 새로 넣은 문서 목록).
    """
    cfg = settings["collect"]
    today = str(date.today())
    rec = load(star["id"])
    if rec and question is None:
        return rec, []
    if rec and question in rec.get("questions", []):
        return rec, []   # 같은 질문은 검색어 추출(LLM 호출)도 건너뛴다
    cap = cfg["max_docs_total"] if rec else cfg["max_docs"]
    added = []
    if rec is None:
        rec = {"star_id": star["id"], "terms": [], "candidates": [], "docs": []}
        # 별 자체 문서는 선별이나 길이 제한과 상관없이 항상 넣는다
        own = wiki.fetch(star["wiki_ko"], cfg["max_chars_per_doc"])
        if own:
            rec["docs"].append(_doc(own, star["wiki_ko"], today, own=True))
            added.append(rec["docs"][-1])
    seen = {d["doc_id"] for d in rec["docs"]}
    new_terms = []
    for t in extract_terms(star, question):
        if not is_known(t, rec["terms"] + new_terms):
            new_terms.append(t)
    cands = []
    for t in new_terms:
        for c in wiki.search(t, cfg["search_limit"]):
            if str(c["pageid"]) not in seen and all(c["pageid"] != x["pageid"] for x in cands):
                cands.append({**c, "term": t})
    picked = select_candidates(star, cands) if cands else set()
    for i, c in enumerate(cands, 1):
        c["decision"] = "adopted" if i in picked else "dropped"
        if i in picked and len(rec["docs"]) < cap:
            d = wiki.fetch(c["title"], cfg["max_chars_per_doc"])
            # 리다이렉트로 이미 가진 문서로 되돌아오는 경우도 여기서 걸러진다
            if d and str(d["pageid"]) not in seen:
                seen.add(str(d["pageid"]))
                rec["docs"].append(_doc(d, c["term"], today))
                added.append(rec["docs"][-1])
    rec["terms"] += new_terms
    if question:
        rec["questions"] = rec.get("questions", []) + [question]
    rec["candidates"] += cands
    DOCS.mkdir(parents=True, exist_ok=True)
    (DOCS / f"{star['id']}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
    return rec, added


def _doc(d, term, today, own=False):
    return {"doc_id": str(d["pageid"]), "title": d["title"], "url": d["url"], "source_type": "위키백과",
            "search_term": term, "collected_at": today, "own_article": own, "text": d["text"]}
