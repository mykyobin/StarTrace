"""별마다 NASA SkyView 에서 실제 하늘 사진을 받아 data/photos/{서베이}/{별ID}.jpg 로 저장한다.

서베이 (--survey):
  2mass  2MASS 근적외선 J·H·K 를 RGB 로 합친 사진 (기본). NASA·NSF 지원, 전천. 색은 눈에 보이는 색이 아니다.
  wise   NASA WISE 위성 3.4μm 중적외선 사진.
  dss    Digitized Sky Survey 가시광 사진. 원본 사진판마다 저작권자가 달라서 저장소에는 넣지 않는다.

  python scripts/fetch_photos.py --test              # sirius 한 장만 받아 화면 없이 형식을 확인한다
  python scripts/fetch_photos.py                     # 2mass 로 200개 (약 25~40분)
  python scripts/fetch_photos.py --survey wise betelgeuse vega
키는 필요 없다. 이미 받은 별은 건너뛰고, 호출 사이에 간격을 둔다. 받은 기록은 data/photos/manifest.json 에 남긴다.
"""
import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import ROOT, settings  # noqa: E402
from app.data_prep.stars import load_stars  # noqa: E402

URL = "https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl"
OUT = ROOT / "data/photos"
GAP = 1.5
# 서베이마다 시도할 (이름, 추가 인자) 순서. 앞이 비어 있는 하늘 구역이면 다음 것으로 한 번 더 시도한다
SURVEYS = {
    "2mass": [("2MASS-K,2MASS-H,2MASS-J", {"RGB": "1"}), ("2MASS-K", {})],
    "wise": [("WISE 3.4", {})],
    "dss": [("DSS2 Red", {}), ("DSS", {})],
}


def fetch(star, survey, size, pixels):
    for name, extra in SURVEYS[survey]:
        r = requests.get(URL, params={"Position": f"{star['ra_hours'] * 15:.5f},{star['dec_deg']:.5f}", "Survey": name,
                                      "Return": "JPEG", "Pixels": pixels, "Size": size, "Sampler": "Clip",
                                      "coordinates": "J2000", **extra},
                         headers={"User-Agent": settings["wiki"]["user_agent"]}, timeout=120)
        if r.ok and r.headers.get("content-type", "").startswith("image/") and len(r.content) > 3000:
            return r.content, name
        time.sleep(GAP)
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--survey", choices=list(SURVEYS), default="2mass")
    ap.add_argument("--size", type=float, default=0.5, help="한 변의 시야(도)")
    ap.add_argument("--pixels", type=int, default=1024)
    ap.add_argument("--test", action="store_true", help="sirius 한 장만 받는다")
    a = ap.parse_args()
    folder = OUT / a.survey
    folder.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    stars = [s for s in load_stars() if (not a.ids or s["id"] in a.ids) and (not a.test or s["id"] == "sirius")]
    for i, s in enumerate(stars, 1):
        path = folder / f"{s['id']}.jpg"
        legacy = OUT / f"{s['id']}.jpg"          # 예전에 받은 DSS 사진
        if path.exists() or (a.survey == "dss" and legacy.exists()):
            continue
        try:
            data, name = fetch(s, a.survey, a.size, a.pixels)
        except requests.RequestException as e:
            print(f"[{i}/{len(stars)}] {s['id']} 실패: {type(e).__name__}", flush=True)
            continue
        if data:
            path.write_bytes(data)
            manifest[f"{a.survey}/{s['id']}"] = {"survey": name, "bytes": len(data), "size_deg": a.size, "pixels": a.pixels,
                                                  "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            print(f"[{i}/{len(stars)}] {s['id']} {name} {len(data) // 1024}KB", flush=True)
        else:
            print(f"[{i}/{len(stars)}] {s['id']} 사진 없음", flush=True)
        time.sleep(GAP)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
