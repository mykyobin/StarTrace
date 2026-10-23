# 데이터 출처와 이용 조건

사용한 데이터의 출처와 이용 조건 기록입니다. 새 출처를 쓰면 이 표에 줄을 추가합니다.

| 용도 | 출처 | 받은 날 | 이용 조건 |
|---|---|---|---|
| 별 목록(항목 메타데이터) | HYG Database v4.4, https://codeberg.org/astronexus/hyg (`data/hyg/CURRENT/hyg_v44.csv.gz`) | 2026-10-21 | CC BY-SA 4.0 |
| 한국어 제목 찾기, 외부 문서 | 위키백과 API (en/ko), https://www.mediawiki.org/wiki/API:Main_page | 2026-10-21 | 본문 CC BY-SA 4.0. 요청마다 User-Agent에 연락처를 넣고 1초 이상 간격을 둔다 |
| 외계행성 정보 | NASA Exoplanet Archive TAP API (`pscomppars` 표), https://exoplanetarchive.ipac.caltech.edu | 2026-10-21 | 별도 라이선스 없음. 결과물에 NASA Exoplanet Archive 표기를 요청 (아래 확인 기록) |
| 별 사진 | NASA SkyView (https://skyview.gsfc.nasa.gov), Digitized Sky Survey (DSS2 Red, 안 되면 DSS) | 2026-10-21 | 퍼블릭 도메인 아님, 저작권자가 사진판마다 다름. 허용 범위는 미확인. 저장소에서 제외 |
| 지구 사진 | NASA Visible Earth, Blue Marble(낮)과 Black Marble(밤) | 2026-10-21 | NASA 콘텐츠는 일반적으로 저작권 대상 아님. NASA를 출처로 표시 (아래 확인 기록) |

## NASA Exoplanet Archive

- 행성 기록 6,451건을 받아 `data/raw/exoplanets.json`에 저장했습니다(원본, git 제외). 저장소에서는 `scripts/add_nasa.py`로 다시 만들 수 있습니다.
- 별 목록의 HIP·HD 번호로 행성 호스트 별과 이었습니다. 이름은 표기가 달라서(`gam1 Leo` 등) 쓰지 않았습니다. 200개 중 **15개**가 일치했습니다.
- 별마다 문서 1건을 만듭니다. 위키 본문이 긴 줄글인 것과 달리 행성 한 줄이 그 자체로 읽히는 짧은 표라서, 같은 분할기를 쓰되 줄 단위로 끊깁니다. 문서가 대부분 청크 1개입니다.
- 근거 화면에서는 출처 종류를 `NASA Exoplanet Archive`로 표시해 위키백과와 구분합니다.

## NASA 사진

- 별 사진은 `scripts/fetch_photos.py`가 좌표(J2000)로 SkyView에 요청해 `data/photos/{별ID}.jpg`에 저장합니다. 가로 1도, 600픽셀입니다.
- 화면은 이 사진의 중앙값을 검은 점으로 잡아 늘려서 보여줍니다. 서버의 원본 파일은 바꾸지 않습니다.
- 지구 사진은 `frontend/public/textures/earth_day.jpg`, `earth_night.jpg`입니다. 낮 사진은 NASA Earth Observatory 파일이고 밤 사진은 2012년 Black Marble입니다.

## 위키백과

- 1단계에서는 영어판 문서의 언어 간 링크로 각 별의 한국어 문서 제목만 가져왔습니다(`scripts/build_stars.py`).
- 영어판 문서의 분류에 "star"가 들어 있는 문서만 별 문서로 인정합니다. `Naja`(코브라), `Felis`(고양이속)처럼 이름이 같은 다른 문서는 이렇게 걸러집니다.
- 본문은 2026-10-21에 별 200개 전부에 대해 수집해 `data/docs/{별ID}.json`에 저장했습니다. 문서마다 원문 주소(url), 위키 문서 ID, 검색어, 수집일, 채택·버림 판정이 함께 들어 있습니다.
- 한 문서는 최대 10,000자까지 저장하고, 각주·외부 링크 같은 뒤쪽 구간은 잘랐습니다.
- 결과: 별 200개, 문서 487건(별당 1~4건), 후보 2,641건 중 채택 287건. 별 자체 문서는 200개 모두 있습니다.

## HYG Database

- 제작: David Nash (astronexus). Hipparcos, Yale Bright Star, Gliese 세 카탈로그를 합친 별 목록입니다.
- 저장소는 GitHub(`astronexus/HYG-Database`)에서 Codeberg(`astronexus/hyg`)로 옮겨졌습니다. 최신 버전은 Codeberg에 있습니다.
- 받은 파일: `hyg_v44.csv.gz` (13,636,362 바이트), SHA-256 `00b349893b9a53106dd488d8371e8d2fa586043e500bb3cdb8bff3931682197d`
- 압축을 푼 `hyg_v44.csv`는 119,614행이고, 고유명(`proper`)이 있는 별은 549개입니다.
- 원본은 `backend/data/raw/`에 있고 git에는 올리지 않습니다. 저장소 주소와 해시로 같은 파일을 다시 받을 수 있습니다.
- 라이선스: 저장소 README와 `LICENSE`에 CC BY-SA 4.0으로 적혀 있습니다. 이 프로젝트가 만든 `stars.json`은 HYG를 가공한 것이므로 같은 조건(저작자 표시, 동일 조건 공유)을 따릅니다.
- 화면에는 "별 자료: HYG Database (CC BY-SA 4.0)" 표기를 넣습니다.

## 태양계 천체 (data/bodies.json, 2026-10-22 추가)

- 대상: 태양, 달, 수성~해왕성의 행성 7개, 명왕성(왜소행성) 모두 10개. 지구는 화면의 지구 그림이 따로 있어 넣지 않았습니다.
- 반지름·공전 궤도·주기는 NASA Planetary Fact Sheet(https://nssdc.gsfc.nasa.gov/planetary/factsheet/)의 값을 옮겨 적었습니다. 이용 조건은 위 "NASA 이미지 일반 정책"과 같은 NASA 콘텐츠 기준으로 읽었고, 이 페이지 고유의 조건은 따로 확인하지 못했습니다.
- 위치와 밝기는 astronomy-engine 2.1.19(MIT 라이선스, https://github.com/cosinekitty/astronomy)로 시각마다 계산합니다. 파일에 좌표를 두지 않습니다.
- 설명 문서는 별과 같은 방식으로 한국어 위키백과에서 수집했습니다(천체당 1~4건, CC BY-SA 4.0, 근거마다 원문 링크).
- 천체 표면 이미지는 NASA 공식 출처만 씁니다. 목록은 `backend/data/nasa_assets.json`, 받는 스크립트는 `backend/scripts/fetch_nasa_assets.py`이고 받은 크기와 해시는 `backend/data/nasa_manifest.json`에 남습니다. 이전에 임시로 쓰던 Wikimedia Commons 재가공본은 모두 지웠습니다(개인이 색을 입히거나 잘라낸 파일이 섞여 있었습니다).
  - 목성: Cassini 전체 지도 PIA07782 (NASA/JPL/Space Science Institute) https://photojournal.jpl.nasa.gov/catalog/PIA07782
  - 명왕성: New Horizons 전체 색 지도 PIA11707 (NASA/JHUAPL/SwRI) https://photojournal.jpl.nasa.gov/catalog/PIA11707
  - 달: NASA SVS 4720 CGI Moon Kit의 `lroc_color_2k.jpg` (LRO LROC/LOLA, 크레딧 "NASA's Scientific Visualization Studio") https://svs.gsfc.nasa.gov/4720 — 페이지에 "optimized for aesthetics, not science"라고 적혀 있어 화면 캡션에도 밝힙니다.
  - 금성(PIA23791 Mariner 10), 토성(PIA05389 Cassini), 천왕성(PIA00032 Voyager 2), 해왕성(ARC-1989-AC89-7001 Voyager 2): 전체 지도가 없어서 공식 원판 사진에서 위도별 색만 읽어 띠 무늬로 그립니다. 화면 캡션에 "사진의 색을 읽어 그린 표면"이라고 밝힙니다.
  - 태양: SDO가 방금 찍은 사진(https://sdo.gsfc.nasa.gov/assets/img/latest/, HMI 가시광과 AIA 171Å 자외선)을 서버가 15분마다 받아 씁니다. 크레딧 "NASA/SDO and the HMI/AIA science teams". 이용 조건 페이지(Data Rules, Copyright Permissions)는 읽지 못했습니다.
  - 수성, 화성: NASA 이미지 라이브러리(images.nasa.gov)에는 전체 지도가 없어서, NASA 탐사선 데이터로 미국 지질조사국이 만든 공식 지도(USGS Astrogeology Science Center, 미 연방정부 저작물)를 씁니다. 이용 조건은 데이터 페이지의 "cite authors"(만든 이를 밝힐 것)라서 화면 캡션과 이 문서에 크레딧을 적습니다.
    - 화성: Mars Viking MDIM2.1 Colorized Global Mosaic, 1024px 판 (NASA/JPL, USGS Astrogeology) https://astrogeology.usgs.gov/ckan/dataset/7131d503-cdc9-45a5-8f83-5126c0fd397e/resource/6afad901-1caa-48a7-8b62-3911da0004c2
    - 수성: Mercury MESSENGER MDIS Basemap MD3 Color Global Mosaic, 1024px 판 (NASA/JHUAPL/Carnegie Institution of Washington, USGS Astrogeology) https://astrogeology.usgs.gov/ckan/dataset/fc37692f-e806-4632-b300-0250bb61c3de/resource/b1ef80b6-a44a-4c24-8786-e5e901842657 — 원본은 성분 차이를 보이려고 색을 강조한 지도라서 받을 때 채도를 30%로 낮춥니다(`nasa_assets.json`의 `saturation`). 화면 캡션에도 밝힙니다.
  - 고리는 이미지가 아니라 NASA Planetary Rings Fact Sheet(https://nssdc.gsfc.nasa.gov/planetary/factsheet/ 의 jupringfact, satringfact, uranringfact, nepringfact)의 구간 반지름으로 그립니다. 희미한 바깥 고리(목성 아말테아·테베 거미줄 고리, 토성 D·F·G·E 고리, 천왕성 ν·μ 고리)도 넣었습니다. 토성 주 고리 말고는 실제로 아주 어둡고 가늘어서 1px 이상 굵기로 밝게 그리고, 화면에 그 사실을 적습니다. 토성의 포이베 고리(토성 반지름 수백 배 크기, 공전면에 기울어짐)는 넣지 않았습니다.
  - 해왕성 애덤스 고리의 덩어리(호) 다섯 개는 1989~2016년 관측의 상대 배치를 대략 따라 그렸고, 호 무리가 도는 빠르기 820.1194°/일로 돌립니다. 기준 경도 자료가 없어 지금 경도는 대략이며, 화면에 그렇게 적습니다.
  - 그림자: 행성 그림자에 든 고리와 위성은 어둡게, 토성 고리와 큰 위성(행성마다 8개까지)은 행성 표면에 그림자를 드리웁니다. 모두 실제 태양 방향으로 계산합니다.
- 위성 (2026-10-22 정리): 6개 행성의 위성 459개.
  - 목록, 궤도: JPL Planetary Satellite Mean Elements https://ssd.jpl.nasa.gov/sats/elem/ , 크기: JPL Planetary Satellite Physical Parameters https://ssd.jpl.nasa.gov/sats/phys_par/ (`backend/scripts/build_moons.py`가 `backend/data/moons.json`으로 정리). 한글 이름은 주요 위성만 직접 붙였습니다.
  - 정밀 위치: 크기가 알려진 주요 위성 41개는 서버가 JPL Horizons API(https://ssd.jpl.nasa.gov/api/horizons.api)에서 하루치 위치를 20분 간격으로 받아 22시간 동안 씁니다(`backend/data/cache/`). 목성 갈릴레이 위성 4개는 astronomy-engine `JupiterMoons`로 계산합니다.
  - 나머지 작은 위성 410여 개는 평균 궤도 요소로 케플러 궤도를 풀어 근사 위치를 보여줍니다. Horizons와 비교하면 위상이 수십 도 어긋나는 위성도 있어서(평균 요소는 섭동을 평균낸 값), 화면에 "근사 위치"라고 적습니다.
- 자전축 방향과 자전각은 IAU 값(astronomy-engine `RotationAxis`), 밝은 쪽은 실제 태양 방향으로 계산합니다. 자전 주기와 기울기 숫자는 NASA Planetary Fact Sheet 값입니다.

## 별 사진 (2026-10-22 정리)

- 별 상세 화면의 "실제 하늘 사진"은 NASA SkyView(https://skyview.gsfc.nasa.gov)에서 받습니다. 서베이는 세 가지이고 `backend/scripts/fetch_photos.py --survey`로 고릅니다.
  - `2mass`(기본): 2MASS 근적외선 J·H·K 합성. NASA·NSF 지원, UMass와 IPAC/Caltech 공동 서베이. 색은 눈에 보이는 색이 아닙니다. 인정 문구는 사용 전 2MASS 공식 페이지에서 확인해 여기에 옮겨 적어야 합니다(아직 못 읽음).
  - `wise`: NASA WISE 위성의 3.4μm 사진.
  - `dss`: 가시광 DSS. 원본 사진판마다 저작권자가 달라서 저장소에 넣지 않습니다.
- 밝은 별은 서베이 사진도 중심이 포화됩니다. 화면에서 포화된 부분만 같은 크기의 부드러운 별빛으로 다시 그립니다(둘레의 별밭은 실제 사진 그대로).
- "표면 모습(그림)"은 관측된 색지수(B−V)에서 구한 색과 온도로 그린 시뮬레이션이고 실제 사진이 아니라고 화면에 밝힙니다.
- 허블·스피처 공식 보도자료 원본(시리우스, 북극성, 포말하우트, 베가)은 아직 받지 못했습니다. 이전에 쓰던 Commons 재가공본은 지웠습니다.

## 선별 결과 (data/stars.json)

- HYG v4.4에서 고유명이 있는 별을 겉보기 등급 순으로 480개 보고, 한국어 문서가 있는 별 227개 중 밝은 순서로 200개를 골랐습니다.
- 가장 어두운 별은 4.67등급입니다. 거리가 기록되지 않은 별(Polis, Garnet Star)은 거리 문장을 뺍니다.

## 이용 조건 확인 기록 (2026-10-21)

안내 페이지를 읽고 옮긴 내용입니다. 원문과 다를 수 있으니 사용하는 사람이 직접 한 번 더 읽어야 합니다.

- **NASA Exoplanet Archive** (https://exoplanetarchive.ipac.caltech.edu/docs/acknowledge.html): 라이선스나 재사용·재배포 제한은 적혀 있지 않습니다. 다음 문장으로 표기해 달라고 요청합니다.
  > This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with the National Aeronautics and Space Administration under the Exoplanet Exploration Program.
- **NASA 이미지 일반 정책** (https://www.nasa.gov/nasa-brand-center/images-and-media/): "NASA content generally are not subject to copyright in the United States." 학교·교과서는 명시적 허락 없이 쓸 수 있고, NASA를 출처로 표시해야 합니다. NASA 로고는 퍼블릭 도메인이 아니며 NASA가 보증하는 것처럼 보이게 하면 안 됩니다. NASA가 게시한 제3자 이미지는 저작권자 이름이 따로 붙습니다. Blue Marble 개별 이미지에 제3자 표기가 있는지는 확인하지 못했습니다.
- **SkyView의 DSS** (https://skyview.gsfc.nasa.gov/current/cgi/survey.pl, https://archive.stsci.edu/dss/copyright.html): "There are multiple copyright holders depending upon the source plate or plates." 남반구 2차 서베이는 Anglo-Australian Observatory Board(1993-5), 적도 적색 아틀라스는 UK SERC/PPARC와 Anglo-Australian Telescope Board(1992-5), 북반구 팔로마 서베이는 California Institute of Technology(1993-1995), 나머지는 AURA(1995)가 저작권을 가지며 "계약에 따라 배포"된다고 합니다. 사용 허용 범위(비영리·교육용 등)는 이 페이지에 없었고 별도의 Data Use Policy 페이지는 읽지 못했습니다. 그래서 별 사진은 제출 zip에 넣지 않았습니다.
