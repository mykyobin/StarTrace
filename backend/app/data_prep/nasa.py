"""NASA Exoplanet Archive 에서 행성 정보를 받아, 별마다 짧은 설명 문서(JSON)로 만든다."""
import csv
import json
import re
from datetime import date
from urllib.parse import quote

import requests

from app.config import ROOT, settings

TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
QUERY = ("select hostname,hd_name,hip_name,pl_name,discoverymethod,disc_year,pl_orbper,pl_rade,pl_bmasse,"
         "pl_orbsmax,sy_pnum,sy_dist from pscomppars")
SOURCE_TYPE = "NASA Exoplanet Archive"
RAW = ROOT / "data/raw/exoplanets.json"

_METHOD = {"Radial Velocity": "시선속도", "Transit": "통과(트랜짓)", "Imaging": "직접 촬영",
           "Microlensing": "미세 중력렌즈", "Astrometry": "위치천문", "Transit Timing Variations": "통과 시각 변이",
           "Eclipse Timing Variations": "식 시각 변이", "Pulsar Timing": "펄서 타이밍"}


def download():
    r = requests.get(TAP, params={"query": QUERY, "format": "json"},
                     headers={"User-Agent": settings["wiki"]["user_agent"]}, timeout=120)
    r.raise_for_status()
    RAW.write_text(json.dumps(r.json(), ensure_ascii=False), encoding="utf-8")
    return r.json()


def match(stars, planets):
    """HYG 의 HIP·HD 번호로 우리 별과 행성 기록을 잇는다. 이름은 표기가 달라서 쓰지 않는다. -> {별 id: [행성 기록]}"""
    hyg = {int(r["id"]): r for r in csv.DictReader(open(ROOT / "data/raw/hyg_v44.csv", encoding="utf-8"))}
    by_name = {}
    for s in stars:
        row = hyg[s["hyg_id"]]
        if row["hip"]:
            by_name[f"HIP {int(row['hip'])}"] = s
        if row["hd"]:
            by_name[f"HD {int(row['hd'])}"] = s
    out = {}
    for p in planets:
        s = by_name.get(p["hip_name"]) or by_name.get(p["hd_name"])
        if s:
            out.setdefault(s["id"], []).append(p)
    return out


def _line(p):
    bits = []
    if p["disc_year"]:
        bits.append(f"{p['disc_year']}년 {_METHOD.get(p['discoverymethod'], p['discoverymethod'])} 방식으로 발견")
    if p["pl_orbper"]:
        bits.append(f"공전 주기 {p['pl_orbper']:.4g}일")
    if p["pl_orbsmax"]:
        bits.append(f"궤도 반지름 {p['pl_orbsmax']:.3g} AU")
    if p["pl_bmasse"]:
        bits.append(f"질량 약 {p['pl_bmasse']:.4g} 지구 질량")
    if p["pl_rade"]:
        bits.append(f"반지름 약 {p['pl_rade']:.3g} 지구 반지름")
    return f"- {p['pl_name']}: " + ", ".join(bits) + "."


def build_doc(star, planets):
    """행성 한 줄이 그 자체로 읽히는 짧은 표 형태 문서. 위키처럼 긴 글이 아니라서 줄 단위로 끊는다."""
    host = planets[0]["hostname"]
    lines = [f"{star['name_ko']}({star['name_en']})은 NASA Exoplanet Archive에 확인된 행성 {len(planets)}개가 등록된 별이다.",
             "질량은 관측으로 얻은 최선 추정값이며, 시선속도법으로 찾은 행성은 최소 질량에 가깝다."]
    lines += [_line(p) for p in sorted(planets, key=lambda p: p["pl_name"])]
    return {"doc_id": "nasa-" + re.sub(r"[^a-z0-9]+", "-", host.lower()).strip("-"),
            "title": f"NASA Exoplanet Archive: {host}",
            "url": "https://exoplanetarchive.ipac.caltech.edu/overview/" + quote(host),
            "source_type": SOURCE_TYPE, "search_term": "외계행성", "collected_at": str(date.today()),
            "own_article": False, "text": "\n".join(lines)}
