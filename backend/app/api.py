import json
import logging
import time
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
import requests
from pydantic import BaseModel, Field

from app import llm
from app.config import ROOT, missing_keys, settings
from app.data_prep import bodies as body_data
from app.data_prep.stars import best_month, load_stars, seoul_visibility
from app.rag import chat as chat_flow
from app.rag import graph
from app.rag.collect import load as load_docs
from app.services.explore import explore
from app.services.feature import observe
from app.services import moons as moon_data
from app.vectorstore.store import DOCS, META, count

log = logging.getLogger("startrace")
app = FastAPI(title="Star Trace")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 사용자에게 보여줄 문구. 키·프롬프트·오류 추적은 절대 내보내지 않는다
MSG_NO_KEY = "API 키가 설정되지 않았어요. backend/.env 의 ANTHROPIC_API_KEY 와 OPENAI_API_KEY 를 확인해 주세요."
MSG_NO_INDEX = "색인이 없어요. backend 폴더에서 python scripts/index_stars.py 를 먼저 실행해 주세요."
MSG_FAIL = "답을 만드는 중 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요."

_STARS = {s["id"]: s for s in load_stars()}
_BODIES = {b["id"]: b for b in body_data.load_bodies()}
def _assets():
    p = ROOT / "data/nasa_assets.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"assets": {}, "bodies": {}}


_ASSETS = _assets()   # NASA 공식 이미지 목록. 천체 표면은 frontend/public/nasa 에서 화면이 직접 읽는다
SDO = {"hmi": "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_2048_HMIIC.jpg",
       "aia171": "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_2048_0171.jpg"}
SDO_TTL = 15 * 60
_sun_cache = {}
PHOTO_SURVEYS = {"2mass": "근적외선 합성 (2MASS)", "wise": "중적외선 (WISE 3.4μm)", "dss": "가시광 (DSS)"}
_ITEMS = {**_STARS, **_BODIES}   # 질문·가이드·상세는 별과 천체를 가리지 않는다


class ExploreIn(BaseModel):
    query: str = Field(min_length=1, max_length=200)


class GuideIn(BaseModel):
    star_id: str


# 관측 가이드의 '찾는 요령' 은 일반 질문과 같은 RAG 경로를 쓴다. 그래서 근거 번호와 출처가 그대로 붙는다
GUIDE_QUESTION = ("이 별을 밤하늘에서 찾는 요령을 알려줘. 별자리 안에서의 위치나 모양, "
                  "근처의 밝은 별처럼 문서에 있는 단서만 써서 설명해줘.")
GUIDE_QUESTION_BODY = ("이 천체를 하늘에서 찾고 관측하는 요령을 알려줘. 밝기, 색, 위상이나 움직임처럼 "
                       "문서에 있는 단서만 써서 설명해줘.")


class ChatIn(BaseModel):
    star_id: str
    question: str = Field(min_length=1, max_length=500)
    mode: Optional[Literal["similarity", "mmr"]] = None


def _public(s):
    return {k: s[k] for k in ("id", "name_ko", "name_en", "constellation", "ra_hours", "dec_deg", "mag", "bv",
                              "dist_ly", "spectral")}


def _problem():
    """요청을 처리할 수 없는 상태면 안내 문구를, 괜찮으면 None 을 돌려준다."""
    if missing_keys():
        return MSG_NO_KEY
    if count(META) == 0:
        return MSG_NO_INDEX
    return None


@app.get("/api/status")
def status():
    return {"key_set": not missing_keys(), "meta_chunks": count(META), "doc_chunks": count(DOCS),
            "usd_spent": llm.spent()}


@app.get("/api/sky")
def sky():
    """배경으로만 쓰는 별 [적경(시), 적위(도), 등급, B-V]. RAG 항목이 아니라서 클릭은 안 된다."""
    return json.loads((ROOT / "data/sky.json").read_text(encoding="utf-8"))


@app.get("/api/stars")
def stars():
    return [_public(s) for s in _STARS.values()]


@app.get("/api/bodies")
def bodies():
    """태양계 천체의 고정 정보. 위치는 화면이 시각마다 직접 계산한다."""
    keys = ("id", "name_ko", "name_en", "kind", "color", "radius_km", "naked", "rotation_hours")
    return [{k: b[k] for k in keys} for b in _BODIES.values()]


def _first_sentences(text, limit=420):
    """첫 문단을 문장 끝에서 자른다. 문장 중간에서 끊기지 않게 한다."""
    para = text.split(chr(10) * 2)[0].strip()
    if len(para) <= limit:
        return para
    cut = para.rfind("다. ", 0, limit)
    return para[:cut + 2] if cut > 0 else para[:limit]


def _image(item_id):
    """천체·위성의 공식 이미지 정보(크레딧·출처·가공 설명). 받기 전이어도 목록에 있으면 내려준다."""
    asset = _ASSETS["assets"].get(_ASSETS["bodies"].get(item_id, ""))
    if not asset:
        return None
    return {"credit": asset["credit"], "page": asset["page"], "note": asset["note"], "kind": asset["process"]["kind"], "status": asset["status"]}


def _satellite(sat_id):
    """행성의 위성(sat-{JPL 번호}). 질문·가이드 색인에는 없어서 상세 화면만 있다."""
    m = moon_data.find(sat_id[4:])
    if m is None:
        raise HTTPException(404, "찾을 수 없는 위성이에요")
    p = _BODIES[m["planet"]]
    out = {"id": sat_id, "kind": "satellite", "name_ko": m["ko"] or m["name"], "name_en": m["name"],
           "constellation": f"{p['name_ko']}의 위성", "planet": m["planet"], "code": m["code"], "facts": moon_data.facts(m),
           "planet_body": {k: p[k] for k in ("id", "name_ko", "name_en", "kind", "color", "rotation_hours", "obliquity_deg")},
           # 3D 로 그릴 때 쓰는 값. 큰 위성은 늘 같은 면이 행성을 보며 공전 주기에 한 바퀴 돈다(동주기 자전)
           "radius_km": m["r"], "rotation_hours": round(m["P"] * 24, 3), "image": _image(sat_id),
           "color": (_ASSETS["assets"].get(_ASSETS["bodies"].get(sat_id, ""), {}).get("color") or [190, 186, 178])}
    found = moon_data.intro(m)
    if found:
        out["intro"] = {**found, "text": _first_sentences(found["text"])}
    return out


@app.get("/api/stars/{star_id}")
def star(star_id: str):
    if star_id.startswith("sat-"):
        return _satellite(star_id)
    s = _ITEMS.get(star_id)
    if s is None:
        raise HTTPException(404, "찾을 수 없는 별이에요")
    if star_id in _BODIES:
        pos = body_data.position(s)
        out = {"id": s["id"], "name_ko": s["name_ko"], "name_en": s["name_en"], "kind": s["kind"],
               "constellation": s["constellation"], "color": s["color"], "mag": round(pos["mag"], 2),
               "facts": body_data.facts(s, pos), "moon_phase_deg": pos.get("moon_phase_deg"),
               "lit": round(pos["lit"], 3)}
        out["rotation_hours"] = s["rotation_hours"]
        out["obliquity_deg"] = s["obliquity_deg"]
        if _image(star_id):
            out["image"] = _image(star_id)
    else:
        out = _public(s)
        out["seoul"] = seoul_visibility(s["dec_deg"])
        out["best_month"] = best_month(s["ra_hours"])
        out["photos"] = [{"survey": k, "label": v} for k, v in PHOTO_SURVEYS.items() if _photo_path(star_id, k)]
    rec = load_docs(star_id)
    own = next((d for d in rec["docs"] if d["own_article"]), None) if rec else None
    if own:
        # 위키 문서 첫 문단을 소개로 쓴다. 출처 링크를 함께 내려준다
        out["intro"] = {"text": _first_sentences(own["text"]), "title": own["title"], "url": own["url"]}
    return out


def _photo_path(star_id, survey):
    """data/photos/{서베이}/{별ID}.jpg. 예전에 받은 DSS 사진은 서베이 폴더 없이 data/photos/{별ID}.jpg 에 있다."""
    base = ROOT / "data/photos"
    p = base / survey / f"{star_id}.jpg"
    if p.exists():
        return p
    legacy = base / f"{star_id}.jpg"
    return legacy if survey == "dss" and legacy.exists() else None


@app.get("/api/stars/{star_id}/photo")
def photo(star_id: str, survey: str = "2mass"):
    """NASA SkyView 에서 받아 둔 별 주변 하늘 사진. 고른 서베이가 없으면 있는 것으로 대신하고, 하나도 없으면 404."""
    if star_id not in _STARS:
        raise HTTPException(404, "사진이 없어요")
    for s in ([survey] if survey in PHOTO_SURVEYS else []) + list(PHOTO_SURVEYS):
        path = _photo_path(star_id, s)
        if path:
            return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
    raise HTTPException(404, "사진이 없어요")


@app.get("/api/sun/latest")
def sun_latest(kind: Literal["hmi", "aia171"] = "hmi"):
    """SDO 가 방금 찍은 태양 사진. NASA 서버에 부담을 주지 않게 15분 동안 우리 서버가 들고 있다가 내준다."""
    now = time.time()
    hit = _sun_cache.get(kind)
    if not hit or now - hit["t"] > SDO_TTL:
        try:
            r = requests.get(SDO[kind], headers={"User-Agent": settings["wiki"]["user_agent"]}, timeout=20)
            r.raise_for_status()
        except requests.RequestException:
            if hit:   # 새로 못 받으면 가진 것을 계속 쓴다
                return Response(hit["body"], media_type="image/jpeg", headers={"X-Observed-At": hit["observed"]})
            raise HTTPException(503, "태양 사진을 가져오지 못했어요")
        hit = _sun_cache[kind] = {"t": now, "body": r.content, "observed": r.headers.get("Last-Modified", "")}
    return Response(hit["body"], media_type="image/jpeg",
                    headers={"X-Observed-At": hit["observed"], "Cache-Control": "public, max-age=300"})


@app.get("/api/moons/{planet}")
def moons(planet: Literal["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"]):
    """위성 평균 궤도 요소(JPL). 화면이 지금 위치를 근사 계산한다."""
    return moon_data.elements(planet)


@app.get("/api/moons/{planet}/ephemeris")
def moons_ephemeris(planet: Literal["mars", "jupiter", "saturn", "uranus", "neptune", "pluto"]):
    """주요 위성의 정밀 위치(JPL Horizons, 하루치 20분 간격). 처음 한 번은 위성 수만큼 묻느라 수 초 걸린다."""
    e = moon_data.ephemeris(planet)
    if not e:
        raise HTTPException(503, "JPL Horizons 에서 위성 위치를 받지 못했어요")
    return e


@app.post("/api/explore")
def explore_api(body: ExploreIn):
    problem = _problem()
    if problem:
        raise HTTPException(503, problem)
    try:
        return {"results": explore(body.query)}
    except Exception:
        log.exception("explore failed")
        raise HTTPException(500, MSG_FAIL)


@app.post("/api/guide")
def guide(body: GuideIn):
    """관측 가이드. 뜨고 지는 시각은 좌표로 계산하고, 찾는 요령은 위키 근거로 쓴다."""
    star = _ITEMS.get(body.star_id)
    if star is None:
        raise HTTPException(404, "찾을 수 없는 별이에요")
    out = {"observe": observe(star), "tips": None, "tips_error": None}
    problem = _problem()
    if problem:
        out["tips_error"] = problem   # 계산 결과는 키 없이도 보여준다
        return out
    try:
        r = graph.answer(body.star_id, GUIDE_QUESTION_BODY if body.star_id in _BODIES else GUIDE_QUESTION)
        out["tips"] = {"answer": r["answer"], "no_citation": r["no_citation"],
                       "citations": [{k: c[k] for k in ("n", "type", "title", "url")} for c in r["citations"]]}
    except Exception:
        log.exception("guide failed")
        out["tips_error"] = MSG_FAIL
    return out


def _sse(event, data):
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.post("/api/chat")
def chat(body: ChatIn):
    if body.star_id not in _ITEMS:
        raise HTTPException(404, "찾을 수 없는 별이에요")

    def gen():
        problem = _problem()
        if problem:
            yield _sse("error", {"message": problem})
            return
        try:
            for event, data in chat_flow.stream(body.star_id, body.question, body.mode):
                if event == "result":
                    data = {"answer": data["answer"], "no_citation": data["no_citation"],
                            "citations": [{k: c[k] for k in ("n", "type", "title", "url")} for c in data["citations"]],
                            "usd_spent": llm.spent()}
                yield _sse(event, data)
        except Exception:
            log.exception("chat failed")
            yield _sse("error", {"message": MSG_FAIL})

    return StreamingResponse(gen(), media_type="text/event-stream")
