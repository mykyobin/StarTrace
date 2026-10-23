from fastapi.testclient import TestClient

from app import api
from app.rag import chat as chat_flow

client = TestClient(api.app)


def test_stars_list_and_detail():
    r = client.get("/api/stars").json()
    assert len(r) == 200 and "wiki_ko" not in r[0]
    d = client.get("/api/stars/betelgeuse").json()
    assert d["name_ko"] == "베텔게우스" and d["intro"]["url"].startswith("https://ko.wikipedia.org/")
    assert client.get("/api/stars/nope").status_code == 404


def test_status_has_no_secrets():
    body = client.get("/api/status").text
    assert "key_set" in body and "API_KEY" not in body


def test_chat_without_key_returns_notice(monkeypatch):
    monkeypatch.setattr(api, "missing_keys", lambda: ["ANTHROPIC_API_KEY"])
    text = client.post("/api/chat", json={"star_id": "sirius", "question": "안녕"}).text
    assert "event: error" in text and "ANTHROPIC_API_KEY" in text and "Traceback" not in text


def test_chat_stream_shape_and_error_hides_trace(monkeypatch):
    monkeypatch.setattr(api, "missing_keys", lambda: [])
    monkeypatch.setattr(api, "count", lambda n: 1)

    def boom(*a, **k):
        yield "progress", {"step": "terms", "text": "t"}
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(chat_flow, "stream", boom)
    text = client.post("/api/chat", json={"star_id": "sirius", "question": "안녕"}).text
    assert "event: progress" in text and "event: error" in text
    assert "secret internal detail" not in text


def test_intro_ends_on_a_sentence():
    text = "별은 밝다. " * 100
    out = api._first_sentences(text)
    assert out.endswith("다.") and len(out) <= 422


def test_detail_intro_is_cut_on_sentence_end():
    # 엔드포인트가 실제로 _first_sentences 를 쓰는지 본다 (긴 첫 문단을 가진 별)
    text = client.get("/api/stars/acrux").json()["intro"]["text"]
    assert text.endswith("다.") and len(text) <= 422


def test_photo_404_for_unknown_star():
    assert client.get("/api/stars/nope/photo").status_code == 404


def test_guide_returns_calculation_even_without_key(monkeypatch):
    monkeypatch.setattr(api, "missing_keys", lambda: ["ANTHROPIC_API_KEY"])
    d = client.post("/api/guide", json={"star_id": "betelgeuse"}).json()
    assert d["observe"]["status"] == "rises" and d["tips"] is None and "ANTHROPIC_API_KEY" in d["tips_error"]


def test_guide_tips_carry_citations(monkeypatch):
    monkeypatch.setattr(api, "missing_keys", lambda: [])
    monkeypatch.setattr(api, "count", lambda n: 1)
    fake = {"answer": "오리온자리의 어깨에 있다 [근거 2].", "no_citation": False, "evidence": [],
            "citations": [{"n": 2, "type": "위키백과", "title": "t", "url": "u", "text": "secret"}]}
    monkeypatch.setattr(api.graph, "answer", lambda *a, **k: fake)
    d = client.post("/api/guide", json={"star_id": "betelgeuse"}).json()
    assert d["tips"]["citations"][0]["n"] == 2 and "secret" not in str(d)
