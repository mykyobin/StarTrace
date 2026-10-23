# Star Trace

실제 밝은 별 200개를 하늘에 띄워 놓고, 별을 눌러 질문하면 문서 근거를 붙여 답해 주는 별지도 서비스입니다. RAG(검색 증강 생성)로 만든 천문학 지식 서비스입니다.

- 하늘은 현재 항성시에 맞춰 실제로 돕니다. 지구는 NASA 위성 사진이고 낮밤 경계가 시각에 따라 움직입니다.
- 질문하면 별이 가진 문서(한국어 위키백과, NASA 외계행성 자료)에서 근거를 찾아 답하고, **답변에 실제로 쓰인 근거만** 제목과 원문 링크로 보여줍니다.
- 문서에 없는 것은 추측하지 않고 "확인되지 않습니다"라고 답합니다.

## 실행 방법

필요한 것: Python 3.10 이상, Node.js, API 키 두 개.

| 키 | 쓰는 곳 | 발급 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude Haiku 5.5: 검색어 추출, 문서 선별, 답변, 조건 탐색 | https://console.anthropic.com |
| `OPENAI_API_KEY` | OpenAI `text-embedding-3-large`: 별 목록과 문서 임베딩 | https://platform.openai.com |

명령은 모두 슬래시(`/`) 경로로 적었습니다. Git Bash 는 백슬래시를 지워 버려서 `.venv\Scripts\python` 이 "command not found" 가 되기 때문입니다. PowerShell·cmd 에서도 슬래시 경로가 동작합니다. 프롬프트에 `(.venv)` 가 보이면 가상환경이 켜진 상태라 `.venv/Scripts/python` 대신 `python` 만 써도 됩니다.

### 처음 한 번 (clone 직후)

```bash
# 1) 백엔드 (모든 명령은 backend 폴더 안에서 실행)
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # macOS/Linux 는 .venv/bin/pip
cp .env.example .env                                 # PowerShell·cmd 는 copy .env.example .env
# backend/.env 를 열어 ANTHROPIC_API_KEY=, OPENAI_API_KEY= 뒤에 키를 입력합니다 (.env 는 git 에 올라가지 않습니다)
.venv/Scripts/python scripts/index_stars.py          # 별 200개와 태양계 천체 10개를 star_meta 에 색인
.venv/Scripts/python scripts/index_docs.py           # 수집해 둔 위키·NASA 문서를 청킹해 star_docs 에 색인
.venv/Scripts/python scripts/fetch_nasa_assets.py    # (선택) 천체 표면 이미지. 없으면 색으로 그린 표면이 나옵니다
.venv/Scripts/python -m uvicorn app.api:app --port 8000

# 2) 프론트엔드 (다른 터미널, 프로젝트 루트에서)
cd frontend
npm install
npm run dev                                          # http://localhost:5173
```

### 다음부터

색인은 `backend/chroma/`에 저장되어 남아 있으므로 서버만 켜면 됩니다.

```bash
# 백엔드
cd backend
.venv/Scripts/python -m uvicorn app.api:app --port 8000

# 프론트엔드 (다른 터미널, 프로젝트 루트에서)
cd frontend
npm run dev
```

다시 색인해야 하는 경우는 다음과 같습니다.

- `settings.yaml`의 `chunk.size`·`chunk.overlap`을 바꿨거나 `data/docs/*.json`이 바뀌었을 때: `scripts/index_docs.py`
- `data/stars.json`이 바뀌었을 때: `scripts/index_stars.py`
- `backend/chroma/` 폴더를 지웠을 때: 둘 다
- `settings.yaml`의 `embedding.model`을 바꿨을 때: 벡터 차원이 달라지므로 `backend/chroma/`를 지우고 둘 다 다시 색인

백엔드 코드, 설정, 색인을 바꿨으면 실행 중인 uvicorn 을 끄고 다시 켭니다(`--reload`를 주지 않았으므로 자동으로 반영되지 않습니다).

`requirements.txt`나 `package.json`이 바뀌었으면 `pip install -r requirements.txt` / `npm install`을 한 번 더 실행합니다.

위키 문서(`backend/data/docs/*.json`, NASA 행성 문서 포함)와 별 목록(`data/stars.json`)은 저장소에 들어 있어서 다시 받지 않아도 됩니다. 별 사진은 저작권 때문에 들어 있지 않습니다. 처음부터 다시 만들려면 아래 "데이터 준비와 색인 절차"를 따릅니다.

키가 없거나 색인이 비어 있어도 화면은 열리고, 상단에 무엇을 해야 하는지 안내가 나옵니다.

## 기능

| 기능 | 내용 | 구현 위치 |
|---|---|---|
| 별 목록 색인 | 별 200개와 태양계 천체 10개를 검색용 텍스트로 만들어 `star_meta` 컬렉션에 색인 (ID 고정, 다시 실행해도 중복 없음) | `app/data_prep/`, `app/vectorstore/store.py`, `scripts/index_stars.py` |
| 문서 수집 | 질문에서 위키 검색어 추출 → 위키 검색 → 후보 문서 선별 → 본문과 원문 주소 수집. 이미 수집한 검색어는 다시 받지 않음 | `app/rag/collect.py`, `app/data_prep/wiki.py` |
| 문서 색인 | 청킹해 `star_docs` 컬렉션에 색인 (청크 크기·겹침은 설정 파일) | `app/vectorstore/chunks.py`, `scripts/index_docs.py` |
| 검색 | 선택한 별의 메타 청크는 항상 포함, 문서 청크는 그 별로 좁혀 검색, 병합·중복 제거. 유사도 검색과 MMR 중 선택 | `app/rag/retrieve.py` |
| 답변 | LangGraph `retrieve → generate` 두 노드. `[근거 N]`을 붙여 답하고 실제로 인용한 근거만 제목·원문 링크와 함께 표시. 근거에 없으면 "확인되지 않습니다" | `app/rag/graph.py`, `frontend/src/components/ChatPanel.jsx` |
| 별마다 대화 | 별을 바꾸면 대화가 따로 유지됨 | `frontend/src/App.jsx` |
| 관측 가이드 | 서울에서 뜨고 지는 시각과 높이를 계산하고, 찾는 요령은 문서 근거로 답함 | `app/services/feature.py`, `frontend/src/components/GuidePanel.jsx` |
| 조건 탐색 | "오리온자리의 붉은 초거성" 같은 자연어 조건으로 별 찾기 | `app/services/explore.py` |
| 출처 구분 | 한국어 위키백과와 NASA Exoplanet Archive를 함께 색인하고, 근거에 출처 종류를 배지로 표시 | `app/data_prep/nasa.py` |
| 화면 | React + Three.js 별지도, FastAPI 서버와 분리 (요청·응답 형식은 `app/api.py`) | `frontend/` |

## 데이터 준비와 색인 절차

1. **별 목록**: HYG Database v4.4 CSV를 `backend/data/raw/`에 넣고 `scripts/build_stars.py`를 실행합니다. 이름이 있고 한국어 위키 문서가 있는 별 중 밝은 순서로 200개를 `data/stars.json`에 저장합니다.
2. **메타 색인**: `scripts/index_stars.py`
3. **문서 수집**: `scripts/precollect.py`가 별마다 검색어 추출 → 위키 검색 → 후보 선별 → 본문 수집을 하고 결과를 `data/docs/{별ID}.json`에 저장합니다. 위키 호출 간격 1초라 200개에 50분쯤 걸립니다. 끊겨도 다시 실행하면 이어서 합니다.
4. **NASA 행성 문서**: `scripts/add_nasa.py` (행성을 가진 별 15개)
5. **문서 색인**: `scripts/index_docs.py` (`--count`만 주면 색인 없이 청크 수만 셉니다)
6. **별 사진** (선택): `scripts/fetch_photos.py --survey 2mass|wise|dss` (NASA SkyView, 기본 2MASS 근적외선, 별당 약 7~10초). `--test`는 시리우스 한 장만 받습니다. 저장 위치는 `data/photos/{서베이}/`이고 DSS는 사진판 저작권 때문에 저장소에 넣지 않습니다. 사진이 없으면 화면은 관측값으로 그린 별 표면만 보여줍니다
7. **천체 표면 이미지** (선택): `scripts/fetch_nasa_assets.py` (NASA 공식 이미지, 수성·화성은 USGS Astrogeology 공식 지도). 아래 "태양계 천체" 참고

## 태양계 천체

별 200개 외에 태양·달·행성 7개·명왕성을 같은 지도에 넣었습니다. 별과 달리 위치가 날마다 바뀌어서 좌표를 파일에 두지 않고 `astronomy-engine`으로 시각마다 계산합니다(화면은 JS 판, 관측 가이드는 Python 판). 같은 `star_meta`·`star_docs` 컬렉션에 `kind` 필드로 구분해 색인하므로 질문·조건 탐색·관측 가이드가 별과 같은 경로를 탑니다.

- 지도의 천체는 NASA 공식 이미지를 입힌 3D 구입니다. 자전축 방향과 밝은 쪽(위상)은 지금 서울에서 보이는 실제 모습이고, 태양은 SDO가 방금 찍은 사진입니다. 지도와 상세 화면 모두 자전만 한 바퀴 24초로 빠르게 돌려 보여주고(역행 자전은 거꾸로, 달은 돌리지 않음), 상세 화면에는 배속을 표시합니다. 상세 화면에서는 끌어서 어느 방향으로든 돌려 볼 수 있고, "보는 방향 되돌리기"로 지구에서 보는 방향으로 돌아옵니다.
- 고리는 토성·목성·천왕성·해왕성 모두 NASA 고리 자료의 반지름으로 그립니다(희미한 바깥 고리, 해왕성 애덤스 고리의 호 포함). 행성 그림자에 든 고리·위성은 어두워지고, 토성 고리와 큰 위성은 행성 표면에 그림자를 드리웁니다.
- 위성이 있는 행성은 상세 화면에서 "행성 / 주요 위성 / 전체 위성"(또는 휠)로 범위를 넓혀 위성 459개의 지금 위치를 봅니다. 주요 위성은 JPL Horizons 정밀 위치(서버가 하루치를 받아 둠, 토성은 처음 한 번 약 20초), 나머지는 JPL 평균 궤도로 계산한 근사 위치입니다. 위성 목록을 다시 만들려면 `backend`에서 `.venv/Scripts/python scripts/build_moons.py`를 실행합니다.
- 위성을 누르면 위성 페이지로 갑니다(행성 상세 화면의 위성 점이나 "주요 위성" 버튼, 별지도에서 행성을 시야 4° 안쪽으로 확대했을 때 나오는 주요 위성). 위성 페이지는 JPL 궤도 값과 위키백과 소개(한국어 문서가 없으면 영어 첫 문단, `data/cache/moon_wiki.json`에 저장)를 보여주고, 모행성 둘레 배치 속에서 그 위성을 금색 고리로 짚습니다. 위성은 질문·관측 가이드 색인에는 넣지 않았습니다.
- 별지도는 0.15°까지 확대됩니다. 2°보다 확대하면 천체가 실제 겉보기 크기로 줄고, 시선이 하늘의 일주 운동을 따라가며(망원경 추적) 자동 이동은 멈춥니다.
- 지도는 스크롤(또는 두 손가락 벌리기)로 확대합니다. 평소 배율에서는 이름이 보이지 않고, 확대할수록 밝은 별부터 이름이 나타납니다. 가만히 두면 하늘이 천천히 돌고 "자동 이동" 버튼으로 끌 수 있습니다.
- 천체 이미지 받기 (키 불필요, 이미 받은 파일은 건너뜀):
  ```bash
  cd backend
  .venv/Scripts/python scripts/fetch_nasa_assets.py --list   # 받을 목록과 상태
  .venv/Scripts/python scripts/fetch_nasa_assets.py          # frontend/public/nasa/ 에 저장
  .venv/Scripts/python scripts/fetch_photos.py --test        # 별 사진(2MASS) 형식 확인 후
  .venv/Scripts/python scripts/fetch_photos.py               # 별 200개 (약 25~40분)
  ```
  `fetch_nasa_assets.py jupiter_map mars_map`처럼 이름을 주면 그것만 받고, 다시 받으려면 `frontend/public/nasa/`의 해당 파일을 지웁니다. 받은 크기와 해시는 `data/nasa_manifest.json`에 남습니다. 지금 목록은 키가 필요 없는 공식 주소만 쓰고, api.nasa.gov 주소를 쓰는 자산이 생기면 `backend/.env`의 `NASA_API_KEY=`를 읽습니다(코드에 두지 않음). 수성·화성은 NASA 이미지 라이브러리에 전체 지도가 없어 NASA 탐사선 데이터로 만든 USGS Astrogeology 공식 지도를 씁니다.
- 처음 한 번 `index_stars.py`(천체 10개 추가 색인), `precollect.py sun moon mercury venus mars jupiter saturn uranus neptune pluto`, `index_docs.py`를 순서대로 실행합니다.

## 설정

바꿔서 비교할 값은 모두 `backend/settings.yaml`에 있습니다.

| 값 | 기본 | 설명 |
|---|---|---|
| `chunk.size` / `chunk.overlap` | 800 / 160 | 문서 청크 길이와 겹침(글자) |
| `retrieval.top_k` | 6 | 근거 전체 개수. 메타 1건 + 문서 청크 |
| `retrieval.mode` | `similarity` | `mmr`로 바꾸면 다양성 검색 |
| `llm.fast_model` / `llm.answer_model` | `claude-haiku-5-5` / `claude-haiku-5-5` | 검색어 추출·선별·답변 모두 Haiku. `claude-sonnet-5-5`로 바꿀 수 있지만 첫 질문이 1분 넘게 걸린 적이 있음 |
| `embedding.model` | `text-embedding-3-large` | 바꾸면 3072차원이라 컬렉션을 지우고 `index_stars.py`·`index_docs.py`를 다시 실행해야 합니다 |
| `wiki.user_agent` | 연락처 포함 | 위키백과 규칙상 연락처가 있어야 합니다 |

API 사용량과 비용 추정치(달러, `settings.yaml`의 `prices` 기준)는 호출할 때마다 `backend/data/cache/usage.jsonl`에 쌓이고 `/api/status`에서 합계를 볼 수 있습니다.

## 테스트

```bash
cd backend
.venv/Scripts/python -m pytest -q                    # LLM 을 호출하지 않는 테스트 50개
.venv/Scripts/python scripts/compare_mmr.py          # 같은 질문의 유사도·MMR 근거 비교 (API 호출, data/cache/ 에 저장)
```

## 사용한 데이터와 이용 조건

자세한 기록은 `backend/data/sources.md`에 있습니다. 2026-10-21에 각 사이트의 안내 페이지를 읽고 정리했습니다.

| 용도 | 출처 | 조건 |
|---|---|---|
| 별 목록 | HYG Database v4.4 (https://codeberg.org/astronexus/hyg) | CC BY-SA 4.0 |
| 설명 문서 | 한국어 위키백과 API | CC BY-SA 4.0. 근거마다 원문 링크 표시 |
| 외계행성 정보 | NASA Exoplanet Archive | 별도 라이선스는 없고, 아래 문장을 결과물에 표기해 달라고 요청 |
| 지구 사진 | NASA Visible Earth (Blue Marble, Black Marble) | NASA 콘텐츠는 일반적으로 미국에서 저작권 대상이 아님. NASA를 출처로 표시, NASA 로고 사용과 보증 암시는 금지 |
| 별 사진 | NASA SkyView를 거친 Digitized Sky Survey | **퍼블릭 도메인이 아님.** 원본 사진판에 따라 저작권자가 다름(AAO, UK SERC/PPARC, Caltech, AURA). 허용 범위는 확인하지 못해서 저장소에는 넣지 않음 |

> This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with the National Aeronautics and Space Administration under the Exoplanet Exploration Program.

> Digitized Sky Survey: 저작권은 원본 사진판에 따라 Anglo-Australian Observatory Board, UK SERC/PPARC, California Institute of Technology, AURA가 가집니다. STScI가 배포하고 NASA SkyView를 통해 받았습니다.

화면 하단에는 HYG, NASA Exoplanet Archive, NASA Visible Earth 출처를 표시하고, 별 사진 아래에는 DSS 저작권자를 적습니다.

## 폴더 구조

```
backend/
  app/
    data_prep/    별 목록, 위키·NASA 수집 (도메인에 묶인 코드)
    vectorstore/  컬렉션, 청킹, 색인
    rag/          프롬프트, 수집, 검색, LangGraph
    services/     조건 탐색, 관측 가이드
    api.py        REST + SSE
  scripts/        색인·수집·이미지 받기 스크립트
  data/           stars.json, docs/(수집한 문서), photos/, sources.md
frontend/src/     scene(별지도·지구), views, components
```
