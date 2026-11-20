/* SafeRoute Twin - 3D 디지털 트윈 지도(MapLibre: 위성영상 + 3D 건물 + 지형) + 화면 로직 */
const $ = id => document.getElementById(id);
const GW = { w: 126.895, e: 126.972, s: 37.455, n: 37.497 };
const SPOTS = [['신림역 일대', 126.9296, 37.4842], ['봉천역 일대', 126.9418, 37.4824], ['서울대입구역 일대', 126.9527, 37.4812]];
const COL = ['#1ea7ff', '#e8c42a', '#ff3b3b', '#2bd66b'];
let map, loc = null, routeShown = false, mode = 'live', liveOK = false, lastSteps = [], lastRes = null, pitch3d = true;
const W = { r10: 0, r1h: 0, r3h: 0, floor: 0, official: null };
const userMk = [], routeMk = [], stepMk = [];
const EMPTY = { type: 'FeatureCollection', features: [] };
const line = c => ({ type: 'FeatureCollection', features: c && c.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: {} }] : [] });
const polys = items => ({ type: 'FeatureCollection', features: items.map(it => { const r = it.r, p = r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : r.concat([r[0]]); return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [p] }, properties: { th: it.th } }; }).filter(f => f.geometry.coordinates[0].length >= 4) });

/* ---------- 위험도 (과거 강우·침수 분석 기반 규칙 모델) ---------- */
let DATA_AREA = [];
const pred = () => {   // 학습된 로지스틱 회귀 모델: z = w·log(1+강우) + b, 침수 예측 = z ≥ zTau
  const m = window.DATA.model, z = m.w[0] * Math.log1p(W.r10) + m.w[1] * Math.log1p(W.r1h) + m.w[2] * Math.log1p(W.r3h) + m.b;
  const flood = z >= m.zTau; let area = 0; if (flood) DATA_AREA.forEach(([th, ar]) => { if (th <= z) area += ar; });
  return { z, p: 1 / (1 + Math.exp(-z)), flood, area, pct: area / m.area2022 };
};
const alertName = () => W.official ? '기상청 ' + W.official + ' 발효 중' : (W.r1h >= 90 || W.r3h >= 180) ? '호우경보 수준' : (W.r1h >= 60 || W.r3h >= 90) ? '호우주의보 수준' : '특보 없음';

/* ---------- 3D 지도 ---------- */
function mkEl(html, cls) { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; return d; }
function addMk(arr, el, lng, lat, anchor) { arr.push(new maplibregl.Marker({ element: el, anchor: anchor || 'bottom' }).setLngLat([lng, lat]).addTo(map)); }
const clearMk = arr => { arr.forEach(m => m.remove()); arr.length = 0; };
const pinEl = (text, c) => { const e = mkEl(`<span>${text}</span><i></i><b></b>`, 'pin'); e.style.setProperty('--c', c); return e; };
function fly(lng, lat, zoom, dur = 900) { map.easeTo({ center: [lng, lat], zoom, pitch: pitch3d ? 60 : 0, duration: dur }); }
function fit(coords, pad, maxZoom = 17.5, dur = 1300) {
  const b = new maplibregl.LngLatBounds(); coords.forEach(c => b.extend(c));
  map.fitBounds(b, { padding: pad || { top: 130, bottom: 90, left: 340, right: 420 }, maxZoom, pitch: pitch3d ? 60 : 0, duration: dur });
}
function createMap(onLoad) {
  map = new maplibregl.Map({
    container: 'stage', center: [126.9453, 37.4745], zoom: 12.8, pitch: 58, bearing: -15, maxPitch: 78, attributionControl: false,
    style: {
      version: 8,
      sources: {
        sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri' },
        omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
        dem: { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 14 }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#07111a' } },
        { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-brightness-max': 0.85, 'raster-saturation': -0.15 } },
        { id: 'bld', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 13,
          paint: { 'fill-extrusion-color': '#cfd8e0', 'fill-extrusion-opacity': 0.88,
            'fill-extrusion-height': ['max', 7, ['coalesce', ['get', 'render_height'], 7]], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] } }
      ],
      terrain: { source: 'dem', exaggeration: 1.1 }
    }
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '건물 © OpenStreetMap contributors · OpenFreeMap · 지형 Mapzen/AWS' }), 'bottom-right');
  let warned = false; map.on('error', e => { if (!warned && e && e.error && /Failed to fetch|NetworkError|AJAX/i.test(String(e.error.message))) { warned = true; $('locMsg').textContent = '⚠ 지도 타일을 불러오지 못했습니다. 인터넷 연결을 확인하세요.'; } });
  map.on('click', e => setLoc(e.lngLat.lng, e.lngLat.lat));
  map.on('load', onLoad);
}
function netData(z) {
  const fr = Route.fracs(z);
  return { type: 'FeatureCollection', features: Route.edges.map((e, i) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: e.g }, properties: { c: fr[i] >= 0.5 ? '#ff3b3b' : fr[i] > 0.05 ? '#e8c42a' : '#6f8499' } })) };
}
function updateNet() { if (map && map.getSource('net') && $('tnet').checked) { const pr = pred(); map.getSource('net').setData(netData(pr.flood ? pr.z : -99)); } }
function setPred(pr) { if (!map || !map.getLayer('p22')) return; const f = ['<=', ['get', 'th'], pr.flood ? pr.z : -99]; map.setFilter('p22', f); map.setFilter('p100', f); }
function addLayers(f22, f100, net) {
  const D = window.DATA;
  map.addSource('f100', { type: 'geojson', data: polys(f100) });
  map.addSource('f22', { type: 'geojson', data: polys(f22) });
  const NONE = ['<=', ['get', 'th'], -99];
  map.addLayer({ id: 'p100', type: 'fill-extrusion', source: 'f100', filter: NONE, paint: { 'fill-extrusion-color': '#46d8ff', 'fill-extrusion-opacity': 0.5, 'fill-extrusion-height': 1.5, 'fill-extrusion-base': 0 } });
  map.addLayer({ id: 'p22', type: 'fill-extrusion', source: 'f22', filter: NONE, paint: { 'fill-extrusion-color': '#1f6bff', 'fill-extrusion-opacity': 0.78, 'fill-extrusion-height': 3, 'fill-extrusion-base': 0 } });
  map.addLayer({ id: 'ref22', type: 'line', source: 'f22', layout: { visibility: 'none' }, paint: { 'line-color': '#ff3d8b', 'line-width': 1.2, 'line-opacity': 0.9 } });
  map.addSource('net', { type: 'geojson', data: netData(-99) });
  map.addLayer({ id: 'net', type: 'line', source: 'net', layout: { visibility: 'none' }, paint: { 'line-color': ['get', 'c'], 'line-width': 2, 'line-opacity': 0.85 } });
  map.addSource('cands', { type: 'geojson', data: { type: 'FeatureCollection', features: Route.cands.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: {} })) } });
  map.addLayer({ id: 'cands', type: 'circle', source: 'cands', paint: { 'circle-radius': 5, 'circle-color': '#2bd66b', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
  ['normal', 'safe', 'hi'].forEach(s => map.addSource(s, { type: 'geojson', data: EMPTY }));
  const L = { 'line-cap': 'round', 'line-join': 'round' };
  map.addLayer({ id: 'normal', type: 'line', source: 'normal', layout: L, paint: { 'line-color': '#ff4d4d', 'line-width': 5, 'line-dasharray': [1.5, 1.2] } });
  map.addLayer({ id: 'safe-glow', type: 'line', source: 'safe', layout: L, paint: { 'line-color': '#22e5ff', 'line-width': 16, 'line-opacity': 0.3, 'line-blur': 4 } });
  map.addLayer({ id: 'safe', type: 'line', source: 'safe', layout: L, paint: { 'line-color': '#5bffd0', 'line-width': 6 } });
  map.addLayer({ id: 'hi', type: 'line', source: 'hi', layout: L, paint: { 'line-color': '#ffd23f', 'line-width': 9 } });
}

/* ---------- 상태 갱신 ---------- */
function refresh() {
  const pr = pred(), lv = !pr.flood ? 0 : pr.pct < 0.35 ? 1 : 2, pp = Math.round(pr.p * 100);
  $('v10').textContent = W.r10.toFixed(1); $('v1h').textContent = W.r1h.toFixed(0); $('v3h').textContent = W.r3h.toFixed(0);
  $('o10').textContent = W.r10; $('o1h').textContent = W.r1h; $('o3h').textContent = W.r3h;
  $('gbar').style.width = pp + '%'; $('score').textContent = pp; $('alert').textContent = alertName();
  $('verdict').innerHTML = pr.flood ? `⚠ <b>침수 예측</b> · 예상 침수면적 약 ${(pr.area / 1e4).toFixed(1)}ha (2022.8 침수의 ${Math.round(pr.pct * 100)}%)` : '✅ <b>침수 예측 없음</b> · 이 강우 조건에서는 관악구 침수가 예측되지 않습니다';
  const b = $('badge'); b.className = 'badge ' + ['ok', 'warn', 'bad'][lv]; b.textContent = ['정상', '주의', '위험'][lv];
  setPred(pr); updateNet();
  if (routeShown) go(false);
}
function applyMode(m) {
  mode = m; $('mLive').classList.toggle('on', m === 'live'); $('mSim').classList.toggle('on', m === 'sim');
  $('wTitle').textContent = m === 'live' ? '현재 강우 (기상청 실황)' : '가상 강우 설정';
  $('sliders').style.display = (m === 'sim' || !liveOK) ? 'block' : 'none';
  $('preset').style.display = m === 'sim' ? 'flex' : 'none'; $('liveMsg').style.display = m === 'live' ? 'block' : 'none';
  if (m === 'live') loadLive(); else { clearTimeout(liveTimer); W.floor = 0; W.official = null; $('keybox').style.display = 'none'; $('wx').innerHTML = ''; ['s10', 's1h', 's3h'].forEach((id, i) => { $(id).value = [W.r10, W.r1h, W.r3h][i]; }); refresh(); }
}
let liveTimer = null;
const getKey = () => { try { return localStorage.getItem('kmaKey') || window.KMA_SERVICE_KEY || ''; } catch (e) { return window.KMA_SERVICE_KEY || ''; } };
async function loadLive() {
  const key = getKey(), msg = $('liveMsg'); liveOK = false; W.floor = 0; W.official = null;
  $('keybox').style.display = 'flex'; $('wx').innerHTML = '';
  if (!key) { msg.textContent = '기상청 인증키를 입력하면 실시간 강수·특보가 자동 반영됩니다. (아래 입력칸)'; return fallbackManual(); }
  msg.textContent = '기상청 데이터 불러오는 중…';
  try {
    const d = await KMA.load(key);
    W.r10 = d.r10; W.r1h = +d.r1h.toFixed(1); W.r3h = +d.r3h.toFixed(1); liveOK = true;
    W.floor = [0, 40, 70][d.warn.level]; W.official = d.warn.level ? ['', '호우주의보', '호우경보'][d.warn.level] : null;
    const f = v => (v == null ? '-' : v);
    const tm = d.warn.tm ? `${d.warn.tm.slice(4, 6)}/${d.warn.tm.slice(6, 8)} ${d.warn.tm.slice(8, 10)}:${d.warn.tm.slice(10, 12)}` : '';
    $('wx').innerHTML = `<div>🌡 기온 ${f(d.temp)}℃ · 습도 ${f(d.reh)}% · 강수확률 ${f(d.pop)}%</div>
      <div>🌧 관측 1h ${d.obs1h.toFixed(1)} / 3h ${d.obs3h.toFixed(1)}mm → 예보 1h ${d.fc1.toFixed(1)} / 3h ${d.fc3.toFixed(1)}mm</div>
      <div>${!d.warn.ok ? '🚨 기상특보: 조회 실패' : d.warn.level ? `🚨 <b style="color:#ff7b7b">서울 ${W.official} 발효 중</b> (발표 ${tm})` : '🚨 서울 호우특보 없음'}</div>
      <div class="src">기준 ${d.at} · 10분마다 갱신 · 자료: 기상청(공공데이터포털)</div>${d.errors.length ? `<div class="src" style="color:#ffd23f">일부 실패: ${d.errors.join(' / ')}</div>` : ''}`;
    msg.textContent = '기상청 실시간 데이터 반영됨 (위험도 입력 = 관측·예보 중 큰 값, 10분 강수량은 1시간 값/6 추정)';
    $('sliders').style.display = 'none'; refresh();
    clearTimeout(liveTimer); liveTimer = setTimeout(() => { if (mode === 'live') loadLive(); }, 600000);
  } catch (e) { console.warn(e); msg.textContent = '기상청 연동 실패: ' + e.message + ' → 수동 입력으로 전환합니다.'; fallbackManual(); }
}
function fallbackManual() { $('sliders').style.display = 'block'; $('preset').style.display = 'none'; refresh(); }

/* ---------- 위치 ---------- */
function setLoc(lon, lat) {
  if (lon < GW.w || lon > GW.e || lat < GW.s || lat > GW.n) { $('locMsg').textContent = '⚠ 관악구 밖입니다. 관악구 안에서 선택해 주세요.'; return false; }
  loc = { lon, lat }; clearMk(userMk); addMk(userMk, pinEl('📍 내 위치', '#ffd23f'), lon, lat);
  const pr = pred(), inz = pr.flood && Route.inZone(lon, lat, pr.z);
  $('locMsg').textContent = '위치 설정 완료' + (inz ? ' · ⚠ 현재 침수 예측 구역 안' : '');
  if (routeShown) go(); return true;
}

/* ---------- 대피 경로 + 비교 + 구간 안내 ---------- */
function go(flyTo = true) {
  if (!loc) { $('locMsg').textContent = '먼저 ① 내 위치를 정해 주세요.'; return; }
  const pr = pred();
  clearMk(routeMk); clearMk(stepMk); map.getSource('hi').setData(EMPTY);
  if (!pr.flood) { routeShown = true; lastRes = null; map.getSource('normal').setData(EMPTY); map.getSource('safe').setData(EMPTY); showNoFlood(); return; }
  $('noFlood').classList.add('hid');
  const res = Route.find(loc.lon, loc.lat, pr.z);
  if (!res) { $('locMsg').textContent = '이 위치 근처(600m 이내)에 도보 길이 없습니다. 다른 위치를 선택하세요.'; return; }
  routeShown = true; lastRes = res;
  const { safe, normal } = res, differs = normal && (Math.abs(normal.len - safe.len) > 5 || Math.abs(normal.wet - safe.wet) > 5);
  map.getSource('normal').setData(differs ? line(normal.coords) : EMPTY); map.getSource('safe').setData(line(safe.coords));
  addMk(routeMk, pinEl('🏫 ' + safe.dest.name, '#2bd66b'), safe.dest.lon, safe.dest.lat);
  lastSteps = Route.steps(safe.segs, safe.dest.name);
  const on = $('bPins').classList.contains('on');
  lastSteps.forEach((st, i) => { if (i === lastSteps.length - 1) return; const el = mkEl(String(i + 1), 'sb'); el.style.background = COL[st.cat]; el.style.display = on ? '' : 'none'; el.onclick = ev => { ev.stopPropagation(); focusStep(i); }; addMk(stepMk, el, st.at[0], st.at[1], 'center'); });
  renderPanel(pr, res, differs); if (flyTo) fitRoute();
}
function showNoFlood() {
  ['result', 'alertCard', 'intro'].forEach(id => $(id).classList.add('hid')); $('noFlood').classList.remove('hid');
  $('nfP').textContent = `입력 강우(10분 ${W.r10}mm · 1시간 ${W.r1h}mm · 3시간 ${W.r3h}mm)는 과거 침수 발생 기준에 미치지 못해, 관악구에 침수가 발생할 것으로 예측되지 않습니다. 대피 경로 안내는 하지 않습니다.`;
}
function fitRoute() { if (lastRes) fit(lastRes.safe.coords.concat(lastRes.normal ? lastRes.normal.coords : [])); }
function focusStep(i) {
  const st = lastSteps[i]; if (!st) return;
  map.getSource('hi').setData(line(st.coords)); fit(st.coords.length > 1 ? st.coords : [st.at, st.at], { top: 160, bottom: 140, left: 380, right: 460 }, 18, 900);
  document.querySelectorAll('#steps li').forEach((li, k) => li.style.outline = k === i ? '2px solid #ffd23f' : 'none');
}
function renderPanel(pr, res, differs) {
  const { safe, normal } = res, tm = l => `약 ${Math.max(1, Math.round(l / 75))}분`, m = v => Math.round(v) + ' m';
  $('result').classList.remove('hid'); $('intro').classList.add('hid');
  const tag = (el, txt, cls) => { el.textContent = txt; el.className = 'tag ' + cls; };
  $('nD').textContent = m(normal.len); $('nW').textContent = m(normal.wet); $('nT').textContent = tm(normal.len);
  $('sD').textContent = m(safe.len); $('sW').textContent = m(safe.wet); $('sT').textContent = tm(safe.len);
  tag($('tagN'), normal.wet > 30 ? '⚠ 침수 위험도로 관통' : '침수 구간 거의 없음', normal.wet > 30 ? 'r' : 'g');
  tag($('tagS'), safe.wet < 1 ? '✔ 침수구역 회피' : safe.wet < normal.wet - 5 ? '⚡ 부분 침수 통과' : '⚡ 불가피한 침수 통과', safe.wet < 1 ? 'g' : 'y');
  const red = normal.wet - safe.wet, extra = safe.len - normal.len;
  $('cmpMsg').innerHTML = differs && red > 5
    ? `✅ 일반 최단경로보다 침수구역 통과 거리를 <b>${Math.round(red)}m(${Math.round(100 * red / Math.max(normal.wet, 1))}%) 줄이는</b> 대신 <b>${Math.max(0, Math.round(extra))}m 더 걷습니다</b> (약 ${Math.max(0, Math.round(extra / 75))}분).`
    : (normal.wet < 30 ? '✔ 현재 침수 위험이 낮아 가장 가까운 경로가 곧 안전경로입니다.' : '⚠ 이 위치에서는 침수 구간을 피할 더 나은 우회로가 없어 두 경로가 같습니다. 침수 구간에서는 특히 주의하세요.');
  const mx = Math.max(normal.len, safe.len, 1), hh = v => Math.max(3, 90 * v / mx);
  $('bars').innerHTML = [['일반 최단경로', normal], ['SafeRoute 안전경로', safe]].map(([n, r]) => `<div class="grp"><div class="bb"><div class="b" style="height:${hh(r.len)}px;background:#2f86c8">${Math.round(r.len)}</div><div class="b" style="height:${hh(r.wet)}px;background:#e0526c">${Math.round(r.wet)}</div></div>${n}</div>`).join('') + '';
  $('bars').insertAdjacentHTML('afterend', '<div class="lg" id="lg"><span><i style="background:#2f86c8"></i>총 이동거리(m)</span><span><i style="background:#e0526c"></i>침수구간 통과거리(m)</span></div>');
  document.querySelectorAll('#lg').forEach((e, i, a) => i < a.length - 1 && e.remove());
  $('steps').innerHTML = lastSteps.map((st, i) => `<li class="c${st.cat}"><span class="n">${i === lastSteps.length - 1 ? '🏁' : i + 1}</span><div><b>${st.title}</b>: ${st.desc}<br><a data-i="${i}">📍 지도에서 위치 확인</a></div></li>`).join('');
  const inZ = Route.inZone(loc.lon, loc.lat, pr.z);
  $('alertCard').classList.remove('hid'); $('noFlood').classList.add('hid');
  $('alT').textContent = inZ ? '⚠ 현재 위치가 침수 예측 구역입니다' : '⚠ 침수 예측 — 대피 경로 안내 시작';
  $('alP').textContent = `AI 침수 예측 점수 ${Math.round(pr.p * 100)}점 · 예상 침수면적 ${(pr.area / 1e4).toFixed(1)}ha. 예측 침수 구역을 피하는 경로를 안내합니다.`;
}

/* ---------- 초기화 ---------- */
(function () {
  setInterval(() => { $('clock').textContent = new Date().toLocaleString('ko-KR', { hour12: false, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }); }, 1000);
  const { net, f22, f100, ev, model } = window.DATA;
  Route.build(net, f22.concat(f100), ev); DATA_AREA = f22.concat(f100).map(x => [x.th, x.a]);
  const mt = model.metrics; $('mi').textContent = `학습: 서울 ${mt.districts}개 구 × 2022년 일별 강우 ${mt.samples.toLocaleString()}건 · 침수 발생 ${mt.positives}건 · 구 단위 교차검증 AUC ${mt.auc}, 재현율 ${mt.recall}`;
  createMap(() => {
    addLayers(f22, f100, net);
    $('spots').innerHTML = SPOTS.map((s, i) => `<button class="ghost" data-i="${i}">${s[0]}</button>`).join('');
    $('spots').onclick = e => { const i = e.target.dataset.i; if (i != null && setLoc(SPOTS[i][1], SPOTS[i][2])) fly(SPOTS[i][1], SPOTS[i][2], 16.2, 1200); };
    $('steps').onclick = e => { const i = e.target.dataset.i; if (i != null) focusStep(+i); };
    $('mLive').onclick = () => applyMode('live'); $('mSim').onclick = () => applyMode('sim');
    [['s10', 'r10'], ['s1h', 'r1h'], ['s3h', 'r3h']].forEach(([id, k]) => $(id).oninput = e => { W[k] = +e.target.value; if (W.r1h < W.r10) W.r1h = W.r10; if (W.r3h < W.r1h) W.r3h = W.r1h; ['s10', 's1h', 's3h'].forEach((q, n) => $(q).value = [W.r10, W.r1h, W.r3h][n]); refresh(); });
    $('preset').onclick = e => { const v = e.target.dataset.v; if (!v) return; [W.r10, W.r1h, W.r3h] = v.split(',').map(Number); ['s10', 's1h', 's3h'].forEach((q, n) => $(q).value = [W.r10, W.r1h, W.r3h][n]); refresh(); };
    $('bGps').onclick = () => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => { if (setLoc(p.coords.longitude, p.coords.latitude)) fly(p.coords.longitude, p.coords.latitude, 16.2, 1200); }, () => $('locMsg').textContent = '위치 권한이 거부되었습니다. 지도를 클릭해 선택하세요.') : $('locMsg').textContent = '이 브라우저는 위치 기능을 지원하지 않습니다.';
    $('kmaSave').onclick = () => { const v = $('kmaKey').value.trim(); if (!v) return; try { localStorage.setItem('kmaKey', v); } catch (e) {} $('kmaKey').value = ''; loadLive(); };
    $('bGo').onclick = () => go(); $('bFit').onclick = fitRoute;
    $('bPins').onclick = e => { const on = e.target.classList.toggle('on'); stepMk.forEach(m => m.getElement().style.display = on ? '' : 'none'); e.target.textContent = on ? '🏷 3D 경로 안내 핀 끄기' : '🏷 3D 경로 안내 핀 켜기'; };
    const vis = (id, on) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    $('t22').onchange = e => vis('ref22', e.target.checked); $('t100').onchange = e => { vis('p22', e.target.checked); vis('p100', e.target.checked); }; $('tnet').onchange = e => { vis('net', e.target.checked); updateNet(); };
    $('b2d').onclick = () => { pitch3d = !pitch3d; map.easeTo({ pitch: pitch3d ? 60 : 0, bearing: pitch3d ? map.getBearing() : 0, duration: 800 }); };
    $('loading').remove(); applyMode('live');
  });
})();
