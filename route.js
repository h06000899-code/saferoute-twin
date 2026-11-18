/* SafeRoute Twin - 경로 탐색 (침수 위험 가중 다익스트라). 브라우저/Node 공용 */
const Route = (() => {
  let N, adj, edges, nodes, cands, idx2022, idx100, ready = false;

  function inRing(x, y, r) {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  function makeIndex(rings) {
    const cs = 0.002, grid = new Map();
    rings.forEach(r => {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      r.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
      for (let i = Math.floor(x0 / cs); i <= Math.floor(x1 / cs); i++)
        for (let j = Math.floor(y0 / cs); j <= Math.floor(y1 / cs); j++) {
          const k = i + ',' + j;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(r);
        }
    });
    return { hit(x, y) { const l = grid.get(Math.floor(x / cs) + ',' + Math.floor(y / cs)); return !!l && l.some(r => inRing(x, y, r)); } };
  }
  const d2m = (a, b) => { const dx = (a[0] - b[0]) * 88000, dy = (a[1] - b[1]) * 111000; return Math.hypot(dx, dy); };

  function build(net, rings2022, rings100, evacLines) {
    idx2022 = makeIndex(rings2022); idx100 = makeIndex(rings100);
    nodes = net.nodes; N = nodes.length;
    // 가장 큰 연결 성분만 사용
    const adj0 = Array.from({ length: N }, () => []);
    net.edges.forEach((e, i) => { adj0[e[0]].push(e[1]); adj0[e[1]].push(e[0]); });
    const comp = new Int32Array(N).fill(-1); let best = -1, bestN = 0, cid = 0;
    for (let s = 0; s < N; s++) {
      if (comp[s] >= 0) continue;
      let n = 0; const st = [s]; comp[s] = cid;
      while (st.length) { const u = st.pop(); n++; for (const v of adj0[u]) if (comp[v] < 0) { comp[v] = cid; st.push(v); } }
      if (n > bestN) { bestN = n; best = cid; } cid++;
    }
    edges = []; adj = Array.from({ length: N }, () => []);
    net.edges.forEach(e => {
      if (comp[e[0]] !== best) return;
      const g = e[4], pts = g.slice(); if (g.length > 1) pts.push([(g[0][0] + g[g.length - 1][0]) / 2, (g[0][1] + g[g.length - 1][1]) / 2]);
      let h1 = 0, h2 = 0; pts.forEach(p => { if (idx2022.hit(p[0], p[1])) h1++; if (idx100.hit(p[0], p[1])) h2++; });
      const f1 = h1 / pts.length, f2 = h2 / pts.length, id = edges.length;
      edges.push({ a: e[0], b: e[1], len: e[2], f1, f2, g });
      adj[e[0]].push([e[1], id]); adj[e[1]].push([e[0], id]);
    });
    this_comp = comp; mainComp = best;
    // 대피 후보지: 대피경로 선 끝점 중 침수구역 밖 + 도보망에 연결되는 지점
    const seen = new Set(); cands = [];
    evacLines.forEach(l => [l[0], l[l.length - 1]].forEach(p => {
      const k = Math.round(p[0] / 0.0015) + ',' + Math.round(p[1] / 0.0015);
      if (seen.has(k)) return; seen.add(k);
      const nn = nearest(p[0], p[1], 250); if (nn < 0) return;
      const q = nodes[nn];
      if (idx2022.hit(q[0], q[1]) || idx100.hit(q[0], q[1])) return;
      cands.push({ node: nn, lon: q[0], lat: q[1] });
    }));
    const u = new Map(); cands.forEach(c => u.set(c.node, c)); cands = [...u.values()];
    cands.forEach((c, i) => c.name = `대피 지점 ${String(i + 1).padStart(2, '0')}`);
    ready = true;
    return { nodes: bestN, edges: edges.length, cands: cands.length };
  }
  let this_comp, mainComp;
  function nearest(lon, lat, maxM = 1e9) {
    let b = -1, bd = maxM;
    for (let i = 0; i < N; i++) {
      if (this_comp[i] !== mainComp) continue;
      const d = d2m([lon, lat], nodes[i]); if (d < bd) { bd = d; b = i; }
    } return b;
  }
  function dijkstra(src, w) {
    const dist = new Float64Array(N).fill(Infinity), pe = new Int32Array(N).fill(-1), pn = new Int32Array(N).fill(-1);
    const h = [[0, src]]; dist[src] = 0;
    const push = x => { h.push(x); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } };
    const pop = () => { const t = h[0], l = h.pop(); if (h.length) { h[0] = l; let i = 0; for (;;) { let a = 2 * i + 1, b = a + 1, m = i; if (a < h.length && h[a][0] < h[m][0]) m = a; if (b < h.length && h[b][0] < h[m][0]) m = b; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } } return t; };
    while (h.length) {
      const [d, u] = pop(); if (d > dist[u]) continue;
      for (const [v, ei] of adj[u]) { const nd = d + w[ei]; if (nd < dist[v]) { dist[v] = nd; pe[v] = ei; pn[v] = u; push([nd, v]); } }
    }
    return { dist, pe, pn };
  }
  function weights(L) { return edges.map(e => e.len * (1 + 10 * L * (e.f1 + 0.7 * e.f2))); }
  function pick(src, L) {
    const r = dijkstra(src, weights(L)); let best = null;
    cands.forEach(c => { const d = r.dist[c.node]; if (d < Infinity && (!best || d < best.d)) best = { c, d }; });
    return best ? { r, c: best.c } : null;
  }
  function trace(r, src, dst) {
    const path = [], segs = []; let v = dst, len = 0, wet = 0; const es = [];
    while (v !== src) { const ei = r.pe[v]; es.push([ei, v]); v = r.pn[v]; }
    es.reverse(); let cur = nodes[src];
    es.forEach(([ei, to]) => {
      const e = edges[ei]; let g = e.g; if (d2m(g[0], cur) > d2m(g[g.length - 1], cur)) g = g.slice().reverse();
      g.forEach(p => path.push(p)); segs.push({ coords: g, len: e.len, f1: e.f1, f2: e.f2 }); cur = nodes[to]; len += e.len; wet += e.len * Math.min(1, e.f1 + e.f2);
    });
    return { coords: path, len, wet, segs };
  }
  /** L: 0~1 위험도. 반환: {safe, normal} */
  function find(lon, lat, L) {
    const s = nearest(lon, lat, 600); if (s < 0) return null;
    const a = pick(s, L); if (!a) return null;
    const safe = Object.assign(trace(a.r, s, a.c.node), { dest: a.c });
    const b = pick(s, 0); let normal = null;
    if (b) normal = Object.assign(trace(b.r, s, b.c.node), { dest: b.c });
    return { safe, normal, start: nodes[s] };
  }

  /* ---- 구간별 안내문 생성 ---- */
  const brg = (a, b) => Math.atan2((b[0] - a[0]) * 88000, (b[1] - a[1]) * 111000) * 180 / Math.PI;
  const cat = s => { const f = Math.min(1, s.f1 + s.f2); return f >= 0.5 ? 2 : f > 0.05 ? 1 : 0; };
  function headOut(c) { const a = c[0]; for (const p of c) if (d2m(a, p) >= 20) return brg(a, p); return brg(a, c[c.length - 1]); }
  function headIn(c) { const z = c[c.length - 1]; for (let i = c.length - 1; i >= 0; i--) if (d2m(z, c[i]) >= 20) return brg(c[i], z); return brg(c[0], z); }
  const turn = (a, b) => { const d = ((b - a + 540) % 360) - 180, ad = Math.abs(d); return ad < 30 ? '직진' : ad > 150 ? '뒤로 돌아' : (d > 0 ? '우회전' : '좌회전'); };
  const compass = d => ['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round((((d % 360) + 360) % 360) / 45) % 8] + '쪽';
  const TITLE = ['안전 구간', '경미한 침수 주의 구간', '침수 위험 구간'];
  function steps(segs, destName) {
    const gs = [];
    const sh = s => brg(s.coords[0], s.coords[s.coords.length - 1]);
    const dd = (a, b) => Math.abs(((b - a + 540) % 360) - 180);
    segs.forEach(s => {
      const c = cat(s), g = gs[gs.length - 1], h = s.len >= 10 ? sh(s) : null;
      const split = g && g.c !== c && s.len >= 12 || (g && h !== null && g.len >= 60 && dd(brg(g.coords[0], g.coords[g.coords.length - 1]), h) > 70);
      if (g && !split) { g.coords.push(...s.coords); g.len += s.len; g.a += s.f1 * s.len; g.b += s.f2 * s.len; if (g.h === null) g.h = h; }
      else gs.push({ c, coords: s.coords.slice(), len: s.len, a: s.f1 * s.len, b: s.f2 * s.len, h });
    });
    for (let i = gs.length - 1; i > 0; i--) { // 같은 위험등급 + 직진이면 합치기
      const p = gs[i - 1], g = gs[i];
      if (p.c === g.c && dd(headIn(p.coords), headOut(g.coords)) < 25) { p.coords.push(...g.coords); p.len += g.len; p.a += g.a; p.b += g.b; gs.splice(i, 1); }
    }
    const out = gs.map((g, i) => {
      const act = i === 0 ? compass(headOut(g.coords)) + ' 방향으로 출발' : turn(headIn(gs[i - 1].coords), headOut(g.coords));
      let desc = `${act}하여 ${Math.round(g.len)}m 이동`;
      if (g.c > 0) desc += ` (${g.a >= g.b ? '2022 실제 침수흔적' : '100년 빈도 침수 예측'} 구간 · 물이 찬 곳은 피하세요)`;
      return { cat: g.c, title: TITLE[g.c], desc, len: g.len, coords: g.coords, at: g.coords[0] };
    });
    const last = segs[segs.length - 1].coords; const e = last[last.length - 1];
    out.push({ cat: 3, title: '도착', desc: `${destName}에 도착했습니다. 안전한 곳에서 대기하세요.`, len: 0, coords: [e, e], at: e });
    return out;
  }
  const inZone = (lon, lat) => ({ past: idx2022.hit(lon, lat), pred: idx100.hit(lon, lat) });
  return { build, find, inZone, steps, get edges() { return edges; }, get ready() { return ready; }, get cands() { return cands; } };
})();
if (typeof module !== 'undefined') module.exports = Route;
