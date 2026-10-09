// The tutorial: a game played for you on Easy cards, explained one step at a time (tap
// Next to go on), then three matches for you to find yourself. It uses the same cards and
// animations as a real game, and the rules from shared/.

import { DeckGenerator, deckSizeFor, shuffle } from "./shared/generator.js";
import { sharedSymbol, WRONG_TAPS_ALLOWED_PER_GAME } from "./shared/game.js";
import { pickEmoji } from "./shared/symbols.js";
import { $, show, buzz, slideCard, popOnce } from "./ui.js";
import { renderCard, replayAnimation, onSymbolTap, clearLayouts } from "./cards.js";

const Q = 5; // Easy: 6 symbols per card
const PRACTICE_MATCHES = 3;
const CLUE_AFTER_WRONG_TAPS = 2; // wrong taps on one card before the answer starts glowing

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

let goHome = () => {};
let run = 0; // bumped on every start and stop, so a step still animating from an old run stops
let emoji = [];
let pile = [];
let centre = null;
let yours = null;
let stepIndex = 0;
let practice = null; // { found, wrongOnCard } while you're finding matches yourself

const shared = () => sharedSymbol(yours, centre);
const symbolOn = (cardEl, symbol) => cardEl.querySelector(`.symbol[data-symbol="${symbol}"]`);

// Each step is explained in the panel under the cards. A step can spotlight a card, make
// the shared symbol glow, or play a move for you before Next can be tapped.
const STEPS = [
  { text: () => "Welcome to Symbolic! Every card has six symbols, and any two cards share exactly one of them. Never more, never less." },
  { text: () => "This is the centre card. Everyone races to win it.", spotlight: "tutCentre" },
  { text: () => "And this is your card.", spotlight: "tutYours" },
  { text: () => `Can you see it? The ${emoji[shared()]} is on both cards. It's the only symbol they share.`, clue: true },
  { text: () => "Tap the shared symbol first and you win the centre card. It lands on your pile and becomes your new card.", play: playMatch },
  { text: () => "A new centre card is turned over. Now you're matching it against the card you just won.", spotlight: "tutCentre" },
  { text: () => "Tap the wrong symbol and it shakes. You get one wrong tap per card. A second one locks you out of that card until the next.", play: playWrongTap },
  { text: () => `Every wrong tap counts towards the game, and the ${WRONG_TAPS_ALLOWED_PER_GAME + 1}th means you're out. So don't just tap everything!` },
  { text: () => "Playing with friends, everyone sees the same centre card. Whoever taps the match first wins it, so be quick!" },
  { practice: true },
  { done: true },
];

export function initTutorial(options) {
  goHome = options.goHome;
  $("coachNext").addEventListener("click", () => showStep(stepIndex + 1));
  $("tutorialAgain").addEventListener("click", startTutorial);
  $("tutorialMenu").addEventListener("click", () => goHome());
  $("tutorialSkip").addEventListener("click", () => goHome());
  onSymbolTap($("tutorialTable"), tapInPractice);
}

export function startTutorial() {
  stopTutorial();
  const symbols = Array.from({ length: deckSizeFor(Q) }, (_, id) => id);
  pile = shuffle(new DeckGenerator(Q, symbols).generate().cards);
  emoji = pickEmoji(symbols.length);
  clearLayouts();
  yours = pile.pop();
  centre = pile.pop();
  renderCard($("tutYours"), yours, emoji, "deal");
  renderCard($("tutCentre"), centre, emoji, "deal");
  show("tutorialScreen");
  showStep(0);
}

// Called when leaving the tutorial, so nothing from it carries on in the background.
export function stopTutorial() {
  run += 1;
  practice = null;
  clearHighlights();
  for (const hand of document.querySelectorAll(".tap-hand")) hand.remove();
}

async function showStep(index) {
  const token = run;
  stepIndex = index;
  const step = STEPS[index];
  clearHighlights();
  $("coachStep").textContent = step.done ? "All done" : step.practice ? "Your turn" : `Step ${index + 1} of ${STEPS.length - 2}`;
  $("coachNext").hidden = Boolean(step.practice || step.done);
  $("coachEnd").hidden = !step.done;
  $("practiceDots").hidden = !step.practice;

  if (step.practice) return startPractice();
  if (step.done) {
    $("coachText").textContent = "Nice one, you're ready to play! Run through the tutorial again, or head back to the menu to start a game.";
    $("tutorialAgain").focus({ preventScroll: true });
    return;
  }

  $("coachText").textContent = step.text();
  if (step.spotlight) $(step.spotlight).classList.add("spotlight");
  if (step.clue) showClue();
  if (step.play) {
    $("coachNext").disabled = true;
    await wait(700);
    if (token !== run) return;
    await step.play(token);
    if (token !== run) return;
    $("coachNext").disabled = false;
  }
  $("coachNext").focus({ preventScroll: true });
}

function clearHighlights() {
  for (const el of document.querySelectorAll("#tutorialScreen .spotlight, #tutorialScreen .clue")) {
    el.classList.remove("spotlight", "clue");
  }
}

// Makes the shared symbol glow on both cards.
function showClue() {
  for (const card of [$("tutCentre"), $("tutYours")]) symbolOn(card, shared())?.classList.add("clue");
}

/* ---------- moves played for you ---------- */

// A finger taps the symbol, then the tap happens.
async function pointAt(button, token) {
  const r = button.getBoundingClientRect();
  const hand = document.createElement("span");
  hand.className = "tap-hand";
  hand.setAttribute("aria-hidden", "true");
  hand.textContent = "👆";
  hand.style.left = `${r.left + r.width / 2 - 22}px`;
  hand.style.top = `${r.top + r.height / 2 - 6}px`;
  document.body.append(hand);
  await wait(650);
  hand.remove();
  return token === run;
}

async function playMatch(token) {
  if (await pointAt(symbolOn($("tutCentre"), shared()), token)) winCentreCard();
  await wait(500);
}

async function playWrongTap(token) {
  const wrong = centre.find(symbol => symbol !== shared());
  const button = symbolOn($("tutCentre"), wrong);
  if (await pointAt(button, token)) replayAnimation(button, "wrong");
  await wait(500);
}

// The centre card slides onto your pile, a +1 pops up and the next centre card is dealt,
// just like a real game.
function winCentreCard() {
  buzz();
  slideCard($("tutCentre"), $("tutYours"));
  yours = centre;
  centre = pile.pop();
  renderCard($("tutYours"), yours, emoji, "deal");
  renderCard($("tutCentre"), centre, emoji, "deal");
  popOnce($("tutPlus"), "pop");
}

/* ---------- your turn ---------- */

function startPractice() {
  practice = { found: 0, wrongOnCard: 0 };
  renderDots();
  $("coachText").textContent = `Your turn! Find the symbol that's on both cards and tap it. Get ${PRACTICE_MATCHES} to finish.`;
}

function renderDots() {
  $("practiceDots").replaceChildren(...Array.from({ length: PRACTICE_MATCHES }, (_, i) => {
    const dot = document.createElement("span");
    dot.className = i < practice.found ? "found" : "";
    return dot;
  }));
  $("practiceDots").setAttribute("aria-label", `${practice.found} of ${PRACTICE_MATCHES} found`);
}

function tapInPractice(button) {
  if (!practice) return;
  if (Number(button.dataset.symbol) !== shared()) {
    replayAnimation(button, "wrong");
    practice.wrongOnCard += 1;
    if (practice.wrongOnCard >= CLUE_AFTER_WRONG_TAPS) {
      showClue();
      $("coachText").textContent = "Not that one. Here's a clue: it's the glowing symbol, on both cards.";
    } else {
      $("coachText").textContent = "Not that one. Look for the one symbol that's on both cards.";
    }
    return;
  }

  practice.found += 1;
  practice.wrongOnCard = 0;
  winCentreCard();
  renderDots();
  if (practice.found < PRACTICE_MATCHES) {
    $("coachText").textContent = practice.found === 1 ? "Got it! Find the next one." : "Nice! Just one more.";
    return;
  }
  practice = null;
  const token = run;
  setTimeout(() => token === run && showStep(stepIndex + 1), 700);
}
