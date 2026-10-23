from app.services import moons


def _fake_horizons(calls):
    class Resp:
        def raise_for_status(self): pass
        def json(self):
            rows = "\n".join(f"2461000.{k}, A.D. 2026-Oct-22 00:{k:02d}:00.0000, {k}.0, 2.5, -3.0," for k in range(3))
            return {"result": f"header\n$$SOE\n{rows}\n$$EOE\nfooter"}
    return lambda url, params, **k: calls.append(params["COMMAND"]) or Resp()


def test_ephemeris_parses_vectors_and_caches(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(moons.requests, "get", _fake_horizons(calls))
    monkeypatch.setattr(moons, "CACHE", tmp_path)
    monkeypatch.setattr(moons, "GAP", 0)
    moons._mem.clear()
    e = moons.ephemeris("mars", now=1_800_000_000)
    assert set(e["vectors"]) == {"401", "402"} and e["vectors"]["401"][1] == [1.0, 2.5, -3.0]
    assert e["start"] <= 1_800_000_000 and e["step"] == moons.STEP_MIN * 60
    moons._mem.clear()                                    # 디스크에 남은 것을 다시 쓴다
    assert moons.ephemeris("mars", now=1_800_000_000 + 3600) == e and len(calls) == 2


def test_galilean_moons_are_left_to_the_browser(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(moons.requests, "get", _fake_horizons(calls))
    monkeypatch.setattr(moons, "CACHE", tmp_path)
    monkeypatch.setattr(moons, "GAP", 0)
    moons._mem.clear()
    moons.ephemeris("jupiter", now=1_800_000_000)
    assert calls and not {"'501'", "'502'", "'503'", "'504'"} & set(calls)


def test_elements_cover_every_planet_with_moons():
    for p in moons.CENTER:
        assert moons.elements(p)["moons"], p


def test_satellite_detail_without_network(monkeypatch):
    from fastapi.testclient import TestClient
    from app.api import app
    monkeypatch.setattr(moons, "intro", lambda m: None)
    d = TestClient(app).get("/api/stars/sat-606").json()
    assert d["kind"] == "satellite" and d["name_ko"] == "타이탄" and d["planet_body"]["id"] == "saturn"
    assert dict(d["facts"])["모행성"] == "토성"
    assert TestClient(app).get("/api/stars/sat-999999").status_code == 404


def test_provisional_names_and_duplicates_are_tidied():
    names = [m["name"] for m in moons.elements("uranus")["moons"]]
    assert names.count("Puck") == 1
    assert moons.find("65067")["name"] == "S/2004 S 31"
