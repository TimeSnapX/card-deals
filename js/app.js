// Card Deal Checker: UI. Read-only; all prices fetched from keyless public APIs.
import * as C from "./core.js?v=1";
import * as S from "./sources.js?v=1";

// Register the service worker first, independent of any data loading.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = C.fmtAUD;
const pct = (x, dp = 1) => (Number.isFinite(x) ? `${x >= 0 ? "" : "−"}${Math.abs(x).toFixed(dp)}%` : "–");
const numVal = (el) => {
  const v = parseFloat(String(el.value).replace(/,/g, ""));
  return Number.isFinite(v) ? v : NaN;
};

// ------------------------------------------------------------------ storage
const LS = { watch: "cdc.watch.v1", settings: "cdc.settings.v1", fx: "cdc.fx.v1" };
const DEFAULT_SETTINGS = { gradingFee: 45, gradeShipping: 40, sellFeePct: 13, fxUSD: null, fxEUR: null };
function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
let settings = { ...DEFAULT_SETTINGS, ...load(LS.settings, {}) };
let watch = (() => {
  try {
    return C.normaliseWatch(load(LS.watch, []));
  } catch {
    return [];
  }
})();

// ------------------------------------------------------------------ FX
let fx = null; // { USD, EUR, GBP, date, source }
function rate(cur) {
  if (cur === "AUD") return 1;
  if (fx && fx[cur] > 0) return fx[cur];
  if (cur === "USD" && settings.fxUSD > 0) return settings.fxUSD;
  if (cur === "EUR" && settings.fxEUR > 0) return settings.fxEUR;
  return NaN;
}
const toAUD = (value, cur) => value * rate(cur);
function fxLine() {
  const el = $("#fx-line");
  if (fx) el.textContent = `Exchange rates: 1 USD = A$${fx.USD.toFixed(4)}, 1 EUR = A$${fx.EUR.toFixed(4)} (${fx.source}, ${fx.date}${fx.stale ? ", saved copy" : ""}).`;
  else if (settings.fxUSD > 0) el.textContent = `Live exchange rates unavailable: using your backup rate 1 USD = A$${settings.fxUSD}.`;
  else el.textContent = "Live exchange rates unavailable. Set backup rates in Settings to convert USD/EUR prices.";
}
async function loadFx() {
  const cached = load(LS.fx, null);
  if (cached && cached.USD && Date.now() - cached.fetched < 6 * 3600e3) {
    fx = cached;
    fxLine();
    return;
  }
  try {
    fx = await S.fetchFx();
    save(LS.fx, fx);
  } catch {
    fx = cached ? { ...cached, stale: true } : null;
  }
  fxLine();
  if (current.card) renderPrices();
}

// ------------------------------------------------------------------ tabs
function showView(name) {
  for (const t of $$(".tab")) t.setAttribute("aria-selected", String(t.dataset.view === name));
  for (const v of $$("[data-view-panel]")) v.hidden = v.dataset.viewPanel !== name;
  window.scrollTo({ top: 0 });
}
for (const t of $$(".tab")) t.addEventListener("click", () => showView(t.dataset.view));

// ------------------------------------------------------------------ check: game + search
const current = { game: "pokemon", results: [], card: null, priceKey: null, listing: null };
function setGame(game) {
  current.game = game;
  for (const b of $$("#game-seg [data-game]")) b.setAttribute("aria-checked", String(b.dataset.game === game));
  const manual = game === "sports" || game === "other";
  $("#sports-box").hidden = !manual;
  $("#search-btn").hidden = manual;
  $("#q-number").closest(".field").hidden = manual;
  $("#q-number").placeholder = game === "ygo" ? "LOB-005" : game === "mtg" ? "Collector no. e.g. 161" : "4/102";
  if (manual) {
    $("#results").innerHTML = "";
    $("#search-status").textContent = "";
    $("#card-panel").hidden = true;
    $("#ask-panel").hidden = true;
    renderLinks($("#sports-links"), C.soldSearchLinks(manualQuery() || "card"));
  }
}
for (const b of $$("#game-seg [data-game]")) b.addEventListener("click", () => setGame(b.dataset.game));

function manualQuery() {
  const L = current.listing;
  const name = $("#q-name").value.trim();
  if (L && L.text && (!name || L.name === name)) return L.text;
  return name;
}
$("#q-name").addEventListener("input", () => {
  if (current.game === "sports" || current.game === "other") renderLinks($("#sports-links"), C.soldSearchLinks(manualQuery() || "card"));
});

function renderLinks(el, links) {
  el.innerHTML = links.map((l) => `<a class="chip-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join("");
}

$("#read-listing").addEventListener("click", () => {
  const raw = $("#paste").value;
  const L = C.parseListing(raw);
  current.listing = L;
  const box = $("#listing-read");
  if (!L.text) {
    box.hidden = false;
    box.innerHTML = `<p>${esc((L.flags[0] && L.flags[0].text) || "Paste a listing title first.")}</p>`;
    return;
  }
  const game = L.game === "other" ? "sports" : L.game;
  $("#q-name").value = L.name;
  $("#q-number").value = L.number || "";
  $("#cond").value = L.grader ? "graded" : "nm";
  setGame(game);
  const facts = [
    ["Type", { pokemon: "Pokémon", mtg: "Magic", ygo: "Yu-Gi-Oh!", sports: "Sports", other: "Other" }[L.game]],
    ["Name", L.name || "?"],
    L.year && ["Year", L.year],
    L.number && ["Number", L.number],
    L.grader && ["Grade", `${L.grader} ${L.grade}`],
    L.firstEdition && ["Edition", "1st Edition"],
  ].filter(Boolean);
  box.hidden = false;
  box.innerHTML = `<dl>${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` +
    (L.flags.length ? `<ul class="flags">${L.flags.map((f) => `<li class="flag-${esc(f.key)}">${esc(f.text)}</li>`).join("")}</ul>` : "") +
    (L.grader && game !== "sports" ? `<p class="hint">Graded: the live prices are for raw cards, so check this one with Comps.</p>` : "") +
    (L.fromUrl ? `<p class="hint">Read from the link's text only. The app can't open listing pages.</p>` : "");
  $("#c-name").value = L.text;
  $("#g-name").value = L.text;
  renderAllLinks();
  if (game !== "sports" && L.name) $("#search-form").requestSubmit();
});

$("#search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (current.game === "sports" || current.game === "other") return;
  const name = $("#q-name").value.trim();
  const number = $("#q-number").value.trim();
  if (!name) return;
  const status = $("#search-status");
  status.className = "status";
  status.textContent = "Searching…";
  $("#results").innerHTML = "";
  $("#card-panel").hidden = true;
  $("#ask-panel").hidden = true;
  try {
    const { results, query } = await S.searchLoose(current.game, name, number);
    current.results = results;
    if (!results.length) {
      status.textContent = `No cards found for “${name}”. Check the spelling, or use Comps.`;
      return;
    }
    status.textContent = `${results.length} card${results.length === 1 ? "" : "s"}${query !== name ? ` for “${query}”` : ""}. Tap the right one.`;
    renderResults();
    if (results.length === 1) selectCard(0);
  } catch (err) {
    status.className = "status error";
    status.textContent = `${err.message}. Try again in a minute, or use Comps.`;
  }
});

function renderResults() {
  $("#results").innerHTML = current.results
    .map((c, i) => `<li><button type="button" class="result" data-i="${i}">
      ${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy" width="46" height="64" />` : `<span class="noimg" aria-hidden="true">🂠</span>`}
      <span><b>${esc(c.name)}</b><small>${esc([c.set, c.number && `#${c.number}`, c.rarity, c.year].filter(Boolean).join(" · "))}</small></span></button></li>`)
    .join("");
  for (const b of $$("#results .result")) b.addEventListener("click", () => selectCard(Number(b.dataset.i)));
}

async function selectCard(i) {
  let card = current.results[i];
  for (const b of $$("#results .result")) b.classList.toggle("on", Number(b.dataset.i) === i);
  $("#card-panel").hidden = false;
  $("#card-status").className = "status";
  $("#card-status").textContent = card.prices ? "" : "Loading prices…";
  current.card = card;
  current.priceKey = null;
  renderCard();
  if (!card.prices) {
    card = await S.detail(card);
    current.results[i] = card;
    if (current.card && current.card.id !== card.id) return;
    current.card = card;
  }
  renderCard();
  $("#ask-panel").hidden = false;
  $("#card-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function defaultPriceKey(card) {
  const ps = card.prices || [];
  const sold = ps.filter((p) => p.basis === "sold");
  return (sold[0] || ps[0] || {}).key || null;
}

function renderCard() {
  const c = current.card;
  if (!c) return;
  $("#card-name").textContent = c.name;
  $("#card-meta").textContent = [c.set, c.number && `#${c.number}`, c.rarity, c.year].filter(Boolean).join(" · ");
  const img = $("#card-img");
  if (c.image) {
    img.src = c.image;
    img.hidden = false;
  } else img.hidden = true;
  renderLinks($("#card-links"), c.links || []);
  const q = [c.name, c.set, c.number].filter(Boolean).join(" ");
  renderLinks($("#card-sold-links"), C.soldSearchLinks(q).slice(0, 3));
  $("#c-name").value = $("#c-name").value || q;
  $("#g-name").value = $("#g-name").value || q;
  renderAllLinks();
  if (!c.prices) return;
  if (!current.priceKey) current.priceKey = defaultPriceKey(c);
  const st = $("#card-status");
  if (!c.prices.length) {
    st.className = "status warn";
    st.textContent = "Not enough data: no free source has a price for this card." + (c.errors && c.errors.length ? ` (${c.errors.join("; ")})` : "") + " Use Comps with recent sold prices.";
  } else {
    st.className = "status";
    st.textContent = c.errors && c.errors.length ? `Some sources failed: ${c.errors.join("; ")}` : "";
  }
  renderPrices();
}

function renderPrices() {
  const c = current.card;
  const tb = $("#prices tbody");
  $("#price-wrap").hidden = !(c && c.prices && c.prices.length);
  if (!c || !c.prices) return;
  tb.innerHTML = c.prices
    .map((p) => {
      const aud = toAUD(p.value, p.currency);
      const on = p.key === current.priceKey;
      return `<tr data-key="${esc(p.key)}" class="${on ? "on" : ""}" tabindex="0" aria-selected="${on}">
        <td><span class="radio" aria-hidden="true"></span></td>
        <td>${esc(p.label)}<small>${esc(p.variant)} · ${esc(p.source)}</small><span class="badge ${p.basis}">${p.basis}</span></td>
        <td class="num">${esc(p.currency)} ${p.value.toFixed(2)}</td>
        <td class="num">${Number.isFinite(aud) ? fmt(aud) : "–"}</td></tr>`;
    })
    .join("");
  for (const tr of $$("#prices tbody tr")) {
    const pick = () => {
      current.priceKey = tr.dataset.key;
      renderPrices();
      if ($("#verdict-check").innerHTML) $("#ask-form").requestSubmit();
    };
    tr.addEventListener("click", pick);
    tr.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick()));
  }
}

/** The chosen market price in AUD, plus how well a second source family agrees. */
function marketRef() {
  const c = current.card;
  if (!c || !c.prices || !c.prices.length) return null;
  const p = c.prices.find((x) => x.key === current.priceKey) || c.prices[0];
  const value = toAUD(p.value, p.currency);
  if (!Number.isFinite(value)) return { missingFx: p.currency };
  const fam = (x) => x.source.split(" via ")[0];
  const other = c.prices.find((x) => x.basis === "sold" && fam(x) !== fam(p) && (x.variant === p.variant || /Normal\/holo|Any printing/.test(x.variant) || /Normal\/holo|Any printing/.test(p.variant)));
  const ov = other ? toAUD(other.value, other.currency) : NaN;
  return { value, basis: p.basis, agreement: p.basis === "sold" && Number.isFinite(ov) ? C.agreement(value, ov) : null, point: p, other };
}

$("#ask-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const ref = marketRef();
  const out = $("#verdict-check");
  if (ref && ref.missingFx) {
    out.innerHTML = `<div class="verdict nodata"><h3>Need an exchange rate</h3><p>Live ${esc(ref.missingFx)}→AUD rates didn't load. Set a backup rate in Settings.</p></div>`;
    return;
  }
  const r = C.evaluate({ mode: "market", ask: numVal($("#ask")), shipping: numVal($("#ship")) || 0, condition: $("#cond").value, market: ref });
  out.innerHTML = verdictHTML(r, ref ? `${ref.point.label} (${ref.point.variant})` : "");
  wireVerdict(out, r, "check");
});

function verdictHTML(r, refLabel) {
  if (r.status === "need-ask") return `<p class="status warn">${esc(r.notes[0])}</p>`;
  if (r.status === "no-data")
    return `<div class="verdict nodata" data-band="nodata"><h3>Not enough data</h3>${r.notes.map((n) => `<p>${esc(n)}</p>`).join("")}
      <div class="row-actions"><button class="btn" type="button" data-act="to-comps">Use comps</button></div></div>`;
  const P = r.parts;
  return `<div class="verdict band-${r.band.key}" data-band="${r.band.key}">
    <div class="v-top"><h3 class="v-band">${esc(r.band.label)}</h3><div class="score" aria-label="Deal score"><b class="v-score">${r.score}</b><small>/100</small></div></div>
    <p class="v-main"><b class="v-pct">${r.discountPct >= 0 ? pct(r.discountPct) + " under" : pct(-r.discountPct) + " over"}</b> ${r.stats ? "the median sold price" : "market"}</p>
    <dl class="v-grid">
      <div><dt>You pay (incl. shipping)</dt><dd class="v-cost">${fmt(r.cost)}</dd></div>
      <div><dt>${r.stats ? "Median sold" : "Market"}</dt><dd class="v-ref">${fmt(r.ref)}</dd></div>
      <div><dt>${r.savings >= 0 ? "Below market by" : "Above market by"}</dt><dd>${fmt(Math.abs(r.savings))}</dd></div>
      <div><dt>Score parts</dt><dd>discount ${P.discount.toFixed(0)} · data ${P.liquidity} · consistency ${P.consistency}</dd></div>
    </dl>
    ${refLabel ? `<p class="hint">Reference: ${esc(refLabel)}</p>` : ""}
    ${r.notes.length ? `<ul class="notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    <div class="row-actions">
      <button class="btn" type="button" data-act="watch">Add to watchlist</button>
      <button class="btn" type="button" data-act="grade">Grading upside</button>
    </div></div>`;
}

function wireVerdict(root, r, from) {
  const b = (act) => root.querySelector(`[data-act="${act}"]`);
  if (b("to-comps")) b("to-comps").addEventListener("click", () => goComps());
  if (b("watch")) b("watch").addEventListener("click", () => addWatchFromVerdict(r, from));
  if (b("grade")) b("grade").addEventListener("click", () => {
    $("#g-cost").value = r.cost.toFixed(2);
    if (!$("#g-low").value && r.ref) $("#g-low").value = r.ref.toFixed(2);
    renderGradeCosts();
    showView("grading");
  });
}

function goComps() {
  const c = current.card;
  if (!$("#c-name").value) $("#c-name").value = c ? [c.name, c.set, c.number].filter(Boolean).join(" ") : manualQuery();
  if ($("#ask").value && !$("#c-ask").value) $("#c-ask").value = $("#ask").value;
  if ($("#ship").value && !$("#c-ship").value) $("#c-ship").value = $("#ship").value;
  renderAllLinks();
  showView("comps");
}
$("#sports-to-comps").addEventListener("click", () => {
  $("#c-name").value = manualQuery() || $("#c-name").value;
  goComps();
});

// ------------------------------------------------------------------ comps
function compsAUD() {
  const cur = $("#c-cur").value;
  const raw = C.parsePrices($("#c-prices").value);
  const r = rate(cur);
  return { raw, aud: Number.isFinite(r) ? raw.map((v) => v * r) : [], cur, ok: Number.isFinite(r) };
}
function renderParsed() {
  const { raw, aud, cur, ok } = compsAUD();
  $("#c-parsed").textContent = !raw.length ? "0 prices" : `${raw.length} price${raw.length === 1 ? "" : "s"}: ${raw.map((v) => v.toFixed(2)).join(", ")} ${cur}` + (cur !== "AUD" ? (ok ? ` = ${aud.map((v) => fmt(v)).join(", ")}` : " (no exchange rate)") : "");
}
$("#c-prices").addEventListener("input", renderParsed);
$("#c-cur").addEventListener("change", renderParsed);
$("#c-name").addEventListener("input", renderAllLinks);
$("#g-name").addEventListener("input", renderAllLinks);
function renderAllLinks() {
  renderLinks($("#comps-links"), C.soldSearchLinks($("#c-name").value || "card").slice(0, 3));
  const g = $("#g-name").value.replace(/\b(PSA|BGS|CGC|SGC)\s*\d+(\.5)?\b/gi, "").trim() || "card";
  renderLinks($("#grade-links"), [
    { label: "PSA 10 sold (130point)", url: `https://130point.com/sales/?q=${encodeURIComponent(g + " PSA 10")}` },
    { label: "PSA 9 sold (130point)", url: `https://130point.com/sales/?q=${encodeURIComponent(g + " PSA 9")}` },
    { label: "PSA pop report", url: "https://www.psacard.com/pop" },
  ]);
}

$("#comps-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const { aud, ok, cur } = compsAUD();
  const out = $("#verdict-comps");
  if (!ok) {
    out.innerHTML = `<div class="verdict nodata"><h3>Need an exchange rate</h3><p>${esc(cur)}→AUD rate unavailable. Enter prices in AUD or set a backup rate in Settings.</p></div>`;
    return;
  }
  const r = C.evaluate({ mode: "comps", ask: numVal($("#c-ask")), shipping: numVal($("#c-ship")) || 0, comps: aud });
  const st = r.stats || C.compsStats(aud);
  $("#comps-stats").innerHTML = st.n
    ? `<dl class="stats">
      <div><dt>Sales</dt><dd class="s-n">${st.n}</dd></div>
      <div><dt>Median</dt><dd class="s-median">${fmt(st.median)}</dd></div>
      <div><dt>Trimmed mean${st.trimmed ? ` (drops ${st.trimmed} high + ${st.trimmed} low)` : ""}</dt><dd class="s-tmean">${fmt(st.trimmedMean)}</dd></div>
      <div><dt>Average</dt><dd>${fmt(st.mean)}</dd></div>
      <div><dt>Range</dt><dd>${fmt(st.min)} – ${fmt(st.max)}</dd></div>
      <div><dt>Spread</dt><dd class="s-cv">${Number.isFinite(st.cv) ? pct(st.cv * 100, 0) : "–"}</dd></div></dl>`
    : "";
  out.innerHTML = verdictHTML(r, "");
  wireVerdict(out, r, "comps");
});

// ------------------------------------------------------------------ grading
function renderGradeCosts() {
  $("#g-costs").innerHTML = `Using grading fee ${fmt(settings.gradingFee)}, shipping &amp; insurance ${fmt(settings.gradeShipping)}, selling fees ${settings.sellFeePct}% (change in Settings). PSA 8 or lower chance = whatever is left.`;
}
$("#grade-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const cost = numVal($("#g-cost"));
  const low = numVal($("#g-low"));
  const g = C.gradingEV({
    cost,
    v10: numVal($("#g-10")),
    v9: numVal($("#g-9")),
    vLow: Number.isFinite(low) ? low : cost,
    p10: (numVal($("#g-p10")) || 0) / 100,
    p9: (numVal($("#g-p9")) || 0) / 100,
    gradingFee: settings.gradingFee,
    shipping: settings.gradeShipping,
    sellFeePct: settings.sellFeePct,
  });
  const out = $("#grade-out");
  if (g.status !== "ok") {
    out.innerHTML = `<div class="verdict nodata"><h3>${g.status === "no-data" ? "Not enough data" : "Check the chances"}</h3><p>${esc(g.notes[0])}</p></div>`;
    return;
  }
  const worth = g.ev > 0;
  const be = g.breakEvenP10;
  const beText = be == null ? "–" : be <= 0 ? "0% (profitable even with no PSA 10)" : be > g.maxP10 ? "not reachable with this PSA 9 chance" : pct(be * 100, 1);
  out.innerHTML = `<div class="verdict ${worth ? "band-good" : "band-over"}" data-band="${worth ? "worth" : "not"}">
    <div class="v-top"><h3 class="g-verdict">${worth ? "Worth grading" : "Not worth grading"}</h3></div>
    <p class="v-main">Expected profit <b class="g-ev">${fmt(g.ev)}</b> (${pct(g.roiPct, 0)} on ${fmt(g.cost)})</p>
    <dl class="v-grid">
      <div><dt>Expected sale value</dt><dd class="g-gross">${fmt(g.gross)}</dd></div>
      <div><dt>After selling fees</dt><dd class="g-net">${fmt(g.net)}</dd></div>
      <div><dt>Total cost (card + grading + shipping)</dt><dd class="g-cost">${fmt(g.cost)}</dd></div>
      <div><dt>Break-even PSA 10 chance</dt><dd class="g-be">${beText}</dd></div>
      <div><dt>PSA 8 or lower chance</dt><dd>${pct(g.pLow * 100, 0)}</dd></div>
    </dl>
    <p class="hint">Expected value is an average over many cards, not a promise for one. Be honest with the PSA 10 chance: centring, corners, surface and print lines all count.</p></div>`;
});

// ------------------------------------------------------------------ watchlist
function persistWatch() {
  save(LS.watch, watch);
  renderWatch();
}
function addWatchFromVerdict(r, from) {
  const c = from === "check" ? current.card : null;
  const ref = from === "check" ? marketRef() : null;
  const name = c ? c.name : $("#c-name").value.trim() || "Card";
  const target = prompt(`Most you'd pay for “${name}” (A$)?`, (r.ref * 0.8).toFixed(2));
  if (target === null) return;
  const item = C.normaliseWatch([{
    name,
    game: c ? c.game : current.game === "sports" ? "sports" : "other",
    detail: c ? [c.set, c.number && `#${c.number}`, c.rarity].filter(Boolean).join(" · ") : "",
    grade: from === "check" ? $("#cond").selectedOptions[0].textContent : "",
    target: parseFloat(target),
    ref: r.ref,
    refNote: from === "check" && ref ? `${ref.point.label} (${ref.point.variant})` : `median of ${r.stats ? r.stats.n : 0} sold`,
    sourceId: c ? JSON.stringify({ g: c.game, id: c.id, name: c.name, number: c.number, key: current.priceKey }) : null,
    notes: from === "check" ? "" : `Comps: ${C.parsePrices($("#c-prices").value).join(", ")} ${$("#c-cur").value}`,
  }])[0];
  watch.unshift(item);
  persistWatch();
  flashStatus($("#watch-status"), `Added ${name}.`);
  showView("watch");
}
$("#watch-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const item = C.normaliseWatch([{ name: $("#w-name").value, game: $("#w-game").value, target: numVal($("#w-target")), notes: $("#w-notes").value }])[0];
  if (!item) return;
  watch.unshift(item);
  persistWatch();
  e.target.reset();
});
function renderWatch() {
  $("#watch-count").textContent = watch.length ? String(watch.length) : "";
  const ul = $("#watch-list");
  if (!watch.length) {
    ul.innerHTML = `<li class="empty">Nothing yet. Check a card and tap <b>Add to watchlist</b>, or add one by hand below.</li>`;
    return;
  }
  ul.innerHTML = watch
    .map((w) => {
      const gap = w.ref && w.target ? ((w.ref - w.target) / w.ref) * 100 : NaN;
      return `<li data-id="${esc(w.id)}">
        <div class="w-main"><b>${esc(w.name)}</b><small>${esc([w.detail, w.grade].filter(Boolean).join(" · "))}</small>
        <span class="w-nums">Target <b class="w-target">${w.target ? fmt(w.target) : "–"}</b>${w.ref ? ` · Market ${fmt(w.ref)}${Number.isFinite(gap) ? ` (target ${gap >= 0 ? pct(gap, 0) + " below" : pct(-gap, 0) + " above"})` : ""}` : ""}</span>
        ${w.refNote ? `<small>${esc(w.refNote)} · ${esc(new Date(w.updated).toLocaleDateString("en-AU"))}</small>` : ""}
        ${w.notes ? `<small>${esc(w.notes)}</small>` : ""}</div>
        <div class="w-actions">
          <button class="btn small" type="button" data-w="target">Edit target</button>
          <button class="btn small" type="button" data-w="links">Sold search</button>
          <button class="btn small danger" type="button" data-w="remove">Remove</button>
        </div></li>`;
    })
    .join("");
  for (const li of $$("#watch-list li[data-id]")) {
    const w = watch.find((x) => x.id === li.dataset.id);
    li.querySelector('[data-w="target"]').addEventListener("click", () => {
      const v = prompt(`New target buy price for “${w.name}” (A$)`, w.target || "");
      if (v === null) return;
      w.target = Number(v) > 0 ? C.round2(Number(v)) : null;
      w.updated = new Date().toISOString();
      persistWatch();
    });
    li.querySelector('[data-w="links"]').addEventListener("click", () => {
      window.open(C.soldSearchLinks(`${w.name} ${w.detail.split(" · ").slice(0, 2).join(" ")}`)[0].url, "_blank", "noopener");
    });
    li.querySelector('[data-w="remove"]').addEventListener("click", () => {
      if (!confirm(`Remove “${w.name}” from the watchlist?`)) return;
      watch = watch.filter((x) => x.id !== w.id);
      persistWatch();
    });
  }
}
function flashStatus(el, text, cls = "") {
  el.className = `status ${cls}`;
  el.textContent = text;
}
$("#watch-refresh").addEventListener("click", async () => {
  const linked = watch.filter((w) => w.sourceId);
  const st = $("#watch-status");
  if (!linked.length) return flashStatus(st, "Only cards added from a live-price check can refresh. Update comps cards by hand.");
  flashStatus(st, `Refreshing ${linked.length}…`);
  let ok = 0, fail = 0;
  for (const w of linked) {
    try {
      const s = JSON.parse(w.sourceId);
      const list = await S.search(s.g, s.name, s.g === "mtg" ? s.number : s.g === "ygo" ? s.number : s.number);
      let card = list.find((c) => c.id === s.id);
      if (!card) throw new Error("not found");
      card = await S.detail(card);
      const p = card.prices.find((x) => x.key === s.key) || card.prices.find((x) => x.basis === "sold") || card.prices[0];
      const aud = p ? toAUD(p.value, p.currency) : NaN;
      if (!Number.isFinite(aud)) throw new Error("no price");
      w.ref = C.round2(aud);
      w.refNote = `${p.label} (${p.variant})`;
      w.updated = new Date().toISOString();
      ok++;
    } catch {
      fail++;
    }
  }
  persistWatch();
  flashStatus(st, `Updated ${ok}${fail ? `, ${fail} couldn't refresh` : ""}.`, fail ? "warn" : "");
});
$("#watch-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ app: "card-deals", version: 1, exported: new Date().toISOString(), watchlist: watch }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `card-deals-watchlist-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
});
$("#watch-import").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const st = $("#watch-status");
  try {
    const data = JSON.parse(await f.text());
    const res = C.mergeWatch(watch, Array.isArray(data) ? data : data.watchlist);
    watch = res.list;
    persistWatch();
    flashStatus(st, `Imported: ${res.added} new, ${res.replaced} updated.`);
  } catch (err) {
    flashStatus(st, `That file isn't a Card Deal Checker watchlist (${err.message}).`, "error");
  }
});

// ------------------------------------------------------------------ settings
const dlg = $("#settings");
$("#open-settings").addEventListener("click", () => {
  $("#s-fee").value = settings.gradingFee;
  $("#s-ship").value = settings.gradeShipping;
  $("#s-sell").value = settings.sellFeePct;
  $("#s-usd").value = settings.fxUSD || "";
  $("#s-eur").value = settings.fxEUR || "";
  dlg.showModal();
});
dlg.addEventListener("close", () => {
  if (dlg.returnValue !== "save") return;
  const n = (id, d) => (Number.isFinite(numVal($(id))) && numVal($(id)) >= 0 ? numVal($(id)) : d);
  settings = {
    gradingFee: n("#s-fee", DEFAULT_SETTINGS.gradingFee),
    gradeShipping: n("#s-ship", DEFAULT_SETTINGS.gradeShipping),
    sellFeePct: n("#s-sell", DEFAULT_SETTINGS.sellFeePct),
    fxUSD: numVal($("#s-usd")) > 0 ? numVal($("#s-usd")) : null,
    fxEUR: numVal($("#s-eur")) > 0 ? numVal($("#s-eur")) : null,
  };
  save(LS.settings, settings);
  renderGradeCosts();
  fxLine();
  renderParsed();
  if (current.card) renderPrices();
});

// ------------------------------------------------------------------ boot
setGame("pokemon");
renderWatch();
renderGradeCosts();
renderAllLinks();
renderParsed();
loadFx();
window.__cdc = { core: C, get state() { return { current, watch, settings, fx }; } };
