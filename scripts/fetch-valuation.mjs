#!/usr/bin/env node
/* ============================================================================
   invest-log 평가액 계산 스크립트
   ----------------------------------------------------------------------------
   positions.json 을 읽어 종목별 시세·환율을 조회하고 계좌별/전체 평가액(원화)을
   data/valuation.json 에 기록한다. (매입원가/손익률은 범위 아님 — 평가금액만)

   시세 소스 (s-backtesting 의 yogibag-data-proxy.worker.js 로직 재사용):
   - 미국 티커      : Yahoo chart API(1순위) → stooq CSV(폴백)
   - 환율 USD/KRW   : 동일 Yahoo 로직, 심볼 KRW=X (stooq 폴백: usdkrw)
   - 국내 티커(KRX) : 네이버 siseJson.naver 일봉
   - USD_CASH       : qty = 달러 금액, 환율만 곱함
   일 1회 스냅샷 전제 — 각 소스의 최근 일봉 종가를 쓴다 (장중 실시간 아님).
   ========================================================================== */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };

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
  // 응답이 작은따옴표 JS 배열 형태 → JSON 정규화, 실패 시 행 단위 정규식 폴백
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

/* ---- 소스 순서대로 시도해 최근 종가 반환 (워커의 소스 폴백 방식) ---- */
async function latestClose(fetchers, label) {
  const errors = [];
  for (const [source, fn] of fetchers) {
    try {
      const rows = await fn();
      const last = rows[rows.length - 1];
      return { price: last.close, date: last.date, source };
    } catch (e) { errors.push(`${source}: ${e.message}`); }
  }
  throw new Error(`${label} 시세 조회 실패 — ${errors.join(" / ")}`);
}

/* ---- 메인 ---- */
const positions = JSON.parse(fs.readFileSync(path.join(ROOT, "positions.json"), "utf8"));
const to = new Date().toISOString().slice(0, 10);
const from = new Date(Date.now() - 14 * 86400 * 1000).toISOString().slice(0, 10);

const fx = await latestClose([
  ["yahoo", () => fromYahoo("KRW=X", from, to)],
  ["stooq", () => fromStooq("usdkrw", from, to)],
], "USD/KRW");

const accounts = [];
for (const acc of positions.accounts) {
  const holdings = [];
  for (const h of acc.holdings) {
    let quote, currency;
    if (h.market === "US") {
      quote = await latestClose([
        ["yahoo", () => fromYahoo(h.ticker, from, to)],
        ["stooq", () => fromStooq(h.ticker.toLowerCase() + ".us", from, to)],
      ], h.ticker);
      currency = "USD";
    } else if (h.market === "KRX") {
      quote = await latestClose([["naver", () => fromNaver(h.ticker, from, to)]], h.ticker);
      currency = "KRW";
    } else if (h.market === "CASH") {
      quote = { price: 1, date: fx.date, source: "fixed" };
      currency = "USD";
    } else {
      throw new Error(`알 수 없는 market: ${h.market} (${h.ticker})`);
    }
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

const totalKrw = accounts.reduce((s, a) => s + a.totalKrw, 0);
const totalCostKrw = accounts.reduce((s, a) => s + a.costKrw, 0);
const result = {
  generatedAt: new Date().toISOString(),
  usdkrw: { price: fx.price, date: fx.date, source: fx.source },
  accounts,
  totalKrw,
  costKrw: totalCostKrw,
  plKrw: totalKrw - totalCostKrw,
  plPct: +(100 * (totalKrw / totalCostKrw - 1)).toFixed(2),
};

fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data", "valuation.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
