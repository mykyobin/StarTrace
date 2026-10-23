import chromadb
from langchain_chroma import Chroma

from app.config import ROOT
from app.llm import embedder, log_embedding

META = "star_meta"
DOCS = "star_docs"


def collection(name):
    return Chroma(collection_name=name, embedding_function=embedder(),
                  persist_directory=str(ROOT / "chroma"))


def upsert_meta(items):
    """items: [(별 id, 색인 텍스트, 메타데이터)]. 청크 ID를 별 id로 고정해서 다시 실행해도 덮어쓰기만 일어난다."""
    col = collection(META)
    texts = [t for _, t, _ in items]
    log_embedding(texts, "index star_meta")
    col.add_texts(texts=texts, metadatas=[m for _, _, m in items], ids=[i for i, _, _ in items])
    return count(META)


def upsert_docs(chunks, batch=200, prune=True):
    """chunks: [(청크 ID, 텍스트, 메타데이터)]. 같은 ID는 덮어쓴다."""
    col = collection(DOCS)
    for i in range(0, len(chunks), batch):
        part = chunks[i:i + batch]
        texts = [t for _, t, _ in part]
        log_embedding(texts, "index star_docs")
        col.add_texts(texts=texts, metadatas=[m for _, _, m in part], ids=[c for c, _, _ in part])
    # 설정을 바꿔 다시 색인하면 새 규칙에서 사라진 청크가 남을 수 있어서 지운다
    keep = {c for c, _, _ in chunks}
    stale = [i for i in col._collection.get()["ids"] if i not in keep] if prune else []
    if stale:
        col._collection.delete(ids=stale)
    return count(DOCS)


def count(name):
    # 임베딩 없이 건수만 세므로 키가 없어도 동작한다 (색인 없음/키 누락 안내용)
    try:
        return chromadb.PersistentClient(path=str(ROOT / "chroma")).get_collection(name).count()
    except Exception:
        return 0
