// Game rules, kept free of any browser code so they can be tested with node --test
// and reused by the multiplayer rooms on the Worker.
//
// Solo play follows the "pick one up" style: the top card is the centre card and the
// bottom card is yours. Spot the symbol they share and the centre card becomes your new
// card; the next centre card is turned over.
//
// Wrong taps (GameRequirements.md): one wrong tap on a card is allowed; a second wrong
// tap on the same card locks you out of it (it's discarded and you don't score it).
// Every wrong tap counts towards the game, and the 6th wrong tap forfeits the game.

import { shuffle } from "./generator.js";

export const WRONG_TAPS_ALLOWED_PER_CARD = 1;
export const WRONG_TAPS_ALLOWED_PER_GAME = 5;
export const CLOCK_DURATION_MS = 60_000;

export const MODES = {
  clock: "clock", // Beat the clock: as many matches as possible in a fixed time
  race: "race",   // Race the deck: get through the whole deck as fast as possible
};

export function sharedSymbol(cardA, cardB) {
  const inB = new Set(cardB);
  const shared = cardA.filter(symbol => inB.has(symbol));
  return shared.length === 1 ? shared[0] : null;
}

export class SoloGame {
  constructor(deck, { mode = MODES.clock, durationMs = CLOCK_DURATION_MS, now = 0 } = {}) {
    if (deck.cards.length < 2) {
      throw new RangeError("a game needs at least 2 cards");
    }
    this.mode = mode;
    this.durationMs = durationMs;
    this.startedAt = now;
    this.endedAt = null;
    this.status = "playing"; // playing | timeUp | deckCleared | forfeit

    this.allCards = deck.cards;
    this.pile = shuffle([...deck.cards]);
    this.yourCard = this.pile.pop();
    this.topCard = this.pile.pop();
    this.cardsPlayed = 1; // number of centre cards turned over so far

    this.score = 0;
    this.missed = 0;
    this.wrongTotal = 0;
    this.wrongThisCard = 0;
  }

  get wrongTapsLeft() {
    return WRONG_TAPS_ALLOWED_PER_GAME - this.wrongTotal;
  }

  // Race mode: how many centre cards the whole deck holds (every card except your first).
  get totalRounds() {
    return this.allCards.length - 1;
  }

  elapsedMs(now) {
    return (this.endedAt ?? now) - this.startedAt;
  }

  timeLeftMs(now) {
    return Math.max(0, this.durationMs - this.elapsedMs(now));
  }

  // Call regularly (e.g. every animation frame) so Beat the clock ends on time.
  tick(now) {
    if (this.status === "playing" && this.mode === MODES.clock && this.timeLeftMs(now) === 0) {
      this.end("timeUp", this.startedAt + this.durationMs);
    }
    return this.status;
  }

  // Returns what happened: "correct", "wrong", "lockedOut", "forfeit" or "ignored".
  tap(symbol, now) {
    if (this.tick(now) !== "playing") return "ignored";
    if (!this.yourCard.includes(symbol) && !this.topCard.includes(symbol)) return "ignored";

    if (symbol === sharedSymbol(this.yourCard, this.topCard)) {
      this.score += 1;
      this.yourCard = this.topCard;
      this.nextCentreCard(now);
      return "correct";
    }

    this.wrongTotal += 1;
    this.wrongThisCard += 1;
    if (this.wrongTotal > WRONG_TAPS_ALLOWED_PER_GAME) {
      this.end("forfeit", now);
      return "forfeit";
    }
    if (this.wrongThisCard > WRONG_TAPS_ALLOWED_PER_CARD) {
      this.missed += 1;
      this.nextCentreCard(now);
      return "lockedOut";
    }
    return "wrong";
  }

  nextCentreCard(now) {
    this.wrongThisCard = 0;
    if (this.pile.length === 0) {
      if (this.mode === MODES.race) {
        this.end("deckCleared", now);
        return;
      }
      // Beat the clock: reshuffle every card except yours and keep going. Any two cards
      // of a valid deck share exactly one symbol, so the deck can be reused indefinitely.
      this.pile = shuffle(this.allCards.filter(card => card !== this.yourCard));
    }
    this.topCard = this.pile.pop();
    this.cardsPlayed += 1;
  }

  end(status, at) {
    this.status = status;
    this.endedAt = at;
  }
}
