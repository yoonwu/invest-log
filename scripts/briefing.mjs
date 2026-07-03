#!/usr/bin/env node
/* 새벽 미국시장 브리핑 (3~5문장) — Claude Sonnet 이 그날 시장 데이터 + 뉴스
   헤드라인만 보고 작성해 history.json 오늘 엔트리에 저장한다.
   API 키가 없거나 호출이 실패하면 브리핑 없이 조용히 종료 (숫자 파이프라인과 분리). */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const histPath = path.join(ROOT, "data", "history.json");

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("[briefing] ANTHROPIC_API_KEY 없음 — 브리핑 생략");
  process.exit(0);
}

const history = JSON.parse(fs.readFileSync(histPath, "utf8"));
const entry = history[history.length - 1];

/* 뉴스 헤드라인 수집 (RSS, 실패해도 진행) */
const FEEDS = [
  "https://www.cnbc.com/id/20910258/device/rss/rss.html", // CNBC US Markets
  "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",        // WSJ Markets
];
async function headlines() {
  const out = [];
  for (const u of FEEDS) {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!r.ok) continue;
      const t = await r.text();
      for (const m of t.matchAll(/<title>(?:<!\[CDATA\[)?([^<\]]+)/g)) {
        const s = m[1].trim();
        if (s && !/rss|feed/i.test(s)) out.push(s);
        if (out.length >= 16) break;
      }
    } catch { /* 무시 */ }
    if (out.length >= 16) break;
  }
  return out.slice(1, 16); // 첫 항목은 보통 채널명
}

const payload = {
  date: entry.date,
  market: entry.market,
  usdkrw: entry.usdkrw,
  myHoldingsDayChangePct: entry.holdingsChg,
  headlines: await headlines(),
};

try {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 800,
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
    system:
      "너는 개인 투자 일기 블로그의 시장 브리핑 작성자다. 전달받은 데이터(지수 등락, 금리, 환율, " +
      "공포탐욕지수, 보유종목 등락)와 뉴스 헤드라인 안에서만 사실을 서술한다. 데이터에 없는 수치나 " +
      "사건을 추측하거나 지어내지 않는다. 한국어로 3~5문장, 담백한 평서문. 투자 조언·전망·과장 금지. " +
      "이모지·머리기호·제목 없이 문단 하나로만 답한다.",
    messages: [{
      role: "user",
      content: "어젯밤 미국 시장에 무슨 일이 있었는지 브리핑을 작성해줘.\n\n" + JSON.stringify(payload),
    }],
  });
  if (msg.stop_reason === "refusal") throw new Error("refusal");
  const text = msg.content.find(b => b.type === "text")?.text?.trim();
  if (!text) throw new Error("빈 응답");
  entry.briefing = { text, model: msg.model, at: new Date().toISOString() };
  fs.writeFileSync(histPath, JSON.stringify(history) + "\n");
  console.log("[briefing] 저장 완료:", text.slice(0, 80) + "…");
} catch (e) {
  console.error("[briefing] 실패 (숫자 파이프라인엔 영향 없음):", e.message);
  process.exit(0);
}
