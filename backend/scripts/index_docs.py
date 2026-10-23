"""data/docs/*.json 을 청킹해서 star_docs 컬렉션에 색인한다. 청크 크기와 중복은 settings.yaml 에서 바꾼다.

--count 만 주면 색인하지 않고 청크 수만 센다 (설정을 바꿔 청크 수가 달라지는지 볼 때).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import settings  # noqa: E402
from app.data_prep.bodies import load_items  # noqa: E402
from app.rag.collect import load  # noqa: E402
from app.vectorstore.chunks import make_chunks  # noqa: E402
from app.vectorstore.store import upsert_docs  # noqa: E402


def main():
    size, overlap = settings["chunk"]["size"], settings["chunk"]["overlap"]
    chunks = []
    for s in load_items():
        rec = load(s["id"])
        if rec:
            chunks += make_chunks(rec, s, size, overlap, settings["chunk"]["min_chars"])
    print(f"청크 크기 {size} / 중복 {overlap} -> 청크 {len(chunks)}개")
    if "--count" in sys.argv:
        return
    print(f"색인된 청크 {upsert_docs(chunks)}개")


if __name__ == "__main__":
    main()
