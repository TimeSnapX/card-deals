// Hand-checked maths. Run: node tests/unit.mjs
import assert from "node:assert/strict";
import * as C from "../js/core.js";
let n = 0;
const near = (a, b, eps = 1e-6, msg = "") => { assert.ok(Math.abs(a - b) < eps, `${msg} expected ${b}, got ${a}`); };
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

t("parsePrices", () => {
  assert.deepEqual(C.parsePrices("$120, AU $99.50 / 1,250\n0 and 7"), [120, 99.5, 1250, 7]);
  assert.deepEqual(C.parsePrices(""), []);
});
t("median / trimmed mean / cv (5 comps)", () => {
  const v = [100, 120, 90, 150, 110];
  assert.equal(C.median(v), 110);            // 90 100 [110] 120 150
  assert.equal(C.trimmedMean(v), 110);       // drop 90 and 150 -> (100+110+120)/3
  assert.equal(C.mean(v), 114);
  near(C.coeffVar(v), Math.sqrt(2120 / 4) / 114, 1e-12, "cv"); // 0.20194
  assert.equal(C.median([1, 2, 3, 4]), 2.5);
  assert.equal(C.trimmedMean([1, 2, 3, 100]), 26.5); // n<5: no trimming
  assert.equal(C.trimmedMean([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]), 5.5); // drop 2 each end -> 3..8
});
t("verdict bands", () => {
  assert.equal(C.verdictBand(30).key, "strong");
  assert.equal(C.verdictBand(29.9).key, "good");
  assert.equal(C.verdictBand(15).key, "good");
  assert.equal(C.verdictBand(5).key, "fair");
  assert.equal(C.verdictBand(0).key, "market");
  assert.equal(C.verdictBand(-5).key, "above");
  assert.equal(C.verdictBand(-20).key, "over");
});
t("comps verdict: 80+8 vs median 110", () => {
  const r = C.evaluate({ mode: "comps", ask: 80, shipping: 8, comps: [100, 120, 90, 150, 110] });
  assert.equal(r.status, "ok");
  assert.equal(r.cost, 88);
  near(r.discountPct, 20);                   // (110-88)/110
  near(r.parts.discount, (40 / 70) * 60);    // 34.2857
  assert.equal(r.parts.liquidity, 10);       // 5 comps
  assert.equal(r.parts.consistency, 9);      // cv 0.202
  assert.equal(r.score, 53);
  assert.equal(r.band.key, "good");
});
t("comps: fewer than 3 = no data", () => {
  const r = C.evaluate({ mode: "comps", ask: 50, comps: [60, 70] });
  assert.equal(r.status, "no-data");
});
t("market verdict: A$150 vs A$200, sources agree", () => {
  const r = C.evaluate({ mode: "market", ask: 140, shipping: 10, market: { value: 200, basis: "sold", agreement: 1 / 3 } });
  near(r.discountPct, 25);
  assert.equal(r.parts.liquidity, 18);
  assert.equal(r.parts.consistency, 8);
  assert.equal(r.score, Math.round((45 / 70) * 60 + 26)); // 64.57 -> 65
  assert.equal(r.score, 65);
});
t("market verdict: condition LP x0.85", () => {
  const r = C.evaluate({ mode: "market", ask: 150, condition: "lp", market: { value: 200, basis: "sold", agreement: 1 / 3 } });
  near(r.ref, 170);
  near(r.discountPct, (20 / 170) * 100);
  assert.equal(r.band.key, "fair");
  assert.equal(r.score, 53);
});
t("market verdict: listing-only, disagreement, single source", () => {
  assert.equal(C.evaluate({ mode: "market", ask: 10, market: { value: 10, basis: "listing", agreement: null } }).parts.liquidity, 6);
  assert.equal(C.evaluate({ mode: "market", ask: 10, market: { value: 10, basis: "sold", agreement: 0.5 } }).parts.liquidity, 6);
  assert.equal(C.evaluate({ mode: "market", ask: 10, market: { value: 10, basis: "sold", agreement: null } }).parts.liquidity, 12);
});
t("market: graded or no price = no data; extremes clamp", () => {
  assert.equal(C.evaluate({ mode: "market", ask: 10, condition: "graded", market: { value: 20, basis: "sold" } }).status, "no-data");
  assert.equal(C.evaluate({ mode: "market", ask: 10, market: null }).status, "no-data");
  assert.equal(C.evaluate({ mode: "market", ask: 0, market: { value: 1 } }).status, "need-ask");
  assert.equal(C.discountPoints(90), 60);
  assert.equal(C.discountPoints(-50), 0);
  assert.equal(C.evaluate({ mode: "market", ask: 1, market: { value: 2, basis: "sold", agreement: null } }).score, 80);
});
t("grading EV hand-check", () => {
  const g = C.gradingEV({ cost: 50, v10: 400, v9: 150, vLow: 60, p10: 0.2, p9: 0.5, gradingFee: 45, shipping: 35, sellFeePct: 12 });
  near(g.gross, 173);          // 80 + 75 + 18
  near(g.net, 152.24);         // x0.88
  near(g.cost, 130);
  near(g.ev, 22.24);
  near(g.breakEvenP10, 42.72727272727 / 340, 1e-9); // 0.12567
  assert.equal(C.gradingEV({ cost: 1, v10: 1, v9: 1, p10: 0.7, p9: 0.5 }).status, "bad-prob");
  assert.equal(C.gradingEV({ cost: 1, v10: 0, v9: 0, p10: 0.1, p9: 0.1 }).status, "no-data");
});
t("listing parser", () => {
  const a = C.parseListing("Pokemon Charzard Base Set 4/102 Holo 1st edtion");
  assert.equal(a.game, "pokemon");
  assert.equal(a.number, "4/102");
  assert.equal(a.name, "Charizard Base Set");
  assert.ok(a.firstEdition);
  assert.ok(a.flags.some((f) => f.key === "misspelt"));
  assert.ok(!a.flags.some((f) => f.key === "sp"));
  const b = C.parseListing("2021 Panini Prizm NBA LaMelo Ball Rookie RC #278 PSA 10");
  assert.equal(b.game, "sports");
  assert.equal(b.grader, "PSA");
  assert.equal(b.grade, "10");
  assert.equal(b.year, "2021");
  assert.equal(b.number, "278");
  const c = C.parseListing("Yu-Gi-Oh Dark Magician LOB-005 Ultra Rare");
  assert.equal(c.game, "ygo");
  assert.equal(c.number, "LOB-005");
  assert.ok(C.parseListing("Pokemon bulk lot 100 cards").lot);
  assert.ok(C.parseListing("Charizard proxy custom card").flags.some((f) => f.key === "fake"));
  assert.ok(C.parseListing("2023 Topps Chrome Bellingham /99").flags.some((f) => f.key === "sp"));
});
t("watchlist normalise / merge", () => {
  const cur = C.normaliseWatch([{ id: "a", name: "A", target: 10 }, { id: "b", name: "B" }]);
  const m = C.mergeWatch(cur, [{ id: "b", name: "B2", target: "12.345" }, { id: "c", name: "C" }, { name: "" }]);
  assert.equal(m.added, 1);
  assert.equal(m.replaced, 1);
  assert.equal(m.list.find((w) => w.id === "b").target, 12.35);
  assert.throws(() => C.normaliseWatch({}));
});
t("sold search links", () => {
  const l = C.soldSearchLinks("Charizard 4/102");
  assert.ok(l[0].url.includes("ebay.com.au") && l[0].url.includes("LH_Sold=1"));
  assert.ok(l[2].url.startsWith("https://130point.com/sales/?q=Charizard"));
});
console.log(`\n${n} unit tests passed`);
