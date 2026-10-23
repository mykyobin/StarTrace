from app.rag import graph
from app.rag.retrieve import merge, with_star_name

EV = [{"n": 1, "type": "항목 메타데이터", "title": "a", "url": "u", "text": "하나"},
      {"n": 2, "type": "위키백과", "title": "b", "url": "v", "text": "둘"},
      {"n": 3, "type": "위키백과", "title": "c", "url": "w", "text": "셋"}]


def test_graph_has_two_nodes():
    nodes = set(graph.build().get_graph().nodes) - {"__start__", "__end__"}
    assert nodes == {"retrieve", "generate"}


def test_only_cited_evidence_is_kept_in_order():
    used = graph.parse_citations("별이다 [근거 3]. 또 그렇다 [근거 1][근거 3]. 없는 것 [근거 9]", EV)
    assert [e["n"] for e in used] == [3, 1]


def test_no_citation_flag(monkeypatch):
    monkeypatch.setattr(graph, "retrieve", lambda *a, **k: EV)
    monkeypatch.setattr(graph.llm, "ask", lambda *a, **k: "제공된 문서에서는 확인되지 않습니다.")
    out = graph.answer("betelgeuse", "아무거나")
    assert out["no_citation"] and out["citations"] == []


def test_merge_dedupes_same_text_and_numbers_from_one():
    m = merge([{"text": "같은  내용", "title": "m"}], [{"text": "같은 내용", "title": "d"}, {"text": "다른", "title": "e"}])
    assert [x["n"] for x in m] == [1, 2] and m[0]["title"] == "m"


def test_star_name_is_added_only_when_missing():
    assert with_star_name("폴룩스", "이 별에는 행성이 있어?") == "폴룩스 이 별에는 행성이 있어?"
    assert with_star_name("폴룩스", "폴룩스에는 행성이 있어?") == "폴룩스에는 행성이 있어?"
