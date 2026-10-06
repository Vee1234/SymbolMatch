// Cloudflare Worker entry point. Static files in src/client are served directly by
// Cloudflare; only /api/* requests reach this code (see run_worker_first in wrangler.jsonc).

import { DeckGenerator, SUPPORTED_SYMBOLS_PER_CARD, deckSizeFor } from "../client/shared/generator.js";

const MAX_CARDS = 57;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // GET /api/deck?symbolsPerCard=8 -> { q, cards }, where symbols are ids 0..n-1.
    // Phones map ids to emoji (or, later, the player's own photos).
    if (url.pathname === "/api/deck" && request.method === "GET") {
      const symbolsPerCard = Number(url.searchParams.get("symbolsPerCard") ?? 8);
      if (!SUPPORTED_SYMBOLS_PER_CARD.includes(symbolsPerCard)) {
        return Response.json(
          { error: `symbolsPerCard must be one of ${SUPPORTED_SYMBOLS_PER_CARD.join(", ")}` },
          { status: 400 },
        );
      }
      const q = symbolsPerCard - 1;
      const symbolIds = Array.from({ length: deckSizeFor(q) }, (_, id) => id);
      const deck = new DeckGenerator(q, symbolIds).generate({ maxCards: MAX_CARDS });
      return Response.json(deck);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
