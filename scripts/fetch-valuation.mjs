#!/usr/bin/env node
/* ============================================================================
   invest-log 평가액 계산 + 일일 스냅샷 축적
   ----------------------------------------------------------------------------
   positions.json 을 읽어 종목별 시세·환율을 조회하고
   - data/valuation.json : 계좌 상세 (계좌 페이지용, 매일 덮어씀)
   - data/history.json   : 하루 1건 일지 엔트리 축적 (홈 피드·그래프용)

   시세 소스 (s-backtesting 의 yogibag-data-proxy.worker.js 로직 재사용):
   - 미국 티커·지수·벤치마크 : Yahoo chart API(1순위) → stooq CSV(폴백)
   - 환율 USD/KRW            : 동일 Yahoo 로직, 심볼 KRW=X
   - 국내 티커(KRX)          : 네이버 siseJson.naver 일봉
   - 공포탐욕지수            : CNN 비공식 API (실패해도 무시)
   일 1회 스냅샷 전제 — 각 소스의 최근 일봉 종가를 쓴다.
   ========================================================================== */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };
const START_DATE = "2026-07-03"; // 기록 시작일 (D+N 기준)

/* ---- Yahoo Finance chart API (워커 fromYahoo 축약: 일봉 종가만) ---- */
async function fromYahoo(symbol, from, to) {
  const p1 = Math.floor(Date.parse(from) / 1000);
  const p2 = Math.floor(Date.parse(to) / 1000) + 86400; // 종료일 포함
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
          + `?period1=${p1}&period2=${p2}&interval=1d`;
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result || j?.chart?.error) throw new Error(j?.chart?.error?.description || "결과 없음");
  const ts = result.timestamp || [];
  const C = result.indicators?.quote?.[0]?.close || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (C[i] == null) continue;
    out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: +C[i] });
  }
  if (!out.length) throw new Error("빈 시계열");
  return out;
}

/* ---- Stooq CSV (워커 fromStooq 축약: 일봉 폴백) ---- */
async function fromStooq(symbol, from, to) {
  const d = s => s.replaceAll("-", "");
  const u = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&d1=${d(from)}&d2=${d(to)}&i=d`;
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const t = await r.text();
  if (/N\/D|<html/i.test(t)) throw new Error("데이터 없음");
  const lines = t.trim().split(/\r?\n/);
  const h = lines[0].toLowerCase().split(",");
  const di = h.indexOf("date"), ci = h.indexOf("close");
  if (di < 0 || ci < 0) throw new Error("CSV 형식 오류");
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    const c = parseFloat(p[ci]);
    if (!p[di] || isNaN(c) || c <= 0) continue;
    out.push({ date: p[di].slice(0, 10), close: c });
  }
  if (!out.length) throw new Error("빈 시계열");
  return out;
}

/* ---- 네이버 siseJson.naver (국내 티커 일봉) ---- */
async function fromNaver(code, from, to) {
  const d = s => s.replaceAll("-", "");
  const u = `https://api.finance.naver.com/siseJson.naver?symbol=${encodeURIComponent(code)}`
          + `&requestType=1&startTime=${d(from)}&endTime=${d(to)}&timeframe=day`;
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const t = await r.text();
  const out = [];
  let rows = null;
  try { rows = JSON.parse(t.replace(/'/g, '"').trim()); } catch { /* 폴백 사용 */ }
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const date = String(row?.[0] ?? ""), close = +row?.[4];
      if (/^\d{8}$/.test(date) && Number.isFinite(close) && close > 0)
        out.push({ date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`, close });
    }
  } else {
    for (const m of t.matchAll(/\[\s*"?(\d{8})"?\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)/g))
      out.push({ date: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`, close: +m[2] });
  }
  if (!out.length) throw new Error("빈 시계열");
  return out;
}

/* ---- 소스 순서대로 시도, 최근 종가 + 전일 대비 반환 ---- */
async function latest(fetchers, label) {
  const errors = [];
  for (const [source, fn] of fetchers) {
    try {
      const rows = await fn();
      const last = rows[rows.length - 1], prev = rows[rows.length - 2];
      return { price: last.close, date: last.date, source,
               chgPct: prev ? +(100 * (last.close / prev.close - 1)).toFixed(2) : null };
    } catch (e) { errors.push(`${source}: ${e.message}`); }
  }
  throw new Error(`${label} 시세 조회 실패 — ${errors.join(" / ")}`);
}

const usQuote = t => latest([
  ["yahoo", () => fromYahoo(t, from, to)],
  ["stooq", () => fromStooq(t.toLowerCase().replace(/^\^/, "") + ".us", from, to)],
], t);
const yahooOnly = s => latest([["yahoo", () => fromYahoo(s, from, to)]], s);

/* ---- CNN 공포탐욕지수 (실패해도 null) ---- */
async function fearGreed() {
  try {
    const r = await fetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
                          { headers: UA });
    if (!r.ok) return null;
    const j = await r.json();
    const g = j?.fear_and_greed;
    if (!g || !Number.isFinite(+g.score)) return null;
    return { score: Math.round(+g.score), rating: String(g.rating || "") };
  } catch { return null; }
}

/* ---- 메인 ---- */
const positions = JSON.parse(fs.readFileSync(path.join(ROOT, "positions.json"), "utf8"));
const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
const today = kstNow.toISOString().slice(0, 10); // KST 기준 날짜
const to = new Date().toISOString().slice(0, 10);
const from = new Date(Date.now() - 21 * 86400 * 1000).toISOString().slice(0, 10);

const fx = await latest([
  ["yahoo", () => fromYahoo("KRW=X", from, to)],
  ["stooq", () => fromStooq("usdkrw", from, to)],
], "USD/KRW");

const accounts = [];
const holdingsChg = {};
const qtyMap = {};
for (const acc of positions.accounts) {
  const holdings = [];
  for (const h of acc.holdings) {
    let quote, currency;
    if (h.market === "US") {
      quote = await usQuote(h.ticker); currency = "USD";
    } else if (h.market === "KRX") {
      quote = await latest([["naver", () => fromNaver(h.ticker, from, to)]], h.ticker);
      currency = "KRW";
    } else if (h.market === "CASH") {
      quote = { price: 1, date: fx.date, source: "fixed", chgPct: 0 }; currency = "USD";
    } else {
      throw new Error(`알 수 없는 market: ${h.market} (${h.ticker})`);
    }
    if (h.market !== "CASH") holdingsChg[h.ticker] = quote.chgPct;
    qtyMap[h.ticker] = (qtyMap[h.ticker] || 0) + h.qty; // 같은 티커가 여러 계좌에 있으면 합산
    const toKrw = currency === "USD" ? fx.price : 1;
    const valueKrw = Math.round(h.qty * quote.price * toKrw);
    // 손익은 증권사 표기 방식과 동일: 매입금액도 현재 환율로 환산 (환차손익 미포함)
    const costKrw = h.market === "CASH" ? valueKrw
                  : h.avgCost != null ? Math.round(h.qty * h.avgCost * toKrw) : null;
    const plKrw = costKrw != null ? valueKrw - costKrw : null;
    const plPct = h.market === "CASH" ? 0
                : h.avgCost != null ? +(100 * (quote.price / h.avgCost - 1)).toFixed(2) : null;
    holdings.push({ ticker: h.ticker, ...(h.name && { name: h.name }), qty: h.qty,
                    price: quote.price, currency, priceDate: quote.date, source: quote.source,
                    valueKrw, costKrw, plKrw, plPct });
  }
  const totalKrw = holdings.reduce((s, x) => s + x.valueKrw, 0);
  const costKrw = holdings.reduce((s, x) => s + (x.costKrw ?? x.valueKrw), 0);
  accounts.push({ name: acc.name, holdings, totalKrw, costKrw,
                  plKrw: totalKrw - costKrw, plPct: +(100 * (totalKrw / costKrw - 1)).toFixed(2) });
}

/* 지수·벤치마크 */
const [nasdaq, sp500, sox, tnx, qqq, qld, soxl] = await Promise.all([
  yahooOnly("^IXIC"), yahooOnly("^GSPC"), yahooOnly("^SOX"),
  yahooOnly("^TNX"), usQuote("QQQ"), usQuote("QLD"), usQuote("SOXL"),
]);
const us10y = tnx.price > 20 ? +(tnx.price / 10).toFixed(2) : +tnx.price.toFixed(2);
const fg = await fearGreed();

const totalKrw = accounts.reduce((s, a) => s + a.totalKrw, 0);
const totalCostKrw = accounts.reduce((s, a) => s + a.costKrw, 0);

/* valuation.json — 계좌 상세 페이지용 */
const valuation = {
  generatedAt: new Date().toISOString(),
  usdkrw: { price: fx.price, date: fx.date, source: fx.source },
  accounts,
  totalKrw, costKrw: totalCostKrw,
  plKrw: totalKrw - totalCostKrw,
  plPct: +(100 * (totalKrw / totalCostKrw - 1)).toFixed(2),
};

/* history.json — 하루 1건, 같은 날짜 재실행 시 교체 (브리핑은 보존) */
const histPath = path.join(ROOT, "data", "history.json");
let history = [];
try { history = JSON.parse(fs.readFileSync(histPath, "utf8")); } catch { /* 첫 실행 */ }
const prevEntry = [...history].reverse().find(e => e.date < today);
const oldToday = history.find(e => e.date === today);

/* 매매 감지: 직전 영업일 엔트리의 수량과 비교 */
const trades = [];
if (prevEntry?.qty) {
  const names = {};
  for (const a of positions.accounts) for (const h of a.holdings) names[h.ticker] = h.name || h.ticker;
  for (const [t, q] of Object.entries(qtyMap)) {
    const pq = prevEntry.qty[t];
    if (pq != null && pq !== q) trades.push({ ticker: t, name: names[t], delta: q - pq });
    if (pq == null) trades.push({ ticker: t, name: names[t], delta: q, new: true });
  }
}

const entry = {
  date: today,
  generatedAt: valuation.generatedAt,
  totalKrw, costKrw: totalCostKrw,
  plKrw: valuation.plKrw, plPct: valuation.plPct,
  usdkrw: { price: +fx.price.toFixed(2), chgPct: fx.chgPct },
  accounts: accounts.map(a => ({ name: a.name, totalKrw: a.totalKrw, plKrw: a.plKrw, plPct: a.plPct })),
  qty: qtyMap,
  trades,
  holdingsChg,
  market: {
    nasdaq: { close: nasdaq.price, chgPct: nasdaq.chgPct },
    sp500: { close: sp500.price, chgPct: sp500.chgPct },
    sox: { close: sox.price, chgPct: sox.chgPct },
    us10y,
    qqq: { close: qqq.price, chgPct: qqq.chgPct },
    qld: { close: qld.price, chgPct: qld.chgPct },
    soxl: { close: soxl.price, chgPct: soxl.chgPct },
    fearGreed: fg,
  },
  briefing: oldToday?.briefing ?? null,
};

history = history.filter(e => e.date !== today);
history.push(entry);
history.sort((a, b) => (a.date < b.date ? -1 : 1));

fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data", "valuation.json"), JSON.stringify(valuation, null, 2) + "\n");
fs.writeFileSync(histPath, JSON.stringify(history) + "\n");
console.log(`[fetch-valuation] ${today} 총 ${totalKrw.toLocaleString()}원, history ${history.length}건`);
console.log(JSON.stringify(entry, null, 2));
