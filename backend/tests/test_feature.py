import math
from datetime import datetime, timedelta, timezone

from app.data_prep.stars import load_stars
from app.services.feature import KST, alt_az, observe

NOW = datetime(2026, 10, 21, 8, 0, tzinfo=timezone.utc)   # 서울 오후 5시
S = {s["id"]: s for s in load_stars()}


def at(label_time_star, t):
    return alt_az(label_time_star["ra_hours"], label_time_star["dec_deg"], t)


def parse(point):
    h, m = point["label"].split()[-1].split(":")
    day = 0 if point["label"].startswith("오늘") else 1 if point["label"].startswith("내일") else 2
    return datetime(2026, 10, 21 + day, int(h), int(m), tzinfo=KST)


def test_polaris_never_sets_and_alpha_cen_never_rises():
    assert observe(S["polaris"], NOW)["status"] == "circumpolar"
    assert observe(S["rigil-kentaurus"], NOW)["status"] == "never"


def test_transit_altitude_matches_max_altitude():
    o = observe(S["betelgeuse"], NOW)
    alt, _ = at(S["betelgeuse"], parse(o["transit"]))
    assert abs(alt - o["max_alt"]) < 0.5
    assert o["transit"]["dir"] == "남"


def test_rise_and_set_are_on_the_horizon_and_east_west():
    for sid in ("betelgeuse", "sirius", "vega"):
        o = observe(S[sid], NOW)
        for key, side in (("rise", "동"), ("set", "서")):
            alt, az = at(S[sid], parse(o[key]))
            assert abs(alt - (-0.567)) < 0.5, (sid, key, alt)
            assert side in o[key]["dir"]
        assert parse(o["rise"]) < parse(o["transit"]) < parse(o["set"])


def test_sirius_rises_before_set_by_twice_the_hour_angle():
    o = observe(S["sirius"], NOW)
    h0 = math.degrees(math.acos(-math.tan(math.radians(37.57)) * math.tan(math.radians(S["sirius"]["dec_deg"]))))
    gap = (parse(o["set"]) - parse(o["rise"])) / timedelta(hours=1)
    assert abs(gap - 2 * h0 / 15) < 0.2


def test_night_samples():
    assert [p["label"] for p in observe(S["vega"], NOW)["night"]] == ["21시", "00시", "03시"]


def test_named_constellations_prefers_longest_name():
    from app.services.explore import named_constellations
    names = {"오리온자리", "물고기자리", "남쪽물고기자리", "전갈자리"}
    assert named_constellations("오리온자리의 붉은 초거성", names) == {"오리온자리"}
    assert named_constellations("남쪽물고기자리의 밝은 별", names) == {"남쪽물고기자리"}
    assert named_constellations("붉은 초거성", names) == set()
