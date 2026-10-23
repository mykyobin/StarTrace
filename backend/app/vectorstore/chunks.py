from langchain_text_splitters import RecursiveCharacterTextSplitter


def make_chunks(rec, star, size, overlap, min_chars=0):
    """data/docs/{별}.json 한 건 -> [(청크 ID, 텍스트, 메타데이터)].

    청크 ID는 '별ID:문서ID:순번'. 여러 별이 같은 문서를 수집해도 별ID가 달라 서로 덮어쓰지 않는다.
    """
    splitter = RecursiveCharacterTextSplitter(chunk_size=size, chunk_overlap=overlap)
    out = []
    for d in rec["docs"]:
        pieces = [t for t in splitter.split_text(d["text"]) if len(t.strip()) >= min_chars]
        for n, text in enumerate(pieces):
            out.append((f"{star['id']}:{d['doc_id']}:{n}", text, {
                "star_id": star["id"], "related_star": star["name_ko"],
                "doc_id": d["doc_id"], "doc_title": d["title"], "url": d["url"],
                "source_type": d["source_type"], "search_term": d["search_term"],
                "collected_at": d["collected_at"], "chunk_no": n,
            }))
    return out
