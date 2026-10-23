// 태양계 천체를 3D 구로 그리는 공용 코드. 지도(StarMap)와 상세 화면(BodyGlobe)이 같이 쓴다.
//
// 표면 이미지는 NASA 공식 자료를 /nasa/ 에서 읽는다 (backend/scripts/fetch_nasa_assets.py 가 받는다).
//   {id}_map.jpg       정거원통도법 전체 지도          -> 그대로 입힌다
//   {id}_profile.json  공식 원판 사진에서 읽은 위도별 색 -> 띠 무늬로 그린다 (표면 지도가 없는 천체)
//   둘 다 없으면 천체 색으로 그린 표면을 쓴다 (캡션에 이미지 준비 중이라고 알린다)
// 자전축·자전각은 IAU 값(astronomy-engine RotationAxis)이고, 밝은 쪽은 실제 태양 방향이다.
import * as Astronomy from 'astronomy-engine'
import * as THREE from 'three'
import { DEG } from './astro'
import { PLANET_R } from './moons'

const NASA = '/nasa'
// 지도와 상세 화면에서 행성 자전을 한 바퀴 이 시간(초)에 돌려 보여준다. 행성마다 배속이 달라진다
export const SPIN_LOOP_SEC = 24

// astronomy-engine 좌표(x 춘분점, y 적경 6h, z 북극)를 우리 천구 좌표(x 춘분점, y 북극, z 적경 6h 반대쪽)로
export const eqj = (v) => new THREE.Vector3(v.x, v.z, -v.y)

// 천체별 표시 설정. mode 는 이미지가 없을 때 표면을 그리는 방식이다. mapCenter 는 지도 한가운데의 경도(동경, 기본 0)
export const STYLE = {
  moon: { mode: 'rock', ambient: 0.02 },
  mercury: { mode: 'rock', ambient: 0.02 },
  venus: { mode: 'bands', ambient: 0.05, atmo: 0.55, atmoColor: [1.0, 0.9, 0.62], contrast: 0.12 },
  mars: { mode: 'rock', ambient: 0.03, atmo: 0.22, atmoColor: [1.0, 0.62, 0.42] },
  jupiter: { mode: 'bands', ambient: 0.04, atmo: 0.22, atmoColor: [1.0, 0.9, 0.7], contrast: 0.3 },
  saturn: { mode: 'bands', ambient: 0.04, atmo: 0.2, atmoColor: [1.0, 0.92, 0.7], contrast: 0.2 },
  uranus: { mode: 'bands', ambient: 0.04, atmo: 0.45, atmoColor: [0.6, 0.95, 1.0], contrast: 0.06 },
  neptune: { mode: 'bands', ambient: 0.04, atmo: 0.45, atmoColor: [0.45, 0.65, 1.0], contrast: 0.14 },
  pluto: { mode: 'rock', ambient: 0.02, mapCenter: 180 }, // NASA 지도는 스푸트니크 평원(동경 약 180°)이 가운데
  // 위성(sat-JPL번호). 0~360° 로 펼친 지도(USGS 유로파·칼리스토, 카시니 2014 색 지도)는 180° 가, -180~180° 지도(이오, 미마스, 카론)는 0° 가 가운데
  'sat-501': { mode: 'rock', ambient: 0.02 },
  'sat-502': { mode: 'rock', ambient: 0.02, mapCenter: 180 },
  'sat-503': { mode: 'rock', ambient: 0.02 },
  'sat-504': { mode: 'rock', ambient: 0.02, mapCenter: 180 },
  'sat-601': { mode: 'rock', ambient: 0.02 },
  'sat-602': { mode: 'rock', ambient: 0.03, mapCenter: 180 },
  'sat-603': { mode: 'rock', ambient: 0.02, mapCenter: 180 },
  'sat-604': { mode: 'rock', ambient: 0.02, mapCenter: 180 },
  'sat-605': { mode: 'rock', ambient: 0.02, mapCenter: 180 },
  'sat-606': { mode: 'bands', ambient: 0.05, atmo: 0.6, atmoColor: [1.0, 0.68, 0.32], contrast: 0.04 }, // 타이탄: 주황 안개
  'sat-608': { mode: 'rock', ambient: 0.02, mapCenter: 180 },
  'sat-801': { mode: 'rock', ambient: 0.02 },
  'sat-901': { mode: 'rock', ambient: 0.02 },
}

// 위도별 바람(m/s, 자전 방향이 +). 거대 행성의 띠는 위도마다 다른 빠르기로 흐른다(차등 회전). 보이저·카시니가 구름을 추적해 잰
// 띠별 바람을 몇 개의 제트로 근사했고, 자전과 같은 배속으로 흘려 보인다. 목성은 실제 지도라 띠가 밀리는 모습이 보인다
const gs = (x, c, w) => Math.exp(-(((x - c) / w) ** 2))
export const WIND = {
  jupiter: (l) => 100 * gs(l, 0, 8) + 140 * gs(l, 23.5, 2.5) - 45 * gs(l, 17, 2.5) - 55 * gs(l, -17, 2.5) + 55 * gs(l, -26.5, 2.5)
    + 35 * gs(l, 35.5, 2.5) - 25 * gs(l, 30, 2) + 30 * gs(l, -39, 2.5) - 20 * gs(l, -32, 2),
  saturn: (l) => 400 * gs(l, 0, 17) + 90 * gs(Math.abs(l), 46, 4) - 20 * gs(Math.abs(l), 40, 3) + 80 * gs(Math.abs(l), 61, 4),
  uranus: (l) => -80 * gs(l, 0, 18) + 230 * gs(Math.abs(l), 60, 15),
  neptune: (l) => -400 * gs(l, 0, 28) + 230 * gs(Math.abs(l), 70, 10),
}
const DRIFT_N = 48 // 위도 칸 수 (남극 -> 북극)

// 고리: [안쪽, 바깥쪽, 불투명도, 가장자리 번짐], 반지름은 행성 적도 반지름 단위. NASA Planetary Rings Fact Sheet(nssdc.gsfc.nasa.gov) 값.
// 토성 주 고리 말고는 실제로 너무 어둡고 가늘어서 1px 이상 굵기로, 밝게 그리고 note 로 밝힌다.
// fit: 상세 화면에서 이만큼까지 화면에 담는다. 그 바깥의 희미한 고리는 위성 보기로 넓혀야 다 보인다. shadow: 행성 표면에 고리 그림자를 드리울지
export const RINGS = {
  jupiter: { fit: 1.8, note: '고리는 실제로는 아주 어두워서 밝고 굵게 그렸어요', col: [[0.5, 0.4, 0.32], [0.62, 0.5, 0.4]], span: [1.25, 1.8],
    bands: [[1.25, 1.72, 0.06, 0.05], [1.72, 1.80, 0.3, 0.005], [1.80, 2.54, 0.035, 0.03], [2.54, 3.10, 0.025, 0.03], [3.10, 3.92, 0.012, 0.2]] }, // 헤일로, 주, 아말테아·테베 거미줄 고리, 테베 확장
  saturn: { fit: 2.33, shadow: true, note: '희미한 D·G·E 고리는 실제보다 밝게 그렸어요', col: [[0.62, 0.55, 0.45], [0.93, 0.84, 0.68]], span: [1.5, 1.95], ripple: 0.14,
    bands: [[1.110, 1.236, 0.04, 0.01], [1.239, 1.526, 0.2, 0.01], [1.526, 1.950, 0.88, 0.01], [2.030, 2.208, 0.64, 0.004], [2.220, 2.264, 0.64, 0.002],
      [2.266, 2.270, 0.6, 0], [2.320, 2.320, 0.5, 0], [2.754, 2.874, 0.05, 0.03], [2.987, 7.964, 0.025, 1.2]] }, // D, C, B, (카시니) A, (엥케) A, (킬러) A, F, G, E
  uranus: { fit: 2.02, note: '고리는 실제로는 아주 어두워서 밝고 굵게 그렸어요', col: [[0.5, 0.52, 0.55], [0.55, 0.57, 0.6]], span: [1.6, 2.0],
    bands: [1.637, 1.652, 1.666, 1.750, 1.786, 1.834, 1.863, 1.900, 1.957].map((r) => [r, r, 0.3, 0])
      .concat([[2.003, 2.009, 0.7, 0], [2.56, 2.71, 0.03, 0.05], [3.49, 4.16, 0.02, 0.2]]) }, // 6 5 4 α β η γ δ λ, ε, ν, μ
  neptune: { fit: 2.56, note: '고리는 실제로는 아주 어두워서 밝고 굵게 그렸어요. 애덤스 고리 덩어리(호)의 지금 경도는 대략이에요', col: [[0.55, 0.45, 0.4], [0.6, 0.5, 0.45]], span: [1.6, 2.6],
    bands: [[1.652, 1.732, 0.08, 0.02], [2.148, 2.148, 0.35, 0], [2.148, 2.310, 0.06, 0.01], [2.310, 2.310, 0.2, 0], [2.541, 2.541, 0.3, 0]], // 갈레, 르베리에, 라셀, 아라고, 애덤스
    // 애덤스 고리의 호 [중심 경도°, 반 길이°, 불투명도]. 앞에서부터 용기·자유·평등 둘·박애, 1989~2016 관측의 배치를 대략 따른다
    arcs: { r: 2.541, rate: 820.1194, list: [[33, 0.5, 0.7], [24, 2, 0.8], [15, 0.8, 0.85], [12.5, 0.8, 0.85], [0, 5, 0.95]] } }, // rate: 호 무리가 도는 빠르기(°/일)
}
export const ringOuter = (id) => RINGS[id]?.fit ?? 1
const MAX_BANDS = 16

// 고리 불투명도(반지름 r). 행성 표면에 드리우는 고리 그림자에도 같은 함수를 쓴다
const RING_FN = `
  uniform vec4 uBands[${MAX_BANDS}]; uniform int uCount;
  float ringAt(float r, float aa){
    float d = 0.0;
    for (int i = 0; i < ${MAX_BANDS}; i++) {
      if (i >= uCount) break;
      vec4 b = uBands[i];
      float hw = max(b.y - b.x, aa) * 0.5;
      float soft = max(b.w, aa);
      d = max(d, b.z * (1.0 - smoothstep(hw - soft * 0.5, hw + soft * 0.5, abs(r - (b.x + b.y) * 0.5))));
    }
    return d;
  }`
const bandUniforms = (rd) => {
  const v = (rd?.bands || []).map(([a, b, o, w]) => new THREE.Vector4(a, b, o, w ?? 0))
  while (v.length < MAX_BANDS) v.push(new THREE.Vector4())
  return { uBands: { value: v }, uCount: { value: rd?.bands.length ?? 0 } }
}

// ---------- 이미지가 없을 때 쓰는 표면 (캔버스) ----------
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s) }
const lerp = (a, b, t) => a + (b - a) * t
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v)
}
const fbm = (x, y) => { let a = 0.5, f = 1, s = 0; for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, y * f); f *= 2; a *= 0.5 } return s }

// 위도별 색(위에서 아래로)을 읽어 띠 무늬 지도를 그린다. profile 이 없으면 천체 색으로 밝고 어두운 띠를 만든다
function bandsCanvas(color, profile, contrast) {
  const W = 1024, H = 512
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H })
  const g = c.getContext('2d'), img = g.createImageData(W, H)
  const at = (t) => {
    if (profile?.length) {
      const f = Math.min(profile.length - 1, Math.max(0, t * (profile.length - 1))), i = Math.floor(f), j = Math.min(profile.length - 1, i + 1)
      return profile[i].map((v, k) => lerp(v, profile[j][k], f - i))
    }
    const k = 0.85 + 0.3 * Math.sin(t * Math.PI * 9)
    return color.map((v) => v * k)
  }
  for (let y = 0; y < H; y++) {
    const base = at(y / H)
    for (let x = 0; x < W; x++) {
      const n = fbm(x * 0.012, y * 0.3) - 0.5
      const k = 1 + n * contrast * 2
      const i = (y * W + x) * 4
      img.data[i] = base[0] * k; img.data[i + 1] = base[1] * k; img.data[i + 2] = base[2] * k; img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return c
}

function rockCanvas(color) {
  const W = 1024, H = 512
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H })
  const g = c.getContext('2d'), img = g.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = 0.72 + 0.5 * fbm(x * 0.03, y * 0.06)
      const crater = 1 - 0.28 * Math.max(0, (vnoise(x * 0.12, y * 0.24) - 0.72) / 0.18)
      const i = (y * W + x) * 4
      img.data[i] = color[0] * k * crater; img.data[i + 1] = color[1] * k * crater; img.data[i + 2] = color[2] * k * crater; img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return c
}

const tex = (canvas) => { const t = new THREE.CanvasTexture(canvas); t.anisotropy = 4; t.wrapS = THREE.RepeatWrapping; return t }

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

// ---------- 셰이더 ----------
const GLOBE_VERT = `
  varying vec2 vUv; varying vec3 vN;
  void main(){
    vUv = uv; vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`
// 보는 쪽은 화면 앞(+z). 낮 쪽만 밝고, 가장자리는 어둡게, 대기가 있는 천체는 밝은 쪽 가장자리에 얇은 빛을 둔다.
// 그림자: 표면 점에서 태양 쪽으로 쏜 선이 고리 면이나 위성에 막히면 어둡게 한다(모두 보는 방향 좌표, 행성 반지름 단위)
const GLOBE_FRAG = `
  uniform sampler2D uMap; uniform vec3 uSun; uniform float uAmbient; uniform float uAtmo; uniform vec3 uAtmoColor; uniform float uDim;
  uniform vec3 uRingN; uniform float uRingShadow; uniform vec4 uMoons[8]; uniform int uMoonCount;
  uniform float uOffset; uniform float uDrift[${DRIFT_N}];
  varying vec2 vUv; varying vec3 vN;
  ${RING_FN}
  void main(){
    vec3 n = normalize(vN);
    vec3 S = normalize(uSun);
    // 지도 가운데 경도(uOffset)와 위도별 바람에 밀린 각도(uDrift, 라디안)만큼 옆에서 읽는다
    float fy = clamp(vUv.y, 0.0, 1.0) * ${DRIFT_N - 1}.0;
    int i0 = int(floor(fy)); int i1 = min(i0 + 1, ${DRIFT_N - 1});
    float drift = mix(uDrift[i0], uDrift[i1], fy - float(i0));
    vec3 albedo = texture2D(uMap, vec2(vUv.x + uOffset - drift / 6.2831853, vUv.y)).rgb;
    float ndl = dot(n, S);
    float lit = smoothstep(-0.03, 0.10, ndl);
    float mu = max(n.z, 0.0);
    float shade = 1.0;
    float sn = dot(S, uRingN);
    if (uRingShadow > 0.0 && abs(sn) > 1e-4) {
      float t = -dot(n, uRingN) / sn;
      if (t > 0.0) shade *= 1.0 - 0.95 * ringAt(length(n + t * S), 0.002);
    }
    for (int k = 0; k < 8; k++) {
      if (k >= uMoonCount) break;
      vec3 d = uMoons[k].xyz - n;
      float s = dot(d, S);
      if (s > 0.0) shade *= mix(0.12, 1.0, smoothstep(uMoons[k].w * 0.8, uMoons[k].w * 1.3, length(d - s * S)));
    }
    vec3 col = albedo * (uAmbient + lit * max(ndl, 0.0) * 1.12 * shade);
    col *= mix(0.6, 1.0, pow(mu, 0.3));
    col += uAtmoColor * uAtmo * pow(1.0 - mu, 3.0) * smoothstep(-0.25, 0.45, ndl);
    // 가장자리 1px 을 투명하게 번지게 한다. 지도 캔버스는 성능 때문에 안티에일리어싱을 끄고 그려서 테두리가 계단처럼 보였다
    float edge = clamp(mu / max(fwidth(mu) * 1.5, 1e-4), 0.0, 1.0);
    gl_FragColor = vec4(col * uDim, edge);
  }`

const RING_VERT = `
  varying vec2 vXY;
  void main(){ vXY = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
// 고리 밝기: 구간마다 불투명도. 폭이 1px 보다 좁은 고리는 1px 선으로 그린다. 행성 그림자에 든 곳은 어둡게, 해왕성 호는 덧그린다
const RING_FRAG = `
  uniform float uDim; uniform vec3 uCol0; uniform vec3 uCol1; uniform vec2 uSpan; uniform float uRipple; uniform vec3 uSunR;
  uniform vec3 uArcs[6]; uniform int uArcCount; uniform float uArcR; uniform float uArcPhase;
  varying vec2 vXY;
  ${RING_FN}
  void main(){
    float r = length(vXY);
    float aa = fwidth(r);
    float d = ringAt(r, aa);
    if (uArcCount > 0) {
      float lon = degrees(atan(vXY.y, vXY.x)) - uArcPhase;
      float across = 1.0 - smoothstep(aa * 0.5, aa * 1.5, abs(r - uArcR));
      for (int i = 0; i < 6; i++) {
        if (i >= uArcCount) break;
        float dl = abs(mod(lon - uArcs[i].x + 180.0, 360.0) - 180.0);
        d = max(d, uArcs[i].z * across * (1.0 - smoothstep(uArcs[i].y * 0.6, uArcs[i].y, dl)));
      }
    }
    d *= 1.0 - uRipple + uRipple * sin(r * 230.0) * sin(r * 61.0);
    vec3 col = mix(uCol0, uCol1, smoothstep(uSpan.x, uSpan.y, r));
    vec3 P = vec3(vXY, 0.0);
    float t = dot(P, uSunR);
    if (t < 0.0) col *= mix(0.06, 1.0, smoothstep(0.97, 1.03, length(P - t * uSunR)));   // 행성 그림자
    gl_FragColor = vec4(col * uDim, d * uDim);
  }`

// 태양: 실시간 SDO 원판 사진을 둥글게 오려 쓰고 바깥에 은은한 빛을 번지게 한다
// 값 노이즈(3D). 태양 불꽃과 항성 쌀알 무늬가 같이 쓴다
const NOISE3 = `
  float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 x){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n3(x); x = x * 2.03 + 1.7; a *= 0.5; } return s; }`

// 태양: 원판은 SDO 사진 그대로(아주 옅게 일렁임만), 테두리 바깥에 불꽃 혀와 코로나가 바깥으로 흘러나가며 타오른다.
// 불꽃은 실제 관측이 아니라 분위기를 위한 그림이다(코로나는 개기일식 때나 보인다). uTime 이 0 이면 멈춘다
const SUN_FRAG = `
  uniform sampler2D uMap; uniform float uHasMap; uniform float uDisc; uniform vec3 uColor; uniform float uDim; uniform float uTime;
  varying vec2 vUv;
  ${NOISE3}
  void main(){
    vec2 p = (vUv - 0.5) * 2.0;           // 면 전체가 -1..1, 태양 반지름이 1/1.6
    float d = length(p) * 1.6;
    vec2 dir = p / max(length(p), 1e-5);
    vec3 img = texture2D(uMap, 0.5 + p * (uDisc * 0.8)).rgb;   // 사진 속 원판 반지름 = uDisc/2
    float boil = fbm(vec3(p * 10.0, uTime * 0.3));
    vec3 fallback = uColor * (0.75 + 0.35 * pow(max(1.0 - d * d, 0.0), 0.5)) * (0.85 + 0.3 * boil);
    vec3 sun = mix(fallback, img * (0.97 + 0.06 * boil), uHasMap) * (1.0 - smoothstep(0.985, 1.0, d));
    float h = max(d - 1.0, 0.0);          // 표면에서 잰 높이(태양 반지름 단위)
    float out_ = step(0.985, d);
    // 채층: 테두리에 얇은 주황 빛이 깜박인다
    float rim = exp(-abs(d - 1.0) * 55.0) * (0.25 + 0.6 * fbm(vec3(dir * 16.0, uTime * 0.9)));
    // 불꽃 혀: 각도마다 다른 길이로 뻗고, 노이즈가 바깥으로 흘러 일렁인다(각도는 방향 벡터로 넣어 이음매가 없다)
    float flow = fbm(vec3(dir * 3.0, h * 2.0 - uTime * 0.22));
    float tongue = fbm(vec3(dir * 5.5 + flow * 1.8, h * 3.5 - uTime * 0.5));
    float k = mix(13.0, 1.9, smoothstep(0.38, 0.72, tongue));
    float flame = exp(-h * k) * (0.5 + 2.2 * tongue * tongue) * out_;
    float corona = exp(-h * 3.0) * (0.12 + 0.14 * flow) * out_;
    vec3 hot = vec3(1.0, 0.78, 0.38), mid = vec3(1.0, 0.45, 0.1), cool = vec3(0.75, 0.16, 0.03);
    vec3 fcol = mix(cool, mix(mid, hot, exp(-h * 16.0)), exp(-h * 4.0));
    vec3 col = (sun + (fcol * flame + mix(uColor, mid, 0.5) * corona + mid * rim) * smoothstep(1.6, 1.3, d)) * uDim;
    // 덧그리기라 색은 그대로 더하고, 투명 캔버스(상세 화면)에선 어두운 곳이 네모로 비치지 않게 밝기만큼만 불투명하게 둔다
    float a = clamp(max(col.r, max(col.g, col.b)), 0.002, 1.0);
    gl_FragColor = vec4(col / a, a);
  }`

// 항성: 관측된 색으로 칠한 표면에 쌀알 무늬(대류 셀)가 천천히 끓는다
const STAR_VERT = `
  varying vec3 vP; varying vec3 vN;
  void main(){ vP = position; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const STAR_FRAG = `
  uniform vec3 uColor; uniform float uTime; uniform float uDim;
  varying vec3 vP; varying vec3 vN;
  ${NOISE3}
  void main(){
    vec3 p = normalize(vP) * 5.0;
    float cells = n3(p * 2.2 + vec3(0.0, uTime * 0.05, 0.0));
    float fine = n3(p * 6.0 + cells * 2.0 - uTime * 0.04);
    float g = 0.74 + 0.5 * (0.6 * cells + 0.4 * fine);
    float mu = max(normalize(vN).z, 0.0);
    float limb = 0.35 + 0.65 * pow(mu, 0.55);
    vec3 hot = mix(uColor, vec3(1.0), 0.25);
    gl_FragColor = vec4(mix(uColor * 0.8, hot, g - 0.7) * g * limb * 1.15 * uDim, 1.0);
  }`
const GLOW_FRAG = `
  uniform vec3 uColor;
  varying vec2 vUv;
  void main(){ float d = length(vUv - 0.5) * 2.0; float a = exp(-d * d * 4.5) * 0.6 * (1.0 - smoothstep(0.85, 1.0, d)); gl_FragColor = vec4(uColor * a, a); }`
const PLANE_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

// ---------- 천체 하나 ----------
// 반환값의 group 은 반지름 1 인 구이고, 호출하는 쪽이 위치와 크기를 정한다.
export function createBody(body) {
  const style = STYLE[body.id] || {}
  const group = new THREE.Group()
  const tilt = new THREE.Group()    // 자전축을 세우는 방향. 보는 방향(view)에 맞춰 매번 바꾼다
  const globe = new THREE.Group()   // 자전
  group.add(tilt)
  tilt.add(globe)
  const state = { source: 'fallback', observedAt: null }
  const local = { q: new THREE.Quaternion(), sun: new THREE.Vector3(1, 0, 0), dist: 1 }
  const dimU = { value: 1 }
  const api = { group, tilt, globe, state, local, dim: dimU, update: null }

  if (body.kind === 'sun') {
    const m = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: new THREE.Texture() }, uHasMap: { value: 0 }, uDisc: { value: SUN_DISC }, uColor: { value: new THREE.Vector3(...body.color.map((v) => v / 255)) }, uDim: dimU, uTime: { value: 0 } },
      vertexShader: PLANE_VERT, fragmentShader: SUN_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), m)
    group.add(mesh)
    api.sunMaterial = m
    api.setSunImage = (img, observedAt) => {
      const t = new THREE.Texture(img)
      t.needsUpdate = true
      m.uniforms.uMap.value.dispose?.()
      m.uniforms.uMap.value = t
      m.uniforms.uHasMap.value = 1
      state.source = 'live'
      state.observedAt = observedAt
    }
    api.setEphemeris = () => {}
    api.setTurn = () => {}
    api.setFlow = () => {}
    api.setTime = (t) => { m.uniforms.uTime.value = t } // 불꽃이 타오르는 시각(초). 프레임마다 부른다
    api.applyView = () => {}
    api.dispose = () => { mesh.geometry.dispose(); m.dispose() }
    return api
  }

  // 지도가 오기 전에 먼저 보일 표면. 이미지나 띠 정보가 오면 바꿔 끼운다
  const fallbackTex = tex(style.mode === 'bands' ? bandsCanvas(body.color, null, style.contrast ?? 0.15) : rockCanvas(body.color))
  const uniforms = {
    uMap: { value: fallbackTex }, uSun: { value: new THREE.Vector3(1, 0, 0) },
    uAmbient: { value: style.ambient ?? 0.03 }, uAtmo: { value: style.atmo ?? 0 },
    uAtmoColor: { value: new THREE.Vector3(...(style.atmoColor || [1, 1, 1])) }, uDim: dimU,
    ...bandUniforms(RINGS[body.id]), uRingN: { value: new THREE.Vector3(0, 1, 0) }, uRingShadow: { value: RINGS[body.id]?.shadow ? 1 : 0 },
    uMoons: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }, uMoonCount: { value: 0 },
    uOffset: { value: (style.mapCenter ?? 0) / 360 }, uDrift: { value: new Array(DRIFT_N).fill(0) },
  }
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: GLOBE_VERT, fragmentShader: GLOBE_FRAG, transparent: true })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), mat)
  mesh.renderOrder = -1 // 가장자리 때문에 반투명이지만 고리보다 먼저 그려 깊이를 남긴다(행성 뒤 고리가 가려지게)
  globe.add(mesh)

  let ring = null
  const rd = RINGS[body.id]
  if (rd) {
    const arcs = (rd.arcs?.list || []).map(([c, h, o]) => new THREE.Vector3(c, h, o))
    while (arcs.length < 6) arcs.push(new THREE.Vector3())
    const rm = new THREE.ShaderMaterial({
      uniforms: { uDim: dimU, ...bandUniforms(rd), uCol0: { value: new THREE.Vector3(...rd.col[0]) },
        uCol1: { value: new THREE.Vector3(...rd.col[1]) }, uSpan: { value: new THREE.Vector2(...rd.span) }, uRipple: { value: rd.ripple ?? 0 },
        uSunR: { value: new THREE.Vector3(1, 0, 0) }, uArcs: { value: arcs }, uArcCount: { value: rd.arcs?.list.length ?? 0 },
        uArcR: { value: rd.arcs?.r ?? 0 }, uArcPhase: { value: 0 } },
      vertexShader: RING_VERT, fragmentShader: RING_FRAG, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    })
    ring = new THREE.Mesh(new THREE.RingGeometry(Math.min(...rd.bands.map((b) => b[0])) - 0.01, Math.max(...rd.bands.map((b) => b[1])) + 0.3, 512, 1), rm)
    ring.rotation.x = -Math.PI / 2   // 고리는 적도면. 자전축(Y)에 수직
    tilt.add(ring)
  }

  let alive = true
  const swap = (t) => { if (!alive) return; uniforms.uMap.value.dispose?.(); uniforms.uMap.value = t }
  loadImage(`${NASA}/${body.id}_map.jpg`).then((img) => {
    if (!img) return
    // 경도 0 이 구의 기준(u=0.5)에 오게 미는 것은 셰이더(uOffset)가 한다. ShaderMaterial 은 texture.offset 을 쓰지 않는다
    const t = new THREE.Texture(img); t.anisotropy = 4; t.wrapS = THREE.RepeatWrapping; t.needsUpdate = true
    swap(t); state.source = 'map'
  })
  if (style.mode === 'bands') {
    fetch(`${NASA}/${body.id}_profile.json`).then((r) => (r.ok ? r.json() : null)).then((p) => {
      if (p && Array.isArray(p) && state.source !== 'map') { swap(tex(bandsCanvas(body.color, p, style.contrast ?? 0.15))); state.source = 'profile' }
    }).catch(() => {})
  }

  // 자전각 위에 더 돌리는 각도(지도에서 자전을 빠르게 보여줄 때). setEphemeris 는 느려서 250ms 마다, 이건 프레임마다 부른다
  let base = 0, turn = 0
  api.setTurn = (a) => { turn = a; globe.rotation.y = base + turn }
  // 띠의 바람: sim 초(자전 배속을 곱한 흐른 시간)만큼 위도마다 밀어 준다
  const wind = WIND[body.id], R = PLANET_R[body.id], dir = Math.sign(body.rotation_hours || 1)
  api.setFlow = (sim) => {
    if (!wind) return
    const d = uniforms.uDrift.value
    for (let k = 0; k < DRIFT_N; k++) {
      const lat = -90 + (180 * k) / (DRIFT_N - 1)
      d[k] = ((dir * wind(lat) * sim) / (R * 1000 * Math.max(0.15, Math.cos(lat * DEG)))) % (2 * Math.PI)
    }
  }
  // 느린 계산: 자전축과 태양 쪽 방향을 하늘 좌표(J2000)에서 구한다. spinDate 로 자전만 앞당겨 돌릴 수 있다
  // 위성: 자전축은 모행성의 것으로 두고, 늘 같은 면(경도 0)이 행성을 본다(동주기 자전). 행성 쪽 방향은 화면이 setToPlanet 으로 넘긴다.
  // shortcut: 큰 위성의 적도면은 행성 적도면과 거의 같다는 근사, 궤도가 기울어진 이아페투스(약 15°)는 축이 조금 다르다
  const toPlanet = new THREE.Vector3(1, 0, 0)
  api.setToPlanet = (v) => { if (v.lengthSq() > 0) toPlanet.copy(v).normalize() }
  const astro = body.planetAstro || body.astroName
  api.setEphemeris = (date, spinDate = date) => {
    const ax = Astronomy.RotationAxis(astro, date)
    const pole = eqj(ax.north).normalize()
    const node = body.planetAstro
      ? toPlanet.clone().addScaledVector(pole, -toPlanet.dot(pole)).normalize()  // 경도 0 = 행성 쪽
      : new THREE.Vector3(0, 1, 0).cross(pole).normalize() // 적도와 ICRF 적도의 교점. 본초 자오선은 여기서 자전각만큼 돈다
    const z = new THREE.Vector3().crossVectors(node, pole)
    local.q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(node, pole, z))
    const spin = body.planetAstro ? 0 : spinDate === date ? ax.spin : Astronomy.RotationAxis(astro, spinDate).spin
    base = spin * DEG
    globe.rotation.y = base + turn
    const sun = Astronomy.GeoVector('Sun', date, true), me = Astronomy.GeoVector(astro, date, true)
    local.sun.set(sun.x - me.x, sun.z - me.z, -(sun.y - me.y)).normalize()
    local.dist = Math.hypot(me.x, me.y, me.z)
    if (rd?.arcs) ring.material.uniforms.uArcPhase.value = (rd.arcs.rate * (date.getTime() / 86400000 - 10957.5)) % 360 // J2000 부터 돈 각도. 기준 경도는 모른다
  }
  // 위성 그림자: [{ v: 하늘 좌표 벡터(행성 반지름 단위), r: 반지름 }] 중 큰 것 8개까지
  let moonList = []
  api.setMoons = (list) => { moonList = list.filter((m) => m.r).sort((a, b) => b.r - a.r).slice(0, 8) }
  // 빠른 계산: 하늘 좌표를 화면(보는 방향) 좌표로 돌린다. viewQuat 은 하늘 좌표 -> 화면 좌표 회전
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3()
  api.applyView = (viewQuat) => {
    tilt.quaternion.copy(tmpQ.copy(viewQuat).multiply(local.q))
    uniforms.uSun.value.copy(local.sun).applyQuaternion(viewQuat)
    uniforms.uRingN.value.set(0, 1, 0).applyQuaternion(tilt.quaternion)              // 고리 면의 법선 = 자전축
    if (ring) ring.material.uniforms.uSunR.value.copy(uniforms.uSun.value).applyQuaternion(tmpQ.copy(tilt.quaternion).multiply(ring.quaternion).invert())
    moonList.forEach((m, k) => { const p = tmpV.copy(m.v).applyQuaternion(viewQuat); uniforms.uMoons.value[k].set(p.x, p.y, p.z, m.r) })
    uniforms.uMoonCount.value = moonList.length
  }
  api.dispose = () => {
    alive = false
    mesh.geometry.dispose(); mat.dispose(); uniforms.uMap.value.dispose?.()
    if (ring) { ring.geometry.dispose(); ring.material.dispose() }
  }
  return api
}

// 태양 사진에서 원판이 차지하는 비율(지름/한 변). 실제 SDO 사진을 보고 맞춘다
export const SUN_DISC = 0.93 // 실제 SDO 2048px 사진에서 잰 값(원판 지름 1911px)

// 관측 시각 붙은 실시간 태양 사진을 백엔드 프록시에서 가져온다
export async function fetchSunImage(kind = 'hmi') {
  const res = await fetch(`/api/sun/latest?kind=${kind}`)
  if (!res.ok) return null
  const observedAt = res.headers.get('X-Observed-At')
  const bmp = await createImageBitmap(await res.blob(), { imageOrientation: 'flipY' }) // ImageBitmap 은 텍스처의 flipY 가 안 먹어서 미리 뒤집는다
  return { img: bmp, observedAt }
}

// ---------- 항성(표면 시뮬레이션) ----------
export function createStar(color) {
  const group = new THREE.Group()
  const globe = new THREE.Group()
  group.add(globe)
  const col = new THREE.Vector3(...color.map((v) => v / 255))
  const uniforms = { uColor: { value: col }, uTime: { value: 0 }, uDim: { value: 1 } }
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), new THREE.ShaderMaterial({ uniforms, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG }))
  globe.add(mesh)
  const glowMat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: col } }, vertexShader: PLANE_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), glowMat)
  glow.position.z = -0.5
  group.add(glow)
  return {
    group, globe, uniforms,
    dispose: () => { mesh.geometry.dispose(); mesh.material.dispose(); glow.geometry.dispose(); glowMat.dispose() },
  }
}

// 하늘 좌표 -> 보는 방향 좌표 회전. 지구(관측자)에서 천체를 보고, 화면 위쪽은 천구 북극 쪽이다
export function viewFromEarth(body, date) {
  const g = Astronomy.GeoVector(body.astroName, date, true)
  const dir = new THREE.Vector3(g.x, g.z, -g.y).normalize()
  const z = dir.clone().negate()                                  // 천체에서 지구(카메라) 쪽
  const up = new THREE.Vector3(0, 1, 0)
  const y = up.addScaledVector(z, -up.dot(z)).normalize()
  const x = new THREE.Vector3().crossVectors(y, z)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)).invert()
}

// 별의 색지수(B-V)에서 겉보기 표면 온도(K). Ballesteros(2012)
export const tempFromBV = (bv) => 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62))
