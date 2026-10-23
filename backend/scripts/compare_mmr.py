"""같은 질문에 유사도 검색과 MMR 검색의 근거 목록을 나란히 찍는다."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.rag.graph import build  # noqa: E402
from app.rag.retrieve import retrieve  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "data/cache"
CASES = [("betelgeuse", "베텔게우스가 초신성이 되면 어떻게 보일까?"), ("sirius", "시리우스 B는 어떤 별이야?")]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "graph.mmd").write_text(build().get_graph().draw_mermaid(), encoding="utf-8")
    lines = []
    for sid, q in CASES:
        lines.append(f"## [{sid}] {q}")
        for mode in ("similarity", "mmr"):
            lines.append(f"[{mode}]")
            for e in retrieve(sid, q, mode=mode):
                lines.append(f"  {e['n']}. {e['type']} | {e['title']} | {e['text'][:50].replace(chr(10), ' ')}")
        lines.append("")
    (OUT / "mmr_vs_similarity.txt").write_text("\n".join(lines), encoding="utf-8")
    print("저장:", OUT)


if __name__ == "__main__":
    main()
