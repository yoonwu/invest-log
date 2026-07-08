#!/usr/bin/env node
/* 진단용(임시): 문제 티커의 최근 일봉 종가를 여러 소스로 조회해 어느 게 실제(증권사) 값과 맞는지 확인.
   실제 7/7 종가 정답 = 20,870원 (사용자 앱). 데이터 커밋 없음, 로그 출력만. */
const CODE = process.argv[2] || "0195S0";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };
const d8 = s => s.replaceAll("-", "");
const from = new Date(Date.now() - 20 * 86400e3).toISOString().slice(0, 10);
const to = new Date().toISOString().slice(0, 10);

async function tryIt(label, fn) {
  try { const r = await fn(); console.log(`\n### ${label}\n` + r); }
  catch (e) { console.log(`\n### ${label}\n[ERR] ${e.message}`); }
}

const tail = (arr, n = 6) => arr.slice(-n).map(x => JSON.stringify(x)).join("\n");

// 1) 현재 코드가 쓰는 방식: api.finance.naver.com siseJson
await tryIt("naver siseJson (현재 코드)", async () => {
  const u = `https://api.finance.naver.com/siseJson.naver?symbol=${CODE}&requestType=1&startTime=${d8(from)}&endTime=${d8(to)}&timeframe=day`;
  const r = await fetch(u, { headers: UA }); const t = await r.text();
  return `raw(last 500 chars):\n` + t.slice(-500);
});

// 2) 신 모바일 API: api.stock.naver.com day chart
await tryIt("naver api.stock.naver.com/chart day", async () => {
  const u = `https://api.stock.naver.com/chart/domestic/item/${CODE}/day?startDateTime=${d8(from)}0000&endDateTime=${d8(to)}0000`;
  const r = await fetch(u, { headers: UA }); const j = await r.json();
  const rows = (Array.isArray(j) ? j : j?.priceInfos || j?.datas || []).map(x =>
    ({ date: x.localDate || x.localDateTime, close: x.closePrice ?? x.close }));
  return tail(rows);
});

// 3) 실시간 현재가: polling.finance.naver.com
await tryIt("naver realtime polling", async () => {
  const u = `https://polling.finance.naver.com/api/realtime/domestic/stock/${CODE}`;
  const r = await fetch(u, { headers: UA }); const t = await r.text();
  return t.slice(0, 700);
});

// 4) Yahoo .KS / .KQ
for (const sfx of [".KS", ".KQ"]) {
  await tryIt(`yahoo ${CODE}${sfx}`, async () => {
    const u = `https://query1.finance.yahoo.com/v8/finance/chart/${CODE}${sfx}?interval=1d&range=15d`;
    const r = await fetch(u, { headers: UA }); const j = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) throw new Error(j?.chart?.error?.description || "no result");
    const ts = res.timestamp || [], C = res.indicators?.quote?.[0]?.close || [];
    const rows = ts.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: C[i] }));
    return tail(rows);
  });
}

// 5) stooq
for (const s of [`${CODE.toLowerCase()}.kr`, `${CODE.toLowerCase()}.ks`]) {
  await tryIt(`stooq ${s}`, async () => {
    const u = `https://stooq.com/q/d/l/?s=${s}&d1=${d8(from)}&d2=${d8(to)}&i=d`;
    const r = await fetch(u, { headers: UA }); const t = await r.text();
    return t.slice(0, 600);
  });
}
console.log("\n=== 정답(증권사) 7/7 종가 = 20,870원 ===");
