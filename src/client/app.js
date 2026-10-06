import { DeckGenerator, SUPPORTED_SYMBOLS_PER_CARD, deckSizeFor } from "./shared/generator.js";
import { SoloGame, MODES, WRONG_TAPS_ALLOWED_PER_GAME } from "./shared/game.js";
import { pickEmoji } from "./shared/symbols.js";

const MAX_CARDS = 57;
const MODE_NAMES = { [MODES.clock]: "Beat the clock", [MODES.race]: "Race the deck" };

const $ = id => document.getElementById(id);
const screens = { home: $("home"), play: $("play"), results: $("results") };

function show(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  window.scrollTo(0, 0);
}

// localStorage can be unavailable (private browsing, blocked storage); the game works without it.
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* not saved */ } },
};

/* ---------- settings ---------- */

let symbolsPerCard = Number(store.get("symbolsPerCard"));
if (!SUPPORTED_SYMBOLS_PER_CARD.includes(symbolsPerCard)) symbolsPerCard = 8;

const cardsInDeck = perCard => Math.min(deckSizeFor(perCard - 1), MAX_CARDS);

function renderSettings() {
  $("sizePicker").replaceChildren(...SUPPORTED_SYMBOLS_PER_CARD.map(n => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.textContent = n;
    button.setAttribute("aria-checked", n === symbolsPerCard);
    button.addEventListener("click", () => {
      symbolsPerCard = n;
      store.set("symbolsPerCard", n);
      renderSettings();
    });
    return button;
  }));
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

function formatTime(ms) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(1);
  return minutes ? `${minutes}:${seconds.padStart(4, "0")}` : `${seconds}s`;
}

/* ---------- card layout ---------- */

// Slot positions (fractions of the card) for each number of symbols per card, plus the
// base symbol size as a fraction of the card's width.
const ring = (n, radius) => Array.from({ length: n }, (_, i) => {
  const angle = (2 * Math.PI * i) / n;
  return [0.5 + radius * Math.cos(angle), 0.5 + radius * Math.sin(angle)];
});
const LAYOUTS = {
  3: { slots: ring(3, 0.25), size: 0.27 },
  4: { slots: ring(4, 0.26), size: 0.24 },
  6: { slots: [[0.5, 0.5], ...ring(5, 0.31)], size: 0.19 },
  8: { slots: [[0.5, 0.5], ...ring(7, 0.33)], size: 0.16 },
  12: { slots: [...ring(4, 0.16), ...ring(8, 0.355)], size: 0.125 },
};

const random = (min, max) => min + Math.random() * (max - min);
const layoutCache = new WeakMap(); // a card keeps the same look while it's on screen

function layoutFor(card) {
  if (!layoutCache.has(card)) {
    const { slots, size } = LAYOUTS[card.length];
    const spin = random(0, 2 * Math.PI);
    const order = [...slots.keys()].sort(() => Math.random() - 0.5);
    layoutCache.set(card, card.map((symbol, i) => {
      const [x, y] = slots[order[i]];
      const dx = x - 0.5, dy = y - 0.5;
      return {
        symbol,
        x: 0.5 + dx * Math.cos(spin) - dy * Math.sin(spin),
        y: 0.5 + dx * Math.sin(spin) + dy * Math.cos(spin),
        size: size * random(0.8, 1.15),
        turn: random(-35, 35),
      };
    }));
  }
  return layoutCache.get(card);
}

function renderCard(el, card, animation) {
  el.replaceChildren(...layoutFor(card).map(({ symbol, x, y, size, turn }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "symbol";
    button.dataset.symbol = symbol;
    button.textContent = emoji[symbol];
    button.setAttribute("aria-label", emoji[symbol]);
    button.style.left = `${x * 100}%`;
    button.style.top = `${y * 100}%`;
    button.style.width = button.style.height = `calc(var(--card-size) * ${size * 1.3})`;
    button.style.fontSize = `calc(var(--card-size) * ${size})`;
    button.style.setProperty("--turn", `${turn}deg`);
    return button;
  }));
  if (animation) replayAnimation(el, animation);
}

function replayAnimation(el, className) {
  el.classList.remove(className);
  void el.offsetWidth; // restart the CSS animation
  el.classList.add(className);
}

/* ---------- playing ---------- */

let game = null;
let emoji = [];
let mode = MODES.clock;
let frame = 0;
let toastTimer = 0;

function startGame(chosenMode) {
  mode = chosenMode;
  const q = symbolsPerCard - 1;
  const symbolIds = Array.from({ length: deckSizeFor(q) }, (_, id) => id);
  const deck = new DeckGenerator(q, symbolIds).generate({ maxCards: MAX_CARDS });
  emoji = pickEmoji(symbolIds.length);
  game = new SoloGame(deck, { mode, now: performance.now() });

  $("scoreLabel").textContent = mode === MODES.clock ? "Matches" : "Cards";
  renderCard($("topCard"), game.topCard, "deal");
  renderCard($("yourCard"), game.yourCard, "deal");
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
  const pips = $("mistakes");
  pips.replaceChildren(...Array.from({ length: WRONG_TAPS_ALLOWED_PER_GAME }, (_, i) => {
    const pip = document.createElement("span");
    pip.className = i < game.wrongTotal ? "pip used" : "pip";
    return pip;
  }));
  pips.classList.toggle("last-chance", game.wrongTapsLeft === 0);
  pips.setAttribute("aria-label", `${game.wrongTotal} of ${WRONG_TAPS_ALLOWED_PER_GAME} mistakes used`);
}

function toast(message, tone = "") {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast show ${tone}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, 1400);
}

function handleTap(button) {
  const now = performance.now();
  const result = game.tap(Number(button.dataset.symbol), now);

  if (result === "correct") {
    renderCard($("yourCard"), game.yourCard, "deal");
    renderCard($("topCard"), game.topCard, "deal");
  } else if (result === "wrong") {
    replayAnimation(button, "wrong");
    toast(game.wrongTapsLeft === 0
      ? "Careful: one more wrong tap and you forfeit"
      : "Not that one. One more wrong tap locks this card", "bad");
  } else if (result === "lockedOut") {
    toast("Locked out of that card", "bad");
    renderCard($("topCard"), game.topCard, "locked");
  }

  if (game.status !== "playing") return finish();
  if (result !== "ignored") renderHud(now);
}

// pointerdown reacts as soon as a finger touches the screen, which matters in a speed game.
// Keyboard users still get click (detail === 0 means it didn't come from a pointer).
$("table").addEventListener("pointerdown", event => {
  const button = event.target.closest(".symbol");
  if (button && game) handleTap(button);
});
$("table").addEventListener("click", event => {
  const button = event.target.closest(".symbol");
  if (button && game && event.detail === 0) handleTap(button);
});

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

for (const button of document.querySelectorAll("button[data-mode]")) {
  button.addEventListener("click", () => startGame(button.dataset.mode));
}
$("quit").addEventListener("click", () => {
  cancelAnimationFrame(frame);
  game = null;
  renderSettings();
  show("home");
});
$("again").addEventListener("click", () => startGame(mode));
$("toHome").addEventListener("click", () => {
  renderSettings();
  show("home");
});

renderSettings();
