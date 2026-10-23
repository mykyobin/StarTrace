import re

from app.config import settings
from app.vectorstore.store import DOCS, META, collection

HYG_URL = "https://codeberg.org/astronexus/hyg"
FACTSHEET_URL = "https://nssdc.gsfc.nasa.gov/planetary/factsheet/"


def _norm(text):
    return re.sub(r"\s+", " ", text).strip()


def with_star_name(name, question):
    """'이 별은 ...' 같은 질문에는 별 이름이 없어서 검색이 그 별의 문서를 못 찾는다. 이름을 앞에 붙인다."""
    return question if name in question else f"{name} {question}"


def merge(meta_items, doc_items):
    """두 컬렉션의 결과를 합치고 같은 내용은 한 번만 남긴다. 번호는 합친 순서대로 1부터 붙인다."""
    out, seen = [], set()
    for it in meta_items + doc_items:
        key = _norm(it["text"])
        if key in seen:
            continue
        seen.add(key)
        out.append({**it, "n": len(out) + 1})
    return out


def retrieve(star_id, question, mode=None, top_k=None):
    """선택한 별의 메타 청크는 검색 없이 항상 넣고, 위키 청크는 그 별로 범위를 좁혀 검색한다.

    top_k 는 근거 전체 개수다. 메타 1건을 빼고 나머지를 문서 청크로 채운다.
    """
    cfg = settings["retrieval"]
    mode = mode or cfg["mode"]
    k = top_k or cfg["top_k"]
    got = collection(META)._collection.get(ids=[star_id])
    meta = []
    if got["ids"]:
        m = got["metadatas"][0]
        body = m.get("kind", "star") != "star"
        meta.append({"type": "항목 메타데이터",
                     "title": f"{m['name_ko']} (NASA 행성 자료)" if body else f"{m['name_ko']} (HYG 별 목록)",
                     "url": FACTSHEET_URL if body else HYG_URL, "text": got["documents"][0]})
    flt = {"star_id": star_id}
    col = collection(DOCS)
    if meta:
        question = with_star_name(got["metadatas"][0]["name_ko"], question)
    if mode == "mmr":
        found = col.max_marginal_relevance_search(question, k=k - len(meta), fetch_k=cfg["mmr_fetch_k"], filter=flt)
    else:
        found = col.similarity_search(question, k=k - len(meta), filter=flt)
    docs = [{"type": d.metadata["source_type"], "title": d.metadata["doc_title"], "url": d.metadata["url"],
             "text": d.page_content} for d in found]
    return merge(meta, docs)
