"""질문 하나를 처리하는 전체 흐름. 진행 단계를 (이벤트, 내용) 으로 하나씩 내보낸다."""
from app.config import settings
from app.data_prep.bodies import load_items
from app.rag import graph
from app.rag.collect import collect
from app.vectorstore.chunks import make_chunks
from app.vectorstore.store import upsert_docs


def stream(star_id, question, mode=None, top_k=None):
    star = next((s for s in load_items() if s["id"] == star_id), None)
    if star is None:
        raise KeyError(star_id)
    yield "progress", {"step": "terms", "text": "검색어를 고르는 중"}
    rec, added = collect(star, question)
    if added:
        titles = ", ".join(d["title"] for d in added)
        yield "progress", {"step": "collected", "text": f"새 문서를 수집했어요: {titles}"}
        c = settings["chunk"]
        upsert_docs(make_chunks({"docs": added}, star, c["size"], c["overlap"], c["min_chars"]), prune=False)
    yield "progress", {"step": "answer", "text": "근거를 찾고 답을 쓰는 중"}
    yield "result", graph.answer(star_id, question, mode, top_k)
