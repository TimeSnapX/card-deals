# Card Deal Checker

Live: https://timesnapx.github.io/card-deals/

A phone-first, installable (PWA) deal checker for trading cards. Enter a card and an
asking price, or paste a listing title, and it compares the price against recent
sold/market prices, converted to AUD. Strictly read-only: no buying, bidding, sign-in,
or keys. Watchlist and settings live in this browser's localStorage only.

## Price sources (all keyless, called from the browser)

| Card type | Source | What the price is |
|---|---|---|
| Pokémon | [TCGdex](https://tcgdex.dev) (search + prices), fallback [pokemontcg.io](https://pokemontcg.io) | TCGplayer market price (based on recent sales, USD), TCGplayer lowest listing, Cardmarket 30/7-day average sale, trend and lowest listing (EUR) |
| Magic | [Scryfall](https://scryfall.com/docs/api) | TCGplayer market (USD), Cardmarket trend (EUR), non-foil/foil/etched |
| Yu-Gi-Oh! | [YGOPRODeck](https://ygoprodeck.com/api-guide/) | Per-printing TCGplayer price and lowest prices across printings. These are asking prices, not sales, and the app says so |
| Sports & anything else | none free | Manual comps: paste 3+ recent sold prices (links open eBay AU/US sold search and 130point in your browser) |
| Graded prices (PSA 9/10) | none free | Entered by hand in Grading |

Exchange rates: Frankfurter (ECB), fallback ExchangeRate-API open endpoint, cached 6 h;
backup rates can be set in Settings.

Not used: eBay sold listings (blocked, and robots/ToS forbid automated access),
130point and PSA pop report (Cloudflare bot protection), PriceCharting API (paid token),
TCGCSV (no CORS, so not callable from a static page).

## Maths

- Cost = asking price + shipping. Discount = (reference − cost) / reference.
- Reference: chosen live price × condition factor (NM 1, LP 0.85, MP 0.70, HP 0.50), or the
  **median** of comps. Comps also show a trimmed mean (drops floor(20%) each end when n ≥ 5).
- Verdict: ≥30% under Strong deal · 15–30% Good deal · 5–15% Slightly under · ±5% About
  market · 5–20% over Above market · more Overpriced.
- Deal score /100 = discount (0–60, linear from −20% to +50%) + data depth (0–25) +
  consistency (0–15). See the Tips tab for the exact table.
- Grading EV = (p10·PSA10 + p9·PSA9 + rest·PSA≤8) × (1 − selling fee) − (card + grading fee +
  shipping). Break-even PSA 10 chance holds the PSA 9 chance fixed.

## Develop

```bash
node tests/server.mjs            # http://127.0.0.1:4741/card-deals/
node tests/unit.mjs              # maths, parser, watchlist
node tests/e2e.mjs               # headless Chrome, phone viewport, mocked APIs, PWA checks
node tests/live-smoke.mjs [url]  # real APIs
```
Tests need `playwright-core` (looked up from /workspace/tools, or `PLAYWRIGHT_DIR`) and Chrome.
