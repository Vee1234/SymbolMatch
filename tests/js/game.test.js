import { test } from "node:test";
import assert from "node:assert/strict";

import { DeckGenerator, deckSizeFor } from "../../src/client/shared/generator.js";
import { SoloGame, MODES, sharedSymbol, WRONG_TAPS_ALLOWED_PER_GAME } from "../../src/client/shared/game.js";
import { EMOJI, pickEmoji } from "../../src/client/shared/symbols.js";

const makeDeck = q => new DeckGenerator(q, Array.from({ length: deckSizeFor(q) }, (_, id) => id)).generate();
const match = game => sharedSymbol(game.yourCard, game.topCard);
const wrongSymbol = game => game.topCard.find(symbol => symbol !== match(game));

test("sharedSymbol finds the one symbol two cards share", () => {
  assert.equal(sharedSymbol([1, 2, 3], [3, 4, 5]), 3);
  assert.equal(sharedSymbol([1, 2, 3], [4, 5, 6]), null);
  assert.equal(sharedSymbol([1, 2, 3], [2, 3, 4]), null);
});

test("a correct tap scores and the centre card becomes yours", () => {
  const game = new SoloGame(makeDeck(7));
  const centre = game.topCard;
  assert.equal(game.tap(match(game), 100), "correct");
  assert.equal(game.score, 1);
  assert.equal(game.yourCard, centre);
  assert.notEqual(game.topCard, centre);
});

test("the second wrong tap on a card locks you out of it", () => {
  const game = new SoloGame(makeDeck(7));
  const centre = game.topCard;
  assert.equal(game.tap(wrongSymbol(game), 100), "wrong");
  assert.equal(game.topCard, centre);
  assert.equal(game.tap(wrongSymbol(game), 200), "lockedOut");
  assert.equal(game.missed, 1);
  assert.equal(game.score, 0);
  assert.notEqual(game.topCard, centre);
  assert.equal(game.wrongThisCard, 0);
});

test("the 6th wrong tap in a game forfeits", () => {
  const game = new SoloGame(makeDeck(7));
  for (let n = 1; n <= WRONG_TAPS_ALLOWED_PER_GAME; n++) {
    assert.notEqual(game.tap(wrongSymbol(game), n), "forfeit");
  }
  assert.equal(game.tap(wrongSymbol(game), 99), "forfeit");
  assert.equal(game.status, "forfeit");
  assert.equal(game.tap(match(game), 100), "ignored");
});

test("tapping a symbol on neither card is ignored", () => {
  const game = new SoloGame(makeDeck(7));
  assert.equal(game.tap("not a symbol", 100), "ignored");
  assert.equal(game.wrongTotal, 0);
});

test("race mode ends when the whole deck has been played", () => {
  const game = new SoloGame(makeDeck(3), { mode: MODES.race, now: 0 });
  for (let n = 1; n <= game.totalRounds; n++) {
    assert.equal(game.tap(match(game), n * 1000), "correct");
  }
  assert.equal(game.status, "deckCleared");
  assert.equal(game.score, 12);
  assert.equal(game.elapsedMs(999_999), 12_000);
});

test("clock mode keeps going past the end of the deck and every pair still matches", () => {
  const game = new SoloGame(makeDeck(2), { mode: MODES.clock, now: 0 });
  for (let n = 1; n <= 30; n++) {
    assert.ok(match(game) !== null, `round ${n} has a match`);
    assert.equal(game.tap(match(game), n), "correct");
  }
  assert.equal(game.status, "playing");
});

test("clock mode ends when time is up", () => {
  const game = new SoloGame(makeDeck(7), { mode: MODES.clock, durationMs: 60_000, now: 0 });
  assert.equal(game.tick(59_999), "playing");
  assert.equal(game.tick(60_000), "timeUp");
  assert.equal(game.tap(match(game), 60_001), "ignored");
  assert.equal(game.timeLeftMs(70_000), 0);
});

test("emoji set is large enough, has no repeats and each is one character on screen", () => {
  assert.ok(EMOJI.length >= deckSizeFor(11), "enough for 12 symbols per card");
  assert.equal(new Set(EMOJI).size, EMOJI.length);
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  for (const emoji of EMOJI) {
    assert.equal([...segmenter.segment(emoji)].length, 1, emoji);
  }
  assert.equal(new Set(pickEmoji(57)).size, 57);
});
