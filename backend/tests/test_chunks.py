from app.vectorstore.chunks import make_chunks

STAR = {"id": "x", "name_ko": "가"}
REC = {"docs": [{"doc_id": "7", "title": "t", "url": "u", "source_type": "위키백과",
                 "search_term": "s", "collected_at": "2026-01-01", "text": "가나다 " * 400}]}


def test_chunk_id_format():
    ids = [c[0] for c in make_chunks(REC, STAR, 800, 160)]
    assert ids[0] == "x:7:0" and ids[1] == "x:7:1"


def test_smaller_chunks_give_more_chunks():
    assert len(make_chunks(REC, STAR, 400, 80)) > len(make_chunks(REC, STAR, 800, 160))


def test_two_stars_same_doc_do_not_collide():
    a = {c[0] for c in make_chunks(REC, {"id": "a", "name_ko": "가"}, 800, 160)}
    b = {c[0] for c in make_chunks(REC, {"id": "b", "name_ko": "나"}, 800, 160)}
    assert not (a & b)


def test_heading_only_chunks_are_dropped():
    # 뒤따르는 문단이 청크 크기보다 길면 제목이 혼자 한 청크로 남는다
    text = "== 진화 ==" + chr(10) * 2 + "가" * 900
    rec = {"docs": [{**REC["docs"][0], "text": text}]}
    assert any(c[1].strip() == "== 진화 ==" for c in make_chunks(rec, STAR, 800, 160))
    assert not any(c[1].strip() == "== 진화 ==" for c in make_chunks(rec, STAR, 800, 160, min_chars=50))
