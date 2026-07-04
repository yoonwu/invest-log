#!/usr/bin/env node
/* 오늘 일지를 네이버/티스토리에 그대로 붙여넣는 카드 이미지(data/card.png)로 렌더링.
   fetch-valuation → briefing 뒤에 실행. 실패해도 숫자 파이프라인엔 영향 없게 workflow에서 continue-on-error. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const START = "2026-07-03";
const SITE_URL = "https://yoonwu.github.io/invest-log/";

const hist = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "history.json"), "utf8"));
if (!hist.length) { console.log("[card] history 비어있음 — 생략"); process.exit(0); }
let val = null;
try { val = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "valuation.json"), "utf8")); } catch {}

/* index.html과 동일한 파생값 계산 */
const base = hist[0].totalKrw;
const bq0 = hist[0].market.qqq.close * hist[0].usdkrw.price;
const bl0 = hist[0].market.qld.close * hist[0].usdkrw.price;
let peak = -Infinity;
hist.forEach((e, i) => {
  const prev = hist[i - 1];
  e.dayChg = prev ? e.totalKrw - prev.totalKrw : 0;
  e.dayChgPct = prev ? 100 * (e.totalKrw / prev.totalKrw - 1) : 0;
  e.sinceStart = 100 * (e.totalKrw / base - 1);
  peak = Math.max(peak, e.totalKrw);
  e.dd = 100 * (e.totalKrw / peak - 1);
  e.bqqq = 100 * (e.market.qqq.close * e.usdkrw.price / bq0 - 1);
  e.bqld = 100 * (e.market.qld.close * e.usdkrw.price / bl0 - 1);
});
const e = hist[hist.length - 1];

const comma = n => Math.round(n).toLocaleString("ko-KR");
const won = n => comma(n) + "원";
const eok = n => n >= 1e8 ? (n / 1e8).toFixed(2) + "억" : comma(n / 1e4) + "만";
const sign = n => (n > 0 ? "+" : "") + n.toFixed(2) + "%";
const sw = n => (n > 0 ? "+" : n < 0 ? "-" : "") + comma(Math.abs(n)) + "원";
const cls = n => n > 0 ? "up" : n < 0 ? "down" : "flat";
const dow = d => "일월화수목금토"[new Date(d + "T00:00:00").getDay()];
const dplus = d => Math.round((Date.parse(d) - Date.parse(START)) / 86400000) + 1;
const fgKo = r => ({ "extreme fear": "극단적 공포", fear: "공포", neutral: "중립",
                     greed: "탐욕", "extreme greed": "극단적 탐욕" })[r] || r;

/* 차트 SVG (이틀 이상일 때) — index.html과 같은 지수화 3라인 */
function chartSvg() {
  if (hist.length < 2) return "";
  const S = [
    { label: "나", color: "#4b5563", vals: hist.map(x => x.sinceStart) },
    { label: "QQQ", color: "#2b5fd9", vals: hist.map(x => x.bqqq) },
    { label: "QLD", color: "#16a34a", vals: hist.map(x => x.bqld) },
  ];
  const W = 632, H = 190, P = { t: 10, r: 46, b: 22, l: 8 };
  const all = S.flatMap(s => s.vals);
  let lo = Math.min(...all, 0), hi = Math.max(...all, 0);
  const pad = Math.max((hi - lo) * 0.1, 0.5); lo -= pad; hi += pad;
  const x = i => P.l + (W - P.l - P.r) * (hist.length === 1 ? 0.5 : i / (hist.length - 1));
  const y = v => P.t + (H - P.t - P.b) * (1 - (v - lo) / (hi - lo));
  const ticks = [lo + (hi - lo) * 0.15, (lo + hi) / 2, lo + (hi - lo) * 0.85].map(v => Math.round(v * 10) / 10);
  let svg = `<svg width="${W}" height="${H}" style="display:block">`;
  for (const t of ticks) svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="#e7e8e3"/>` +
    `<text x="${P.l + 2}" y="${y(t) - 3}" font-size="10" fill="#6b7280">${t > 0 ? "+" : ""}${t}%</text>`;
  svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(0)}" y2="${y(0)}" stroke="#c8cac3" stroke-dasharray="3 3"/>`;
  for (const s of S) {
    const pts = s.vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    svg += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>` +
      `<circle cx="${x(hist.length - 1)}" cy="${y(s.vals[s.vals.length - 1])}" r="3" fill="${s.color}"/>`;
  }
  const ends = S.map(s => ({ label: s.label, color: s.color, y: y(s.vals[s.vals.length - 1]) }))
                .sort((a, b) => a.y - b.y);
  for (let i = 0; i < ends.length; i++) {
    ends[i].y = Math.min(Math.max(ends[i].y, 16), H - P.b - 4 - (ends.length - 1 - i) * 12);
    if (i > 0 && ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
  }
  for (const en of ends)
    svg += `<text x="${W - P.r + 4}" y="${en.y + 3}" font-size="10" font-weight="600" fill="${en.color}">${en.label}</text>`;
  const d0 = hist[0].date.slice(5).replace("-", "."), d1 = e.date.slice(5).replace("-", ".");
  svg += `<text x="${P.l}" y="${H - 5}" font-size="10" fill="#6b7280">${d0}</text>` +
    `<text x="${W - P.r}" y="${H - 5}" font-size="10" fill="#6b7280" text-anchor="end">${d1}</text></svg>`;
  return `<div class="sec">자산 추이 — 같은 돈을 QQQ·QLD에 넣었다면</div>${svg}`;
}

const md = e.market;
const chips = Object.entries(e.holdingsChg).map(([t, v]) => {
  const name = { "456600": "TIME글로벌AI", "0195S0": "SK하이닉스2배" }[t] || t;
  return `<span class="chip">${name} <b class="${cls(v)}">${sign(v)}</b></span>`;
}).join("");

/* 계좌별 잔고 상세 — valuation.json의 종목별 수량·매입·평가·손익까지 (홈 화면과 동일 정보) */
const hname = h => h.name || (h.ticker === "USD_CASH" ? "미국달러" : h.ticker);
const accountsHtml = val
  ? val.accounts.map(a => `
    <div class="acct">
      <div class="ahead">
        <span class="an">${a.name}</span>
        <span class="pill sm mono ${cls(a.plKrw)}">${a.plKrw > 0 ? "+" : ""}${comma(a.plKrw)}원 · ${sign(a.plPct)}</span>
      </div>
      <div class="atot mono">${won(a.totalKrw)}</div>
      <div class="acost">매입 ${won(a.costKrw)}</div>
      ${a.holdings.map(h => `
      <div class="hrow">
        <div><div class="hn">${hname(h)}</div>
          <div class="hs">${comma(h.qty)}${h.ticker === "USD_CASH" ? "달러" : "주"} · 매입 ${eok(h.costKrw)}</div></div>
        <div class="hr"><div class="hv mono">${won(h.valueKrw)}</div>
          <div class="hs mono ${cls(h.plKrw)}">${h.plKrw > 0 ? "+" : ""}${comma(h.plKrw)}원 (${sign(h.plPct)})</div></div>
      </div>`).join("")}
    </div>`).join("")
  : e.accounts.map(a => `<div class="arow"><span class="n">${a.name}</span>
      <b class="mono">${won(a.totalKrw)} <span class="${cls(a.plPct)}">(${sign(a.plPct)})</span></b></div>`).join("");

const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { background: #f4f5f3; font-family: "Noto Sans CJK KR", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif;
         color: #16181c; -webkit-font-smoothing: antialiased; }
  .card { width: 700px; background: #fff; border: 1px solid #e7e8e3; border-radius: 10px;
          padding: 26px 30px 22px; margin: 20px; position: relative; overflow: hidden; }
  .card::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: #4b5563; }
  .mono { font-family: "SF Mono", "Roboto Mono", ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums; }
  .head { display: flex; justify-content: space-between; align-items: baseline; }
  .head .t { font-size: 16px; font-weight: 800; }
  .head .d { font-size: 12.5px; color: #98a1ad; }
  .total { font-size: 34px; font-weight: 800; letter-spacing: -0.5px; margin-top: 12px; }
  .pill { display: inline-block; font-size: 13px; font-weight: 700; border-radius: 999px; padding: 5px 12px; margin-top: 10px; }
  .pill.up { background: rgba(214,48,63,.10); color: #d6303f; }
  .pill.down { background: rgba(43,95,217,.10); color: #2b5fd9; }
  .pill.flat { background: #fafaf8; color: #6b7280; }
  .pill.sm { font-size: 12px; padding: 4px 10px; margin-top: 0; }
  .acct { border: 1px solid #e7e8e3; border-radius: 10px; padding: 14px 16px 4px; margin-bottom: 10px; }
  .ahead { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .ahead .an { font-size: 13px; font-weight: 700; color: #6b7280; }
  .atot { font-size: 19px; font-weight: 800; margin-top: 6px; letter-spacing: -0.3px; }
  .acost { font-size: 12px; color: #98a1ad; margin: 3px 0 11px; }
  .hrow { display: flex; justify-content: space-between; align-items: center; gap: 10px;
          padding: 10px 0; border-top: 1px solid #e7e8e3; }
  .hrow .hn { font-size: 14px; font-weight: 600; }
  .hrow .hs { font-size: 11.5px; color: #98a1ad; margin-top: 2px; }
  .hrow .hr { text-align: right; flex: none; }
  .hrow .hv { font-size: 14px; font-weight: 650; }
  .hrow .hs.up { color: #d6303f; } .hrow .hs.down { color: #2b5fd9; }
  .sub { font-size: 12.5px; color: #98a1ad; margin-top: 10px; }
  .up { color: #d6303f; } .down { color: #2b5fd9; } .flat { color: #6b7280; }
  .sec { font-size: 11.5px; color: #98a1ad; font-weight: 700; letter-spacing: .04em; margin: 20px 0 8px;
         padding-top: 14px; border-top: 1px solid #e7e8e3; }
  .arow { display: flex; justify-content: space-between; font-size: 14.5px; padding: 5px 0; }
  .arow .n { color: #6b7280; }
  .arow b { font-weight: 700; }
  .mgrid { display: grid; grid-template-columns: auto 1fr auto 1fr; column-gap: 18px; row-gap: 7px;
           font-size: 13px; align-items: baseline; }
  .mgrid span { color: #6b7280; font-size: 12px; }
  .mgrid b { text-align: right; font-weight: 650; white-space: nowrap; }
  .chips { display: flex; flex-wrap: wrap; gap: 7px; }
  .chip { background: #fafaf8; border: 1px solid #e7e8e3; border-radius: 8px; padding: 5px 10px;
          font-size: 12.5px; color: #6b7280; white-space: nowrap; }
  .chip b { font-weight: 700; }
  .trade { background: rgba(75,85,99,.07); border: 1px solid rgba(75,85,99,.25); border-radius: 8px;
           padding: 10px 12px; font-size: 13.5px; font-weight: 700; color: #4b5563; }
  .brief { font-size: 13.5px; line-height: 1.75; color: #16181c; }
  .foot { margin-top: 20px; padding-top: 12px; border-top: 1px solid #e7e8e3;
          font-size: 11.5px; color: #98a1ad; display: flex; justify-content: space-between; }
</style></head><body>
<div class="card" id="card">
  <div class="head">
    <span class="t">계좌일지 ${e.date.replaceAll("-", ".")} (${dow(e.date)})</span>
    <span class="d">D+${dplus(e.date)} · ${hist.length}일째 기록</span>
  </div>
  <div class="total mono">${won(e.totalKrw)}</div>
  <div><span class="pill mono ${cls(e.dayChg)}">전일 ${sw(e.dayChg)} · ${sign(e.dayChgPct)}</span></div>
  <div class="sub">시작(${START.replaceAll("-", ".")}) 대비 ${sign(e.sinceStart)} · 누적 손익 ${sign(e.plPct)} · 전고점 대비 ${e.dd.toFixed(2)}%</div>

  <div class="sec">계좌별 잔고</div>
  ${accountsHtml}

  ${chartSvg()}

  <div class="sec">어제밤 미국 시장</div>
  <div class="mgrid">
    <span>나스닥</span><b class="mono ${cls(md.nasdaq.chgPct)}">${sign(md.nasdaq.chgPct)}</b>
    <span>S&amp;P500</span><b class="mono ${cls(md.sp500.chgPct)}">${sign(md.sp500.chgPct)}</b>
    <span>반도체</span><b class="mono ${cls(md.sox.chgPct)}">${sign(md.sox.chgPct)}</b>
    <span>미10년물</span><b class="mono">${md.us10y}%</b>
    <span>환율</span><b class="mono">${comma(e.usdkrw.price)}원 (${sign(e.usdkrw.chgPct)})</b>
    ${md.fearGreed ? `<span>공포탐욕</span><b class="mono">${md.fearGreed.score} · ${fgKo(md.fearGreed.rating)}</b>` : ""}
  </div>

  <div class="sec">내 종목 (전일)</div>
  <div class="chips">${chips}</div>

  ${e.trades?.length ? `<div class="sec">매매</div><div class="trade">${e.trades.map(t =>
    `${t.name || t.ticker} ${t.delta > 0 ? "+" : ""}${t.delta}주`).join(", ")}</div>` : ""}
  ${e.briefing ? `<div class="sec">브리핑</div><p class="brief">${e.briefing.text}</p>` : ""}

  <div class="foot"><span>매일 아침 7시 자동 기록 · 숫자는 기계가 쓴다</span><span>${SITE_URL.replace("https://", "")}</span></div>
</div>
</body></html>`;

let chromium;
try { ({ chromium } = await import("playwright")); }
catch { ({ chromium } = await import("playwright-core")); }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 760, height: 1400 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "load" });
await page.locator("#card").screenshot({ path: path.join(ROOT, "data", "card.png") });
await browser.close();
console.log("[card] data/card.png 생성");
