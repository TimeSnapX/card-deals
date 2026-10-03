// Card Deal Checker: pure maths and parsing. No DOM, no network.
// Imported by the app and by tests/unit.mjs (node).

export const round2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Pull every positive number out of free text ("$120, AU $99.50 / 1,250"). */
export function parsePrices(text) {
  if (!text) return [];
  const out = [];
  const re = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(String(text)))) {
    const v = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
}

export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Trimmed mean: drops floor(20%) of values from each end, only when n >= 5. */
export function trimmedMean(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  const k = n >= 5 ? Math.floor(n * 0.2) : 0;
  const mid = s.slice(k, n - k);
  return mid.reduce((a, b) => a + b, 0) / mid.length;
}

export function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}

/** Sample standard deviation / mean. */
export function coeffVar(values) {
  const n = values.length;
  if (n < 2) return NaN;
  const m = mean(values);
  const v = values.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1);
  return Math.sqrt(v) / m;
}

export const MIN_COMPS = 3;

export function compsStats(values) {
  const v = values.filter((x) => Number.isFinite(x) && x > 0);
  return {
    n: v.length,
    min: v.length ? Math.min(...v) : NaN,
    max: v.length ? Math.max(...v) : NaN,
    median: median(v),
    trimmedMean: trimmedMean(v),
    mean: mean(v),
    cv: coeffVar(v),
    trimmed: v.length >= 5 ? Math.floor(v.length * 0.2) : 0,
  };
}

// Condition multipliers applied to a raw near-mint market price.
export const CONDITION = {
  nm: { label: "Near mint (raw)", mult: 1 },
  lp: { label: "Lightly played", mult: 0.85 },
  mp: { label: "Moderately played", mult: 0.7 },
  hp: { label: "Heavily played / damaged", mult: 0.5 },
  graded: { label: "Graded slab", mult: 1 },
};

export function verdictBand(discountPct) {
  if (discountPct >= 30) return { key: "strong", label: "Strong deal" };
  if (discountPct >= 15) return { key: "good", label: "Good deal" };
  if (discountPct >= 5) return { key: "fair", label: "Slightly under market" };
  if (discountPct > -5) return { key: "market", label: "About market price" };
  if (discountPct > -20) return { key: "above", label: "Above market" };
  return { key: "over", label: "Overpriced" };
}

/** Discount part of the deal score: 0..60. -20% or worse = 0, +50% or better = 60. */
export function discountPoints(discountPct) {
  return (clamp((discountPct + 20) / 70, 0, 1)) * 60;
}

/** Liquidity / data-depth part: 0..25. */
export function liquidityPoints(ctx) {
  if (ctx.mode === "comps") {
    if (ctx.n >= 10) return 25;
    if (ctx.n >= 6) return 18;
    if (ctx.n >= MIN_COMPS) return 10;
    return 0;
  }
  // market (API) mode: free APIs give no sales volume, so score the evidence instead.
  if (ctx.basis !== "sold") return 6;
  if (ctx.agreement == null) return 12;
  return ctx.agreement <= 0.35 ? 18 : 6;
}

/** Price-consistency part: 0..15. */
export function consistencyPoints(ctx) {
  if (ctx.mode === "comps") {
    if (!Number.isFinite(ctx.cv)) return 3;
    if (ctx.cv < 0.15) return 15;
    if (ctx.cv < 0.3) return 9;
    return 3;
  }
  return 8; // spread unknown from a single market figure
}

/**
 * The verdict.
 * input: { ask, shipping=0, condition='nm', mode:'market'|'comps',
 *          market: { value, basis:'sold'|'listing', agreement } (AUD, raw NM)
 *          comps: [AUD...] }
 */
export function evaluate(input) {
  const ask = Number(input.ask);
  const shipping = Number(input.shipping) || 0;
  const condition = input.condition || "nm";
  const notes = [];
  if (!(ask > 0)) return { status: "need-ask", notes: ["Enter the asking price."] };
  const cost = ask + shipping;
  let ref, ctx;
  if (input.mode === "comps") {
    const st = compsStats(input.comps || []);
    if (st.n < MIN_COMPS) {
      return { status: "no-data", stats: st, cost, notes: [`Need at least ${MIN_COMPS} sold prices (you have ${st.n}).`] };
    }
    ref = st.median;
    ctx = { mode: "comps", n: st.n, cv: st.cv };
    if (st.cv >= 0.3) notes.push("Sold prices are spread out; check the comps are the same card, grade and condition.");
    if (st.n < 6) notes.push("Few comps: treat the verdict as rough.");
    var stats = st;
  } else {
    const mk = input.market;
    if (!mk || !(mk.value > 0)) {
      return { status: "no-data", cost, notes: ["No price data for this card from the free sources. Use Comps with recent sold prices."] };
    }
    if (condition === "graded") {
      return { status: "no-data", cost, notes: ["Free API prices are for raw (ungraded) cards, so they can't value a slab. Use Comps with recent sold prices for the same grade."] };
    }
    const mult = (CONDITION[condition] || CONDITION.nm).mult;
    ref = mk.value * mult;
    if (mult !== 1) notes.push(`Market price adjusted ×${mult} for ${CONDITION[condition].label.toLowerCase()}.`);
    if (mk.basis !== "sold") notes.push("This reference is based on asking prices, not completed sales, so real sold prices may be lower.");
    if (mk.agreement != null && mk.agreement > 0.35) notes.push("The price sources disagree a lot; check sold comps before buying.");
    notes.push("Free sources give no sales volume, so liquidity is estimated.");
    ctx = { mode: "market", basis: mk.basis, agreement: mk.agreement };
  }
  const discountPct = ((ref - cost) / ref) * 100;
  const dp = discountPoints(discountPct);
  const lp = liquidityPoints(ctx);
  const cp = consistencyPoints(ctx);
  const score = Math.round(dp + lp + cp);
  return {
    status: "ok",
    ref,
    cost,
    discountPct,
    savings: ref - cost,
    band: verdictBand(discountPct),
    score,
    parts: { discount: dp, liquidity: lp, consistency: cp },
    stats,
    notes,
  };
}

/** Relative disagreement between two prices: |a-b| / min(a,b). */
export function agreement(a, b) {
  if (!(a > 0) || !(b > 0)) return null;
  return Math.abs(a - b) / Math.min(a, b);
}

/**
 * Grading expected value. All AUD.
 * { cost, v10, v9, vLow, p10, p9 (0..1), gradingFee, shipping, sellFeePct }
 * pLow = 1 - p10 - p9. Sale values are reduced by selling fees.
 */
export function gradingEV(g) {
  const p10 = Number(g.p10) || 0;
  const p9 = Number(g.p9) || 0;
  const pLow = 1 - p10 - p9;
  if (p10 < 0 || p9 < 0 || pLow < -1e-9) return { status: "bad-prob", notes: ["PSA 10 % + PSA 9 % can't be more than 100%."] };
  const keep = 1 - (Number(g.sellFeePct) || 0) / 100;
  const v10 = Number(g.v10) || 0, v9 = Number(g.v9) || 0, vLow = Number(g.vLow) || 0;
  if (!(v10 > 0) || !(v9 > 0)) return { status: "no-data", notes: ["Enter PSA 10 and PSA 9 sold prices (free sources don't publish graded prices)."] };
  const cost = (Number(g.cost) || 0) + (Number(g.gradingFee) || 0) + (Number(g.shipping) || 0);
  const gross = p10 * v10 + p9 * v9 + Math.max(0, pLow) * vLow;
  const net = gross * keep;
  const ev = net - cost;
  // Break-even PSA 10 chance holding the PSA 9 chance fixed (rest grade 8 or lower).
  // keep*(p*v10 + p9*v9 + (1-p9-p)*vLow) = cost  ->  p = (cost/keep - p9*v9 - (1-p9)*vLow) / (v10 - vLow)
  let breakEvenP10 = null;
  if (v10 > vLow && keep > 0) {
    const p = (cost / keep - p9 * v9 - (1 - p9) * vLow) / (v10 - vLow);
    breakEvenP10 = p;
  }
  return { status: "ok", cost, gross, net, ev, roiPct: cost > 0 ? (ev / cost) * 100 : NaN, pLow: Math.max(0, pLow), breakEvenP10, maxP10: 1 - p9 };
}

// ---------------------------------------------------------------- listing titles
const MISSPELLINGS = {
  charzard: "Charizard", charazard: "Charizard", charizad: "Charizard", charizzard: "Charizard", chalizard: "Charizard",
  pikachoo: "Pikachu", pickachu: "Pikachu", pikachue: "Pikachu", pokeman: "Pokemon", pokemom: "Pokemon", pokmon: "Pokemon",
  blastiose: "Blastoise", blastois: "Blastoise", venasaur: "Venusaur", venusuar: "Venusaur", mewto: "Mewtwo", umbrean: "Umbreon",
  yugio: "Yu-Gi-Oh", yugiho: "Yu-Gi-Oh", "blue eye": "Blue-Eyes", exodiya: "Exodia",
  lebron: null, lebrom: "LeBron", jordon: "Jordan", kobie: "Kobe", wembanyamma: "Wembanyama", mahomed: "Mahomes",
  prizim: "Prizm", prism: "Prizm", panninni: "Panini", panin: "Panini", tops: "Topps", rookey: "Rookie",
  "1st edtion": "1st Edition", "first edtion": "1st Edition", holographic: null, holo: null,
};

const SPORT_WORDS = /\b(nrl|afl|nba|nfl|mlb|nhl|epl|soccer|football|rugby|cricket|basketball|baseball|panini|topps|prizm|select|optic|mosaic|donruss|upper deck|fleer|bowman|chrome|rookie|rc|auto|autograph|patch|jersey|tradition|teamcoach|select nrl|dynasty)\b/i;
const POKEMON_WORDS = /\b(pokemon|pok[eé]mon|pikachu|charizard|blastoise|venusaur|mewtwo|umbreon|eevee|gengar|lugia|rayquaza|holo|1st edition|shadowless|base set|jungle|fossil|team rocket|scarlet|violet|sword|shield|full art|alt art|illustration rare|sir|tcg)\b/i;
const MTG_WORDS = /\b(mtg|magic the gathering|magic: the gathering|planeswalker|mythic|foil|alpha|beta|unlimited|revised|commander|black lotus|mox)\b/i;
const YGO_WORDS = /\b(yu-?gi-?oh|ygo|konami|blue-?eyes|dark magician|exodia|secret rare|ultimate rare|ghost rare|starlight|lob-|sdk-|mrd-)\b/i;

export function guessGame(text) {
  const t = String(text || "");
  const s = {
    pokemon: (t.match(new RegExp(POKEMON_WORDS, "gi")) || []).length,
    mtg: (t.match(new RegExp(MTG_WORDS, "gi")) || []).length,
    ygo: (t.match(new RegExp(YGO_WORDS, "gi")) || []).length * 1.5,
    sports: (t.match(new RegExp(SPORT_WORDS, "gi")) || []).length,
  };
  const best = Object.entries(s).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : "other";
}

/** Read a listing title (or a URL with a title slug) into fields + flags. */
export function parseListing(raw) {
  let text = String(raw || "").trim();
  const flags = [];
  let fromUrl = false;
  if (/^https?:\/\//i.test(text)) {
    fromUrl = true;
    try {
      const u = new URL(text);
      const slug = decodeURIComponent(u.pathname.split("/").filter(Boolean).filter((p) => /[a-z]/i.test(p) && p.length > 6 && p !== "itm").pop() || "");
      const q = u.searchParams.get("_nkw") || u.searchParams.get("q") || "";
      text = (q || slug).replace(/[-_+]+/g, " ").trim();
      if (!text) flags.push({ key: "url", text: "This link has no title in it. Paste the listing title instead (the app can't open eBay pages)." });
    } catch {
      text = "";
    }
  }
  const lower = text.toLowerCase();
  const out = { text, fromUrl, game: guessGame(text), name: "", year: null, number: null, grader: null, grade: null, firstEdition: false, lot: false, flags };
  const yr = text.match(/\b(19[4-9]\d|20[0-3]\d)(?:[-/](\d{2,4}))?\b/);
  if (yr) out.year = yr[0];
  const gr = text.match(/\b(PSA|BGS|CGC|SGC|Beckett|TAG|ACE)\s*(?:GEM\s*(?:MT|MINT)\s*)?(10|9\.5|[1-9](?:\.5)?)\b/i);
  if (gr) {
    out.grader = gr[1].toUpperCase().replace("BECKETT", "BGS");
    out.grade = gr[2];
  }
  const slash = text.match(/\b([A-Z]{0,4}\d{1,3}[a-z]?)\s*\/\s*([A-Z]{0,3}\d{2,3})\b/i);
  const hash = text.match(/#\s*([A-Z]{0,5}-?\d{1,4}[A-Z]?)\b/i);
  const code = text.match(/\b([A-Z0-9]{2,5}-[A-Z]{0,2}\d{3})\b/); // YGO set code like LOB-001 / MRD-EN036
  if (slash) out.number = `${slash[1]}/${slash[2]}`;
  else if (code) out.number = code[1];
  else if (hash) out.number = hash[1];
  out.firstEdition = /\b(1st|first)\s*(edition|edtion|editon|ed\.?)(?![a-z])/i.test(text);
  out.lot = /\b(lot|bundle|bulk|collection|x\s?\d{2,}|\d{2,}\s?cards)\b/i.test(text);
  if (out.lot) flags.push({ key: "lot", text: "Looks like a lot or bundle: price each key card separately; lots often hide a valuable card." });
  for (const [bad, good] of Object.entries(MISSPELLINGS)) {
    if (!good) continue;
    if (new RegExp(`\\b${bad}\\b`, "i").test(lower)) flags.push({ key: "misspelt", text: `Misspelt “${bad}” (should be ${good}): fewer buyers find it, which can mean a cheaper price.` });
  }
  if (/\b(error|misprint|miscut|off[- ]?center|crimp|wrong back|no stamp)\b/i.test(text)) flags.push({ key: "error", text: "Mentions an error/misprint: some are valuable, many aren't. Check sold prices for that exact error." });
  if (/(\b(sp|ssp|short print|numbered|one of one)\b|(^|\s)(\/|#'d\s*\/?)\d{1,3}\b|\b1\/1\b)/i.test(text)) flags.push({ key: "sp", text: "Short print or numbered card: check the print run and sold prices for the same number range." });
  if (/\b(reprint|proxy|custom|replica|orica|fan made|rp)\b/i.test(text)) flags.push({ key: "fake", text: "Says reprint/proxy/custom/RP: not an original card." });
  // Name: strip the bits we recognised and common filler.
  let name = text
    .replace(gr ? gr[0] : "", " ")
    .replace(yr ? yr[0] : "", " ")
    .replace(slash ? slash[0] : "", " ")
    .replace(code ? code[0] : "", " ")
    .replace(hash ? hash[0] : "", " ")
    .replace(/\b(pokemon|pok[eé]mon|tcg|card|cards|mtg|magic the gathering|yu-?gi-?oh!?|ygo|holo|rare|nm|mint|near mint|lp|mp|hp|psa|bgs|cgc|graded|ungraded|raw|1st edition|first edition|english|eng|free post|free shipping|fast post|au seller|aus|australia|look|wow|l@@k|gem|mt|rc|rookie|\bnew\b)\b/gi, " ")
    .replace(/[|,;:()[\]!*~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [bad, good] of Object.entries(MISSPELLINGS)) {
    if (good && !/\s/.test(bad)) name = name.replace(new RegExp(`\\b${bad}\\b`, "gi"), good);
  }
  name = name.replace(/\b(lot|bundle|bulk|collection|edtion|editon|edition|1st|first)\b/gi, " ").replace(/\s+/g, " ").trim();
  out.name = name.split(" ").slice(0, 6).join(" ");
  return out;
}

/** Search URLs the user opens in their own browser to gather sold comps. */
export function soldSearchLinks(query) {
  const q = encodeURIComponent(query.trim());
  return [
    { label: "eBay AU sold", url: `https://www.ebay.com.au/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1` },
    { label: "eBay US sold", url: `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1` },
    { label: "130point", url: `https://130point.com/sales/?q=${q}` },
    { label: "PSA pop report", url: `https://www.psacard.com/pop` },
  ];
}

// ---------------------------------------------------------------- watchlist
export function normaliseWatch(list) {
  if (!Array.isArray(list)) throw new Error("Not a watchlist file");
  return list
    .filter((w) => w && typeof w.name === "string" && w.name.trim())
    .map((w) => ({
      id: String(w.id || `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`),
      name: w.name.trim().slice(0, 140),
      game: ["pokemon", "mtg", "ygo", "sports", "other"].includes(w.game) ? w.game : "other",
      detail: String(w.detail || "").slice(0, 200),
      grade: String(w.grade || "").slice(0, 30),
      target: Number(w.target) > 0 ? round2(Number(w.target)) : null,
      ref: Number(w.ref) > 0 ? round2(Number(w.ref)) : null,
      refNote: String(w.refNote || "").slice(0, 120),
      sourceId: w.sourceId ? String(w.sourceId).slice(0, 120) : null,
      notes: String(w.notes || "").slice(0, 500),
      added: w.added || new Date().toISOString(),
      updated: w.updated || w.added || new Date().toISOString(),
    }));
}

/** Merge imported items into the current list; same id = imported copy wins. */
export function mergeWatch(current, incoming) {
  const map = new Map(current.map((w) => [w.id, w]));
  let added = 0, replaced = 0;
  for (const w of normaliseWatch(incoming)) {
    if (map.has(w.id)) replaced++;
    else added++;
    map.set(w.id, w);
  }
  return { list: [...map.values()], added, replaced };
}

export function fmtAUD(x, dp = 2) {
  if (!Number.isFinite(x)) return "–";
  const s = Math.abs(x).toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return `${x < 0 ? "−" : ""}A$${s}`;
}
