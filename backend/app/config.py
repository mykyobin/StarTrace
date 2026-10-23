from pathlib import Path

import yaml
from dotenv import load_dotenv
import os

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

with open(ROOT / "settings.yaml", encoding="utf-8") as f:
    settings = yaml.safe_load(f)


KEYS = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY")   # Claude 는 답변·선별, OpenAI 는 임베딩


def api_key(name):
    # 비어 있으면 None. 호출하는 쪽에서 안내 문구를 띄운다
    return os.getenv(name) or None


def missing_keys():
    return [k for k in KEYS if not api_key(k)]
