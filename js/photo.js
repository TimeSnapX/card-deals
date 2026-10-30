// Card Deal Checker: identify a card from a photo, on the device.
// OCR is Tesseract.js loaded from jsDelivr on first use (free, no key, the image
// never leaves the phone). Text is parsed into name / number / set code / grade,
// then fuzzy-matched against the same keyless catalogs the app already prices from
// (TCGdex for Pokémon, Scryfall for Magic, YGOPRODeck for Yu-Gi-Oh!).
// Nothing here fetches a price: pricing only happens after the user taps Confirm.

export const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

// ------------------------------------------------------------------ text helpers (pure)
export function levenshtein(a, b) {
  a = String(a); b = String(b);
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

export const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** 0..1 similarity of a catalog name to the best-matching window of OCR text. */
export function nameScore(name, text) {
  const n = norm(name);
  if (!n) return 0;
  const words = norm(text).split(" ").filter(Boolean);
  const k = n.split(" ").length;
  let best = 0;
  for (let w = Math.max(1, k - 1); w <= k + 1; w++) {
    for (let i = 0; i + w <= words.length; i++) {
      const win = words.slice(i, i + w).join(" ");
      const s = 1 - levenshtein(n, win) / Math.max(n.length, win.length);
      if (s > best) best = s;
    }
  }
  return best;
}

const GRADERS = "PSA|BGS|BECKETT|CGC|SGC|TAG|ACE";
const GRADE_WORDS = { "GEM MT": 10, "GEM MINT": 10, "PRISTINE": 10, "MINT": 9, "NM-MT": 8, "NM MT": 8, "NM": 7, "EX-MT": 6, "EX MT": 6, "EX": 5, "VG-EX": 4, "VG EX": 4, "VG": 3, "GOOD": 2, "PR": 1, "POOR": 1 };

/** Parse OCR text into { name, nameLines, number, total, setCode, grader, grade, gradeQualifier, cert, game }. */
export function parseOcr(raw) {
  const text = String(raw || "").replace(/[|]/g, "I");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const up = text.toUpperCase();
  const out = { name: "", nameLines: [], number: "", total: "", setCode: "", mtgSet: "", grader: "", grade: "", gradeQualifier: "", cert: "", game: "" };

  // Slab label: grader, grade, cert
  const gm = up.match(new RegExp(`\\b(${GRADERS})\\b`));
  if (gm) out.grader = gm[1] === "BECKETT" ? "BGS" : gm[1];
  const certLike = up.match(/(?:^|\s)(\d{8,10})(?:\s|$)/);
  if (out.grader || certLike) {
    const cert = up.match(/\b(\d{7,10})\b/);
    if (cert) out.cert = cert[1];
    const wordAlt = Object.keys(GRADE_WORDS).sort((a, b) => b.length - a.length).map((w) => w.replace(/[- ]/g, "[- ]?")).join("|");
    const gw = up.match(new RegExp(`\\b(${wordAlt})\\b[\\s\\n]*(10|[1-9])(?:\\.5)?\\s*(\\((?:MC|OC|ST|PD|OF|MK)\\))?`));
    const direct = up.match(new RegExp(`\\b(?:${GRADERS})\\s*(10|[1-9])(\\.5)?\\b`));
    const lone = up.match(/(?:^|\n)\s*(10|[1-9](?:\.5)?)\s*(\((?:MC|OC|ST|PD|OF|MK)\))?\s*(?:\n|$)/);
    const qual = up.match(/\b(?:[1-9]|10)\s*\((MC|OC|ST|PD|OF|MK)\)/);
    if (gw) out.grade = up.slice(gw.index + gw[1].length).match(/(10|[1-9])(\.5)?/)[0];
    else if (direct) out.grade = direct[1] + (direct[2] || "");
    else if (lone) out.grade = lone[1];
    else {
      // Grade word alone (OCR often loses the digit): PSA's words map to one number each.
      const wOnly = up.match(new RegExp(`\\b(${wordAlt})\\b`));
      if (wOnly && out.cert) out.grade = String(GRADE_WORDS[wOnly[1].replace(/[- ]+/, (x) => (wOnly[1].includes("-") ? "-" : " "))] || "");
    }
    if (qual) out.gradeQualifier = qual[1];
  }

  // Number: 123/198, 4/102, TG05/TG30, SV049/SV094
  const nm = text.match(/\b([A-Z]{0,3}\d{1,3}[a-z]?)\s*\/\s*([A-Z]{0,3}\d{2,3})\b/);
  if (nm) { out.number = nm[1]; out.total = nm[2].replace(/^[A-Z]+/, ""); }
  // Yu-Gi-Oh! set code LOB-005, MP22-EN001, RA01-EN054
  const yc = up.match(/\b([A-Z0-9]{2,4}-(?:EN|DE|FR|IT|SP|PT|JP|E)?\d{3})\b/);
  if (yc) out.setCode = yc[1];
  // Magic set code printed beside the language: "A25 • EN"
  const ms = up.match(/\b([A-Z0-9]{3,5})\s*[•*+·.]\s*EN\b/);
  if (ms) out.mtgSet = ms[1];
  // Slab "#4" card number
  if (!out.number) {
    const hn = up.match(/#\s*([A-Z]{0,3}\d{1,4})\b/);
    if (hn) out.number = hn[1];
  }

  // Game
  const pk = /\b(HP|POK[EÉ]MON|WEAKNESS|RESISTANCE|RETREAT|EVOLVES|STAGE ?[12]|BASIC)\b/.test(up);
  const yg = /\bATK\s*\/|\bDEF\s*\/|\[(?:SPELL|TRAP) CARD|EFFECT\]/.test(up) || !!out.setCode;
  const mt = /\b(CREATURE|INSTANT|SORCERY|ENCHANTMENT|ARTIFACT|PLANESWALKER|LEGENDARY|WIZARDS OF THE COAST)\b/.test(up) && !/\bPOK[EÉ]MON\b/.test(up);
  const sp = /\b(TOPPS|PANINI|PRIZM|BOWMAN|UPPER DECK|DONRUSS|SELECT|ROOKIE|RC)\b|\bT20\d|\bCAPORAL\b/.test(up);
  out.game = pk ? "pokemon" : yg ? "ygo" : mt ? "mtg" : sp ? "sports" : "";
  if (!out.game && out.cert && /\bT20\d|\b(19\d\d|20\d\d)\b/.test(up) && !/\bPOK/.test(up)) out.game = "sports";

  // Name candidates: lines that are mostly letters, minus card furniture
  const junk = /\b(HP|BASIC|STAGE|EVOLVES|FROM|WEAKNESS|RESISTANCE|RETREAT|ILLUS|ILLUSTRATOR|POKEMON|POKÉMON|NINTENDO|CREATURES|GAME ?FREAK|WIZARDS|COAST|PSA|BGS|CGC|SGC|CERT|GEM|MINT|NM|MT|EX|EN)\b/gi;
  for (const l of lines) {
    const clean = l.replace(/\b\w*\d\w*\b/g, " ").replace(/[^A-Za-zÀ-ÿ'’. \-]/g, " ").replace(junk, " ").split(/\s+/).filter((w) => w.length >= 3 && w.replace(/[^A-Za-zÀ-ÿ]/g, "").length >= 2).join(" ").trim();
    const rawLetters = l.replace(/[^A-Za-zÀ-ÿ]/g, "").length;
    const letters = clean.replace(/[^A-Za-zÀ-ÿ]/g, "").length;
    if (letters >= 4 && rawLetters / Math.max(1, l.replace(/\s/g, "").length) >= 0.6 && clean.split(" ").length <= 5) out.nameLines.push(clean);
  }
  out.name = out.nameLines[0] || "";
  return out;
}

// ------------------------------------------------------------------ image preprocessing (browser)
/** Load a File/Blob into a canvas: resize so the long side is ≤ maxSide, rotate, crop (fractions), grayscale + contrast stretch. */
export async function preprocess(file, { rotate = 0, crop = null, maxSide = 1600, gray = true } = {}) {
  const bmp = await createImageBitmap(file);
  let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
  if (crop) { sx = crop.x * bmp.width; sy = crop.y * bmp.height; sw = crop.w * bmp.width; sh = crop.h * bmp.height; }
  const scale = Math.min(1, maxSide / Math.max(sw, sh)) * (Math.max(sw, sh) < 900 ? 900 / Math.max(sw, sh) : 1);
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const swap = rotate % 180 !== 0;
  const c = document.createElement("canvas");
  c.width = swap ? h : w; c.height = swap ? w : h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.translate(c.width / 2, c.height / 2);
  g.rotate((rotate * Math.PI) / 180);
  g.drawImage(bmp, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
  if (bmp.close) bmp.close();
  if (gray) {
    const img = g.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = y; hist[y]++; }
    const total = d.length / 4;
    let lo = 0, hi = 255, acc = 0;
    while (lo < 255 && (acc += hist[lo]) < total * 0.02) lo++;
    acc = 0;
    while (hi > 0 && (acc += hist[hi]) < total * 0.02) hi--;
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span)); d[i] = d[i + 1] = d[i + 2] = v; }
    g.putImageData(img, 0, 0);
  }
  return c;
}

// ------------------------------------------------------------------ OCR (browser)
let workerP = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement("script");
    s.src = src; s.async = true; s.crossOrigin = "anonymous";
    s.onload = () => res(); s.onerror = () => rej(new Error("Couldn't load the text reader (check your connection)"));
    document.head.appendChild(s);
  });
}
export async function ocr(canvas, onProgress) {
  if (!workerP) {
    workerP = (async () => {
      await loadScript(TESSERACT_URL);
      return window.Tesseract.createWorker("eng", 1, { logger: (m) => onProgress && onProgress(m) });
    })().catch((e) => { workerP = null; throw e; });
  }
  const worker = await workerP;
  const { data } = await worker.recognize(canvas);
  return data.text || "";
}

// ------------------------------------------------------------------ catalog matching
/** Rank catalog candidates for parsed OCR fields. S = sources module. Returns { game, candidates:[{card, score}] } without prices shown. */
export async function findCandidates(S, parsed, text, gameHint) {
  const game = gameHint || parsed.game || "pokemon";
  let pool = [];
  const errors = [];
  const tryAdd = async (fn) => { try { pool.push(...((await fn()) || [])); } catch (e) { errors.push(e.message); } };
  if (game === "pokemon") {
    if (parsed.number) await tryAdd(() => S.pokemonByNumber(parsed.number, parsed.total));
    const words = [...new Set(parsed.nameLines.join(" ").split(" ").filter((w) => w.replace(/[^A-Za-z]/g, "").length >= 4))].slice(0, 4);
    if (pool.length < 2) for (const w of words) await tryAdd(() => S.searchPokemon(w.replace(/[^A-Za-zÀ-ÿ'’. -]/g, ""), parsed.number));
  } else if (game === "mtg") {
    for (const line of parsed.nameLines.slice(0, 4)) {
      let fixed = null;
      try { fixed = await S.scryfallFuzzyName(line); } catch {}
      if (fixed) {
        if (parsed.mtgSet) await tryAdd(() => S.searchMagic(`!"${fixed}" set:${parsed.mtgSet.toLowerCase()}`, parsed.number));
        if (!pool.length) await tryAdd(() => S.searchMagic(`!"${fixed}"`, ""));
        break;
      }
    }
  } else if (game === "ygo") {
    for (const line of parsed.nameLines.slice(0, 3)) {
      await tryAdd(() => S.searchYugioh(line.split(" ").slice(0, 3).join(" "), parsed.setCode));
      if (pool.length) break;
    }
  }
  const seen = new Set();
  pool = pool.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));
  const lid = (s) => String(s || "").replace(/^0+(?=\d)/, "").toLowerCase();
  const ranked = pool
    .map((card) => {
      let score = nameScore(card.name, text);
      if (parsed.number && lid(card.number) === lid(parsed.number)) score += 0.3;
      if (parsed.setCode && String(card.number || "").toUpperCase() === parsed.setCode) score += 0.3;
      return { card, score: Math.round(score * 100) / 100 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  return { game, candidates: ranked, errors };
}
