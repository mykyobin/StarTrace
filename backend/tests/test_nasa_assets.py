import io
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_nasa_assets as f  # noqa: E402


def _png(im):
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def test_profile_reads_latitude_bands_from_a_disc_photo():
    im = Image.new("RGB", (200, 200), (0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([20, 20, 180, 180], fill=(200, 160, 60))
    d.rectangle([20, 20, 180, 70], fill=(60, 60, 200))         # 위쪽 띠는 파란색
    d.ellipse([20, 20, 180, 180], outline=None)
    prof = f.make_profile(_png(im), n=16)
    assert len(prof) == 16
    assert prof[1][2] > prof[1][0]        # 위쪽은 파랑이 우세
    assert prof[14][0] > prof[14][2]      # 아래쪽은 황토색이 우세


def test_left_half_crop_ignores_the_other_view():
    im = Image.new("RGB", (400, 200), (0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([20, 20, 180, 180], fill=(10, 200, 10))          # 왼쪽 그림: 초록
    d.ellipse([220, 20, 380, 180], fill=(200, 10, 10))         # 오른쪽 그림: 빨강
    prof = f.make_profile(_png(im), crop="left", n=8)
    assert all(p[1] > p[0] for p in prof)


def test_map_is_shrunk_to_fit_but_never_enlarged():
    big = f.make_map(_png(Image.new("RGB", (4000, 2000), (9, 9, 9))), [2048, 1024])[1]
    small = f.make_map(_png(Image.new("RGB", (1024, 512), (9, 9, 9))), [2048, 1024])[1]
    assert big == (2048, 1024) and small == (1024, 512)


def test_saturation_option_greys_out_an_enhanced_map():
    raw = _png(Image.new("RGB", (64, 32), (200, 60, 60)))
    r, g, b = Image.open(io.BytesIO(f.make_map(raw, [64, 32], 0.3)[0])).getpixel((10, 10))
    assert r - b < 60          # 원래 140 차이가 줄었다
