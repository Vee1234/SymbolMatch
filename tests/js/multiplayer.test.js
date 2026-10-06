import { test } from "node:test";
import assert from "node:assert/strict";

import { DeckGenerator, deckSizeFor } from "../../src/client/shared/generator.js";
import { sharedSymbol } from "../../src/client/shared/game.js";
import { createGame, applyTap, standings, viewFor, isLockedOut } from "../../src/client/shared/multiplayer.js";

const makeDeck = q => new DeckGenerator(q, Array.from({ length: deckSizeFor(q) }, (_, id) => id)).generate();
const yours = (game, id) => game.players[id].pile.at(-1);
const right = (game, id) => sharedSymbol(yours(game, id), game.centre);
const wrong = (game, id) => game.centre.find(s => s !== right(game, id));
const tap = (game, id, symbol) => applyTap(game, id, symbol, game.centreSeq);

test("tower: everyone starts with one card and the rest form the centre pile", () => {
  const game = createGame(makeDeck(7), "tower", ["a", "b", "c"]);
  assert.equal(game.players.a.pile.length, 1);
  assert.equal(game.centrePile.length, 57 - 3 - 1);
});

test("tower: spotting the match wins the centre card", () => {
  const game = createGame(makeDeck(7), "tower", ["a", "b"]);
  const centre = game.centre;
  assert.equal(tap(game, "a", right(game, "a")), "correct");
  assert.equal(yours(game, "a"), centre);
  assert.equal(game.players.a.won, 1);
  assert.notEqual(game.centre, centre);
});

test("a tap on an old centre card is too late and costs nothing", () => {
  const game = createGame(makeDeck(7), "tower", ["a", "b"]);
  const oldSeq = game.centreSeq;
  const bSymbol = right(game, "b");
  tap(game, "a", right(game, "a"));
  assert.equal(applyTap(game, "b", bSymbol, oldSeq), "tooLate");
  assert.equal(game.players.b.wrongTotal, 0);
});

test("second wrong tap locks a player out until the centre card changes", () => {
  const game = createGame(makeDeck(7), "tower", ["a", "b", "c"]);
  assert.equal(tap(game, "a", wrong(game, "a")), "wrong");
  assert.equal(tap(game, "a", wrong(game, "a")), "lockedOut");
  assert.ok(isLockedOut(game, "a"));
  assert.equal(tap(game, "a", right(game, "a")), "ignored");
  tap(game, "b", right(game, "b"));
  assert.ok(!isLockedOut(game, "a"));
});

test("if everyone is locked out, tower turns over the next centre card", () => {
  const game = createGame(makeDeck(7), "tower", ["a", "b"]);
  const centre = game.centre;
  for (const id of ["a", "b"]) {
    tap(game, id, wrong(game, id));
    tap(game, id, wrong(game, id));
  }
  assert.notEqual(game.centre, centre);
  assert.ok(!isLockedOut(game, "a") && !isLockedOut(game, "b"));
});

test("the 6th wrong tap forfeits, and the game ends when fewer than two players are left", () => {
  const game = createGame(makeDeck(7), "tower", ["a", "b"]);
  let result;
  for (let n = 0; n < 6; n++) {
    result = tap(game, "a", wrong(game, "a"));
    if (isLockedOut(game, "a")) tap(game, "b", right(game, "b")); // move the centre on
  }
  assert.equal(result, "forfeit");
  assert.ok(game.players.a.forfeited);
  assert.equal(game.status, "ended");
  assert.equal(standings(game)[0].id, "b");
});

test("tower ends when the centre pile runs out; most cards won comes first", () => {
  const game = createGame(makeDeck(2), "tower", ["a", "b"]); // 7 cards: 2 dealt, 5 to play
  for (let n = 0; n < 5; n++) tap(game, n < 3 ? "a" : "b", right(game, n < 3 ? "a" : "b"));
  assert.equal(game.status, "ended");
  const [first, second] = standings(game);
  assert.deepEqual([first.id, first.won, second.id, second.won], ["a", 3, "b", 2]);
});

test("well: cards are dealt out and a match puts your card on the centre", () => {
  const game = createGame(makeDeck(7), "well", ["a", "b", "c"]);
  assert.equal(["a", "b", "c"].reduce((n, id) => n + game.players[id].pile.length, 0), 56);
  const top = yours(game, "a");
  const before = game.players.a.pile.length;
  assert.equal(tap(game, "a", right(game, "a")), "correct");
  assert.equal(game.centre, top);
  assert.equal(game.players.a.pile.length, before - 1);
});

test("well: the first player to run out of cards wins", () => {
  const game = createGame(makeDeck(2), "well", ["a", "b"]); // 6 dealt: 3 each
  while (game.status === "playing") tap(game, "a", right(game, "a"));
  const [first] = standings(game);
  assert.equal(first.id, "a");
  assert.equal(first.cardsLeft, 0);
});

test("a player's view never includes other players' cards", () => {
  const game = createGame(makeDeck(7), "well", ["a", "b"]);
  const view = viewFor(game, "a");
  assert.deepEqual(view.yourCard, yours(game, "a"));
  assert.ok(view.players.every(p => !("pile" in p)));
  assert.equal(JSON.stringify(view).includes(JSON.stringify(yours(game, "b"))), false);
});

test("games that can't be dealt are rejected", () => {
  assert.throws(() => createGame(makeDeck(2), "tower", ["a"]), RangeError);
  assert.throws(() => createGame(makeDeck(2), "tower", "abcdefg".split("")), RangeError);
  assert.throws(() => createGame(makeDeck(7), "snap", ["a", "b"]), RangeError);
});
