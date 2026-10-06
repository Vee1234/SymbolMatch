// "Play with friends": creating and joining rooms, the lobby, the shared game and results.
// The room on the server (src/server/room.js) runs the rules; this file only shows its
// state and sends taps.

import { SUPPORTED_SYMBOLS_PER_CARD } from "./shared/generator.js";
import { WRONG_TAPS_ALLOWED_PER_GAME } from "./shared/game.js";
import { MULTIPLAYER_MODES, MIN_PLAYERS } from "./shared/multiplayer.js";
import { $, show, store, toast, segmented, renderPips } from "./ui.js";
import { renderCard, replayAnimation, onSymbolTap, clearLayouts } from "./cards.js";

const MODE_INFO = {
  [MULTIPLAYER_MODES.tower]: {
    name: "Pick one up",
    hint: "Everyone starts with one card. Spot the match with the centre card to win it. Most cards when the pile runs out wins.",
  },
  [MULTIPLAYER_MODES.well]: {
    name: "Put one down",
    hint: "The cards are dealt out. Spot the match to put your card on the centre. First to get rid of all their cards wins.",
  },
};
const ROOM_CODE = /^[A-HJ-KM-NP-Z2-9]{5}$/;
const PING_EVERY_MS = 25_000;
const LEAVE_CONFIRM_MS = 3_000;

let playerId = store.get("playerId");
if (!playerId) {
  playerId = crypto.randomUUID();
  store.set("playerId", playerId);
}

let goHome = () => show("home");
let socket = null;
let roomCode = null;
let state = null;
let leaving = false; // true when the player closed the connection on purpose
let reconnectDelay = 1000;
let pingTimer = 0;
let lastTapped = null;
let shownCentreSeq = null;
let shownYourCard = "";
let leaveArmedUntil = 0;

const nameOf = id => state?.players.find(p => p.id === id)?.name ?? "Someone";
const savedName = () => (store.get("playerName") ?? "").trim();

export function initFriends(options) {
  goHome = options.goHome;

  $("openFriends").addEventListener("click", () => openFriendsScreen());
  $("friendsBack").addEventListener("click", () => goHome());
  $("playerName").value = savedName();
  $("playerName").addEventListener("input", () => store.set("playerName", $("playerName").value.trim()));

  $("createRoom").addEventListener("click", createRoom);
  $("joinForm").addEventListener("submit", event => {
    event.preventDefault();
    const code = $("roomCode").value.trim().toUpperCase();
    if (!ROOM_CODE.test(code)) return toast("Room codes are 5 letters and numbers", "bad");
    joinRoom(code);
  });

  $("shareRoom").addEventListener("click", shareRoom);
  $("startRoom").addEventListener("click", () => send({ type: "start" }));
  $("leaveRoom").addEventListener("click", leaveRoom);
  $("roomAgain").addEventListener("click", () => send({ type: "again" }));
  $("roomLeave").addEventListener("click", leaveRoom);
  $("roomQuit").addEventListener("click", () => {
    // Leaving mid-game counts as forfeiting, so ask for a second tap rather than a dialog.
    if (Date.now() < leaveArmedUntil) return leaveRoom();
    leaveArmedUntil = Date.now() + LEAVE_CONFIRM_MS;
    toast("Tap ✕ again to leave. You'll forfeit this game", "bad");
  });
  onSymbolTap($("roomTable"), tap);

  // Opened from an invite link: ?room=CODE
  const code = new URLSearchParams(location.search).get("room")?.toUpperCase();
  if (code && ROOM_CODE.test(code)) joinRoom(code);
}

function openFriendsScreen(code = "") {
  $("roomCode").value = code;
  show("friends");
}

function requireName() {
  const name = $("playerName").value.trim() || savedName();
  if (!name) {
    toast("Add your name first", "bad");
    $("playerName").focus();
    return null;
  }
  store.set("playerName", name);
  return name;
}

async function createRoom() {
  if (!requireName()) return;
  try {
    const response = await fetch("/api/rooms", { method: "POST" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    connect(body.code);
  } catch (error) {
    toast(error.message || "Couldn't create a room", "bad");
  }
}

function joinRoom(code) {
  if (!savedName()) {
    // Came from a link but we don't know their name yet.
    openFriendsScreen(code);
    $("playerName").focus();
    return toast("Add your name, then tap Join");
  }
  connect(code);
}

/* ---------- connection ---------- */

function connect(code) {
  roomCode = code;
  leaving = false;
  history.replaceState(null, "", `?room=${code}`);
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protocol}://${location.host}/api/rooms/${code}/ws`);
  socket = ws;
  let opened = false;

  ws.addEventListener("open", () => {
    opened = true;
    reconnectDelay = 1000;
    ws.send(JSON.stringify({ type: "join", playerId, name: savedName() }));
    clearInterval(pingTimer);
    pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), PING_EVERY_MS);
  });

  ws.addEventListener("message", event => {
    if (event.data === "pong") return;
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      state = message;
      render();
    } else if (message.type === "event") {
      handleEvent(message);
    } else if (message.type === "error") {
      toast(message.message, "bad");
    }
  });

  ws.addEventListener("close", () => {
    clearInterval(pingTimer);
    if (socket !== ws || leaving) return;
    if (!opened && !state) {
      // The room doesn't exist (or has expired after a day without use).
      resetRoom();
      openFriendsScreen();
      return toast(`Couldn't find room ${code}`, "bad");
    }
    toast("Connection lost. Reconnecting…", "bad");
    setTimeout(() => socket === ws && !leaving && connect(code), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
  });
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function leaveRoom() {
  send({ type: "leave" });
  leaving = true;
  socket?.close();
  resetRoom();
  goHome();
}

function resetRoom() {
  socket = null;
  roomCode = null;
  state = null;
  shownCentreSeq = null;
  shownYourCard = "";
  history.replaceState(null, "", location.pathname);
}

async function shareRoom() {
  const url = `${location.origin}${location.pathname}?room=${roomCode}`;
  const text = `Join my game! Room ${roomCode}`;
  if (navigator.share) {
    try {
      return await navigator.share({ title: "Dobble", text, url });
    } catch (error) {
      if (error.name === "AbortError") return; // they closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Invite link copied");
  } catch {
    toast(url);
  }
}

/* ---------- rendering ---------- */

function render() {
  if (state.phase === "lobby") return renderLobby();
  if (state.phase === "playing") return state.game?.you ? renderPlay() : renderLobby();
  return renderResults();
}

function renderLobby() {
  const isHost = state.hostId === playerId;
  const { mode, symbolsPerCard } = state.settings;
  const inProgress = state.phase === "playing";
  const connectedCount = state.players.filter(p => p.connected).length;
  clearLayouts();
  shownCentreSeq = null;

  $("lobbyCode").textContent = state.code;
  $("lobbyPlayers").replaceChildren(...state.players.map(p => {
    const li = document.createElement("li");
    li.className = p.connected ? "" : "offline";
    const tags = [p.id === state.hostId && "host", p.id === playerId && "you", !p.connected && "offline"].filter(Boolean);
    li.textContent = p.name;
    if (tags.length) {
      const span = document.createElement("span");
      span.className = "tags";
      span.textContent = tags.join(" · ");
      li.append(span);
    }
    return li;
  }));

  const options = Object.entries(MODE_INFO).map(([value, info]) => ({ value, label: info.name }));
  segmented($("roomModePicker"), options, mode, value => send({ type: "settings", mode: value }), { disabled: !isHost });
  segmented($("roomSizePicker"), SUPPORTED_SYMBOLS_PER_CARD.map(n => ({ value: n, label: n })), symbolsPerCard,
    value => send({ type: "settings", symbolsPerCard: value }), { disabled: !isHost });
  $("roomModeHint").textContent = MODE_INFO[mode].hint;

  $("startRoom").hidden = !isHost || inProgress;
  $("startRoom").disabled = connectedCount < MIN_PLAYERS;
  $("startRoom").textContent = connectedCount < MIN_PLAYERS ? "Waiting for another player…" : `Start game with ${connectedCount}`;
  $("lobbyWaiting").textContent = inProgress
    ? "A game is in progress. You'll be in the next round."
    : isHost ? "Share the link, then start when everyone's in." : `Waiting for ${nameOf(state.hostId)} to start the game.`;
  show("lobby");
}

function renderPlay() {
  const game = state.game;
  const you = game.you;
  const tower = game.mode === MULTIPLAYER_MODES.tower;

  if (shownCentreSeq !== game.centreSeq) {
    renderCard($("roomCentre"), game.centre, state.emoji, shownCentreSeq === null ? null : "deal");
    shownCentreSeq = game.centreSeq;
  }
  const yoursKey = JSON.stringify(game.yourCard);
  if (shownYourCard !== yoursKey) {
    if (game.yourCard) {
      renderCard($("roomYours"), game.yourCard, state.emoji, "deal");
    } else {
      const out = document.createElement("p");
      out.className = "card-message";
      out.textContent = "You're out of this game. Watch the others finish.";
      $("roomYours").replaceChildren(out);
    }
    shownYourCard = yoursKey;
  }

  $("roomTable").classList.toggle("locked-out", you.lockedOut);
  $("roomYoursLabel").textContent = you.forfeited ? "Out" : you.lockedOut ? "Locked out. Wait for the next card" : "Your card";
  $("roomStatLabel").textContent = tower ? "Centre pile" : "Cards left";
  $("roomStat").textContent = tower ? game.centrePileLeft : you.cardsLeft;
  $("roomScoreLabel").textContent = tower ? "Won" : "Played";
  $("roomScore").textContent = you.won;
  renderPips($("roomMistakes"), you.wrongTotal, WRONG_TAPS_ALLOWED_PER_GAME);

  const online = new Map(state.players.map(p => [p.id, p.connected]));
  $("opponents").replaceChildren(...game.players.filter(p => p.id !== playerId).map(p => {
    const li = document.createElement("li");
    const status = p.forfeited ? "out" : !online.get(p.id) ? "offline" : p.lockedOut ? "🔒" : "";
    li.className = p.forfeited || !online.get(p.id) ? "dim" : "";
    li.textContent = `${nameOf(p.id)} ${tower ? p.won : p.cardsLeft}${status ? ` ${status}` : ""}`;
    return li;
  }));
  show("roomPlay");
}

function renderResults() {
  const game = state.game;
  const tower = game.mode === MULTIPLAYER_MODES.tower;
  const winners = game.standings.filter(s => s.place === 1 && !s.forfeited);
  const youWon = winners.some(s => s.id === playerId);

  $("roomResultMode").textContent = `${MODE_INFO[game.mode].name} · ${state.settings.symbolsPerCard} per card`;
  $("roomResultTitle").textContent = youWon
    ? (winners.length > 1 ? "You tied for first!" : "You win!")
    : winners.length ? `${winners.map(s => nameOf(s.id)).join(" & ")} ${winners.length > 1 ? "win" : "wins"}` : "Game over";

  $("standings").replaceChildren(...game.standings.map(s => {
    const li = document.createElement("li");
    li.className = s.id === playerId ? "you" : "";
    const detail = s.forfeited ? "forfeited"
      : tower ? `${s.won} ${s.won === 1 ? "card" : "cards"}`
      : s.cardsLeft === 0 ? "no cards left" : `${s.cardsLeft} left`;
    li.innerHTML = `<span class="place"></span><span class="who"></span><span class="detail"></span>`;
    li.querySelector(".place").textContent = s.place;
    li.querySelector(".who").textContent = nameOf(s.id);
    li.querySelector(".detail").textContent = detail;
    return li;
  }));

  const isHost = state.hostId === playerId;
  $("roomAgain").hidden = !isHost;
  $("roomResultWaiting").textContent = isHost ? "" : `Waiting for ${nameOf(state.hostId)} to start another round.`;
  clearLayouts();
  shownCentreSeq = null;
  shownYourCard = "";
  show("roomResults");
}

/* ---------- playing ---------- */

function tap(button) {
  if (state?.phase !== "playing" || !state.game.you || state.game.you.forfeited) return;
  lastTapped = button;
  send({ type: "tap", symbol: Number(button.dataset.symbol), centreSeq: state.game.centreSeq });
}

function handleEvent({ kind, playerId: who, symbol }) {
  const mine = who === playerId;
  if (mine) {
    if (kind === "wrong") {
      if (lastTapped?.dataset.symbol === String(symbol)) replayAnimation(lastTapped, "wrong");
      toast("Not that one. One more wrong tap locks this card", "bad");
    } else if (kind === "lockedOut") {
      toast("Locked out of this card", "bad");
    } else if (kind === "forfeit") {
      toast(`${WRONG_TAPS_ALLOWED_PER_GAME + 1} wrong taps. You're out`, "bad");
    } else if (kind === "tooLate") {
      toast("Too slow, someone got there first");
    }
  } else if (kind === "correct") {
    toast(`${nameOf(who)} got it`);
  } else if (kind === "forfeit") {
    toast(`${nameOf(who)} is out`);
  }
}
