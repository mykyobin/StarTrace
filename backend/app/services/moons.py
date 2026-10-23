"""행성 위성 자료.

- elements(planet): JPL 평균 궤도 요소(data/moons.json, scripts/build_moons.py 로 만든다). 화면이 바로 근사 위치를 계산한다.
- detail(code): 위성 상세 화면에 쓸 항목과 위키백과 소개.
- ephemeris(planet): 크기가 알려진 주요 위성의 정밀 위치를 JPL Horizons 에서 하루치(20분 간격) 받아 둔다.
  평균 요소는 토성 위성 등에서 위상이 크게 어긋나서(타이탄 약 150°) 주요 위성은 Horizons 값을 쓴다.
  Horizons 에 위성마다 한 번씩 묻고 사이에 간격을 둔다. 받은 것은 메모리와 data/cache 에 두고 22시간 쓴다.
"""
import functools
import json
import re
import threading
import time
from urllib.parse import quote

import requests

from app.config import ROOT, settings
from app.data_prep import wiki

PATH = ROOT / "data/moons.json"
CACHE = ROOT / "data/cache"
HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"
CENTER = {"mars": 499, "jupiter": 599, "saturn": 699, "uranus": 799, "neptune": 899, "pluto": 999}
GALILEAN = {"501", "502", "503", "504"}      # 화면이 astronomy-engine 으로 정밀 계산한다
STEP_MIN = 20
SPAN_H = 24
TTL_H = 22
GAP = 0.3

_mem = {}
_locks = {p: threading.Lock() for p in CENTER}


@functools.cache
def _all():
    d = json.loads(PATH.read_text(encoding="utf-8")) if PATH.exists() else {"source": [], "moons": []}
    newest = {}
    for m in d["moons"]:
        m["name"] = re.sub(r"^S(\d{4})_([A-Z])_(\d+)$", lambda g: f"S/{g[1]} {g[2]} {g[3]}", m["name"])   # JPL 표의 임시 이름 S2004_S_31 -> S/2004 S 31
        # JPL 표에 두 번 나오는 위성(퍽)은 기준 시각이 최근인 것만 둔다
        if m["code"] not in newest or m["epoch"] > newest[m["code"]]["epoch"]:
            newest[m["code"]] = m
    return {"source": d["source"], "moons": list(newest.values())}


def elements(planet):
    d = _all()
    return {"source": d["source"], "moons": [m for m in d["moons"] if m["planet"] == planet]}


def _fmt(t):
    return time.strftime("%Y-%m-%d %H:%M", time.gmtime(t))


def _vectors(code, planet, start):
    """Horizons 에서 위성 하나의 행성 중심 ICRF 위치(km)를 start 부터 SPAN_H 시간, STEP_MIN 분 간격으로"""
    params = {"format": "json", "COMMAND": f"'{code}'", "CENTER": f"'500@{CENTER[planet]}'", "EPHEM_TYPE": "'VECTORS'",
              "REF_PLANE": "'FRAME'", "START_TIME": f"'{_fmt(start)}'", "STOP_TIME": f"'{_fmt(start + SPAN_H * 3600)}'",
              "STEP_SIZE": f"'{STEP_MIN}m'", "VEC_TABLE": "'1'", "CSV_FORMAT": "'YES'", "VEC_CORR": "'NONE'",
              "TIME_TYPE": "'UT'", "OUT_UNITS": "'KM-S'"}
    for attempt in range(2):
        try:
            r = requests.get(HORIZONS, params=params, headers={"User-Agent": settings["wiki"]["user_agent"]}, timeout=30)
            r.raise_for_status()
            text = r.json()["result"]
            body = text.split("$$SOE")[1].split("$$EOE")[0]
            return [[round(float(x), 1) for x in line.split(",")[2:5]] for line in body.strip().splitlines()]
        except (requests.RequestException, ValueError, KeyError, IndexError):
            if attempt:
                return None
            time.sleep(2)


def ephemeris(planet, now=None):
    """{"start": unix 초, "step": 초, "vectors": {JPL 번호: [[x,y,z], ...]}}. 하나도 못 받으면 None"""
    now = now or time.time()
    with _locks[planet]:
        hit = _mem.get(planet)
        disk = CACHE / f"moons_{planet}.json"
        if not hit and disk.exists():
            hit = json.loads(disk.read_text(encoding="utf-8"))
        if hit and hit["start"] <= now < hit["start"] + TTL_H * 3600:
            _mem[planet] = hit
            return hit
        start = now - now % (STEP_MIN * 60) - STEP_MIN * 60
        codes = [m["code"] for m in elements(planet)["moons"] if m.get("r") and m["code"] not in GALILEAN]
        vectors = {}
        for code in codes:
            v = _vectors(code, planet, start)
            if v:
                vectors[code] = v
            time.sleep(GAP)
        if not vectors:
            return hit      # 못 받으면 예전 것이라도 (없으면 None)
        hit = _mem[planet] = {"start": start, "step": STEP_MIN * 60, "vectors": vectors, "source": HORIZONS}
        CACHE.mkdir(parents=True, exist_ok=True)
        disk.write_text(json.dumps(hit, separators=(",", ":")), encoding="utf-8")
        return hit


PLANET_KO = {"mars": "화성", "jupiter": "목성", "saturn": "토성", "uranus": "천왕성", "neptune": "해왕성", "pluto": "명왕성"}
PLANE_KO = {"laplace": "라플라스 면", "equatorial": "행성 적도면", "ecliptic": "황도면"}
PLANET_R = {"mars": 3396.19, "jupiter": 71492, "saturn": 60268, "uranus": 25559, "neptune": 24764, "pluto": 1188.3}
WIKI_CACHE = CACHE / "moon_wiki.json"
_wiki_lock = threading.Lock()


def find(code):
    return next((m for m in _all()["moons"] if m["code"] == code), None)


def _period(days):
    if days < 1:
        return f"약 {days * 24:.1f}시간"
    if days < 365.25:
        return f"약 {days:,.2f}일"
    return f"약 {days / 365.25:.1f}년 ({days:,.0f}일)"


def facts(m):
    retro = m["i"] > 90
    kind = ("불규칙 위성" if m["frame"] == "ecliptic" else "규칙 위성") + (" (역행)" if retro else "")
    exact = m["r"] is not None
    return [
        ["모행성", PLANET_KO[m["planet"]]],
        ["종류", kind],
        ["반지름", f"약 {m['r']:,g}km" if m["r"] else "알려지지 않음 (작아서 측정값 없음)"],
        ["행성까지 평균 거리", f"약 {m['a']:,.0f}km (행성 반지름의 {m['a'] / PLANET_R[m['planet']]:,.1f}배)"],
        ["공전 주기", _period(m["P"])],
        ["궤도 이심률", f"{m['e']:.3f}"],
        ["궤도 기울기", f"{m['i']:.1f}° ({PLANE_KO[m['frame']]} 기준)"],
        ["지금 위치 계산", "JPL Horizons 정밀 위치" if exact else "JPL 평균 궤도 요소로 계산한 근사 위치"],
        ["JPL 번호", m["code"]],
    ]


def _wiki_lookup(m):
    """영어 위키백과의 '{이름} (moon)' 문서에서 한국어 문서로 건너간다. 한국어 문서가 없으면 영어 첫 문단을 쓴다.
    임시 이름(S/2004 S 12 등)은 그 이름 그대로 찾는다. 위성 목록 문서로 넘겨지면 소개가 아니라서 버린다."""
    title = m["name"] if m["name"].startswith("S/") else f"{m['name']} (moon)"
    d = wiki.api_get({"action": "query", "prop": "langlinks|extracts", "lllang": "ko", "exintro": 1, "explaintext": 1,
                      "redirects": 1, "titles": title}, lang="en")
    p = d["query"]["pages"][0]
    if p.get("missing") or p["title"].startswith(("Moons of", "List of", "Irregular moon")):
        return None
    ko = (p.get("langlinks") or [{}])[0].get("title")
    if ko:
        doc = wiki.fetch(ko, 2000)
        if doc:
            return {"title": doc["title"], "url": doc["url"], "text": doc["text"], "lang": "ko"}
    if p.get("extract"):
        return {"title": p["title"], "url": "https://en.wikipedia.org/wiki/" + quote(p["title"].replace(" ", "_")),
                "text": p["extract"].strip(), "lang": "en"}
    return None


def intro(m):
    """위키백과 소개. 한 번 찾은 결과(없음 포함)는 data/cache 에 두고 다시 묻지 않는다. 호출이 실패하면 None 이고 다음에 다시 묻는다."""
    with _wiki_lock:
        cache = json.loads(WIKI_CACHE.read_text(encoding="utf-8")) if WIKI_CACHE.exists() else {}
        if m["code"] in cache:
            return cache[m["code"]]
        try:
            out = _wiki_lookup(m)
        except (requests.RequestException, RuntimeError, KeyError, IndexError):
            return None
        cache[m["code"]] = out
        CACHE.mkdir(parents=True, exist_ok=True)
        WIKI_CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
        return out
