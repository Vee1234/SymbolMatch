// One GameRoom Durable Object per game room. It holds the room's state, runs the rules in
// shared/multiplayer.js, and talks to every player's phone over a WebSocket.
//
// Uses the WebSocket Hibernation API: between taps the object can be evicted from memory
// without dropping connections, so the room state is saved to storage after every change
// and loaded again in the constructor.

import { DurableObject } from "cloudflare:workers";
import { DeckGenerator, SUPPORTED_SYMBOLS_PER_CARD, MAX_CARDS, deckSizeFor } from "../client/shared/generator.js";
import { pickEmoji } from "../client/shared/symbols.js";
import {
  MULTIPLAYER_MODES, MAX_PLAYERS, MIN_PLAYERS, createGame, applyTap, forfeitPlayer, viewFor,
} from "../client/shared/multiplayer.js";

const MAX_NAME_LENGTH = 16;
const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000; // rooms are deleted after a day without activity

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    // Phones send "ping" to keep their connection alive; answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get("room")) ?? null;
    });
  }

  // Called by the Worker when a room is created. Returns false if the code is already taken.
  async create(code) {
    if (this.room) return false;
    await this.save({
      code,
      hostId: null,
      players: [], // { id, name }, in joining order
      settings: { mode: MULTIPLAYER_MODES.tower, symbolsPerCard: 8 },
      phase: "lobby", // lobby | playing | ended
      game: null,
      emoji: null,
    });
    return true;
  }

  async fetch(request) {
    if (!this.room) {
      return new Response("Room not found", { status: 404 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return this.sendError(ws, "Couldn't read that message");
    }
    const { playerId } = ws.deserializeAttachment() ?? {};

    if (message.type === "join") return this.join(ws, message);
    if (!playerId) return this.sendError(ws, "Join the room first");

    const isHost = playerId === this.room.hostId;
    switch (message.type) {
      case "settings": return isHost ? this.changeSettings(message) : this.sendError(ws, "Only the host can change settings");
      case "start": return isHost ? this.start(ws) : this.sendError(ws, "Only the host can start the game");
      case "again": return isHost ? this.backToLobby() : this.sendError(ws, "Only the host can start another round");
      case "tap": return this.tap(playerId, message);
      case "leave": return this.leave(ws, playerId);
      default: return this.sendError(ws, `Unknown message type ${message.type}`);
    }
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch { /* already closed */ }
    this.broadcast(null, ws); // others see this player as offline
  }

  async webSocketError(ws) {
    this.broadcast(null, ws);
  }

  // Deletes the room once nobody has used it for ROOM_LIFETIME_MS.
  async alarm() {
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_LIFETIME_MS);
      return;
    }
    await this.ctx.storage.deleteAll();
    this.room = null;
  }

  /* ---------- actions ---------- */

  async join(ws, { playerId, name }) {
    if (typeof playerId !== "string" || !playerId || playerId.length > 64) {
      return this.sendError(ws, "Missing player id");
    }
    const cleanName = String(name ?? "").trim().slice(0, MAX_NAME_LENGTH) || "Player";
    const room = this.room;
    const existing = room.players.find(p => p.id === playerId);

    if (existing) {
      existing.name = cleanName; // rejoining, e.g. after the connection dropped
    } else if (room.players.length >= MAX_PLAYERS) {
      return this.sendError(ws, `This room is full (${MAX_PLAYERS} players)`);
    } else {
      room.players.push({ id: playerId, name: cleanName });
    }
    room.hostId ??= playerId;
    ws.serializeAttachment({ playerId });
    await this.save(room);
    this.broadcast();
  }

  async leave(ws, playerId) {
    const room = this.room;
    const inGame = room.phase !== "lobby" && room.game?.players[playerId];
    if (inGame) {
      forfeitPlayer(room.game, playerId); // leaving mid-game counts as forfeiting
      if (room.game.status === "ended") room.phase = "ended";
    } else {
      room.players = room.players.filter(p => p.id !== playerId);
    }
    if (room.hostId === playerId) {
      room.hostId = room.players.find(p => p.id !== playerId)?.id ?? null;
    }
    ws.serializeAttachment({ playerId: null });
    await this.save(room);
    ws.close(1000, "Left the room");
    this.broadcast(null, ws);
  }

  async changeSettings({ mode, symbolsPerCard }) {
    const room = this.room;
    if (room.phase !== "lobby") return;
    if (Object.values(MULTIPLAYER_MODES).includes(mode)) room.settings.mode = mode;
    if (SUPPORTED_SYMBOLS_PER_CARD.includes(symbolsPerCard)) room.settings.symbolsPerCard = symbolsPerCard;
    await this.save(room);
    this.broadcast();
  }

  async start(ws) {
    const room = this.room;
    if (room.phase !== "lobby") return;
    const playerIds = room.players.map(p => p.id).filter(id => this.isConnected(id));
    if (playerIds.length < MIN_PLAYERS) {
      return this.sendError(ws, `You need at least ${MIN_PLAYERS} players to start`);
    }

    const q = room.settings.symbolsPerCard - 1;
    const symbolIds = Array.from({ length: deckSizeFor(q) }, (_, id) => id);
    const deck = new DeckGenerator(q, symbolIds).generate({ maxCards: MAX_CARDS });
    try {
      room.game = createGame(deck, room.settings.mode, playerIds);
    } catch (error) {
      return this.sendError(ws, error.message);
    }
    room.emoji = pickEmoji(symbolIds.length); // everyone sees the same emoji for each symbol
    room.phase = "playing";
    await this.save(room);
    this.broadcast();
  }

  async tap(playerId, { symbol, centreSeq }) {
    const room = this.room;
    if (room.phase !== "playing") return;
    const result = applyTap(room.game, playerId, symbol, centreSeq);
    if (result === "ignored" || result === "tooLate") {
      return this.sendTo(playerId, { type: "event", kind: result, playerId, symbol });
    }
    if (room.game.status === "ended") room.phase = "ended";
    await this.save(room);
    this.broadcast({ type: "event", kind: result, playerId, symbol });
  }

  async backToLobby() {
    const room = this.room;
    if (room.phase !== "ended") return;
    room.phase = "lobby";
    room.game = null;
    room.emoji = null;
    await this.save(room);
    this.broadcast();
  }

  /* ---------- helpers ---------- */

  // Persist first, then keep the in-memory copy (it may be gone after hibernation).
  async save(room) {
    await this.ctx.storage.put("room", room);
    this.room = room;
    await this.ctx.storage.setAlarm(Date.now() + ROOM_LIFETIME_MS);
  }

  // ignore: a socket that is closing; it can still be listed while its close handler runs.
  sockets(ignore = null) {
    return this.ctx.getWebSockets()
      .filter(ws => ws !== ignore)
      .map(ws => ({ ws, playerId: ws.deserializeAttachment()?.playerId }));
  }

  isConnected(playerId, ignore = null) {
    return this.sockets(ignore).some(s => s.playerId === playerId);
  }

  // Each player gets their own view: their card, but never anyone else's.
  stateFor(playerId, ignore = null) {
    const room = this.room;
    return {
      type: "state",
      code: room.code,
      you: playerId,
      hostId: room.hostId,
      phase: room.phase,
      settings: room.settings,
      players: room.players.map(p => ({ ...p, connected: this.isConnected(p.id, ignore) })),
      emoji: room.emoji,
      game: room.game ? viewFor(room.game, playerId) : null,
    };
  }

  broadcast(event = null, ignore = null) {
    for (const { ws, playerId } of this.sockets(ignore)) {
      if (!playerId) continue;
      if (event) this.trySend(ws, event);
      this.trySend(ws, this.stateFor(playerId, ignore));
    }
  }

  sendTo(playerId, message) {
    for (const s of this.sockets()) {
      if (s.playerId === playerId) this.trySend(s.ws, message);
    }
  }

  sendError(ws, message) {
    this.trySend(ws, { type: "error", message });
  }

  trySend(ws, message) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // the connection closed in the meantime; webSocketClose tidies up
    }
  }
}
