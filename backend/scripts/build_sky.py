"""화면 배경용으로 맨눈으로 보이는 별(5.5등급 이하)을 data/sky.json 에 뽑는다. RAG 와는 상관없는 장식용이다."""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIMIT = 5.5


def main():
    rows = []
    with open(ROOT / "data/raw/hyg_v44.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            mag = float(r["mag"])
            if r["proper"] == "Sol" or mag > LIMIT:
                continue
            ci = round(float(r["ci"]), 2) if r["ci"] else None
            rows.append([round(float(r["ra"]), 4), round(float(r["dec"]), 3), round(mag, 2), ci])
    (ROOT / "data/sky.json").write_text(json.dumps(rows, separators=(",", ":")), encoding="utf-8")
    print(f"배경 별 {len(rows)}개 저장")


if __name__ == "__main__":
    main()
