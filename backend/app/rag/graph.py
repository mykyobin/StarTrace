import re
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from app import llm
from app.data_prep.bodies import load_items
from app.rag.prompts import P3_ANSWER
from app.rag.retrieve import retrieve

_CITE = re.compile(r"\[근거\s*(\d+)\]")


class State(TypedDict, total=False):
    star_id: str
    question: str
    mode: str
    top_k: int
    evidence: list
    answer: str
    citations: list


def parse_citations(answer, evidence):
    """답변 본문에서 [근거 N] 을 찾아 실제 인용된 근거만 순서대로 돌려준다."""
    used, seen = [], set()
    by_n = {e["n"]: e for e in evidence}
    for m in _CITE.finditer(answer):
        n = int(m.group(1))
        if n in by_n and n not in seen:
            seen.add(n)
            used.append(by_n[n])
    return used


def retrieve_node(state):
    return {"evidence": retrieve(state["star_id"], state["question"], state.get("mode"), state.get("top_k"))}


def generate_node(state):
    star = next(s for s in load_items() if s["id"] == state["star_id"])
    ev = "\n\n".join(f"[근거 {e['n']}] ({e['type']}) {e['title']}\n{e['text']}" for e in state["evidence"])
    answer = llm.ask("answer", P3_ANSWER.format(name_ko=star["name_ko"], evidence=ev, question=state["question"]),
                     "P3 answer")
    return {"answer": answer, "citations": parse_citations(answer, state["evidence"])}


def build():
    g = StateGraph(State)
    g.add_node("retrieve", retrieve_node)
    g.add_node("generate", generate_node)
    g.add_edge(START, "retrieve")
    g.add_edge("retrieve", "generate")
    g.add_edge("generate", END)
    return g.compile()


def answer(star_id, question, mode=None, top_k=None):
    out = build().invoke({"star_id": star_id, "question": question, "mode": mode, "top_k": top_k})
    return {"answer": out["answer"], "citations": out["citations"], "evidence": out["evidence"],
            "no_citation": not out["citations"]}   # 인용이 하나도 없으면 화면에 그 사실을 알린다
