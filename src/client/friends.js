// "Play with friends": creating and joining rooms, the lobby, the shared game and results.
// The room on the server (src/server/room.js) runs the rules; this file only shows its
// state and sends taps.

import { LEVELS, levelName } from "./shared/generator.js";
import { WRONG_TAPS_ALLOWED_PER_GAME } from "./shared/game.js";
import { MULTIPLAYER_MODES, MIN_PLAYERS, readiness } from "./shared/multiplayer.js";
import { verdictFor } from "./shared/verdicts.js";
import { $, show, store, toast, segmented, renderPips, formatTime, buzz, slideCard } from "./ui.js";
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
let levelForNewRoom = null; // symbols per card chosen on the home screen, set once the room exists
let codeToJoin = ""; // set when the name screen was opened by an invite link or a typed code
let countdown = null; // the opening 3-2-1 that's running, if any: { game, timer }
let slideOnNext = null; // "won" or "played" after your correct tap, until the cards update

const nameOf = id => state?.players.find(p => p.id === id)?.name ?? "Someone";
const savedName = () => (store.get("playerName") ?? "").trim();

export function initFriends(options) {
  goHome = options.goHome;

  $("friendsBack").addEventListener("click", () => goHome());
  $("playerName").value = savedName();
  $("playerName").addEventListener("input", () => store.set("playerName", $("playerName").value.trim()));

  $("nameForm").addEventListener("submit", event => {
    event.preventDefault();
    if (!requireName()) return;
    if (codeToJoin) connect(codeToJoin);
    else createRoom();
  });

  $("shareRoom").addEventListener("click", shareRoom);
  $("startRoom").addEventListener("click", () => send({ type: "start" }));
  $("readyToggle").addEventListener("click", () => {
    const me = state?.players.find(p => p.id === playerId);
    if (me) send({ type: "ready", ready: !me.ready });
  });
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

// "Play with friends" on the home screen, after picking a level.
export function createRoomAtLevel(symbolsPerCard) {
  levelForNewRoom = symbolsPerCard;
  if (savedName()) return createRoom();
  openFriendsScreen();
  $("playerName").focus();
  toast("Add your name, then tap Create a game");
}

export function joinWithCode(input) {
  const code = input.trim().toUpperCase();
  if (!ROOM_CODE.test(code)) return toast("Room codes are 5 letters and numbers", "bad");
  levelForNewRoom = null;
  joinRoom(code);
}

// The name screen either creates a room or, when opened from an invite, joins one. A friend
// joining sees just the name box and Join game: the description is for whoever creates it.
function openFriendsScreen(code = "") {
  codeToJoin = code;
  $("createRoom").textContent = code ? "Join game" : "Create a game";
  $("friendsIntro").hidden = Boolean(code);
  show("friends");
}

export const inRoom = () => roomCode !== null;

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
    return toast("Add your name, then tap Join game");
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
      if (levelForNewRoom && state.phase === "lobby" && state.hostId === playerId) {
        send({ type: "settings", symbolsPerCard: levelForNewRoom });
        levelForNewRoom = null;
      }
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

export function leaveRoom() {
  send({ type: "leave" });
  leaving = true;
  socket?.close();
  resetRoom();
  goHome();
}

function resetRoom() {
  stopCountdown();
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
      return await navigator.share({ title: "Symbolic", text, url });
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
  if (state.phase !== "playing") stopCountdown();
  if (state.phase === "lobby") return renderLobby();
  if (state.phase === "playing") return state.game?.you ? renderPlay() : renderLobby();
  return renderResults();
}

// Each player keeps one pastel, from their place in the room.
const toneOf = id => `tone-${Math.max(0, state.players.findIndex(p => p.id === id)) % 4}`;

function circle(id, text, extraClass = "") {
  const span = document.createElement("span");
  span.className = `initial ${toneOf(id)} ${extraClass}`.trim();
  span.setAttribute("aria-hidden", "true");
  span.textContent = text;
  return span;
}
const initialOf = id => (nameOf(id).trim()[0] ?? "?").toUpperCase();

function renderLobby() {
  const isHost = state.hostId === playerId;
  const { mode, symbolsPerCard } = state.settings;
  const inProgress = state.phase === "playing";
  const { players: connectedCount, waitingFor, canStart } = readiness(state.players);
  const me = state.players.find(p => p.id === playerId);
  clearLayouts();
  shownCentreSeq = null;

  $("lobbyCode").textContent = state.code;
  $("lobbyPlayers").replaceChildren(...state.players.map(p => {
    const li = document.createElement("li");
    li.className = p.connected ? "" : "offline";
    const who = document.createElement("span");
    who.className = "who-name";
    const name = document.createElement("span");
    name.textContent = p.name;
    who.append(name);
    const tags = [p.id === state.hostId && "host", p.id === playerId && "you", !p.connected && "offline"].filter(Boolean);
    if (tags.length) {
      const span = document.createElement("span");
      span.className = "tags";
      span.textContent = tags.join(" · ");
      who.append(span);
    }
    li.append(circle(p.id, initialOf(p.id)), who);
    if (p.connected && !inProgress) {
      const mark = document.createElement("span");
      mark.className = p.ready ? "ready-mark ready" : "ready-mark";
      mark.textContent = p.ready ? "✓ Ready" : "Not ready";
      li.append(mark);
    }
    return li;
  }));

  const options = Object.entries(MODE_INFO).map(([value, info]) => ({ value, label: info.name }));
  segmented($("roomModePicker"), options, mode, value => send({ type: "settings", mode: value }), { disabled: !isHost });
  segmented($("roomSizePicker"), LEVELS.map(level => ({ value: level.symbolsPerCard, label: level.name })), symbolsPerCard,
    value => send({ type: "settings", symbolsPerCard: value }), { disabled: !isHost });
  $("roomModeHint").textContent = MODE_INFO[mode].hint;
  const host = nameOf(state.hostId);
  $("hostOnlyNote").textContent = isHost ? "" : `Only ${host} (the host) can change these`;

  $("readyToggle").hidden = inProgress;
  $("readyToggle").setAttribute("aria-pressed", String(Boolean(me?.ready)));
  $("readyToggle").textContent = me?.ready ? "✓ Ready (tap to undo)" : "I'm ready";

  // Start stays greyed out until at least two players are in and every one of them is ready.
  $("startRoom").hidden = !isHost || inProgress;
  $("startRoom").disabled = !canStart;
  $("startRoom").textContent = connectedCount < MIN_PLAYERS ? "Waiting for another player…"
    : waitingFor.length ? `Waiting for ${waitingFor.length} ${waitingFor.length === 1 ? "player" : "players"} to be ready…`
    : `Start game with ${connectedCount}`;
  $("lobbyWaiting").textContent = inProgress
    ? "A game is in progress. You'll be in the next round."
    : isHost ? (!me?.ready ? "Tap I'm ready when you're set. The game starts once everyone is."
      : canStart ? "Everyone's ready. Start when you like." : "Share the link, then start once everyone's ready.")
    : !me?.ready ? `Tap I'm ready when you're set. ${host} (the host) starts the game once everyone is.`
    : canStart ? `Everyone's ready. Waiting for ${host} to start the game…`
    : `Waiting for everyone to be ready. ${host} (the host) starts the game.`;
  show("lobby");
}

function renderPlay() {
  const game = state.game;
  const you = game.you;
  const tower = game.mode === MULTIPLAYER_MODES.tower;
  const centreChanged = shownCentreSeq !== game.centreSeq;

  // After your correct tap the cards about to change: the won card slides onto your pile
  // (Pick one up), or your card goes down on the centre (Put one down).
  if (slideOnNext && centreChanged && shownCentreSeq !== null) {
    if (tower) slideCard($("roomCentre"), $("roomYours"));
    else slideCard($("roomYours"), $("roomCentre"));
  }
  slideOnNext = null;

  if (centreChanged) {
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
    li.append(circle(p.id, initialOf(p.id)), `${nameOf(p.id)} · ${tower ? p.won : p.cardsLeft}${status ? ` ${status}` : ""}`);
    return li;
  }));

  if (game.startsInMs > 0 && !countdown) startCountdown(game);
  show("roomPlay");
}

// The opening 3, 2, 1, Go! on top of the table. It runs for however long the room says is
// left, so a phone that reconnects partway through joins in at the right number.
function startCountdown(game) {
  const overlay = $("countdown");
  const endsAt = performance.now() + game.startsInMs;
  $("countdownMode").textContent = `${MODE_INFO[game.mode].name} · ${levelName(state.settings.symbolsPerCard)}`;
  $("countdownPlayers").replaceChildren(...game.players.map(p => {
    const li = document.createElement("li");
    li.append(circle(p.id, initialOf(p.id)), p.id === playerId ? `${nameOf(p.id)} (you)` : nameOf(p.id));
    return li;
  }));
  overlay.classList.remove("fading");
  overlay.hidden = false;

  let shown = "";
  const tick = () => {
    const left = endsAt - performance.now();
    if (left <= 0) {
      overlay.classList.add("fading");
      countdown.timer = setTimeout(() => {
        overlay.hidden = true;
        countdown = null;
        for (const card of [$("roomCentre"), $("roomYours")]) replayAnimation(card, "deal");
      }, 350);
      return;
    }
    const label = left > 3000 ? "3" : left > 2000 ? "2" : left > 1000 ? "1" : "Go!";
    if (label !== shown) {
      shown = label;
      const number = document.createElement("span");
      number.className = "count";
      number.textContent = label;
      $("countdownCircle").replaceChildren(number);
      $("countdownCircle").classList.toggle("is-go", label === "Go!");
      $("countdownHeading").textContent = label === "Go!" ? "Symbolic!" : "Get ready!";
    }
    countdown.timer = setTimeout(tick, 50);
  };
  countdown = { timer: 0 };
  tick();
}

function stopCountdown() {
  if (countdown) clearTimeout(countdown.timer);
  countdown = null;
  $("countdown").hidden = true;
}

function renderResults() {
  const game = state.game;
  const tower = game.mode === MULTIPLAYER_MODES.tower;
  const winners = game.standings.filter(s => s.place === 1 && !s.forfeited);
  const youWon = winners.some(s => s.id === playerId);
  stopCountdown();

  // The summary is missing only for a game that started before this version was deployed.
  const summary = game.summary;
  const statsOf = id => summary?.players.find(p => p.id === id);
  const badgesOf = id => (summary?.badges ?? []).filter(b => b.playerIds.includes(id)).map(b => b.emoji).join("");
  const line = s => verdictFor(s, game.standings, summary?.startedAt ?? "");
  const mine = game.standings.find(s => s.id === playerId);

  $("roomResultMode").textContent = [
    MODE_INFO[game.mode].name,
    levelName(state.settings.symbolsPerCard),
    summary?.durationMs != null && `lasted ${formatTime(summary.durationMs)}`,
  ].filter(Boolean).join(" · ");
  $("roomResultTitle").textContent = youWon
    ? (winners.length > 1 ? "You tied for first!" : "You win!")
    : winners.length ? `${winners.map(s => nameOf(s.id)).join(" & ")} ${winners.length > 1 ? "win" : "wins"}` : "Game over";
  $("roomVerdict").textContent = mine ? `“${line(mine)}”` : "";

  $("standings").replaceChildren(...game.standings.map(s => {
    const li = document.createElement("li");
    li.className = [s.id === playerId && "you", s.forfeited && "out"].filter(Boolean).join(" ");
    const detail = s.forfeited ? "forfeited"
      : tower ? `${s.won} ${s.won === 1 ? "card" : "cards"}`
      : s.cardsLeft === 0 ? "no cards left" : `${s.cardsLeft} left`;
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = s.id === playerId ? `${nameOf(s.id)} (you)` : nameOf(s.id);
    const badges = badgesOf(s.id);
    if (badges) {
      const span = document.createElement("span");
      span.className = "who-badges";
      span.textContent = badges;
      who.append(span);
    }
    const detailEl = document.createElement("span");
    detailEl.className = "detail";
    detailEl.textContent = detail;
    const stats = document.createElement("p");
    stats.className = "stats";
    stats.textContent = statsLine(statsOf(s.id));
    li.append(circle(s.id, s.place, "place"), who, detailEl, stats);
    if (s.id !== playerId) {
      const p = document.createElement("p");
      p.className = "line";
      p.textContent = `“${line(s)}”`;
      li.append(p);
    }
    return li;
  }));

  const awarded = summary?.badges ?? [];
  $("roomBadgesSection").hidden = awarded.length === 0;
  $("roomBadges").replaceChildren(...awarded.map(b => {
    const li = document.createElement("li");
    li.title = b.description;
    li.innerHTML = `<span class="badge-emoji" aria-hidden="true"></span><span class="badge-text"><span class="badge-name"></span><span class="badge-who"></span></span>`;
    li.querySelector(".badge-emoji").textContent = b.emoji;
    li.querySelector(".badge-name").textContent = b.name;
    li.querySelector(".badge-who").textContent = b.playerIds.map(id => id === playerId ? "You" : nameOf(id)).join(" & ");
    return li;
  }));

  const isHost = state.hostId === playerId;
  $("roomAgain").hidden = !isHost;
  $("roomAgain").parentElement.classList.toggle("two", isHost);
  $("roomResultWaiting").textContent = isHost ? "" : `Waiting for ${nameOf(state.hostId)} to start another round.`;
  clearLayouts();
  shownCentreSeq = null;
  shownYourCard = "";
  show("roomResults");
}

// "Average 1.8s · fastest 0.9s · 2 wrong taps" for one player's summary row.
function statsLine(stats) {
  if (!stats) return "";
  const parts = stats.matches
    ? [`average ${formatTime(stats.averageMs)}`, `fastest ${formatTime(stats.fastestMs)}`]
    : ["no matches"];
  parts.push(`${stats.wrongTotal} wrong ${stats.wrongTotal === 1 ? "tap" : "taps"}`);
  return parts.join(" · ").replace(/^./, c => c.toUpperCase());
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
    if (kind === "correct") {
      buzz();
      slideOnNext = true;
    } else if (kind === "wrong") {
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
