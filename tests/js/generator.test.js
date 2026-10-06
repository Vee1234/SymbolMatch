import { test } from "node:test";
import assert from "node:assert/strict";

import { DeckGenerator, deckSizeFor, LEVELS, levelName, SUPPORTED_SYMBOLS_PER_CARD } from "../../src/client/shared/generator.js";
import { SetChecker } from "../../src/client/shared/checker.js";

const symbolPool = q => Array.from({ length: deckSizeFor(q) }, (_, id) => id);

test("generated decks are valid", () => {
  for (const q of [2, 3, 5, 7, 11]) {
    const deck = new DeckGenerator(q, symbolPool(q)).generate();
    assert.deepEqual(new SetChecker(q).findProblems(deck), {}, `q = ${q}`);
  }
});

test("one generator makes many valid decks", () => {
  const generator = new DeckGenerator(7, symbolPool(7));
  const checker = new SetChecker(7);
  for (let n = 0; n < 5; n++) {
    assert.deepEqual(checker.findProblems(generator.generate()), {});
  }
});

test("deck uses exactly the given symbols", () => {
  const pool = Array.from({ length: 57 }, (_, n) => `symbol${n}`);
  const deck = new DeckGenerator(7, pool).generate();
  assert.deepEqual(new Set(deck.cards.flat()), new Set(pool));
});

test("caller's symbol array is not changed", () => {
  const pool = symbolPool(7);
  new DeckGenerator(7, pool).generate();
  assert.deepEqual(pool, symbolPool(7));
});

test("maxCards caps the deck and the capped deck is still valid", () => {
  const deck = new DeckGenerator(11, symbolPool(11)).generate({ maxCards: 57 });
  assert.equal(deck.cards.length, 57);
  assert.deepEqual(new SetChecker(11).findProblems(deck, { complete: false }), {});
});

test("rejects q that is not prime", () => {
  for (const q of [0, 1, 4, 6, 9]) {
    assert.throws(() => new DeckGenerator(q, symbolPool(q)), RangeError, `q = ${q}`);
  }
});

test("rejects wrong number of symbols", () => {
  assert.throws(() => new DeckGenerator(7, symbolPool(7).slice(1)), RangeError);
  assert.throws(() => new DeckGenerator(7, [...symbolPool(7), 57]), RangeError);
});

test("rejects repeated symbols", () => {
  const pool = symbolPool(2);
  pool[pool.length - 1] = pool[0];
  assert.throws(() => new DeckGenerator(2, pool), RangeError);
});

test("every difficulty level uses a supported card size, getting harder in order", () => {
  assert.deepEqual(LEVELS.map(level => level.symbolsPerCard), [6, 8, 12]);
  for (const level of LEVELS) assert.ok(SUPPORTED_SYMBOLS_PER_CARD.includes(level.symbolsPerCard), level.name);
});

test("levelName names a card size by its level", () => {
  assert.equal(levelName(6), "Easy");
  assert.equal(levelName(12), "Hard");
  assert.equal(levelName(4), "4 per card");
});
