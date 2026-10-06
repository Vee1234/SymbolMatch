import { DeckGenerator, SUPPORTED_SYMBOLS_PER_CARD, MAX_CARDS, deckSizeFor } from "./shared/generator.js";
import { SoloGame, MODES, WRONG_TAPS_ALLOWED_PER_GAME } from "./shared/game.js";
import { pickEmoji } from "./shared/symbols.js";
import { $, show, store, toast, formatTime, segmented, renderPips } from "./ui.js";
import { renderCard, replayAnimation, onSymbolTap, clearLayouts } from "./cards.js";
import { initFriends } from "./friends.js";

const MODE_NAMES = { [MODES.clock]: "Beat the clock", [MODES.race]: "Race the deck" };

/* ---------- settings ---------- */

let symbolsPerCard = Number(store.get("symbolsPerCard"));
if (!SUPPORTED_SYMBOLS_PER_CARD.includes(symbolsPerCard)) symbolsPerCard = 8;

const cardsInDeck = perCard => Math.min(deckSizeFor(perCard - 1), MAX_CARDS);

function renderSettings() {
  segmented($("sizePicker"), SUPPORTED_SYMBOLS_PER_CARD.map(n => ({ value: n, label: n })), symbolsPerCard, n => {
    symbolsPerCard = n;
    store.set("symbolsPerCard", n);
    renderSettings();
  });
  $("sizeHint").textContent = `${symbolsPerCard} symbols per card · ${cardsInDeck(symbolsPerCard)}-card deck`;
  for (const el of document.querySelectorAll("[data-best]")) {
    el.textContent = bestText(el.dataset.best, symbolsPerCard);
  }
}

/* ---------- best scores ---------- */

const bestKey = (mode, perCard) => `best:${mode}:${perCard}`;

function bestText(mode, perCard) {
  const best = Number(store.get(bestKey(mode, perCard)));
  if (!best) return "";
  return mode === MODES.clock ? `Best: ${best} matches` : `Best: ${formatTime(best)}`;
}

// Returns true if this result is a new best. Clock: more matches is better; race: less time.
function recordBest(mode, perCard, value) {
  const key = bestKey(mode, perCard);
  const previous = Number(store.get(key));
  const isBetter = !previous || (mode === MODES.clock ? value > previous : value < previous);
  if (isBetter) store.set(key, value);
  return isBetter;
}

/* ---------- playing ---------- */

let game = null;
let emoji = [];
let mode = MODES.clock;
let frame = 0;

function startGame(chosenMode) {
  mode = chosenMode;
  const q = symbolsPerCard - 1;
  const symbolIds = Array.from({ length: deckSizeFor(q) }, (_, id) => id);
  const deck = new DeckGenerator(q, symbolIds).generate({ maxCards: MAX_CARDS });
  emoji = pickEmoji(symbolIds.length);
  clearLayouts();
  game = new SoloGame(deck, { mode, now: performance.now() });

  $("scoreLabel").textContent = mode === MODES.clock ? "Matches" : "Cards";
  renderCard($("topCard"), game.topCard, emoji, "deal");
  renderCard($("yourCard"), game.yourCard, emoji, "deal");
  renderHud(performance.now());
  show("play");
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(loop);
}

function loop(now) {
  if (game.tick(now) !== "playing") return finish();
  renderTime(now);
  frame = requestAnimationFrame(loop);
}

function renderTime(now) {
  $("time").textContent = mode === MODES.clock
    ? (game.timeLeftMs(now) / 1000).toFixed(1)
    : formatTime(game.elapsedMs(now));
}

function renderHud(now) {
  renderTime(now);
  $("score").textContent = mode === MODES.clock
    ? game.score
    : `${game.score + game.missed}/${game.totalRounds}`;
  renderPips($("mistakes"), game.wrongTotal, WRONG_TAPS_ALLOWED_PER_GAME);
}

function handleTap(button) {
  if (!game) return;
  const now = performance.now();
  const result = game.tap(Number(button.dataset.symbol), now);

  if (result === "correct") {
    renderCard($("yourCard"), game.yourCard, emoji, "deal");
    renderCard($("topCard"), game.topCard, emoji, "deal");
  } else if (result === "wrong") {
    replayAnimation(button, "wrong");
    toast(game.wrongTapsLeft === 0
      ? "Careful: one more wrong tap and you forfeit"
      : "Not that one. One more wrong tap locks this card", "bad");
  } else if (result === "lockedOut") {
    toast("Locked out of that card", "bad");
    renderCard($("topCard"), game.topCard, emoji, "locked");
  }

  if (game.status !== "playing") return finish();
  if (result !== "ignored") renderHud(now);
}

onSymbolTap($("table"), handleTap);

/* ---------- results ---------- */

function finish() {
  cancelAnimationFrame(frame);
  const g = game;
  game = null;

  $("resultMode").textContent = `${MODE_NAMES[mode]} · ${symbolsPerCard} per card`;
  const stats = [];
  let best = "";
  let isNewBest = false;

  if (g.status === "forfeit") {
    $("resultTitle").textContent = "Forfeit";
    $("resultMain").textContent = `${WRONG_TAPS_ALLOWED_PER_GAME + 1} wrong taps`;
    stats.push(["Matches", g.score], ["Cards locked out", g.missed]);
  } else if (g.status === "timeUp") {
    $("resultTitle").textContent = "Time's up";
    $("resultMain").textContent = `${g.score} ${g.score === 1 ? "match" : "matches"}`;
    stats.push(["Cards locked out", g.missed], ["Wrong taps", g.wrongTotal]);
    isNewBest = g.score > 0 && recordBest(mode, symbolsPerCard, g.score);
    best = bestText(mode, symbolsPerCard);
  } else {
    const time = g.elapsedMs(0);
    $("resultTitle").textContent = "Deck cleared";
    $("resultMain").textContent = formatTime(time);
    stats.push(["Matched", `${g.score}/${g.totalRounds}`], ["Cards locked out", g.missed], ["Wrong taps", g.wrongTotal]);
    isNewBest = recordBest(mode, symbolsPerCard, Math.round(time));
    best = bestText(mode, symbolsPerCard);
  }

  $("resultStats").replaceChildren(...stats.flatMap(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    return [dt, dd];
  }));
  $("resultBest").textContent = isNewBest ? "New best!" : best;
  $("resultBest").classList.toggle("new", isNewBest);
  show("results");
}

/* ---------- navigation ---------- */

function goHome() {
  cancelAnimationFrame(frame);
  game = null;
  renderSettings();
  show("home");
}

for (const button of document.querySelectorAll("button[data-mode]")) {
  button.addEventListener("click", () => startGame(button.dataset.mode));
}
$("quit").addEventListener("click", goHome);
$("again").addEventListener("click", () => startGame(mode));
$("toHome").addEventListener("click", goHome);

renderSettings();
initFriends({ goHome });
