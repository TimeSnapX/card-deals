// Live smoke test against the REAL public APIs (no mocks).
//   node tests/live-smoke.mjs [url]   (default: local server)
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { start } from "./server.mjs";
const req = createRequire(process.env.PLAYWRIGHT_DIR ? process.env.PLAYWRIGHT_DIR + "/package.json" : "/workspace/tools/package.json");
const { chromium } = req("playwright-core");
let srv = null;
let URL_ = process.argv[2];
if (!URL_) { srv = await start(4743); URL_ = "http://127.0.0.1:4743/card-deals/"; }
const shots = process.env.SHOTS || "test-results";
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
const out = {};
const ok = [];
async function step(name, fn) {
  try { await fn(); ok.push(name); console.log("ok -", name); } catch (e) { console.log("FAIL -", name, e.message.split("\n")[0]); process.exitCode = 1; }
}
await page.goto(URL_ + (URL_.includes("?") ? "&" : "?") + "smoke=" + Date.now());
await step("live FX", async () => {
  await page.waitForFunction(() => /1 USD = A\$\d/.test(document.querySelector("#fx-line").textContent), null, { timeout: 20000 });
  out.fx = await page.locator("#fx-line").innerText();
});
await page.screenshot({ path: `${shots}/1-check-empty.png` });
await step("Pokémon: Charizard 4/102 (TCGdex) has sold-based prices", async () => {
  await page.fill("#q-name", "Charizard");
  await page.fill("#q-number", "4/102");
  await page.click("#search-btn");
  await page.waitForSelector("#results .result", { timeout: 20000 });
  await page.locator("#results .result", { hasText: "Base Set · #4" }).first().click();
  await page.waitForSelector("#prices tbody tr", { timeout: 20000 });
  out.pokemon = await page.locator("#prices tbody tr").allInnerTexts();
  assert.ok(out.pokemon.some((r) => /TCGplayer market price/.test(r) && /A\$[\d,]+\.\d\d/.test(r)));
  await page.fill("#ask", "900");
  await page.fill("#ship", "15");
  await page.click("#check-btn");
  await page.waitForSelector("#verdict-check .verdict");
  out.pokemonVerdict = (await page.locator("#verdict-check .verdict").innerText()).split("\n").slice(0, 4).join(" | ");
  await page.locator("#card-panel").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/2-check-pokemon.png`, fullPage: true });
});
await step("Magic: Lightning Bolt (Scryfall)", async () => {
  await page.click('#game-seg [data-game="mtg"]');
  await page.fill("#q-name", "lightning bolt");
  await page.fill("#q-number", "");
  await page.click("#search-btn");
  await page.waitForSelector("#results .result", { timeout: 20000 });
  await page.locator("#results .result").first().click();
  await page.waitForSelector("#prices tbody tr", { timeout: 20000 });
  out.mtg = (await page.locator("#prices tbody tr").allInnerTexts()).slice(0, 3);
});
await step("Yu-Gi-Oh!: Dark Magician LOB-005 (YGOPRODeck)", async () => {
  await page.click('#game-seg [data-game="ygo"]');
  await page.fill("#q-name", "Dark Magician");
  await page.fill("#q-number", "LOB-005");
  await page.click("#search-btn");
  await page.waitForSelector("#prices tbody tr", { timeout: 20000 });
  out.ygo = (await page.locator("#prices tbody tr").allInnerTexts()).slice(0, 3);
});
await step("Sports listing -> comps", async () => {
  await page.fill("#paste", "2019 Select NRL Nathan Cleary Rookie PSA 10");
  await page.click("#read-listing");
  await page.screenshot({ path: `${shots}/3-check-sports.png`, fullPage: true });
  await page.click("#sports-to-comps");
  await page.fill("#c-prices", "120, 135, 110, 150, 128, 140");
  await page.fill("#c-ask", "95");
  await page.click("#comps-btn");
  out.comps = (await page.locator("#verdict-comps .verdict").innerText()).split("\n").slice(0, 3).join(" | ");
  await page.screenshot({ path: `${shots}/4-comps.png`, fullPage: true });
});
await step("Grading + watchlist + tips screens", async () => {
  await page.click('.tab[data-view="grading"]');
  await page.fill("#g-cost", "60"); await page.fill("#g-10", "450"); await page.fill("#g-9", "160"); await page.fill("#g-low", "70");
  await page.click("#grade-btn");
  out.grading = (await page.locator("#grade-out").innerText()).split("\n").slice(0, 2).join(" | ");
  await page.screenshot({ path: `${shots}/5-grading.png`, fullPage: true });
  await page.click('.tab[data-view="watch"]');
  await page.screenshot({ path: `${shots}/6-watchlist.png`, fullPage: true });
  await page.click('.tab[data-view="tips"]');
  await page.screenshot({ path: `${shots}/7-tips.png` });
});
console.log(JSON.stringify(out, null, 1));
if (errors.length) { console.log("console errors:\n " + errors.join("\n ")); process.exitCode = 1; }
console.log(`${ok.length} live steps ok, ${errors.length} console errors`);
await browser.close();
if (srv) srv.close();
