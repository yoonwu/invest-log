#!/usr/bin/env node
/* 1회용 백필: history.json 각 엔트리에 market.soxl(SOXL 3배 반도체 ETF 종가)를 채운다.
   자산 추이 차트의 SOXL 비교선을 전 구간 그리기 위함. 이미 채워진 엔트리는 건너뛴다.
   qqq/qld와 동일하게 "해당 일자 이전(포함) 마지막 종가"를 쓴다(주말=직전 영업일). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };

async function yahooSeries(symbol, from, to) {
  const p1 = Math.floor(Date.parse(from) / 1000);
  const p2 = Math.floor(Date.parse(to) / 1000) + 86400;
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`
          + `?period1=${p1}&period2=${p2}&interval=1d`;
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const ts = res?.timestamp || [], C = res?.indicators?.quote?.[0]?.close || [];
  const out = [];
  for (let i = 0; i < ts.length; i++)
    if (C[i] != null) out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: +C[i] });
  if (!out.length) throw new Error("빈 시계열");
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

const histPath = path.join(ROOT, "data", "history.json");
const hist = JSON.parse(fs.readFileSync(histPath, "utf8"));
const from = new Date(Date.parse(hist[0].date) - 14 * 86400e3).toISOString().slice(0, 10);
const to = new Date().toISOString().slice(0, 10);
const series = await yahooSeries("SOXL", from, to);

const idxOnOrBefore = d => {
  let idx = -1;
  for (let i = 0; i < series.length; i++) { if (series[i].date <= d) idx = i; else break; }
  return idx;
};

let n = 0;
for (const e of hist) {
  if (e.market.soxl) continue;
  const idx = idxOnOrBefore(e.date);
  if (idx < 0) { console.log("SOXL 데이터 없음:", e.date); continue; }
  const close = series[idx].close, prev = series[idx - 1]?.close ?? null;
  e.market.soxl = { close, chgPct: prev ? +(100 * (close / prev - 1)).toFixed(2) : null };
  n++;
}
fs.writeFileSync(histPath, JSON.stringify(hist) + "\n");
console.log(`[backfill-soxl] ${n}개 엔트리 채움 (총 ${hist.length}개)`);
