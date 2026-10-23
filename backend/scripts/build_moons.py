"""JPL 위성 평균 궤도 요소와 크기를 받아 data/moons.json 으로 만든다. 화면은 /api/moons/{행성} 으로 받는다.

- 궤도: https://ssd.jpl.nasa.gov/sats/elem/  (행성 위성 460여 개의 평균 궤도 요소, 기준 시각과 기준면 포함)
- 크기: https://ssd.jpl.nasa.gov/sats/phys_par/ (주요 위성 40여 개의 평균 반지름. 나머지는 크기 없음)
화면은 이 요소로 케플러 궤도를 풀어 지금 위치를 근사 계산한다. 주요 위성은 서버가 JPL Horizons 정밀 위치를 따로 준다(app/services/moons.py).
키는 필요 없다.

  python scripts/build_moons.py
"""
import html
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/moons.json"
UA = {"User-Agent": "StarTrace/0.1 (mykyobinlove@naver.com) satellite elements"}
ELEM = "https://ssd.jpl.nasa.gov/sats/elem/"
PHYS = "https://ssd.jpl.nasa.gov/sats/phys_par/"
PLANETS = {"Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"}   # 지구의 달은 따로 다룬다

KO = {
    "Phobos": "포보스", "Deimos": "데이모스",
    "Io": "이오", "Europa": "유로파", "Ganymede": "가니메데", "Callisto": "칼리스토", "Amalthea": "아말테아",
    "Thebe": "테베", "Metis": "메티스", "Adrastea": "아드라스테아", "Himalia": "히말리아", "Elara": "엘라라",
    "Pasiphae": "파시파에", "Carme": "카르메", "Ananke": "아난케", "Sinope": "시노페", "Lysithea": "리시테아",
    "Mimas": "미마스", "Enceladus": "엔켈라두스", "Tethys": "테티스", "Dione": "디오네", "Rhea": "레아",
    "Titan": "타이탄", "Hyperion": "히페리온", "Iapetus": "이아페투스", "Phoebe": "포이베", "Janus": "야누스",
    "Epimetheus": "에피메테우스", "Prometheus": "프로메테우스", "Pandora": "판도라", "Pan": "판", "Atlas": "아틀라스",
    "Daphnis": "다프니스", "Helene": "헬레네", "Telesto": "텔레스토", "Calypso": "칼립소",
    "Miranda": "미란다", "Ariel": "아리엘", "Umbriel": "움브리엘", "Titania": "티타니아", "Oberon": "오베론",
    "Puck": "퍽", "Sycorax": "시코락스", "Cordelia": "코델리아", "Ophelia": "오필리아", "Bianca": "비앙카", "Cressida": "크레시다",
    "Desdemona": "데스데모나", "Juliet": "줄리엣", "Portia": "포셔", "Rosalind": "로잘린드", "Belinda": "벨린다", "Perdita": "페르디타",
    "Mab": "마브", "Cupid": "큐피드", "Caliban": "칼리반",
    "Triton": "트리톤", "Nereid": "네레이드", "Proteus": "프로테우스", "Larissa": "라리사",
    "Naiad": "나이아드", "Thalassa": "탈라사", "Despina": "데스피나", "Galatea": "갈라테아", "Hippocamp": "히포캄프",
    "Charon": "카론", "Nix": "닉스", "Hydra": "히드라", "Kerberos": "케르베로스", "Styx": "스틱스",
}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read().decode("utf-8")


def rows(page, table=0):
    t = re.findall(r"<table.*?</table>", page, re.S)[table]
    for r in re.findall(r"<tr.*?</tr>", t, re.S):
        yield [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", "", c))).strip()
               for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S)]


def num(s):
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None          # "-" 나 빈칸


def jd(epoch):
    """'2000-01-01.5' 같은 TDB 날짜를 율리우스일로"""
    day, frac = (epoch.split(".") + ["0"])[:2]
    d = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return d.timestamp() / 86400 + 2440587.5 + float("0." + frac)


def parse(elem_page, phys_page):
    radius = {}
    for c in rows(phys_page):
        if len(c) > 4 and c[2].isdigit():
            radius[c[2]] = num(c[4].split(" ")[0])
    out = []
    for c in rows(elem_page):
        if len(c) < 19 or c[1] not in PLANETS:
            continue
        a, e, w, M, i, node, P = (num(x) for x in c[7:14])
        if None in (a, e, w, M, i, node, P):
            continue
        out.append({
            "planet": c[1].lower(), "name": c[2], "ko": KO.get(c[2]), "code": c[3], "frame": c[5].lower(),
            "epoch": round(jd(c[6]), 4), "a": a, "e": e, "w": w, "M": M, "i": i, "node": node, "P": P,
            "Papsis": num(c[14]), "Pnode": num(c[15]), "ra": num(c[16]), "dec": num(c[17]), "r": radius.get(c[3]),
        })
    return out


def main():
    moons = parse(get(ELEM), get(PHYS))
    OUT.write_text(json.dumps({"source": [ELEM, PHYS], "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                               "moons": moons}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    by = {}
    for m in moons:
        by[m["planet"]] = by.get(m["planet"], 0) + 1
    print(f"{len(moons)}개 -> {OUT.name}", by)


if __name__ == "__main__":
    main()
