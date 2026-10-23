"""stars.json 의 별 전부를 star_meta 컬렉션에 색인한다. 몇 번을 돌려도 건수는 같다."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.data_prep import bodies  # noqa: E402
from app.data_prep.stars import build_text, load_stars  # noqa: E402
from app.vectorstore.store import upsert_meta  # noqa: E402


def main():
    stars = load_stars()
    items = [(s["id"], build_text(s), {
        "star_id": s["id"], "name_ko": s["name_ko"], "name_en": s["name_en"],
        "constellation": s["constellation"], "mag": s["mag"], "kind": "star", "source_type": "star_meta",
    }) for s in stars]
    # 태양계 천체도 같은 컬렉션에 넣고 kind 로 구분한다. 청크 ID 는 천체 id 로 고정이라 다시 돌려도 덮어쓰기만 일어난다
    items += [(b["id"], bodies.build_text(b), {
        "star_id": b["id"], "name_ko": b["name_ko"], "name_en": b["name_en"], "constellation": b["constellation"],
        "kind": b["kind"], "source_type": "star_meta",
    }) for b in bodies.load_bodies()]
    n = upsert_meta(items)
    print(f"로드한 별 {len(stars)}개 + 태양계 천체 {len(items) - len(stars)}개 / 색인된 청크 {n}개")


if __name__ == "__main__":
    main()
