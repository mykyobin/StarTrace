"""태양계 천체(태양·달·행성·명왕성). 별과 달리 위치가 날마다 바뀌어서 좌표를 파일에 두지 않고 시각마다 계산한다.

도메인에 묶인 부분이라 별 목록(stars.py)과 같은 data_prep 영역에 둔다.
"""
import json
from datetime import datetime, timezone

import astronomy as ast

from app.config import ROOT
from app.data_prep.stars import SEOUL_LAT, load_stars, topic

SEOUL_LON = 126.98
SEOUL = ast.Observer(SEOUL_LAT, SEOUL_LON, 0)
NO_CONSTELLATION = "태양계"


def load_bodies():
    with open(ROOT / "data/bodies.json", encoding="utf-8") as f:
        out = json.load(f)["bodies"]
    for b in out:
        b["constellation"] = NO_CONSTELLATION   # 별과 같은 칸을 쓰는 코드(수집·탐색)가 비어 있지 않게
    return out


def load_items():
    """별과 태양계 천체를 한 목록으로. 색인·수집·질문 처리는 이 목록을 쓴다."""
    return load_stars() + load_bodies()


def astro_time(dt=None):
    dt = dt or datetime.now(timezone.utc)
    return ast.Time(dt.timestamp() / 86400 + 2440587.5 - 2451545.0)


def position(body, dt=None):
    """서울에서 본 지금의 위치와 밝기. 적경·적위는 별 목록과 같은 J2000 기준."""
    t = astro_time(dt)
    b = getattr(ast.Body, body["astro"])
    eq = ast.Equator(b, t, SEOUL, False, True)
    il = ast.Illumination(b, t)
    out = {"ra_hours": eq.ra, "dec_deg": eq.dec, "dist_au": eq.dist, "mag": il.mag, "lit": il.phase_fraction}
    if body["kind"] == "moon":
        out["moon_phase_deg"] = ast.MoonPhase(t)   # 0 삭, 90 상현, 180 보름, 270 하현
    return out


def _lit_words(frac):
    return "거의 보름달처럼 둥글다" if frac > 0.9 else "절반쯤 빛난다" if frac > 0.4 else "가느다란 초승달 모양에 가깝다"


def build_text(b):
    """천체 1건을 검색용 문장으로 푼다. 위치는 매일 바뀌어서 넣지 않는다."""
    parts = [f"{topic(b['name_ko'])} 태양계의 천체이고 영어 이름은 {b['name_en']}이다.", f"종류는 {b['type_ko']}이다."]
    parts.append(f"반지름은 약 {b['radius_km']:,}km이다.")
    if b["kind"] in ("planet", "dwarf"):
        parts.append(f"태양에서 평균 약 {b['sun_au']:g}AU 떨어져 있고 태양을 한 바퀴 도는 데 {b['period_ko']}이 걸린다.")
    else:
        parts.append(b["period_ko"] + ".")
    parts.append(b["look_ko"] + ".")
    parts.append("맨눈으로 볼 수 있다." if b["naked"] else "맨눈으로는 보기 어렵고 망원경이 필요하다.")
    if b["kind"] in ("planet", "dwarf", "moon"):
        parts.append("별과 달리 하늘에서 위치가 날마다 바뀌고, 서울에서 보이는 시기도 해마다 다르다.")
    return " ".join(parts)


def facts(body, pos):
    """상세 화면에 보여줄 항목. 현재 위치에서 나오는 값은 지금 시각 기준이다."""
    from app.services.feature import now_altaz, compass   # 순환 참조를 피하려고 안에서 불러온다

    alt, az = now_altaz(body)
    if body["kind"] == "moon":
        dist = f"지구에서 약 {pos['dist_au'] * 149597870.7:,.0f}km"
    else:
        dist = f"지구에서 약 {pos['dist_au']:.2f}AU" + (" (빛이 약 8분 걸린다)" if body["kind"] == "sun" else "")
    out = [["종류", body["type_ko"]], ["겉보기 등급", f"{pos['mag']:.2f}".replace("-", "−")], ["지금 거리", dist]]
    if body["kind"] in ("planet", "dwarf"):
        out.append(["태양까지", f"평균 약 {body['sun_au']:g}AU"])
    out += [["반지름", f"약 {body['radius_km']:,}km"], ["공전·주기", body["period_ko"]]]
    if body["kind"] in ("moon", "planet", "dwarf"):
        out.append(["빛나는 면", f"{round(pos['lit'] * 100)}%"])
    out.append(["서울 하늘에서 지금", f"고도 {round(alt)}°, {compass(az)}쪽" if alt > 0 else "지평선 아래에 있다"])
    return out
