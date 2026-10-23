import * as THREE from 'three'
import { SEOUL, toVec } from './astro'

// NASA Blue Marble(낮)과 Black Marble(밤) 사진을 낮밤 경계에서 섞는다.
// 구는 지구 고정 좌표계에 맞춰 있어서 위치로 바로 태양 방향과 비교한다.
// 구름은 NASA Blue Marble 구름 지도(MODIS)를 얹고, 위도대마다 실제 바람 방향(무역풍은 서쪽, 편서풍은 동쪽)으로 흘린다.
// 구름 지도가 아직 없으면 검게 읽혀 구름 없이 그린다(backend/scripts/fetch_nasa_assets.py earth_clouds 로 받는다)
export function makeEarth() {
  const loader = new THREE.TextureLoader()
  const load = (url) => {
    const t = loader.load(url)
    t.anisotropy = 8
    return t
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: load('/textures/earth_day.jpg') },
      nightMap: { value: load('/textures/earth_night.jpg') },
      cloudMap: { value: (() => { const t = load('/nasa/earth_clouds.jpg'); t.wrapS = THREE.RepeatWrapping; return t })() },
      uCloudT: { value: 0 }, // 구름을 흘린 시간(초, 배속 포함)
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uHome: { value: toVec(SEOUL.lon, SEOUL.lat) },
    },
    vertexShader: `
      varying vec2 vUv; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){
        vUv = uv;
        vP = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = vec3(0.0, 0.0, 1.0); // 정사영이라 보는 방향이 어디서나 같다
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D cloudMap; uniform float uCloudT;
      uniform vec3 uSun; uniform vec3 uHome;
      varying vec2 vUv; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 day = texture2D(dayMap, vUv).rgb;
        vec3 night = texture2D(nightMap, vUv).rgb * 1.35;
        float k = smoothstep(-0.12, 0.18, dot(vP, normalize(uSun)));
        vec3 c = mix(night, day, k);
        // 구름: 위도별 바람(m/s) -> 경도 각속도. 무역풍(적도~25°) 서쪽 6, 편서풍(35~60°) 동쪽 12, 극동풍 서쪽 4
        float la = abs(vUv.y - 0.5) * 180.0;
        float w = -6.0 * exp(-pow((la - 12.0) / 14.0, 2.0)) + 12.0 * exp(-pow((la - 47.0) / 12.0, 2.0)) - 4.0 * exp(-pow((la - 75.0) / 8.0, 2.0));
        float shift = w * uCloudT / (6.371e6 * max(cos(radians(la)), 0.15)) / 6.2831853;
        float cl = texture2D(cloudMap, vec2(vUv.x - shift, vUv.y)).r;
        c = mix(c, vec3(0.02, 0.025, 0.035) + vec3(0.95) * k, smoothstep(0.08, 0.9, cl) * 0.85);
        c = mix(c, vec3(0.85, 0.71, 0.42), smoothstep(0.9993, 0.9997, dot(vP, uHome)));
        float rim = pow(1.0 - max(dot(vN, vV), 0.0), 2.5);
        c += vec3(0.30, 0.55, 1.0) * rim * (0.25 + 0.75 * k);
        float mu = max(dot(vN, vV), 0.0);
        gl_FragColor = vec4(c, clamp(mu / max(fwidth(mu) * 1.5, 1e-4), 0.0, 1.0)); // 테두리 1px 을 부드럽게 (지도는 안티에일리어싱 없이 그린다)
      }`,
    transparent: true,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 96), mat)
  return { mesh, mat }
}
