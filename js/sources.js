// Card Deal Checker: price sources (all keyless, called straight from the browser).
// Every adapter returns normalised cards:
// { id, game, name, set, number, rarity, year, image, prices:[PricePoint], links:[{label,url}], source }
// PricePoint: { key, label, variant, value, currency, basis:'sold'|'listing', source, note }

export const ENDPOINTS = {
  tcgdexGraphql: "https://api.tcgdex.net/v2/graphql",
  tcgdexCard: (id) => `https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`,
  ptcgCard: (id) => `https://api.pokemontcg.io/v2/cards/${encodeURIComponent(id)}`,
  scryfallSearch: (q) => `https://api.scryfall.com/cards/search?unique=prints&order=released&q=${encodeURIComponent(q)}`,
  ygoSearch: (q) => `https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(q)}&num=20&offset=0`,
  fxFrankfurter: "https://api.frankfurter.dev/v1/latest?from=AUD&to=USD,EUR,GBP",
  fxErApi: "https://open.er-api.com/v6/latest/AUD",
};

export class SourceError extends Error {
  constructor(source, message) {
    super(message);
    this.source = source;
  }
}

async function getJSON(url, source, opts = {}, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { ...opts, signal: ctl.signal, cache: "no-store" });
  } catch (e) {
    throw new SourceError(source, e.name === "AbortError" ? `${source} timed out` : `${source} couldn't be reached`);
  } finally {
    clearTimeout(t);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new SourceError(source, `${source} returned an error (${res.status})`);
  try {
    return await res.json();
  } catch {
    throw new SourceError(source, `${source} sent something unreadable`);
  }
}

const num = (x) => (x == null || x === "" ? NaN : Number(x));
const pos = (x) => Number.isFinite(x) && x > 0;

// ------------------------------------------------------------------ Pokémon (TCGdex)
const PKM_VARIANT = { normal: "Normal", holofoil: "Holofoil", "reverse-holofoil": "Reverse holo", reverseHolofoil: "Reverse holo", "1st-edition": "1st Edition", "1st-edition-holofoil": "1st Ed. holofoil", "1stEditionHolofoil": "1st Ed. holofoil", "1stEditionNormal": "1st Ed. normal", "unlimited-holofoil": "Unlimited holofoil", unlimitedHolofoil: "Unlimited holofoil" };
const pkmVariant = (k) => PKM_VARIANT[k] || k.replace(/[-_]/g, " ");

function localIdFromNumber(n) {
  if (!n) return null;
  const m = String(n).trim().match(/^([A-Za-z]{0,4}\d{1,3}[a-z]?)/);
  if (!m) return null;
  return m[1].replace(/^0+(?=\d)/, "");
}

export async function searchPokemon(name, number) {
  const lid = localIdFromNumber(number);
  const filters = [`name: ${JSON.stringify(name)}`];
  const query = `{ cards(filters: { ${filters.join(", ")} }, pagination: { page: 1, count: 60 }) { id name localId rarity image set { id name releaseDate } } }`;
  const data = await getJSON(ENDPOINTS.tcgdexGraphql, "TCGdex", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const cards = (data && data.data && data.data.cards) || [];
  let list = cards.map((c) => ({
    id: c.id,
    game: "pokemon",
    name: c.name,
    set: c.set ? c.set.name : "",
    number: c.localId,
    rarity: c.rarity || "",
    year: c.set && c.set.releaseDate ? String(c.set.releaseDate).slice(0, 4) : "",
    image: c.image ? `${c.image}/low.webp` : "",
    prices: null,
    source: "TCGdex",
  }));
  if (lid) {
    const strip = (s) => String(s || "").replace(/^0+(?=\d)/, "").toLowerCase();
    const exact = list.filter((c) => strip(c.number) === lid.toLowerCase());
    if (exact.length) list = exact;
  }
  return list.slice(0, 30);
}

function pokemonPricesFromTcgdex(pricing) {
  const out = [];
  if (!pricing) return out;
  const tp = pricing.tcgplayer;
  if (tp) {
    for (const [k, v] of Object.entries(tp)) {
      if (!v || typeof v !== "object") continue;
      const variant = pkmVariant(k);
      const url = v.productId ? `https://www.tcgplayer.com/product/${v.productId}` : null;
      if (pos(num(v.marketPrice))) out.push({ key: `tcgp-market-${k}`, label: "TCGplayer market price", variant, value: num(v.marketPrice), currency: tp.unit || "USD", basis: "sold", source: "TCGplayer via TCGdex", note: "Based on recent completed sales on TCGplayer", url });
      if (pos(num(v.lowPrice))) out.push({ key: `tcgp-low-${k}`, label: "TCGplayer lowest listing", variant, value: num(v.lowPrice), currency: tp.unit || "USD", basis: "listing", source: "TCGplayer via TCGdex", url });
    }
  }
  const cm = pricing.cardmarket;
  if (cm) {
    const url = cm.idProduct ? `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${cm.idProduct}` : null;
    const cur = cm.unit || "EUR";
    const add = (field, label, basis, variant) => {
      if (pos(num(cm[field]))) out.push({ key: `cm-${field}`, label, variant, value: num(cm[field]), currency: cur, basis, source: "Cardmarket via TCGdex", url });
    };
    add("avg30", "Cardmarket 30-day average sale", "sold", "Normal/holo");
    add("avg7", "Cardmarket 7-day average sale", "sold", "Normal/holo");
    add("trend", "Cardmarket price trend", "sold", "Normal/holo");
    add("low", "Cardmarket lowest listing", "listing", "Normal/holo");
    add("avg30-holo", "Cardmarket 30-day average sale", "sold", "Holo / reverse variant");
    add("trend-holo", "Cardmarket price trend", "sold", "Holo / reverse variant");
  }
  return out;
}

function pokemonPricesFromPtcg(card) {
  const out = [];
  const tp = card.tcgplayer;
  if (tp && tp.prices) {
    for (const [k, v] of Object.entries(tp.prices)) {
      const variant = pkmVariant(k);
      if (pos(num(v.market))) out.push({ key: `tcgp-market-${k}`, label: "TCGplayer market price", variant, value: num(v.market), currency: "USD", basis: "sold", source: "TCGplayer via pokemontcg.io", note: "Based on recent completed sales on TCGplayer", url: tp.url });
      if (pos(num(v.low))) out.push({ key: `tcgp-low-${k}`, label: "TCGplayer lowest listing", variant, value: num(v.low), currency: "USD", basis: "listing", source: "TCGplayer via pokemontcg.io", url: tp.url });
    }
  }
  const cm = card.cardmarket;
  if (cm && cm.prices) {
    const p = cm.prices;
    if (pos(num(p.avg30))) out.push({ key: "cm-avg30", label: "Cardmarket 30-day average sale", variant: "Normal/holo", value: num(p.avg30), currency: "EUR", basis: "sold", source: "Cardmarket via pokemontcg.io", url: cm.url });
    if (pos(num(p.trendPrice))) out.push({ key: "cm-trend", label: "Cardmarket price trend", variant: "Normal/holo", value: num(p.trendPrice), currency: "EUR", basis: "sold", source: "Cardmarket via pokemontcg.io", url: cm.url });
  }
  return out;
}

export async function pokemonDetail(card) {
  const errors = [];
  let prices = [];
  let links = [];
  try {
    const d = await getJSON(ENDPOINTS.tcgdexCard(card.id), "TCGdex");
    if (d) {
      prices = pokemonPricesFromTcgdex(d.pricing);
      if (!card.set && d.set) card.set = d.set.name;
      if (!card.rarity) card.rarity = d.rarity || "";
    }
  } catch (e) {
    errors.push(e.message);
  }
  if (!prices.length) {
    try {
      const d = await getJSON(ENDPOINTS.ptcgCard(card.id), "pokemontcg.io");
      if (d && d.data) prices = pokemonPricesFromPtcg(d.data);
    } catch (e) {
      errors.push(e.message);
    }
  }
  for (const p of prices) if (p.url && !links.some((l) => l.url === p.url)) links.push({ label: p.source.split(" via ")[0], url: p.url });
  return { ...card, prices, links, errors };
}

// ------------------------------------------------------------------ Magic (Scryfall)
export async function searchMagic(name, number) {
  let q = name.trim();
  if (number) q += ` cn:${String(number).split("/")[0].trim()}`;
  const d = await getJSON(ENDPOINTS.scryfallSearch(q), "Scryfall", { headers: { accept: "application/json" } });
  const cards = (d && d.data) || [];
  const mapped = cards.slice(0, 40).map((c) => {
    const img = (c.image_uris && c.image_uris.small) || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris && c.card_faces[0].image_uris.small) || "";
    const P = c.prices || {};
    const tp = (c.purchase_uris && c.purchase_uris.tcgplayer) || null;
    const cmu = (c.purchase_uris && c.purchase_uris.cardmarket) || null;
    const prices = [];
    const add = (field, label, variant, currency, url, source) => {
      if (pos(num(P[field]))) prices.push({ key: `sf-${field}`, label, variant, value: num(P[field]), currency, basis: "sold", source, url });
    };
    add("usd", "TCGplayer market price", "Non-foil", "USD", tp, "TCGplayer via Scryfall");
    add("usd_foil", "TCGplayer market price", "Foil", "USD", tp, "TCGplayer via Scryfall");
    add("usd_etched", "TCGplayer market price", "Etched foil", "USD", tp, "TCGplayer via Scryfall");
    add("eur", "Cardmarket price trend", "Non-foil", "EUR", cmu, "Cardmarket via Scryfall");
    add("eur_foil", "Cardmarket price trend", "Foil", "EUR", cmu, "Cardmarket via Scryfall");
    const links = [];
    if (tp) links.push({ label: "TCGplayer", url: tp });
    if (cmu) links.push({ label: "Cardmarket", url: cmu });
    if (c.scryfall_uri) links.push({ label: "Scryfall", url: c.scryfall_uri });
    return {
      id: c.id,
      game: "mtg",
      name: c.name,
      set: c.set_name,
      number: c.collector_number,
      rarity: c.rarity || "",
      year: (c.released_at || "").slice(0, 4),
      image: img,
      prices,
      links,
      errors: [],
      source: "Scryfall",
    };
  });
  return [...mapped.filter((c) => c.prices.length), ...mapped.filter((c) => !c.prices.length)].slice(0, 30);
}

// ------------------------------------------------------------------ Yu-Gi-Oh! (YGOPRODeck)
export async function searchYugioh(name, number) {
  const d = await getJSON(ENDPOINTS.ygoSearch(name.trim()), "YGOPRODeck");
  const cards = (d && d.data) || [];
  const out = [];
  const code = number ? String(number).trim().toUpperCase() : "";
  const codeHit = (c) => (c.card_sets || []).some((s) => (s.set_code || "").toUpperCase().includes(code));
  const anyHit = code && cards.some(codeHit);
  for (const c of anyHit ? cards.filter(codeHit) : cards) {
    const cp = (c.card_prices && c.card_prices[0]) || {};
    const sets = c.card_sets || [];
    const pick = code ? sets.filter((s) => (s.set_code || "").toUpperCase().includes(code)) : [];
    const base = { game: "ygo", name: c.name, rarity: "", year: "", image: "", links: [{ label: "YGOPRODeck", url: c.ygoprodeck_url || `https://ygoprodeck.com/card/?search=${encodeURIComponent(c.name)}` }], errors: [], source: "YGOPRODeck" };
    const common = [];
    const add = (field, label, source) => {
      if (pos(num(cp[field]))) common.push({ key: `ygo-${field}`, label, variant: "Any printing", value: num(cp[field]), currency: field === "cardmarket_price" ? "EUR" : "USD", basis: "listing", source });
    };
    add("tcgplayer_price", "TCGplayer price (lowest across printings)", "TCGplayer via YGOPRODeck");
    add("cardmarket_price", "Cardmarket price (lowest across printings)", "Cardmarket via YGOPRODeck");
    add("ebay_price", "eBay listing price", "eBay via YGOPRODeck");
    for (const s of pick.length ? pick : []) {
      const prices = [];
      if (pos(num(s.set_price))) prices.push({ key: `ygo-set-${s.set_code}`, label: `Printing price ${s.set_rarity_code || "(" + s.set_rarity + ")"}`, variant: s.set_code, value: num(s.set_price), currency: "USD", basis: "listing", source: "TCGplayer via YGOPRODeck" });
      out.push({ ...base, id: `${c.id}:${s.set_code}:${s.set_rarity_code || ""}`, set: s.set_name, number: s.set_code, rarity: s.set_rarity, prices: [...prices, ...common] });
    }
    if (!pick.length) {
      const printings = sets.map((s) => ({ key: `ygo-set-${s.set_code}-${s.set_rarity_code}`, label: `${s.set_name} ${s.set_rarity_code || ""}`.trim(), variant: s.set_code, value: num(s.set_price), currency: "USD", basis: "listing", source: "TCGplayer via YGOPRODeck" })).filter((p) => pos(p.value));
      out.push({ ...base, id: String(c.id), set: sets.length ? `${sets.length} printing${sets.length === 1 ? "" : "s"}` : "", number: "", prices: [...common, ...printings.slice(0, 25)] });
    }
    if (out.length >= 30) break;
  }
  return out;
}

export async function search(game, name, number) {
  if (!name || !name.trim()) return [];
  if (game === "pokemon") return searchPokemon(name.trim(), number);
  if (game === "mtg") return searchMagic(name, number);
  if (game === "ygo") return searchYugioh(name, number);
  return [];
}

/** Retry with fewer words when a long name finds nothing ("Charizard Base Set" -> "Charizard"). */
export async function searchLoose(game, name, number) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  for (let n = words.length; n >= 1; n--) {
    const q = words.slice(0, n).join(" ");
    const r = await search(game, q, number);
    if (r.length) return { results: r, query: q };
    if (n > 3) n = 4; // jump quickly to short queries
  }
  return { results: [], query: words.join(" ") };
}

export async function detail(card) {
  if (card.game === "pokemon" && !card.prices) return pokemonDetail(card);
  return card;
}

// ------------------------------------------------------------------ FX (AUD base)
// Returns { USD: audPerUsd, EUR: audPerEur, GBP: ..., date, source }
export async function fetchFx() {
  try {
    const d = await getJSON(ENDPOINTS.fxFrankfurter, "Frankfurter", {}, 8000);
    if (d && d.rates && d.rates.USD) return toAud(d.rates, d.date, "Frankfurter (ECB)");
  } catch {}
  const d = await getJSON(ENDPOINTS.fxErApi, "ExchangeRate-API", {}, 8000);
  if (d && d.rates && d.rates.USD) return toAud(d.rates, (d.time_last_update_utc || "").slice(5, 16), "ExchangeRate-API");
  throw new SourceError("FX", "Exchange rates unavailable");
}

function toAud(rates, date, source) {
  const out = { AUD: 1, date, source, fetched: Date.now() };
  for (const c of ["USD", "EUR", "GBP"]) if (rates[c] > 0) out[c] = 1 / rates[c];
  return out;
}
