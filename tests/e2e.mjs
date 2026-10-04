// Headless Chrome on a Pixel-sized viewport with every external API mocked.
// Run: node tests/e2e.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
import { start } from "./server.mjs";
const req = createRequire(process.env.PLAYWRIGHT_DIR ? process.env.PLAYWRIGHT_DIR + "/package.json" : "/workspace/tools/package.json");
const { chromium } = req("playwright-core");

const PORT = 4742;
const BASE = `http://127.0.0.1:${PORT}/card-deals/`;
const srv = await start(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

// ---- mock data. FX: 1 USD = A$2, 1 EUR = A$2.5
const mock = {
  fail: new Set(), // "tcgdex" | "scryfall" | "fx" | "tcgdexCard"
  calls: [],
};
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
const GQL_CARDS = [
  { id: "base4-4", name: "Charizard", localId: "4", rarity: "Rare", image: "https://assets.tcgdex.net/en/base/base4/4", set: { id: "base4", name: "Base Set 2", releaseDate: null } },
  { id: "base1-4", name: "Charizard", localId: "4", rarity: "Rare", image: "https://assets.tcgdex.net/en/base/base1/4", set: { id: "base1", name: "Base Set", releaseDate: "1999-01-09" } },
  { id: "sm9-14", name: "Charizard", localId: "14", rarity: "Rare", image: null, set: { id: "sm9", name: "Team Up", releaseDate: null } },
];
async function routes(ctx) {
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await ctx.route(/assets\.tcgdex\.net|cards\.scryfall\.io/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await ctx.route("https://api.tcgdex.net/v2/graphql", async (r) => {
    mock.calls.push("gql");
    if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST" } });
    if (mock.fail.has("tcgdex")) return json(r, { error: "boom" }, 500);
    const body = r.request().postDataJSON();
    const name = (body.query.match(/name: "([^"]*)"/) || [])[1] || "";
    const cards = name.toLowerCase() === "charizard" ? GQL_CARDS : [];
    return json(r, { data: { cards } });
  });
  await ctx.route(/api\.tcgdex\.net\/v2\/en\/cards\//, (r) => {
    const id = decodeURIComponent(r.request().url().split("/").pop());
    mock.calls.push("tcgdex:" + id);
    if (mock.fail.has("tcgdexCard")) return json(r, {}, 500);
    if (id === "base1-4") return json(r, { id, name: "Charizard", set: { name: "Base Set" }, pricing: {
      tcgplayer: { unit: "USD", holofoil: { productId: 42382, lowPrice: 80, midPrice: 120, marketPrice: 100 } },
      cardmarket: { unit: "EUR", idProduct: 273699, avg30: 60, avg7: 64, trend: 70, low: 30 } } });
    return json(r, { id, name: "Charizard", pricing: null });
  });
  await ctx.route(/api\.pokemontcg\.io/, (r) => { mock.calls.push("ptcg"); return json(r, { data: { id: "x", name: "Charizard" } }); });
  await ctx.route(/api\.scryfall\.com/, (r) => {
    mock.calls.push("scryfall");
    if (mock.fail.has("scryfall")) return r.abort("failed");
    return json(r, { object: "list", data: [{ id: "sf1", name: "Lightning Bolt", set_name: "Magic 2010", collector_number: "146", rarity: "common", released_at: "2009-07-17", image_uris: { small: "https://cards.scryfall.io/x.jpg" }, prices: { usd: "1.00", usd_foil: null, eur: null }, purchase_uris: { tcgplayer: "https://www.tcgplayer.com/product/1" } }] });
  });
  await ctx.route(/db\.ygoprodeck\.com/, (r) => {
    mock.calls.push("ygo");
    return json(r, { data: [{ id: 1, name: "Mystery Card", card_sets: [], card_prices: [{ tcgplayer_price: "0.00", cardmarket_price: "0.00", ebay_price: "0.00" }] }] });
  });
  await ctx.route(/frankfurter|open\.er-api\.com/, (r) => {
    mock.calls.push("fx");
    if (mock.fail.has("fx")) return r.abort("failed");
    return json(r, r.request().url().includes("frankfurter") ? { amount: 1, base: "AUD", date: "2026-10-02", rates: { USD: 0.5, EUR: 0.4, GBP: 0.4 } } : { result: "success", rates: { USD: 0.5, EUR: 0.4, GBP: 0.4 } });
  });
}

let errors = [];
const allowed = []; // regexes of console errors we expect in a given step
async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (allowed.some((re) => re.test(t))) return;
    errors.push("console: " + t);
  });
  return page;
}
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(["ok", name]);
    console.log("ok -", name);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
    console.log("FAIL -", name, "\n   ", e.message.split("\n").slice(0, 6).join("\n    "));
  }
  allowed.length = 0; // expected errors only count as expected inside their own step
}
const phone = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", acceptDownloads: true };

const ctx = await browser.newContext(phone);
await routes(ctx);
let page = await newPage(ctx);
await page.goto(BASE);
await page.waitForFunction(() => document.querySelector("#fx-line").textContent.includes("A$2.0000"));
const text = (sel) => page.locator(sel).first().innerText();

await step("loads, FX line shows mocked rate, no horizontal overflow", async () => {
  assert.match(await text("#fx-line"), /1 USD = A\$2\.0000, 1 EUR = A\$2\.5000/);
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(w[0] <= w[1], `scrollWidth ${w[0]} > ${w[1]}`);
});

await step("Pokémon search -> select -> prices in AUD", async () => {
  await page.fill("#q-name", "Charizard");
  await page.fill("#q-number", "4/102");
  await page.click("#search-btn");
  await page.waitForSelector("#results .result");
  assert.equal(await page.locator("#results .result").count(), 2); // localId 4 filter drops sm9-14
  await page.locator("#results .result", { hasText: "Base Set ·" }).first().click();
  await page.waitForSelector("#prices tbody tr");
  const rows = await page.locator("#prices tbody tr").allInnerTexts();
  assert.ok(rows[0].includes("TCGplayer market price") && rows[0].includes("A$200.00"), rows[0]);
  assert.ok(rows.some((r) => r.includes("Cardmarket 30-day average sale") && r.includes("A$150.00")));
  assert.equal(await page.locator("#prices tr.on").count(), 1);
});

await step("verdict maths: 140 + 10 vs A$200 -> Good deal, 25%, score 65", async () => {
  await page.fill("#ask", "140");
  await page.fill("#ship", "10");
  await page.click("#check-btn");
  await page.waitForSelector("#verdict-check .verdict");
  assert.equal(await text("#verdict-check .v-band"), "Good deal");
  assert.match(await text("#verdict-check .v-pct"), /25\.0% under/);
  assert.equal(await text("#verdict-check .v-score"), "65");
  assert.equal(await text("#verdict-check .v-cost"), "A$150.00");
  assert.equal(await text("#verdict-check .v-ref"), "A$200.00");
});

await step("condition LP: ref A$170 -> Slightly under, score 53", async () => {
  await page.selectOption("#cond", "lp");
  await page.click("#check-btn");
  assert.equal(await text("#verdict-check .v-band"), "Slightly under market");
  assert.equal(await text("#verdict-check .v-score"), "53");
  assert.equal(await text("#verdict-check .v-ref"), "A$170.00");
});

await step("tap Cardmarket row as reference -> About market, score 43", async () => {
  await page.selectOption("#cond", "nm");
  await page.locator("#prices tbody tr", { hasText: "30-day average" }).first().click();
  await page.waitForFunction(() => document.querySelector("#verdict-check .v-ref")?.textContent === "A$150.00");
  assert.equal(await text("#verdict-check .v-band"), "About market price");
  assert.equal(await text("#verdict-check .v-score"), "43");
});

await step("graded condition with API price -> Not enough data", async () => {
  await page.selectOption("#cond", "graded");
  await page.click("#check-btn");
  assert.equal(await text("#verdict-check h3"), "Not enough data");
  assert.match(await text("#verdict-check"), /raw \(ungraded\)/);
  await page.selectOption("#cond", "nm");
});

await step("card with no prices -> Not enough data state", async () => {
  await page.locator("#results .result", { hasText: "Base Set 2" }).click();
  await page.waitForFunction(() => /Not enough data/.test(document.querySelector("#card-status").textContent));
  assert.ok(await page.locator("#price-wrap").isHidden());
  await page.fill("#ask", "50");
  await page.click("#check-btn");
  assert.equal(await text("#verdict-check h3"), "Not enough data");
});

await step("Magic search (single result auto-selects): A$1 vs A$2 -> Strong deal 80", async () => {
  await page.click('#game-seg [data-game="mtg"]');
  await page.fill("#q-name", "lightning bolt");
  await page.fill("#q-number", "");
  await page.click("#search-btn");
  await page.waitForFunction(() => document.querySelector("#card-name").textContent === "Lightning Bolt");
  await page.fill("#ask", "1");
  await page.fill("#ship", "");
  await page.click("#check-btn");
  assert.equal(await text("#verdict-check .v-band"), "Strong deal");
  assert.equal(await text("#verdict-check .v-score"), "80");
});

await step("Yu-Gi-Oh card with zero prices -> Not enough data", async () => {
  await page.click('#game-seg [data-game="ygo"]');
  await page.fill("#q-name", "mystery");
  await page.click("#search-btn");
  await page.waitForFunction(() => /Not enough data/.test(document.querySelector("#card-status").textContent));
});

await step("API failure: TCGdex 500 shows a clear error", async () => {
  allowed.push(/status of 500/);
  mock.fail.add("tcgdex");
  await page.click('#game-seg [data-game="pokemon"]');
  await page.fill("#q-name", "Charizard");
  await page.click("#search-btn");
  await page.waitForFunction(() => document.querySelector("#search-status").classList.contains("error"));
  assert.match(await text("#search-status"), /TCGdex returned an error \(500\).*Comps/);
  mock.fail.delete("tcgdex");
});

await step("API failure: Scryfall unreachable shows a clear error", async () => {
  allowed.push(/ERR_FAILED|net::/);
  mock.fail.add("scryfall");
  await page.click('#game-seg [data-game="mtg"]');
  await page.fill("#q-name", "bolt");
  await page.click("#search-btn");
  await page.waitForFunction(() => document.querySelector("#search-status").classList.contains("error"));
  assert.match(await text("#search-status"), /Scryfall couldn't be reached/);
  mock.fail.delete("scryfall");
});

await step("paste listing title: misspelling flagged, loose search finds Charizard", async () => {
  await page.fill("#paste", "Pokemon Charzard Base Set 4/102 Holo Rare");
  await page.click("#read-listing");
  await page.waitForSelector("#listing-read .flags");
  assert.match(await text("#listing-read"), /Misspelt “charzard”/);
  assert.equal(await page.inputValue("#q-name"), "Charizard Base Set");
  await page.waitForFunction(() => document.querySelectorAll("#results .result").length === 2);
  assert.match(await text("#search-status"), /for “Charizard”/);
});

await step("sports listing -> manual comps flow with sold-search links", async () => {
  await page.fill("#paste", "2021 Panini Prizm NBA LaMelo Ball Rookie RC #278 PSA 10");
  await page.click("#read-listing");
  assert.ok(await page.locator("#sports-box").isVisible());
  const href = await page.locator("#sports-links a").first().getAttribute("href");
  assert.ok(href.startsWith("https://www.ebay.com.au/sch/i.html?_nkw=2021%20Panini") && href.includes("LH_Sold=1"), href);
  assert.ok(await page.locator("#search-btn").isHidden());
  await page.click("#sports-to-comps");
  assert.ok(await page.locator("#view-comps").isVisible());
  assert.match(await page.inputValue("#c-name"), /LaMelo Ball/);
});

await step("comps: 5 AUD sales, 80 + 8 -> Good deal 53, median/trimmed 110, spread 20%", async () => {
  await page.fill("#c-prices", "100\n120, 90\n$150 110");
  await page.selectOption("#c-cur", "AUD");
  assert.match(await text("#c-parsed"), /^5 prices/);
  await page.fill("#c-ask", "80");
  await page.fill("#c-ship", "8");
  await page.click("#comps-btn");
  assert.equal(await text("#comps-stats .s-median"), "A$110.00");
  assert.equal(await text("#comps-stats .s-tmean"), "A$110.00");
  assert.equal(await text("#comps-stats .s-cv"), "20%");
  assert.equal(await text("#verdict-comps .v-band"), "Good deal");
  assert.equal(await text("#verdict-comps .v-score"), "53");
  assert.match(await text("#verdict-comps .v-pct"), /20\.0% under/);
});

await step("comps in USD converted (x2): 50,60,55 vs ask 100 -> score 50", async () => {
  await page.fill("#c-prices", "50, 60, 55");
  await page.selectOption("#c-cur", "USD");
  assert.match(await text("#c-parsed"), /A\$100\.00, A\$120\.00, A\$110\.00/);
  await page.fill("#c-ask", "100");
  await page.fill("#c-ship", "");
  await page.click("#comps-btn");
  assert.equal(await text("#verdict-comps .v-band"), "Slightly under market");
  assert.equal(await text("#verdict-comps .v-score"), "50");
});

await step("comps with 2 sales -> Not enough data", async () => {
  await page.fill("#c-prices", "50, 60");
  await page.click("#comps-btn");
  assert.equal(await text("#verdict-comps h3"), "Not enough data");
  assert.match(await text("#verdict-comps"), /at least 3/);
});

await step("settings + grading EV: A$22.24 profit, break-even 12.6%", async () => {
  await page.click("#open-settings");
  await page.fill("#s-fee", "45");
  await page.fill("#s-ship", "35");
  await page.fill("#s-sell", "12");
  await page.click("#settings-save");
  await page.click('.tab[data-view="grading"]');
  assert.match(await text("#g-costs"), /A\$45\.00.*A\$35\.00.*12%/);
  await page.fill("#g-cost", "50");
  await page.fill("#g-low", "60");
  await page.fill("#g-10", "400");
  await page.fill("#g-9", "150");
  await page.fill("#g-p10", "20");
  await page.fill("#g-p9", "50");
  await page.click("#grade-btn");
  assert.equal(await text("#grade-out .g-verdict"), "Worth grading");
  assert.equal(await text("#grade-out .g-ev"), "A$22.24");
  assert.equal(await text("#grade-out .g-gross"), "A$173.00");
  assert.equal(await text("#grade-out .g-net"), "A$152.24");
  assert.equal(await text("#grade-out .g-cost"), "A$130.00");
  assert.equal(await text("#grade-out .g-be"), "12.6%");
  await page.fill("#g-p10", "60");
  await page.click("#grade-btn");
  assert.match(await text("#grade-out"), /can't be more than 100%/);
  await page.fill("#g-10", "");
  await page.fill("#g-p10", "20");
  await page.click("#grade-btn");
  assert.equal(await text("#grade-out h3"), "Not enough data");
});

await step("watchlist: add from verdict, persists after reload, export, import, remove", async () => {
  await page.click('.tab[data-view="check"]');
  await page.click('#game-seg [data-game="pokemon"]');
  await page.fill("#q-name", "Charizard");
  await page.fill("#q-number", "4");
  await page.click("#search-btn");
  await page.waitForSelector("#results .result");
  await page.locator("#results .result", { hasText: "Base Set ·" }).first().click();
  await page.waitForSelector("#prices tbody tr");
  await page.fill("#ask", "140");
  await page.fill("#ship", "10");
  await page.selectOption("#cond", "nm"); // the sports PSA 10 listing set it to "graded"
  await page.click("#check-btn");
  page.once("dialog", (d) => d.accept("120"));
  await page.click('#verdict-check [data-act="watch"]');
  await page.waitForSelector("#watch-list li[data-id]");
  assert.match(await text("#watch-list li[data-id]"), /Charizard[\s\S]*Target A\$120\.00 · Market A\$200\.00 \(target 40% below\)/);
  await page.reload();
  await page.click('.tab[data-view="watch"]');
  assert.equal(await page.locator("#watch-list li[data-id]").count(), 1);
  assert.equal(await text("#watch-count"), "1");
  // refresh from live (mocked) API
  await page.click("#watch-refresh");
  await page.waitForFunction(() => /Updated 1/.test(document.querySelector("#watch-status").textContent));
  // export
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#watch-export")]);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  assert.equal(exported.app, "card-deals");
  assert.equal(exported.watchlist.length, 1);
  assert.equal(exported.watchlist[0].target, 120);
  // import: one replaced (same id, new target), one new
  const id = exported.watchlist[0].id;
  const file = "/tmp/cdc-import.json";
  fs.writeFileSync(file, JSON.stringify({ watchlist: [{ ...exported.watchlist[0], target: 99 }, { id: "x1", name: "2019 Select Nathan Cleary", game: "sports", target: 40 }] }));
  await page.setInputFiles("#watch-import", file);
  await page.waitForFunction(() => /Imported: 1 new, 1 updated/.test(document.querySelector("#watch-status").textContent));
  assert.equal(await page.locator("#watch-list li[data-id]").count(), 2);
  assert.match(await page.locator(`#watch-list li[data-id="${id}"]`).innerText(), /Target A\$99\.00/);
  fs.writeFileSync(file, "{nope");
  await page.setInputFiles("#watch-import", file);
  await page.waitForFunction(() => document.querySelector("#watch-status").classList.contains("error"));
  page.once("dialog", (d) => d.accept());
  await page.locator('#watch-list li[data-id="x1"] [data-w="remove"]').click();
  assert.equal(await page.locator("#watch-list li[data-id]").count(), 1);
  await page.reload();
  await page.click('.tab[data-view="watch"]');
  assert.equal(await page.locator("#watch-list li[data-id]").count(), 1);
});

await step("tips panel renders", async () => {
  await page.click('.tab[data-view="tips"]');
  const t = await text("#view-tips");
  assert.match(t, /Misspelt titles/);
  assert.match(t, /Odd ending times/);
  assert.match(t, /Low population/);
});

await page.screenshot({ path: "test-results/e2e-last.png", fullPage: true }).catch(() => {});
await ctx.close();

// ---- FX down: no cached rate -> clear message; backup rate fixes it
await step("FX failure: message, AUD blank, backup rate from Settings works", async () => {
  allowed.push(/ERR_FAILED|net::/);
  const c2 = await browser.newContext(phone);
  await routes(c2);
  mock.fail.add("fx");
  const p = await newPage(c2);
  await p.goto(BASE);
  await p.waitForFunction(() => /unavailable/.test(document.querySelector("#fx-line").textContent));
  await p.fill("#q-name", "Charizard");
  await p.fill("#q-number", "4");
  await p.click("#search-btn");
  await p.waitForSelector("#results .result");
  await p.locator("#results .result", { hasText: "Base Set ·" }).first().click();
  await p.waitForSelector("#prices tbody tr");
  assert.match(await p.locator("#prices tbody tr").first().innerText(), /USD 100\.00\s+–/);
  await p.fill("#ask", "100");
  await p.click("#check-btn");
  assert.match(await p.locator("#verdict-check").innerText(), /Need an exchange rate/);
  await p.click("#open-settings");
  await p.fill("#s-usd", "1.5");
  await p.click("#settings-save");
  await p.click("#check-btn");
  assert.equal(await p.locator("#verdict-check .v-ref").innerText(), "A$150.00");
  assert.match(await p.locator("#fx-line").innerText(), /backup rate 1 USD = A\$1\.5/);
  mock.fail.delete("fx");
  await c2.close();
});

// ---- PWA: installability, SW scope, API calls never cached, offline reopen
await step("PWA: installable, SW scoped to /card-deals/, caches only app files, opens offline", async () => {
  const dir = fs.mkdtempSync("/tmp/cdc-pwa-");
  const c3 = await chromium.launchPersistentContext(dir, { executablePath: "/usr/bin/google-chrome", headless: true, ...phone });
  await routes(c3);
  const p = c3.pages()[0] || (await c3.newPage());
  await p.goto(BASE);
  const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return r.scope; });
  assert.equal(sw, BASE);
  await p.reload();
  await p.fill("#q-name", "Charizard");
  await p.click("#search-btn");
  await p.waitForSelector("#results .result");
  const cdp = await c3.newCDPSession(p);
  const inst = await cdp.send("Page.getInstallabilityErrors");
  assert.deepEqual(inst.installabilityErrors, [], JSON.stringify(inst.installabilityErrors));
  const man = await cdp.send("Page.getAppManifest");
  assert.deepEqual(man.errors, []);
  const appId = await cdp.send("Page.getAppId");
  assert.equal(appId.appId, `http://127.0.0.1:${PORT}/card-deals/?app=card-deals`);
  const cached = await p.evaluate(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url); return out; });
  assert.ok(cached.length >= 8, "shell cached");
  assert.ok(cached.every((u) => u.startsWith(BASE)), "only app files cached: " + cached.filter((u) => !u.startsWith(BASE)).join(","));
  await c3.setOffline(true);
  await p.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await p.title(), "Card Deal Checker · undervalued trading cards");
  await c3.setOffline(false);
  await c3.close();
});

await browser.close();
srv.close();
const fails = results.filter((r) => r[0] === "FAIL");
if (errors.length) console.log("\nconsole/page errors:\n  " + errors.join("\n  "));
console.log(`\n${results.length - fails.length}/${results.length} e2e steps passed, ${errors.length} unexpected console errors`);
process.exit(fails.length || errors.length ? 1 : 0);
