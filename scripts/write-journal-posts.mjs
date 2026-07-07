#!/usr/bin/env node
/* 계좌일지를 날짜별 개별 글(_posts/YYYY-MM-DD-journal.md)로 저장.
   history.json 전체를 훑어 매번 다시 쓴다 — 내용이 같으면 git diff 없음, 과거 결측분도 자동 백필됨.
   fetch-valuation → briefing 뒤에 실행 (브리핑 텍스트까지 포함해야 하므로). */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const START = "2026-07-03";
const SITE_URL = "https://yoonwu.github.io/invest-log/";

const hist = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "history.json"), "utf8"));
if (!hist.length) { console.log("[write-journal-posts] history 비어있음 — 생략"); process.exit(0); }

/* index.html과 동일한 파생값 계산 */
const base = hist[0].totalKrw;
const bq0 = hist[0].market.qqq.close * hist[0].usdkrw.price;
const bl0 = hist[0].market.qld.close * hist[0].usdkrw.price;
let peak = -Infinity, peakDate = hist[0].date;
hist.forEach((e, i) => {
  const prev = hist[i - 1];
  e.dayChg = prev ? e.totalKrw - prev.totalKrw : 0;
  e.dayChgPct = prev ? 100 * (e.totalKrw / prev.totalKrw - 1) : 0;
  e.sinceStart = 100 * (e.totalKrw / base - 1);
  if (e.totalKrw >= peak) { peak = e.totalKrw; peakDate = e.date; }
  e.dd = 100 * (e.totalKrw / peak - 1);
  e.underwater = Math.round((Date.parse(e.date) - Date.parse(peakDate)) / 86400000);
  e.bqqq = 100 * (e.market.qqq.close * e.usdkrw.price / bq0 - 1);
  e.bqld = 100 * (e.market.qld.close * e.usdkrw.price / bl0 - 1);
});

const comma = n => Math.round(n).toLocaleString("ko-KR");
const won = n => comma(n) + "원";
const sign = n => (n > 0 ? "+" : "") + n.toFixed(2) + "%";
const signWon = n => (n > 0 ? "▲ " : n < 0 ? "▼ " : "") + comma(Math.abs(n)) + "원";
const sw = n => (n > 0 ? "+" : n < 0 ? "-" : "") + comma(Math.abs(n)) + "원";
const cls = n => n > 0 ? "up" : n < 0 ? "down" : "flat";
const fgKo = r => ({ "extreme fear": "극단적 공포", fear: "공포", neutral: "중립",
                     greed: "탐욕", "extreme greed": "극단적 탐욕" })[r] || r;
const dow = d => "일월화수목금토"[new Date(d + "T00:00:00Z").getUTCDay()];
const dplus = d => Math.round((Date.parse(d) - Date.parse(START)) / 86400000) + 1;
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const TNAME = { "456600": "TIME AI", "0195S0": "SK하이닉스2배" };

function buildPost(e) {
  const md = e.market;
  const chips = Object.entries(e.holdingsChg).map(([t, v]) =>
    `<span class="chip">${TNAME[t] || t} <b class="${cls(v)}">${sign(v)}</b></span>`).join("");

  const L = [];
  L.push(`📒 계좌일지 ${e.date.replaceAll("-", ".")} (${dow(e.date)}) D+${dplus(e.date)}`);
  L.push("");
  L.push(`[계좌] 총 ${won(e.totalKrw)} (전일 ${signWon(e.dayChg)}, ${sign(e.dayChgPct)})`);
  e.accounts.forEach(a => L.push(` · ${a.name} ${won(a.totalKrw)} (${sign(a.plPct)})`));
  L.push(`시작일 대비 ${sign(e.sinceStart)} · 전고점 대비 ${e.dd.toFixed(2)}%`);
  L.push("");
  L.push(`[시장] 나스닥 ${sign(md.nasdaq.chgPct)} · S&P500 ${sign(md.sp500.chgPct)} · 반도체 ${sign(md.sox.chgPct)} · 미10년물 ${md.us10y}%`);
  const hc = Object.entries(e.holdingsChg).map(([t, v]) => `${t} ${sign(v)}`).join(" · ");
  L.push(`${hc} · 환율 ${comma(e.usdkrw.price)}원(${sign(e.usdkrw.chgPct)})`);
  if (md.fearGreed) L.push(`공포탐욕지수 ${md.fearGreed.score} (${fgKo(md.fearGreed.rating)})`);
  L.push(`같은 돈이면: QQQ ${sign(e.bqqq)} · QLD ${sign(e.bqld)} · 나 ${sign(e.sinceStart)}`);
  if (e.briefing) { L.push(""); L.push(`[브리핑] ${e.briefing.text}`); }
  if (e.trades?.length) {
    L.push(""); L.push("[매매] " + e.trades.map(t =>
      `${t.name || t.ticker} ${t.delta > 0 ? "+" : ""}${t.delta}주`).join(", "));
  }
  L.push("");
  L.push(`원본(조작 불가 커밋 이력 포함): ${SITE_URL}`);

  const html = `<article class="entry">
  <div class="entry-head">
    <div class="entry-date">${e.date.slice(5).replace("-", ".")} (${dow(e.date)})
      <span class="dplus">D+${dplus(e.date)}</span></div>
    <button class="copy-btn" id="copy-journal">복사</button>
  </div>
  <div class="entry-total">
    <span class="tot">${won(e.totalKrw)}</span>
    <span class="pill ${cls(e.dayChg)}">${sw(e.dayChg)} · ${sign(e.dayChgPct)}</span>
  </div>
  <div class="entry-accts">${e.accounts.map(a => `${a.name} ${won(a.totalKrw)}`).join(" · ")}<br>
    시작 대비 <b class="${cls(e.sinceStart)}">${sign(e.sinceStart)}</b> ·
    전고점 대비 <b class="${cls(e.dd)}">${e.dd.toFixed(2)}%</b>${e.underwater > 0 ? ` (언더워터 ${e.underwater}일)` : " (신고점)"}</div>

  <div class="sec-label">어젯밤 미국 시장</div>
  <div class="mgrid">
    <span>나스닥</span><b class="${cls(md.nasdaq.chgPct)}">${sign(md.nasdaq.chgPct)}</b>
    <span>S&amp;P500</span><b class="${cls(md.sp500.chgPct)}">${sign(md.sp500.chgPct)}</b>
    <span>반도체</span><b class="${cls(md.sox.chgPct)}">${sign(md.sox.chgPct)}</b>
    <span>미10년물</span><b>${md.us10y}%</b>
    <span>환율</span><b>${comma(e.usdkrw.price)}원</b>
    ${md.fearGreed ? `<span>공포탐욕</span><b>${md.fearGreed.score} ${fgKo(md.fearGreed.rating)}</b>` : "<span></span><b></b>"}
  </div>

  <div class="sec-label">내 종목</div>
  <div class="chips">${chips}</div>

  <div class="sec-label">같은 돈이면 (시작일 대비)</div>
  <div class="chips">
    <span class="chip">나 <b class="${cls(e.sinceStart)}">${sign(e.sinceStart)}</b></span>
    <span class="chip">QQQ <b class="${cls(e.bqqq)}">${sign(e.bqqq)}</b></span>
    <span class="chip">QLD <b class="${cls(e.bqld)}">${sign(e.bqld)}</b></span>
  </div>

  ${e.briefing ? `<div class="sec-label">브리핑</div><p class="brief-p">${e.briefing.text}</p>` : ""}
  ${e.trades?.length ? `<div class="sec-label">매매</div><div class="trade-box">${e.trades.map(t =>
    `${t.name || t.ticker} ${t.delta > 0 ? "+" : ""}${t.delta}주`).join(", ")}</div>` : ""}
</article>
<textarea id="copy-src" style="position:absolute;left:-9999px" readonly>${esc(L.join("\n"))}</textarea>
<script>
document.getElementById("copy-journal").onclick = async () => {
  const btn = document.getElementById("copy-journal");
  try {
    await navigator.clipboard.writeText(document.getElementById("copy-src").value);
    btn.textContent = "복사됨 ✓"; setTimeout(() => btn.textContent = "복사", 1500);
  } catch { btn.textContent = "실패"; }
};
</script>`;

  const title = `계좌일지 ${e.date.replaceAll("-", ".")} (${dow(e.date)}) D+${dplus(e.date)}`;
  const front = `---\nlayout: journal\ncategory: 일지\ntitle: "${title}"\n---\n`;
  return front + html + "\n";
}

const postsDir = path.join(ROOT, "_posts");
fs.mkdirSync(postsDir, { recursive: true });
for (const e of hist) {
  fs.writeFileSync(path.join(postsDir, `${e.date}-journal.md`), buildPost(e));
}
console.log(`[write-journal-posts] ${hist.length}개 일지 글 저장`);
