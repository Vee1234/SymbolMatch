import { DeckGenerator, LEVELS, levelName, MAX_CARDS, deckSizeFor } from "./shared/generator.js";
import { SoloGame, MODES, WRONG_TAPS_ALLOWED_PER_GAME, CLOCK_DURATION_MS, COUNTDOWN_MS } from "./shared/game.js";
import { pickEmoji } from "./shared/symbols.js";
import { $, show, store, toast, formatTime, segmented, renderPips, buzz, slideCard, runCountdown, stopCountdown } from "./ui.js";
import { renderCard, replayAnimation, onSymbolTap, clearLayouts } from "./cards.js";
import { initFriends, createRoomAtLevel, joinWithCode, inRoom, leaveRoom } from "./friends.js";
import { initTutorial, startTutorial, stopTutorial } from "./tutorial.js";

const MODE_INFO = {
  [MODES.clock]: { name: "Beat the clock", desc: "As many matches as you can in 60 seconds." },
  [MODES.race]: { name: "Race the deck", desc: "Get through the whole deck as fast as you can." },
};
const LEVEL_EMOJI = { easy: "🍎", medium: "🍎🍋", hard: "🍎🍋🍇" };

/* ---------- home ---------- */

let symbolsPerCard = Number(store.get("symbolsPerCard"));
if (!LEVELS.some(level => level.symbolsPerCard === symbolsPerCard)) symbolsPerCard = 8;
let soloMode = store.get("soloMode") === MODES.race ? MODES.race : MODES.clock;
let picking = null; // "solo" or "friends" while the card shows the level choice

// The big card on the home screen flips between the two options and the level choice.
function openPick(kind) {
  picking = kind;
  $("soloModes").hidden = kind !== "solo";
  $("pickGo").textContent = kind === "solo" ? "Play" : "Create";
  renderPick();
  $("cardHome").hidden = true;
  $("cardPick").hidden = false;
  $("cardPick").querySelector('[aria-checked="true"]').focus();
}

function closePick() {
  const from = picking === "solo" ? "pickSolo" : "pickFriends";
  picking = null;
  $("cardPick").hidden = true;
  $("cardHome").hidden = false;
  $(from).focus();
}

function renderPick() {
  const modes = Object.entries(MODE_INFO).map(([value, info]) => ({ value, label: info.name }));
  segmented($("modePicker"), modes, soloMode, value => {
    soloMode = value;
    store.set("soloMode", value);
    renderPick();
    $("modePicker").querySelector('[aria-checked="true"]').focus();
  });
  $("modeDesc").textContent = MODE_INFO[soloMode].desc;

  $("levelPicker").replaceChildren(...LEVELS.map(level => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `level level-${level.id}`;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", level.symbolsPerCard === symbolsPerCard);
    button.innerHTML = `<span class="level-emoji" aria-hidden="true"></span><span></span>`;
    button.firstChild.textContent = LEVEL_EMOJI[level.id];
    button.lastChild.textContent = level.name;
    button.addEventListener("click", () => {
      symbolsPerCard = level.symbolsPerCard;
      store.set("symbolsPerCard", symbolsPerCard);
      renderPick();
      $("levelPicker").querySelector('[aria-checked="true"]').focus();
    });
    return button;
  }));
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

// A solo game opens with the same 3, 2, 1, Go! as a friends game; the cards are dealt
// and the clock starts when it ends.
function startGame(chosenMode) {
  mode = chosenMode;
  cancelAnimationFrame(frame);
  game = null;
  const q = symbolsPerCard - 1;
  const symbolIds = Array.from({ length: deckSizeFor(q) }, (_, id) => id);
  const deck = new DeckGenerator(q, symbolIds).generate({ maxCards: MAX_CARDS });
  emoji = pickEmoji(symbolIds.length);
  clearLayouts();

  $("scoreLabel").textContent = mode === MODES.clock ? "Matches" : "Cards";
  $("time").textContent = mode === MODES.clock ? (CLOCK_DURATION_MS / 1000).toFixed(1) : formatTime(0);
  $("score").textContent = 0;
  renderPips($("mistakes"), 0, WRONG_TAPS_ALLOWED_PER_GAME);
  $("topCard").replaceChildren();
  $("yourCard").replaceChildren();
  show("play");

  runCountdown(COUNTDOWN_MS, {
    title: `${MODE_INFO[mode].name} · ${levelName(symbolsPerCard)}`,
    onDone: () => {
      game = new SoloGame(deck, { mode, now: performance.now() });
      renderCard($("topCard"), game.topCard, emoji, "deal");
      renderCard($("yourCard"), game.yourCard, emoji, "deal");
      renderHud(performance.now());
      frame = requestAnimationFrame(loop);
    },
  });
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
    // The won card slides down onto your pile, with a buzz.
    buzz();
    slideCard($("topCard"), $("yourCard"));
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

  $("resultMode").textContent = `${MODE_INFO[mode].name} · ${levelName(symbolsPerCard)}`;
  const forfeited = g.status === "forfeit";
  $("resultsName").textContent = forfeited ? "Forfeit" : "Results";
  $("resultPips").hidden = !forfeited;
  renderPips($("resultPips"), WRONG_TAPS_ALLOWED_PER_GAME + 1, WRONG_TAPS_ALLOWED_PER_GAME + 1);
  $("again").textContent = forfeited ? "Try again" : "Play again";
  const stats = [];
  let best = "";
  let isNewBest = false;

  if (forfeited) {
    $("resultTitle").textContent = "Forfeit";
    $("resultMain").textContent = `${WRONG_TAPS_ALLOWED_PER_GAME + 1} wrong taps`;
    stats.push(["Matches before that", g.score], ["Cards locked out", g.missed]);
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
  $("resultBest").textContent = isNewBest ? "🎉 New best!" : best;
  $("resultBest").classList.toggle("new", isNewBest);
  show("results");
}

/* ---------- navigation ---------- */

function goHome() {
  cancelAnimationFrame(frame);
  stopCountdown();
  stopTutorial();
  game = null;
  picking = null;
  $("cardPick").hidden = true;
  $("cardHome").hidden = false;
  show("home");
}

$("pickSolo").addEventListener("click", () => openPick("solo"));
$("pickFriends").addEventListener("click", () => openPick("friends"));
$("pickBack").addEventListener("click", closePick);
$("pickGo").addEventListener("click", () => {
  if (picking === "solo") startGame(soloMode);
  else createRoomAtLevel(symbolsPerCard);
});
$("homeJoin").addEventListener("submit", event => {
  event.preventDefault();
  joinWithCode($("homeCode").value);
});
// The logo in every white bar goes back to the home screen (leaving any friends' room).
for (const button of document.querySelectorAll("[data-home]")) {
  button.addEventListener("click", () => (inRoom() ? leaveRoom() : goHome()));
}
$("tutorial").addEventListener("click", startTutorial);
// Safari on iPhone only shows :active (the press animation) on pages that listen for touches.
document.addEventListener("touchstart", () => {}, { passive: true });
$("quit").addEventListener("click", goHome);
$("again").addEventListener("click", () => startGame(mode));
$("toHome").addEventListener("click", goHome);

initFriends({ goHome });
initTutorial({ goHome });
