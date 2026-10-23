"""도메인 특화 기능: 관측 가이드. 서울 기준으로 별이 언제 어느 방향에서 뜨고 지는지 계산한다.

좌표만으로 계산하는 부분이다. 위키 근거가 필요한 '찾는 요령' 은 rag.graph 를 거쳐 api.py 에서 붙인다.
"""
import math
from datetime import datetime, timedelta, timezone

import astronomy as ast

from app.data_prep import bodies
from app.data_prep.stars import SEOUL_LAT, best_month

LAT = SEOUL_LAT
LON = 126.98
KST = timezone(timedelta(hours=9))
SIDEREAL = 360.98564736629   # 하루(태양일)에 지구가 별에 대해 도는 각도
H_STAR = -0.567              # 대기 굴절을 반영한 뜨고 지는 기준 고도(도)
_DIRS = ["북", "북북동", "북동", "동북동", "동", "동남동", "남동", "남남동",
         "남", "남남서", "남서", "서남서", "서", "서북서", "북서", "북북서"]


def gmst_deg(t):
    jd = t.timestamp() / 86400 + 2440587.5
    return (280.46061837 + SIDEREAL * (jd - 2451545.0)) % 360


def alt_az(ra_hours, dec, t):
    """고도(도)와 방위(북쪽 0도, 동쪽 90도)."""
    h = math.radians((gmst_deg(t) + LON) % 360 - ra_hours * 15)
    d, phi = math.radians(dec), math.radians(LAT)
    alt = math.asin(math.sin(phi) * math.sin(d) + math.cos(phi) * math.cos(d) * math.cos(h))
    az = math.atan2(math.sin(h), math.cos(h) * math.sin(phi) - math.tan(d) * math.cos(phi))
    return math.degrees(alt), (math.degrees(az) + 180) % 360


def compass(az):
    return _DIRS[int((az + 11.25) % 360 // 22.5)]


def _label(t, today):
    days = (t.astimezone(KST).date() - today).days
    return f"{['오늘', '내일', '모레'][days] if 0 <= days <= 2 else t.astimezone(KST).strftime('%m월 %d일')} {t.astimezone(KST):%H:%M}"


def _point(t, star, today):
    alt, az = alt_az(star["ra_hours"], star["dec_deg"], t)
    return {"label": _label(t, today), "alt": round(alt, 1), "az": round(az), "dir": compass(az)}


def _hor(body, t):
    """태양계 천체의 그 시각 고도·방위. 날짜의 적도좌표와 대기 굴절을 쓴다."""
    ast_t = bodies.astro_time(t)
    eq = ast.Equator(getattr(ast.Body, body["astro"]), ast_t, bodies.SEOUL, True, True)
    h = ast.Horizon(ast_t, bodies.SEOUL, eq.ra, eq.dec, ast.Refraction.Normal)
    return h.altitude, h.azimuth


def now_altaz(body, t=None):
    return _hor(body, t or datetime.now(timezone.utc))


def _utc(ast_time):
    d = ast_time.Utc()
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _body_point(t, body, today):
    alt, az = _hor(body, t)
    return {"label": _label(t, today), "alt": round(alt, 1), "az": round(az), "dir": compass(az)}


def observe_body(body, now=None):
    """태양계 천체의 관측 가이드. 별과 같은 모양으로 돌려줘서 화면이 그대로 쓴다."""
    now = (now or datetime.now(timezone.utc)).astimezone(KST)
    today = now.date()
    ref = datetime(today.year, today.month, today.day, 12, tzinfo=KST)
    start = bodies.astro_time(ref)
    b = getattr(ast.Body, body["astro"])
    transit = _utc(ast.SearchHourAngle(b, bodies.SEOUL, 0, start).time)
    alt_t, _ = _hor(body, transit)
    out = {"source": "ephemeris", "max_alt": round(alt_t, 2), "transit": _body_point(transit, body, today)}
    at = bodies.astro_time(transit)
    # 별과 같은 순서(뜸 -> 남중 -> 짐)로 보이게, 남중을 가운데 두고 앞의 뜸과 뒤의 짐을 찾는다
    rise = ast.SearchRiseSet(b, bodies.SEOUL, ast.Direction.Rise, at, -1)
    sett = ast.SearchRiseSet(b, bodies.SEOUL, ast.Direction.Set, at, 1)
    if rise and sett:
        out["status"] = "rises"
        out["rise"] = _body_point(_utc(rise), body, today)
        out["set"] = _body_point(_utc(sett), body, today)
    else:
        out["status"] = "circumpolar" if alt_t > 0 else "never"
    out["night"] = []
    for hour, add_day in ((21, 0), (0, 1), (3, 1)):
        t = datetime(today.year, today.month, today.day, hour, tzinfo=KST) + timedelta(days=add_day)
        p = _body_point(t, body, today)
        p["label"] = f"{hour:02d}시"
        out["night"].append(p)
    return out


def observe(star, now=None):
    if star.get("kind"):
        return observe_body(star, now)
    now = (now or datetime.now(timezone.utc)).astimezone(KST)
    today = now.date()
    ref = datetime(today.year, today.month, today.day, 12, tzinfo=KST)   # 오늘 낮 12시부터 24시간 안의 남중을 찾는다
    ra, dec = star["ra_hours"], star["dec_deg"]
    max_alt = 90 - abs(LAT - dec)
    out = {"source": "star", "max_alt": round(max_alt, 2), "best_month": best_month(ra)}   # 소수 둘째 자리까지 줘야 화면 반올림이 정보 칸과 같다
    cos_h0 = (math.sin(math.radians(H_STAR)) - math.sin(math.radians(LAT)) * math.sin(math.radians(dec))) / (
        math.cos(math.radians(LAT)) * math.cos(math.radians(dec)))
    h_now = ((gmst_deg(ref) + LON) % 360 - ra * 15) % 360
    transit = ref + timedelta(days=((-h_now) % 360) / SIDEREAL)
    out["transit"] = _point(transit, star, today)
    if cos_h0 > 1:
        out["status"] = "never"      # 서울에서는 떠오르지 않는다
    elif cos_h0 < -1:
        out["status"] = "circumpolar"  # 지지 않는다
    else:
        h0 = math.degrees(math.acos(cos_h0))
        half = timedelta(days=h0 / SIDEREAL)
        out["status"] = "rises"
        out["rise"] = _point(transit - half, star, today)
        out["set"] = _point(transit + half, star, today)
    # 오늘 밤 세 시각의 고도. 낮에는 하늘이 밝아 못 보는 점은 화면 문구로 안내한다
    out["night"] = []
    for hour, add_day in ((21, 0), (0, 1), (3, 1)):
        t = datetime(today.year, today.month, today.day, hour, tzinfo=KST) + timedelta(days=add_day)
        p = _point(t, star, today)
        p["label"] = f"{hour:02d}시"
        out["night"].append(p)
    return out
