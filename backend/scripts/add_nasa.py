"""행성을 가진 별에 NASA 문서를 붙이고 star_docs 에 색인한다. 다시 실행해도 문서가 중복되지 않는다."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import settings  # noqa: E402
from app.data_prep import nasa  # noqa: E402
from app.data_prep.stars import load_stars  # noqa: E402
from app.rag.collect import DOCS, load  # noqa: E402
from app.vectorstore.chunks import make_chunks  # noqa: E402
from app.vectorstore.store import upsert_docs  # noqa: E402


def main():
    planets = json.loads(nasa.RAW.read_text(encoding="utf-8")) if nasa.RAW.exists() else nasa.download()
    stars = {s["id"]: s for s in load_stars()}
    c = settings["chunk"]
    chunks = []
    for sid, ps in nasa.match(list(stars.values()), planets).items():
        rec = load(sid)
        doc = nasa.build_doc(stars[sid], ps)
        rec["docs"] = [d for d in rec["docs"] if d["source_type"] != nasa.SOURCE_TYPE] + [doc]
        (DOCS / f"{sid}.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
        chunks += make_chunks({"docs": [doc]}, stars[sid], c["size"], c["overlap"], c["min_chars"])
        print(f"{sid}: 행성 {len(ps)}개")
    print(f"NASA 청크 {len(chunks)}개 -> star_docs {upsert_docs(chunks, prune=False)}개")


if __name__ == "__main__":
    main()
