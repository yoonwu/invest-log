#!/usr/bin/env node
/* 매월 1일(KST) 직전 달의 결산 초안을 drafts/YYYY-MM.md 로 생성.
   숫자 정리만 자동 — 글은 이 초안을 바탕으로 직접 쓴다. --force 로 강제 실행. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kst = new Date(Date.now() + 9 * 3600 * 1000);
const force = process.argv.includes("--force");
if (kst.getUTCDate() !== 1 && !force) {
  console.log("[monthly] 1일 아님 — 생략");
  process.exit(0);
}

const prev = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - 1, 1));
const ym = prev.toISOString().slice(0, 7); // 직전 달 YYYY-MM
const history = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "history.json"), "utf8"));
const month = history.filter(e => e.date.startsWith(ym));
if (!month.length) { console.log(`[monthly] ${ym} 데이터 없음`); process.exit(0); }

const first = month[0], last = month[month.length - 1];
const won = n => Math.round(n).toLocaleString("ko-KR") + "원";
const pct = n => (n > 0 ? "+" : "") + n.toFixed(2) + "%";
const chg = last.totalKrw - first.totalKrw;
const chgPct = 100 * (last.totalKrw / first.totalKrw - 1);
let peak = -Infinity, mdd = 0;
for (const e of month) { peak = Math.max(peak, e.totalKrw); mdd = Math.min(mdd, 100 * (e.totalKrw / peak - 1)); }
const lows = [...month].sort((a, b) => a.totalKrw - b.totalKrw);
const trades = month.flatMap(e => (e.trades || []).map(t =>
  `- ${e.date}: ${t.name || t.ticker} ${t.delta > 0 ? "+" : ""}${t.delta}주`));

const md = `## ${ym} 결산 초안 (자동 생성 — 이 표를 바탕으로 글을 쓰세요)

> _posts/ 에 글로 옮길 때 프런트매터에 \`category: 월결산\`을 넣으면 홈의 월결산 섹션에 모입니다.

| 항목 | 값 |
|---|---|
| 기간 | ${first.date} ~ ${last.date} (${month.length}일 기록) |
| 월초 총자산 | ${won(first.totalKrw)} |
| 월말 총자산 | ${won(last.totalKrw)} |
| 월간 증감 | ${won(chg)} (${pct(chgPct)}) |
| 월중 최저 / 최고 | ${won(lows[0].totalKrw)} (${lows[0].date}) / ${won(peak)} |
| 월중 MDD | ${pct(mdd)} |
| 월말 누적 손익 | ${won(last.plKrw)} (${pct(last.plPct)}) |

### 계좌별 (월말 기준)
${last.accounts.map(a => `- ${a.name}: ${won(a.totalKrw)} (누적 ${pct(a.plPct)})`).join("\n")}

### 매매 내역
${trades.length ? trades.join("\n") : "- 없음"}
`;

fs.mkdirSync(path.join(ROOT, "drafts"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "drafts", `${ym}.md`), md);
console.log(`[monthly] drafts/${ym}.md 생성`);
