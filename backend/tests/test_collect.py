from app.rag.collect import parse_json_array


def test_parse_plain_array():
    assert parse_json_array('["오리온자리", "초거성"]') == ["오리온자리", "초거성"]


def test_parse_with_noise_and_numbers():
    assert parse_json_array("선택: [1, 3] 입니다") == [1, 3]


def test_parse_failure_returns_empty():
    assert parse_json_array("없음") == []
    assert parse_json_array("[1, 2") == []


def test_is_known_ignores_spacing_and_containment():
    from app.rag.collect import is_known
    known = ["시리우스 B", "백색왜성"]
    assert is_known("시리우스B", known)
    assert is_known("백색왜성 질량", known)
    assert not is_known("큰개자리", known)
