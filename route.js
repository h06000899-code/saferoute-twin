/* SafeRoute Twin - 경로 탐색 (AI 예측 침수구역을 피하는 다익스트라). 브라우저/Node 공용
 * 각 침수 폴리곤은 학습된 임계값 th(모델 z점수)를 가진다. 예측 z >= th 인 폴리곤만 '침수 예측 구역'. */
const Route = (() => {
  let N, adj, edges, nodes, cands, idx, ready = false, comp, mainComp;
  const INF = 1e9;
  function inRing(x, y, r) {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  function makeIndex(items) {            // items: [{r, th}]
    const cs = 0.002, grid = new Map();
    items.forEach((it, id) => {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      it.r.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
      for (let i = Math.floor(x0 / cs); i <= Math.floor(x1 / cs); i++)
        for (let j = Math.floor(y0 / cs); j <= Math.floor(y1 / cs); j++) {
          const k = i + ',' + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(id);
        }
    });
    return { minTh(x, y) {               // 이 지점을 덮는 폴리곤 중 가장 낮은 임계값(= 가장 먼저 잠기는 시점)
      const l = grid.get(Math.floor(x / cs) + ',' + Math.floor(y / cs)); let m = INF;
      if (l) for (const id of l) { const it = items[id]; if (it.th < m && inRing(x, y, it.r)) m = it.th; }
      return m; } };
  }
  const d2m = (a, b) => Math.hypot((a[0] - b[0]) * 88000, (a[1] - b[1]) * 111000);

  function build(net, items, evacLines) {
    idx = makeIndex(items); nodes = net.nodes; N = nodes.length;
    const adj0 = Array.from({ length: N }, () => []);
    net.edges.forEach(e => { adj0[e[0]].push(e[1]); adj0[e[1]].push(e[0]); });
    comp = new Int32Array(N).fill(-1); let best = -1, bestN = 0, cid = 0;
    for (let s = 0; s < N; s++) {
      if (comp[s] >= 0) continue; let n = 0; const st = [s]; comp[s] = cid;
      while (st.length) { const u = st.pop(); n++; for (const v of adj0[u]) if (comp[v] < 0) { comp[v] = cid; st.push(v); } }
      if (n > bestN) { bestN = n; best = cid; } cid++;
    }
    mainComp = best; edges = []; adj = Array.from({ length: N }, () => []);
    net.edges.forEach(e => {
      if (comp[e[0]] !== best) return;
      const g = e[4], pts = g.slice(); if (g.length > 1) pts.push([(g[0][0] + g[g.length - 1][0]) / 2, (g[0][1] + g[g.length - 1][1]) / 2]);
      const ths = pts.map(p => idx.minTh(p[0], p[1])), id = edges.length;
      edges.push({ a: e[0], b: e[1], len: e[2], g, ths });
      adj[e[0]].push([e[1], id]); adj[e[1]].push([e[0], id]);
    });
    const seen = new Set(); cands = [];
    evacLines.forEach(l => [l[0], l[l.length - 1]].forEach(p => {
      const k = Math.round(p[0] / 0.0015) + ',' + Math.round(p[1] / 0.0015); if (seen.has(k)) return; seen.add(k);
      const nn = nearest(p[0], p[1], 250); if (nn < 0) return;
      cands.push({ node: nn, lon: nodes[nn][0], lat: nodes[nn][1], th: idx.minTh(nodes[nn][0], nodes[nn][1]) });
    }));
    const u = new Map(); cands.forEach(c => u.set(c.node, c)); cands = [...u.values()];
    cands.forEach((c, i) => c.name = `대피 지점 ${String(i + 1).padStart(2, '0')}`);
    ready = true; return { nodes: bestN, edges: edges.length, cands: cands.length };
  }
  function nearest(lon, lat, maxM = 1e9) {
    let b = -1, bd = maxM;
    for (let i = 0; i < N; i++) { if (comp[i] !== mainComp) continue; const d = d2m([lon, lat], nodes[i]); if (d < bd) { bd = d; b = i; } }
    return b;
  }
  const frac = (e, z) => { let c = 0; for (const t of e.ths) if (t <= z) c++; return c / e.ths.length; };
  function dijkstra(src, w) {
    const dist = new Float64Array(N).fill(Infinity), pe = new Int32Array(N).fill(-1), pn = new Int32Array(N).fill(-1);
    const h = [[0, src]]; dist[src] = 0;
    const push = x => { h.push(x); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } };
    const pop = () => { const t = h[0], l = h.pop(); if (h.length) { h[0] = l; let i = 0; for (;;) { let a = 2 * i + 1, b = a + 1, m = i; if (a < h.length && h[a][0] < h[m][0]) m = a; if (b < h.length && h[b][0] < h[m][0]) m = b; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } } return t; };
    while (h.length) { const [d, u] = pop(); if (d > dist[u]) continue;
      for (const [v, ei] of adj[u]) { const nd = d + w[ei]; if (nd < dist[v]) { dist[v] = nd; pe[v] = ei; pn[v] = u; push([nd, v]); } } }
    return { dist, pe, pn };
  }
  const weights = z => edges.map(e => e.len * (1 + 15 * frac(e, z)));
  function pick(src, w, z) {
    const r = dijkstra(src, w); let best = null, any = null;
    cands.forEach(c => { const d = r.dist[c.node]; if (d === Infinity) return;
      if (!any || d < any.d) any = { c, d }; if (c.th > z && (!best || d < best.d)) best = { c, d }; });   // 침수 예측 구역 밖 대피지 우선
    const b = best || any; return b ? { r, c: b.c } : null;
  }
  function trace(r, src, dst, z) {
    const path = [], segs = []; let v = dst, len = 0, wet = 0; const es = [];
    while (v !== src) { const ei = r.pe[v]; es.push([ei, v]); v = r.pn[v]; }
    es.reverse(); let cur = nodes[src];
    es.forEach(([ei, to]) => {
      const e = edges[ei]; let g = e.g; if (d2m(g[0], cur) > d2m(g[g.length - 1], cur)) g = g.slice().reverse();
      const f = frac(e, z); g.forEach(p => path.push(p)); segs.push({ coords: g, len: e.len, f }); cur = nodes[to]; len += e.len; wet += e.len * f;
    });
    return { coords: path, len, wet, segs };
  }
  /** z: 모델 예측 점수. 반환 {safe, normal} (normal = 침수를 고려하지 않은 최단경로) */
  function find(lon, lat, z) {
    const s = nearest(lon, lat, 600); if (s < 0) return null;
    const a = pick(s, weights(z), z); if (!a) return null;
    const safe = Object.assign(trace(a.r, s, a.c.node, z), { dest: a.c });
    const b = pick(s, edges.map(e => e.len), -INF); let normal = null;
    if (b) normal = Object.assign(trace(b.r, s, b.c.node, z), { dest: b.c });
    return { safe, normal, start: nodes[s] };
  }
  const inZone = (lon, lat, z) => idx.minTh(lon, lat) <= z;
  const fracs = z => edges.map(e => frac(e, z));

  /* ---- 구간별 안내문 ---- */
  const brg = (a, b) => Math.atan2((b[0] - a[0]) * 88000, (b[1] - a[1]) * 111000) * 180 / Math.PI;
  const cat = s => s.f >= 0.5 ? 2 : s.f > 0.05 ? 1 : 0;
  function headOut(c) { const a = c[0]; for (const p of c) if (d2m(a, p) >= 20) return brg(a, p); return brg(a, c[c.length - 1]); }
  function headIn(c) { const z = c[c.length - 1]; for (let i = c.length - 1; i >= 0; i--) if (d2m(z, c[i]) >= 20) return brg(c[i], z); return brg(c[0], z); }
  const turn = (a, b) => { const d = ((b - a + 540) % 360) - 180, ad = Math.abs(d); return ad < 30 ? '직진' : ad > 150 ? '뒤로 돌아' : (d > 0 ? '우회전' : '좌회전'); };
  const compass = d => ['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round((((d % 360) + 360) % 360) / 45) % 8] + '쪽';
  const TITLE = ['안전 구간', '경미한 침수 주의 구간', '침수 위험 구간'];
  function steps(segs, destName) {
    const gs = [], sh = s => brg(s.coords[0], s.coords[s.coords.length - 1]), dd = (a, b) => Math.abs(((b - a + 540) % 360) - 180);
    segs.forEach(s => {
      const c = cat(s), g = gs[gs.length - 1], h = s.len >= 10 ? sh(s) : null;
      const split = g && g.c !== c && s.len >= 12 || (g && h !== null && g.len >= 60 && dd(brg(g.coords[0], g.coords[g.coords.length - 1]), h) > 70);
      if (g && !split) { g.coords.push(...s.coords); g.len += s.len; } else gs.push({ c, coords: s.coords.slice(), len: s.len });
    });
    for (let i = gs.length - 1; i > 0; i--) {
      const p = gs[i - 1], g = gs[i];
      if (p.c === g.c && dd(headIn(p.coords), headOut(g.coords)) < 25) { p.coords.push(...g.coords); p.len += g.len; gs.splice(i, 1); }
    }
    const out = gs.map((g, i) => {
      const act = i === 0 ? compass(headOut(g.coords)) + ' 방향으로 출발' : turn(headIn(gs[i - 1].coords), headOut(g.coords));
      let desc = `${act}하여 ${Math.round(g.len)}m 이동`;
      if (g.c > 0) desc += ' (AI 예측 침수 구간 · 물이 찬 곳은 피하세요)';
      return { cat: g.c, title: TITLE[g.c], desc, len: g.len, coords: g.coords, at: g.coords[0] };
    });
    const last = segs[segs.length - 1].coords, e = last[last.length - 1];
    out.push({ cat: 3, title: '도착', desc: `${destName}에 도착했습니다. 안전한 곳에서 대기하세요.`, len: 0, coords: [e, e], at: e });
    return out;
  }
  return { build, find, inZone, steps, fracs, get edges() { return edges; }, get cands() { return cands; }, get ready() { return ready; } };
})();
if (typeof module !== 'undefined') module.exports = Route;
