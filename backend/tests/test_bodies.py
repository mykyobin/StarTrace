from datetime import datetime, timezone

from app.data_prep.bodies import build_text, load_bodies, load_items, load_stars, position
from app.services.feature import observe


def _body(i):
    return next(b for b in load_bodies() if b["id"] == i)


def test_ten_bodies_and_unique_ids():
    ids = [i["id"] for i in load_items()]
    assert len(load_bodies()) == 10 and len(set(ids)) == len(ids)
    assert len(load_stars()) + 10 == len(ids)


def test_sun_at_equinox_and_solstice():
    # 춘분 무렵 태양 적위 0도 근처, 하지 무렵 +23.4도 근처 (알려진 값)
    eq = position(_body("sun"), datetime(2026, 3, 20, 12, tzinfo=timezone.utc))
    sol = position(_body("sun"), datetime(2026, 6, 21, 12, tzinfo=timezone.utc))
    assert abs(eq["dec_deg"]) < 0.5 and 23.2 < sol["dec_deg"] < 23.5
    assert 11.8 < eq["ra_hours"] < 12.1 or eq["ra_hours"] < 0.2 or eq["ra_hours"] > 23.8


def test_moon_phase_and_brightness_order():
    now = datetime(2026, 10, 22, 12, tzinfo=timezone.utc)
    assert 0 < position(_body("moon"), now)["lit"] < 1
    assert position(_body("venus"), now)["mag"] < position(_body("neptune"), now)["mag"]


def test_observe_order_rise_transit_set():
    o = observe(_body("sun"), datetime(2026, 10, 22, 3, tzinfo=timezone.utc))
    assert o["status"] == "rises" and o["source"] == "ephemeris"
    assert o["rise"]["label"] < o["transit"]["label"] < o["set"]["label"]
    assert 40 < o["max_alt"] < 42      # 서울 10월 하순 태양 남중 고도 ≈ 41도


def test_text_has_kind_words():
    t = build_text(_body("pluto"))
    for w in ("명왕성", "왜소행성", "AU", "망원경"):
        assert w in t


def test_asset_list_covers_every_body():
    import json
    from app.config import ROOT
    meta = json.loads((ROOT / "data/nasa_assets.json").read_text(encoding="utf-8"))
    ids = {b["id"] for b in load_bodies()}
    extra = set(meta["bodies"]) - ids      # 천체 말고는 위성(sat-JPL번호)과 지구 구름만
    assert ids <= set(meta["bodies"]) and all(k == "earth" or k.startswith("sat-") for k in extra)
    assert all(k in meta["assets"] for k in meta["bodies"].values())
    for a in meta["assets"].values():     # 공식 출처만: 주소가 있으면 NASA 나 USGS(NASA 데이터로 만든 미 정부 지도) 도메인이어야 한다
        assert a["credit"].startswith(("NASA", "SDO")) or "NASA" in a["credit"]
        assert not a.get("url") or any(h in a["url"] for h in ("nasa.gov", "astrogeology.usgs.gov"))


def test_sun_proxy_caches(monkeypatch):
    from fastapi.testclient import TestClient
    from app import api
    calls = []

    class Resp:
        content, headers = b"jpgbytes", {"Last-Modified": "Thu, 22 Oct 2026 01:40:06 GMT"}
        def raise_for_status(self): pass

    monkeypatch.setattr(api.requests, "get", lambda *a, **k: calls.append(a) or Resp())
    api._sun_cache.clear()
    c = TestClient(api.app)
    r1, r2 = c.get("/api/sun/latest"), c.get("/api/sun/latest")
    assert r1.status_code == 200 and r1.content == b"jpgbytes" and r1.headers["x-observed-at"].endswith("GMT")
    assert len(calls) == 1      # 15분 안에는 NASA 에 다시 묻지 않는다


def test_map_edges_are_healed():
    import sys
    from pathlib import Path
    from PIL import Image
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
    from fetch_nasa_assets import heal_edges
    im = Image.new("RGB", (64, 32), (120, 60, 40))
    im.paste((255, 255, 255), (0, 0, 1, 32))      # 흰 테두리 한 줄 (화성 지도에 있던 것)
    im.paste((0, 0, 0), (0, 0, 64, 3))            # 북극에 관측 없는 검은 줄 3줄 (수성)
    heal_edges(im)
    assert im.getpixel((0, 16)) == (120, 60, 40) and im.getpixel((10, 0)) == (120, 60, 40)
