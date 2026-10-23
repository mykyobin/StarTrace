"""data/nasa_assets.json 의 NASA 공식 이미지를 받아 frontend/public/nasa/ 에 둔다.

- 지도(map): 정거원통도법 전체 지도를 2048x1024 이하로 줄여 {id}_map.jpg 로 저장한다. saturation 이 있으면 채도를 그만큼 낮춘다.
- 지도의 tint: 흑백 지도에 그 천체의 평균 색을 입힌다(유로파·칼리스토처럼 공식 지도가 흑백인 위성).
- 사진(photo): 둥글지 않은 작은 위성은 공식 사진 한 장을 1024px 이하로 줄여 {id}_photo.jpg 로 저장한다.
- 띠 무늬(profile): 공식 전체 원판 사진에서 위도별 색을 읽어 {id}_profile.json 으로 저장한다. 표면 지도가 없는 천체용이다.
- 이미 받은 파일은 건너뛰고, 호출 사이에 간격을 둔다. 받은 크기와 해시는 data/nasa_manifest.json 에 기록한다.
- 키는 필요 없다. api.nasa.gov 계열 주소를 쓰는 자산이 생기면 NASA_API_KEY(환경변수 또는 backend/.env)를 읽어 쓰고, 값은 출력하지 않는다.

  python scripts/fetch_nasa_assets.py            # 전부
  python scripts/fetch_nasa_assets.py jupiter_map moon_map
  python scripts/fetch_nasa_assets.py --list     # 받을 목록과 상태만 보기
"""
import hashlib
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT.parent / "frontend/public/nasa"
UA = {"User-Agent": "StarTrace/0.1 (mykyobinlove@naver.com) NASA asset fetch"}
GAP = 1.5


def api_key():
    key = os.environ.get("NASA_API_KEY")
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("NASA_API_KEY="):
                key = line.split("=", 1)[1].strip()
    return key or None


def get(url):
    host = urllib.parse.urlparse(url).hostname or ""
    if host == "api.nasa.gov":                       # 키는 이 주소로 갈 때만 붙인다
        key = api_key()
        if not key:
            raise SystemExit("api.nasa.gov 주소를 받으려면 backend/.env 에 NASA_API_KEY= 를 넣어 주세요.")
        url += ("&" if "?" in url else "?") + "api_key=" + key
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                return r.read()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt * 2)


def heal_edges(im, jump=40):
    """원본 지도 가장자리의 흰 테두리·검은 줄을 안쪽 줄로 덮는다. 구에 입히면 경도 0° 이음매나 극점에 선으로 보인다.
    가장자리 2줄만 보고, 안쪽 줄과 평균 밝기가 jump 넘게 다를 때만 바꾼다(명왕성 남쪽처럼 넓게 빈 곳은 그대로)."""
    w, h = im.size
    g = im.convert("L")
    mean = lambda box: sum(g.crop(box).getdata()) / ((box[2] - box[0]) * (box[3] - box[1]))
    for edge, inner in ((1, 2), (0, 1), (w - 2, w - 3), (w - 1, w - 2)):
        if abs(mean((edge, 0, edge + 1, h)) - mean((inner, 0, inner + 1, h))) > jump:
            im.paste(im.crop((inner, 0, inner + 1, h)), (edge, 0))
            g = im.convert("L")
    for edge, inner in ((1, 2), (0, 1), (h - 2, h - 3), (h - 1, h - 2)):
        if abs(mean((0, edge, w, edge + 1)) - mean((0, inner, w, inner + 1))) > jump:
            im.paste(im.crop((0, inner, w, inner + 1)), (0, edge))
            g = im.convert("L")
    # 극 둘레에 관측이 빠진 검은 줄이 몇 줄(8줄 이하)만 있으면 처음 찍힌 줄로 채운다. 극은 한 점이라 한 줄로 채워도 구에선 작은 원이다
    for rows in (range(0, 9), range(h - 1, h - 10, -1)):
        dark = [y for y in rows if mean((0, y, w, y + 1)) < 8]
        n = next((k for k, y in enumerate(rows) if y not in dark), None)
        if 0 < len(dark) == n <= 8:
            src = im.crop((0, rows[n], w, rows[n] + 1))
            for y in dark:
                im.paste(src, (0, y))
    return im


def make_map(raw, size, saturation=1.0, tint=None):
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    im.thumbnail(tuple(size), Image.LANCZOS)
    im = heal_edges(im)
    if tint:                                     # 흑백 지도 -> 평균 색. 밝기는 그대로 두고 색만 입힌다
        g = ImageOps.autocontrast(im.convert("L"), cutoff=1)   # 원본이 어두운 위성(칼리스토)도 무늬가 보이게 밝기를 펴 준다
        im = Image.merge("RGB", [g.point(lambda v, c=c: v * c // 255) for c in tint])
    if saturation != 1.0:                        # 색 강조된 지도를 눈에 보이는 색에 가깝게 누른다
        im = ImageEnhance.Color(im).enhance(saturation)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=90)
    return buf.getvalue(), im.size


def make_photo(raw, size):
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    im.thumbnail(tuple(size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=90)
    return buf.getvalue(), im.size


def make_profile(raw, crop=None, n=64):
    """원판 사진 한 장에서 위도별(위에서 아래로) 평균 색 n개를 읽는다. 원판은 어두운 배경 위의 가장 큰 밝은 덩어리로 본다."""
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    if crop == "left":
        im = im.crop((0, 0, im.width // 2, im.height))
    mask = im.convert("L").point(lambda v: 255 if v > 40 else 0)
    x0, y0, x1, y1 = mask.getbbox() or (0, 0, im.width, im.height)
    cx, r = (x0 + x1) / 2, min(x1 - x0, y1 - y0) / 2
    cy = (y0 + y1) / 2
    px = im.load()
    out = []
    for k in range(n):
        y = cy - r * 0.96 + (2 * r * 0.96) * (k + 0.5) / n
        half = max(1, int((r * r - (y - cy) ** 2) ** 0.5 * 0.5))   # 이 높이에서 원판 너비의 가운데 절반만 평균
        xs = range(int(cx - half), int(cx + half) + 1)
        cols = [px[x, int(y)] for x in xs if 0 <= x < im.width and 0 <= int(y) < im.height]
        out.append([round(sum(c[i] for c in cols) / max(1, len(cols))) for i in range(3)])
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    meta = json.loads((ROOT / "data/nasa_assets.json").read_text(encoding="utf-8"))
    items = {k: v for k, v in meta["assets"].items() if not args or k in args}
    if "--list" in sys.argv:
        for k, v in items.items():
            print(f"{k:16} {v['status']:15} {v.get('nasa_id', ''):22} {v.get('bytes', '')} {v.get('url', '(받을 주소 미정)')}")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = ROOT / "data/nasa_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    for key, a in items.items():
        proc = a["process"]
        if proc["kind"] == "live" or a["status"] == "pending-source" or not a.get("url"):
            print(f"{key}: 건너뜀 ({a['status']})")
            continue
        dest = OUT / a["local"]
        if dest.exists():
            print(f"{key}: 이미 있음")
            continue
        raw = get(a["url"])
        if proc["kind"] == "map":
            data, size = make_map(raw, proc["size"], proc.get("saturation", 1.0), proc.get("tint"))
            dest.write_bytes(data)
        elif proc["kind"] == "photo":
            data, size = make_photo(raw, proc["size"])
            dest.write_bytes(data)
        else:
            dest.write_text(json.dumps(make_profile(raw, proc.get("crop")), separators=(",", ":")), encoding="utf-8")
            size = None
        manifest[key] = {"source": a["url"], "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                         "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"), "out": a["local"], "size": size}
        print(f"{key}: {len(raw) // 1024}KB 받음 -> {a['local']}", flush=True)
        time.sleep(GAP)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
