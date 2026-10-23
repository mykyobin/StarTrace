import json
import re

from app.config import ROOT

SEOUL_LAT = 37.57
_COLOR = {"O": "청백색", "B": "청백색", "A": "백색", "F": "황백색", "G": "노란색", "K": "주황색", "M": "붉은색"}
# 사용자가 "붉은 초거성"처럼 부르는 말을 그대로 텍스트에 넣으려고 따로 둔다
_ADJ = {"O": "푸른", "B": "푸른", "A": "하얀", "F": "노르스름한", "G": "노란", "K": "주황빛", "M": "붉은"}
_LUM = {"Ia": "초거성", "Iab": "초거성", "Ib": "초거성", "II": "밝은 거성", "III": "거성", "IV": "준거성", "V": "주계열성"}


def load_stars():
    with open(ROOT / "data/stars.json", encoding="utf-8") as f:
        return json.load(f)["stars"]


def seoul_visibility(dec):
    """서울에서 보이는 정도. 지평선 위 최대 고도로 판단한다."""
    if dec > 90 - SEOUL_LAT:
        return "지평선 아래로 지지 않는 주극성이어서 일 년 내내 볼 수 있다"
    alt = 90 - abs(SEOUL_LAT - dec)
    if alt <= 0:
        return "서울에서는 지평선 위로 떠오르지 않아 볼 수 없다"
    side = "남쪽" if dec < SEOUL_LAT else "북쪽"
    return f"{side} 하늘에서 최대 고도 약 {round(alt)}도까지 올라온다"


def best_month(ra_hours):
    """저녁 9시 무렵 남중하는 달. 적경 0시 별이 11월 쪽, 2시간마다 한 달씩 늦어진다 (근사)."""
    return int((ra_hours / 2 + 10.5) % 12) + 1


def spectral_words(sp):
    if not sp:
        return ""
    color = _COLOR.get(sp[0], "")
    m = re.search(r"Iab|Ia|Ib|III|IV|II|V", sp[1:])
    lum = _LUM.get(m.group(0), "") if m else ""
    return f"{color} {lum}".strip()


def look_words(sp):
    """'붉은 초거성' 같은 일상어 표현. 분광형 기호만으로는 검색이 안 걸려서 풀어 쓴다."""
    if not sp or sp[0] not in _ADJ:
        return ""
    m = re.search(r"Iab|Ia|Ib|III|IV|II|V", sp[1:])
    lum = _LUM.get(m.group(0), "별") if m else "별"
    return f"{_ADJ[sp[0]]} {lum}"


def topic(word):
    """받침 유무로 은/는을 붙인다."""
    c = ord(word[-1])
    return word + ("은" if 0xAC00 <= c <= 0xD7A3 and (c - 0xAC00) % 28 else "는")


def build_text(s):
    """별 1건을 검색용 텍스트 한 덩어리로 만든다. 조건 검색이 걸리도록 문장으로 풀어 쓴다."""
    parts = [f"{topic(s['name_ko'])} {s['constellation']}의 별이고 영어 이름은 {s['name_en']}이다."]
    parts.append(f"겉보기 등급은 {s['mag']}등급이다.")
    if s["mag"] < 1.5:
        parts.append("밤하늘에서 가장 밝은 별 가운데 하나다.")
    elif s["mag"] < 3:
        parts.append("맨눈으로 쉽게 보이는 밝은 별이다.")
    if s["dist_ly"] is not None:
        parts.append(f"지구에서 약 {s['dist_ly']:g}광년 떨어져 있다.")
        if s["dist_ly"] < 30:
            parts.append("태양계에서 가까운 편이다.")
    if s["spectral"]:
        look = look_words(s["spectral"])
        parts.append(f"분광형은 {s['spectral']}이고 {look}이며 {spectral_words(s['spectral'])}으로 분류된다." if look
                     else f"분광형은 {s['spectral']}이다.")
    parts.append(f"서울에서는 {seoul_visibility(s['dec_deg'])}.")
    parts.append(f"저녁 9시 무렵 가장 높이 뜨는 때는 {best_month(s['ra_hours'])}월 무렵이다.")
    return " ".join(parts)
