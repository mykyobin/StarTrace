"""stars.json 의 별 전부에 대해 위키 문서를 수집해 data/docs/*.json 으로 저장한다.

중간에 끊겨도 다시 실행하면 이미 수집한 별은 건너뛴다.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import llm  # noqa: E402
from app.data_prep.bodies import load_items  # noqa: E402
from app.rag.collect import collect, load  # noqa: E402


def main():
    only = sys.argv[1:]
    stars = [s for s in load_items() if not only or s["id"] in only]
    t0 = time.time()
    for i, s in enumerate(stars, 1):
        done = load(s["id"]) is not None
        try:
            rec, _ = collect(s)
        except Exception as e:  # 한 별이 실패해도 나머지는 계속 간다
            print(f"[{i}/{len(stars)}] {s['id']} 실패: {type(e).__name__}", flush=True)
            continue
        state = "건너뜀" if done else f"문서 {len(rec['docs'])}개"
        print(f"[{i}/{len(stars)}] {s['id']} {state} (누적 ${llm.spent()}, {int(time.time() - t0)}초)", flush=True)


if __name__ == "__main__":
    main()
