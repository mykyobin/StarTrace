"""HYG 원본 CSV에서 이름 있는 밝은 별 200개를 골라 data/stars.json 을 만든다.

한국어 위키백과 문서가 없는 별은 근거 문서를 얻을 수 없으니 뺀다.
한국어 제목은 영어판 문서의 언어 간 링크(langlinks)로 찾는다.
"""
import csv
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.data_prep.wiki import api_get  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TARGET = 200
CANDIDATES = 480      # 한국어 문서가 없는 별이 빠질 것을 감안해 넉넉히
PC_TO_LY = 3.26156

CON_KO = {
    "And": "안드로메다자리", "Ant": "공기펌프자리", "Aps": "극락조자리", "Aqr": "물병자리", "Aql": "독수리자리",
    "Ara": "제단자리", "Ari": "양자리", "Aur": "마차부자리", "Boo": "목동자리", "Cae": "조각칼자리",
    "Cam": "기린자리", "Cnc": "게자리", "CVn": "사냥개자리", "CMa": "큰개자리", "CMi": "작은개자리",
    "Cap": "염소자리", "Car": "용골자리", "Cas": "카시오페이아자리", "Cen": "켄타우루스자리", "Cep": "세페우스자리",
    "Cet": "고래자리", "Cha": "카멜레온자리", "Cir": "컴퍼스자리", "Col": "비둘기자리", "Com": "머리털자리",
    "CrA": "남쪽왕관자리", "CrB": "북쪽왕관자리", "Crv": "까마귀자리", "Crt": "컵자리", "Cru": "남십자자리",
    "Cyg": "백조자리", "Del": "돌고래자리", "Dor": "황새치자리", "Dra": "용자리", "Equ": "조랑말자리",
    "Eri": "에리다누스자리", "For": "화로자리", "Gem": "쌍둥이자리", "Gru": "두루미자리", "Her": "헤르쿨레스자리",
    "Hor": "시계자리", "Hya": "바다뱀자리", "Hyi": "물뱀자리", "Ind": "인디언자리", "Lac": "도마뱀자리",
    "Leo": "사자자리", "LMi": "작은사자자리", "Lep": "토끼자리", "Lib": "천칭자리", "Lup": "이리자리",
    "Lyn": "살쾡이자리", "Lyr": "거문고자리", "Men": "테이블산자리", "Mic": "현미경자리", "Mon": "외뿔소자리",
    "Mus": "파리자리", "Nor": "직각자자리", "Oct": "팔분의자리", "Oph": "뱀주인자리", "Ori": "오리온자리",
    "Pav": "공작자리", "Peg": "페가수스자리", "Per": "페르세우스자리", "Phe": "봉황자리", "Pic": "화가자리",
    "Psc": "물고기자리", "PsA": "남쪽물고기자리", "Pup": "고물자리", "Pyx": "나침반자리", "Ret": "그물자리",
    "Sge": "화살자리", "Sgr": "궁수자리", "Sco": "전갈자리", "Scl": "조각실자리", "Sct": "방패자리",
    "Ser": "뱀자리", "Sex": "육분의자리", "Tau": "황소자리", "Tel": "망원경자리", "Tri": "삼각형자리",
    "TrA": "남쪽삼각형자리", "Tuc": "큰부리새자리", "UMa": "큰곰자리", "UMi": "작은곰자리", "Vel": "돛자리",
    "Vir": "처녀자리", "Vol": "날치자리", "Vul": "여우자리",
}


def load_candidates():
    rows = []
    with open(ROOT / "data/raw/hyg_v44.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            name = r["proper"].strip()
            # 태양과 준성은 별지도 항목에서 뺀다
            if not name or name in ("Sol", "3C 273"):
                continue
            rows.append(r)
    rows.sort(key=lambda r: float(r["mag"]))
    return rows[:CANDIDATES]


def lookup(titles):
    """영어판 제목 목록 -> {제목: (최종 제목, 별 문서인지, 한국어 제목)}. 50개씩 묻는다."""
    res = {}
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        cont, alias, ko, cats = {}, {}, {}, {}
        while True:
            d = api_get({"action": "query", "prop": "langlinks|categories", "lllang": "ko",
                         "lllimit": "max", "cllimit": "max", "redirects": 1,
                         "titles": "|".join(chunk), **cont}, lang="en")
            q = d["query"]
            for n in q.get("normalized", []) + q.get("redirects", []):
                alias[n["from"]] = n["to"]
            for p in q["pages"]:
                if p.get("langlinks"):
                    ko[p["title"]] = p["langlinks"][0]["title"]
                cats.setdefault(p["title"], []).extend(c["title"] for c in p.get("categories", []))
            if "continue" not in d:
                break
            cont = d["continue"]
        for n in chunk:
            t = n
            while t in alias:
                t = alias[t]
            # 신화나 동음이의 문서를 거르려고 분류에 star 가 들어 있는지 본다
            is_star = any("star" in c.lower() for c in cats.get(t, []))
            res[n] = (t, is_star, ko.get(t))
    return res


def ko_titles(names):
    """HYG 이름 -> {en_title, ko_title}. 이름 그대로가 별 문서가 아니면 '이름 (star)' 를 시도한다."""
    first = lookup(names)
    retry = [n for n in names if not (first[n][1] and first[n][2])]
    second = lookup([f"{n} (star)" for n in retry])
    out = {}
    for n in names:
        t, is_star, ko = first[n]
        if not (is_star and ko):
            t, is_star, ko = second[f"{n} (star)"]
        if is_star and ko:
            out[n] = {"en_title": t, "ko_title": ko}
    return out


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main():
    cands = load_candidates()
    found = ko_titles([r["proper"].strip() for r in cands])
    stars, used = [], set()
    for r in cands:
        name = r["proper"].strip()
        if name not in found or found[name]["ko_title"] in used:
            continue
        used.add(found[name]["ko_title"])
        dist = float(r["dist"])
        stars.append({
            "id": slug(name),
            "hyg_id": int(r["id"]),
            "name_en": name,
            "name_ko": re.sub(r"\s*\(.*?\)$", "", found[name]["ko_title"]),   # 화면 표시용. "폴룩스 (항성)" -> "폴룩스"
            "wiki_ko": found[name]["ko_title"],
            "wiki_en": found[name]["en_title"],
            "constellation": CON_KO[r["con"]],
            "ra_hours": float(r["ra"]),
            "dec_deg": float(r["dec"]),
            "mag": float(r["mag"]),
            "bv": float(r["ci"]) if r["ci"] else None,
            "dist_ly": None if dist >= 100000 else round(dist * PC_TO_LY, 2),
            "spectral": r["spect"] or None,
            "bayer": r["bayer"] or None,
            "variable": r["var"] or None,
        })
        if len(stars) == TARGET:
            break
    out = {"source": "HYG Database v4.4 (CC BY-SA 4.0)", "built": str(date.today()), "stars": stars}
    (ROOT / "data/stars.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"후보 {len(cands)}개 중 한국어 문서 있는 별 {len(found)}개, 저장 {len(stars)}개")


if __name__ == "__main__":
    main()
