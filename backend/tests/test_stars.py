from app.data_prep.stars import best_month, build_text, load_stars, seoul_visibility, topic


def test_count_and_unique_ids():
    stars = load_stars()
    assert len(stars) >= 100
    assert len({s["id"] for s in stars}) == len(stars)


def test_seoul_visibility_cases():
    assert "주극성" in seoul_visibility(89.3)       # 북극성
    assert "볼 수 없다" in seoul_visibility(-60.8)   # 알파 센타우리
    assert "최대 고도" in seoul_visibility(7.4)      # 베텔게우스


def test_best_month_sirius_and_vega():
    assert best_month(6.75) == 2
    assert best_month(18.6) == 8


def test_text_has_all_attributes():
    s = next(x for x in load_stars() if x["id"] == "betelgeuse")
    t = build_text(s)
    for word in ("베텔게우스", "오리온자리", "등급", "광년", "M2Ib", "붉은 초거성", "서울"):
        assert word in t


def test_topic_particle():
    assert topic("베텔게우스") == "베텔게우스는"
    assert topic("시리우스") == "시리우스는"
    assert topic("미자르") == "미자르는"
    assert topic("알골") == "알골은"
