/* 기상청 공공데이터포털 연동 (브라우저 직접 호출, 백엔드 없음)
 * - 단기예보 조회서비스 VilageFcstInfoService_2.0 : getUltraSrtNcst(초단기실황) / getUltraSrtFcst(초단기예보) / getVilageFcst(단기예보)
 * - 기상특보 조회서비스 WthrWrnInfoService      : getWthrWrnMsg(기상특보통보문)
 * 관악구 격자 nx=59, ny=125 / 서울 특보 지점코드 stnId=109 */
const KMA = (() => {
  const BASE = 'https://apis.data.go.kr/1360000/', NX = 59, NY = 125, STN = 109;
  const p2 = n => String(n).padStart(2, '0');
  const kst = (ms = Date.now()) => new Date(ms + 9 * 3600e3);
  const ymd = d => `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`;
  const H = 3600e3;

  async function call(svc, op, q, key) {
    const k = key.includes('%') ? key : encodeURIComponent(key);
    const qs = Object.entries(q).map(([a, b]) => a + '=' + encodeURIComponent(b)).join('&');
    const r = await fetch(`${BASE}${svc}/${op}?serviceKey=${k}&dataType=JSON&${qs}`);
    const t = await r.text(); let j;
    try { j = JSON.parse(t); } catch (e) {
      const m = t.match(/<returnAuthMsg>([^<]*)/) || t.match(/<errMsg>([^<]*)/);
      throw new Error(m ? m[1] : '응답 형식 오류(인증키 또는 활용신청 승인 상태 확인)');
    }
    const h = j.response && j.response.header;
    if (!h) throw new Error(j.returnAuthMsg || j.errMsg || '응답 오류');
    if (h.resultCode === '03') return [];
    if (h.resultCode !== '00') throw new Error(h.resultMsg || ('결과코드 ' + h.resultCode));
    const it = j.response.body.items && j.response.body.items.item;
    return Array.isArray(it) ? it : it ? [it] : [];
  }
  // "강수없음" / "1mm 미만" / "1.0mm" / "30.0~50.0mm" / "50.0mm 이상" → 숫자(mm)
  function rain(s) {
    s = String(s == null ? '' : s);
    if (!s || /없음/.test(s)) return 0;
    if (/미만/.test(s)) return 0.5;
    const n = (s.match(/[\d.]+/g) || []).map(parseFloat).filter(v => !isNaN(v));
    return n.length === 0 ? 0 : n.length > 1 ? (n[0] + n[1]) / 2 : n[0];
  }
  // 특보통보문에서 '서울'이 포함된 호우주의보/경보 줄 찾기 (해제 문구 제외)
  function warnLevel(items) {
    if (!items.length) return { level: 0, title: '', tm: '' };
    const last = items.slice().sort((a, b) => String(b.tmFc).localeCompare(String(a.tmFc)))[0];
    const lines = [last.t6, last.t1, last.t4].filter(Boolean).join('\n').split(/\r?\n/);
    let level = 0;
    lines.forEach(l => { if (/서울/.test(l) && !/해제/.test(l)) { if (/호우경보/.test(l)) level = 2; else if (/호우주의보/.test(l)) level = Math.max(level, 1); } });
    return { level, title: String(last.t1 || '').split(/\r?\n/)[0].trim(), tm: String(last.tmFc || '') };
  }

  async function load(key) {
    const now = kst(), SV = 'VilageFcstInfoService_2.0';
    const nc = new Date(now.getTime() - (now.getUTCMinutes() < 15 ? H : 0));            // 초단기실황: 정시 + 10분 이후
    const uf = new Date(now.getTime() - (now.getUTCMinutes() < 45 ? H : 0));            // 초단기예보: HH30 발표, +15분 이후
    let vd = new Date(now.getTime() - 10 * 60e3), vh = [23, 20, 17, 14, 11, 8, 5, 2].find(x => x <= vd.getUTCHours());
    if (vh === undefined) { vd = new Date(vd.getTime() - 24 * H); vh = 23; }            // 단기예보: 02,05,…,23시 발표, +10분 이후
    const jobs = [0, 1, 2].map(h => { const t = new Date(nc.getTime() - h * H); return call(SV, 'getUltraSrtNcst', { pageNo: 1, numOfRows: 20, base_date: ymd(t), base_time: p2(t.getUTCHours()) + '00', nx: NX, ny: NY }, key); });
    jobs.push(call(SV, 'getUltraSrtFcst', { pageNo: 1, numOfRows: 100, base_date: ymd(uf), base_time: p2(uf.getUTCHours()) + '30', nx: NX, ny: NY }, key));
    jobs.push(call(SV, 'getVilageFcst', { pageNo: 1, numOfRows: 300, base_date: ymd(vd), base_time: p2(vh) + '00', nx: NX, ny: NY }, key));
    jobs.push(call('WthrWrnInfoService', 'getWthrWrnMsg', { pageNo: 1, numOfRows: 10, stnId: STN, fromTmFc: ymd(new Date(now.getTime() - 24 * H)), toTmFc: ymd(now) }, key));
    const [n0, n1, n2, ufc, vfc, wrn] = await Promise.allSettled(jobs);
    if (n0.status !== 'fulfilled') throw new Error('초단기실황 조회 실패: ' + n0.reason.message);
    const val = (arr, c) => { const x = arr.find(i => i.category === c); return x ? x.obsrValue : null; };
    const o = { errors: [], temp: val(n0.value, 'T1H'), reh: val(n0.value, 'REH'), pty: val(n0.value, 'PTY') };
    const r = a => a.status === 'fulfilled' ? rain(val(a.value, 'RN1')) : 0;
    o.obs1h = r(n0); o.obs3h = r(n0) + r(n1) + r(n2);
    if (n1.status !== 'fulfilled' || n2.status !== 'fulfilled') o.errors.push('과거 실황 일부 누락');
    o.fc1 = 0; o.fc3 = 0;
    if (ufc.status === 'fulfilled') {
      const rr = ufc.value.filter(i => i.category === 'RN1').sort((a, b) => (a.fcstDate + a.fcstTime).localeCompare(b.fcstDate + b.fcstTime)).map(i => rain(i.fcstValue));
      o.fc1 = rr[0] || 0; o.fc3 = rr.slice(0, 3).reduce((a, b) => a + b, 0);
    } else o.errors.push('초단기예보: ' + ufc.reason.message);
    o.pop = null;
    if (vfc.status === 'fulfilled') {
      const key = ymd(now) + p2(now.getUTCHours()) + '00';
      const ps = vfc.value.filter(i => i.category === 'POP' && (i.fcstDate + i.fcstTime) >= key).sort((a, b) => (a.fcstDate + a.fcstTime).localeCompare(b.fcstDate + b.fcstTime)).slice(0, 3).map(i => +i.fcstValue);
      if (ps.length) o.pop = Math.max(...ps);
    } else o.errors.push('단기예보: ' + vfc.reason.message);
    o.warn = { level: 0, title: '', tm: '', ok: false };
    if (wrn.status === 'fulfilled') o.warn = Object.assign(warnLevel(wrn.value), { ok: true }); else o.errors.push('기상특보: ' + wrn.reason.message);
    // 위험도 입력값: 관측과 예보 중 큰 값 (대피는 '앞으로 올 비'도 고려)
    o.r1h = Math.max(o.obs1h, o.fc1); o.r3h = Math.max(o.obs3h, o.fc3); o.r10 = +(o.r1h / 6).toFixed(1);
    o.at = `${p2(now.getUTCHours())}:${p2(now.getUTCMinutes())}`;
    return o;
  }
  return { load, rain, warnLevel };
})();
if (typeof module !== 'undefined') module.exports = KMA;
