// Cloudflare Worker entry point. Static files in src/client are served directly by
// Cloudflare; only /api/* requests reach this code (see run_worker_first in wrangler.jsonc).

import { DeckGenerator, SUPPORTED_SYMBOLS_PER_CARD, MAX_CARDS, deckSizeFor } from "../client/shared/generator.js";

export { GameRoom } from "./room.js";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I/L, which look alike
const CODE_LENGTH = 5;

function newRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

const isRoomCode = code => new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // POST /api/rooms -> { code }: creates a new game room.
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newRoomCode();
        if (await env.GAME_ROOM.getByName(code).create(code)) {
          return Response.json({ code });
        }
      }
      return Response.json({ error: "Couldn't create a room, try again" }, { status: 503 });
    }

    // GET /api/rooms/CODE/ws: a player's WebSocket connection to that room.
    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (roomMatch) {
      const code = roomMatch[1].toUpperCase();
      if (!isRoomCode(code)) {
        return Response.json({ error: "That isn't a valid room code" }, { status: 404 });
      }
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected a WebSocket connection", { status: 426 });
      }
      return env.GAME_ROOM.getByName(code).fetch(request);
    }

    // GET /api/deck?symbolsPerCard=8 -> { q, cards }, where symbols are ids 0..n-1.
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
      return Response.json(new DeckGenerator(q, symbolIds).generate({ maxCards: MAX_CARDS }));
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
