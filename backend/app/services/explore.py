from app import llm
from app.data_prep import bodies
from app.data_prep.stars import look_words, seoul_visibility
from app.rag.collect import parse_json_array
from app.rag.prompts import P4_EXPLORE
from app.vectorstore.store import META, collection

CANDIDATES = 40   # 임베딩이 색·등급 같은 속성에 약해서 넉넉히 가져와 LLM이 거른다
MAX_RESULTS = 12


def _line(i, s):
    if s.get("kind"):
        return (f"{i}. {s['name_ko']}({s['name_en']}) 태양계 | {s['type_ko']} | {s['look_ko']} | "
                f"{'맨눈으로 보임' if s['naked'] else '맨눈으로 안 보임'}")
    dist = f"{s['dist_ly']:g}광년" if s["dist_ly"] is not None else "거리 미상"
    look = look_words(s["spectral"]) if s["spectral"] else ""
    return (f"{i}. {s['name_ko']}({s['name_en']}) {s['constellation']} | {s['mag']}등급 | {dist} | "
            f"{s['spectral'] or '분광형 미상'} {look} | 서울: {seoul_visibility(s['dec_deg'])}")


def named_constellations(query, names):
    """질문에 나온 별자리 이름. '남쪽물고기자리'가 나오면 그 안의 '물고기자리'는 빼고 긴 이름만 남긴다."""
    hit = {n for n in names if n and n in query}
    return {n for n in hit if not any(n != m and n in m for m in hit)}


def explore(query):
    by_id = {s["id"]: s for s in bodies.load_items()}
    found = collection(META).similarity_search(query, k=CANDIDATES)
    cands = [by_id[d.metadata["star_id"]] for d in found if d.metadata["star_id"] in by_id]
    lines = "\n".join(_line(i, s) for i, s in enumerate(cands, 1))
    out = llm.ask("fast", P4_EXPLORE.format(query=query, lines=lines, n=MAX_RESULTS), "P4 explore")
    # 프롬프트로 조건을 지키라고 해도 LLM 이 가끔 다른 별자리의 별을 섞는다. 별자리는 값으로 확인할 수 있으니 코드로 거른다
    wanted = named_constellations(query, {s["constellation"] for s in by_id.values()} - {bodies.NO_CONSTELLATION})
    picked = []
    for i in parse_json_array(out):
        if isinstance(i, int) and 1 <= i <= len(cands) and cands[i - 1] not in picked                 and (not wanted or cands[i - 1]["constellation"] in wanted):
            picked.append(cands[i - 1])
    return [{"id": s["id"], "name_ko": s["name_ko"], "name_en": s["name_en"], "constellation": s["constellation"],
             "mag": round(bodies.position(s)["mag"], 2) if s.get("kind") else s["mag"]} for s in picked[:MAX_RESULTS]]
