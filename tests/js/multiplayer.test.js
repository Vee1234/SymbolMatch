import { test } from "node:test";
import assert from "node:assert/strict";

import { DeckGenerator, deckSizeFor } from "../../src/client/shared/generator.js";
import { sharedSymbol } from "../../src/client/shared/game.js";
import {
  createGame, applyTap, standings, viewFor, isLockedOut, playerStats, awardBadges, gameSummary, readiness, forfeitPlayer, COUNTDOWN_MS,
} from "../../src/client/shared/multiplayer.js";
import { verdictFor, verdictKind, VERDICTS } from "../../src/client/shared/verdicts.js";

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

/* ---------- end-of-game summary ---------- */

const tapAt = (game, id, symbol, now) => applyTap(game, id, symbol, game.centreSeq, now);

test("each match records how long the centre card had been showing", () => {
  const game = createGame(makeDeck(7), "tower", ["a", "b"], 1000);
  tapAt(game, "a", right(game, "a"), 3000); // 2 s after the start
  tapAt(game, "b", right(game, "b"), 3500); // 0.5 s after the new centre card
  tapAt(game, "a", right(game, "a"), 7500); // 4 s
  const [a, b] = playerStats(game);
  assert.deepEqual(game.players.a.matchTimes, [2000, 4000]);
  assert.equal(a.averageMs, 3000);
  assert.equal(a.fastestMs, 2000);
  assert.equal(b.fastestMs, 500);
});

test("players who never made a match have no times", () => {
  const game = createGame(makeDeck(7), "tower", ["a", "b"], 0);
  tapAt(game, "a", right(game, "a"), 100);
  const b = playerStats(game).find(s => s.id === "b");
  assert.equal(b.matches, 0);
  assert.equal(b.averageMs, null);
  assert.equal(b.fastestMs, null);
});

test("the summary says how long the game lasted, and only once it has ended", () => {
  const game = createGame(makeDeck(2), "well", ["a", "b"], 10_000);
  assert.equal(viewFor(game, "a").summary, null);
  let now = 10_000;
  while (game.status === "playing") {
    now += 1000;
    tapAt(game, "a", right(game, "a"), now);
  }
  const view = viewFor(game, "a");
  assert.equal(view.summary.durationMs, now - 10_000);
  assert.equal(view.summary.players.length, 2);
});

test("winning centre cards in a row builds a streak; anyone else winning resets it", () => {
  const game = createGame(makeDeck(7), "tower", ["a", "b"], 0);
  for (const id of ["a", "a", "a", "b", "a"]) tapAt(game, id, right(game, id), 1);
  assert.equal(game.players.a.bestStreak, 3);
  assert.equal(game.players.a.streak, 1);
});

test("badges go to every player who ties for them and are left out when nobody qualifies", () => {
  const stats = [
    { id: "a", matches: 3, averageMs: 900, fastestMs: 400, wrongTotal: 0, bestStreak: 3 },
    { id: "b", matches: 3, averageMs: 1200, fastestMs: 400, wrongTotal: 4, bestStreak: 1 },
    { id: "c", matches: 0, averageMs: null, fastestMs: null, wrongTotal: 1, bestStreak: 0 },
  ];
  const byBadge = Object.fromEntries(awardBadges(stats).map(b => [b.badge, b.playerIds]));
  assert.deepEqual(byBadge.quickest, ["a", "b"]);
  assert.deepEqual(byBadge.fastestAverage, ["a"]);
  assert.deepEqual(byBadge.sharpshooter, ["a"]);
  assert.deepEqual(byBadge.hotStreak, ["a"]);
  assert.deepEqual(byBadge.butterfingers, ["b"]);

  const quiet = awardBadges([{ id: "a", matches: 1, averageMs: 5, fastestMs: 5, wrongTotal: 1, bestStreak: 1 }]);
  assert.deepEqual(quiet.map(b => b.badge), ["quickest"]);
});

test("a game saved before times were recorded still finishes and summarises", () => {
  const game = createGame(makeDeck(7), "tower", ["a", "b"], 0);
  for (const key of ["startedAt", "endedAt", "centreShownAt", "lastWinner"]) delete game[key];
  for (const p of Object.values(game.players)) {
    delete p.matchTimes; delete p.streak; delete p.bestStreak;
  }
  assert.equal(tap(game, "a", right(game, "a")), "correct");
  assert.equal(gameSummary(game).durationMs, null);
  assert.equal(playerStats(game)[0].matches, 1);
});

test("each player gets a deadpan line for how they finished", () => {
  const all = [
    { id: "a", place: 1, won: 9, wrongTotal: 1, forfeited: false },
    { id: "b", place: 2, won: 4, wrongTotal: 0, forfeited: false },
    { id: "c", place: 3, won: 0, wrongTotal: 0, forfeited: false },
    { id: "d", place: 4, won: 0, wrongTotal: 2, forfeited: false },
    { id: "e", place: 5, won: 3, wrongTotal: 6, forfeited: true, forfeitReason: "wrongTaps" },
    { id: "f", place: 5, won: 1, wrongTotal: 0, forfeited: true, forfeitReason: "left" },
  ];
  assert.deepEqual(all.map(s => verdictKind(s, all)), ["first", "middle", "noResult", "middle", "wrongTaps", "left"]);
  const two = [
    { id: "a", place: 1, won: 5, wrongTotal: 0, forfeited: false },
    { id: "b", place: 2, won: 2, wrongTotal: 1, forfeited: false },
  ];
  assert.equal(verdictKind(two[1], two), "last");
  const tie = [
    { id: "a", place: 1, won: 5, wrongTotal: 0, forfeited: false },
    { id: "b", place: 1, won: 5, wrongTotal: 0, forfeited: false },
  ];
  assert.deepEqual(tie.map(s => verdictKind(s, tie)), ["first", "first"]);
});

test("every way of finishing has plenty of different lines", () => {
  for (const [kind, lines] of Object.entries(VERDICTS)) {
    assert.equal(new Set(lines).size, lines.length, `${kind} has a repeated line`);
    assert.ok(lines.length >= 30, kind);
  }
});

test("standings say whether a forfeit came from leaving or from wrong taps", () => {
  const game = createGame(makeDeck(7), "tower", ["a", "b", "c"]);
  forfeitPlayer(game, "c");
  for (let i = 0; i < 6; i++) {
    if (isLockedOut(game, "b")) tap(game, "a", right(game, "a")); // a new centre card ends the lockout
    tap(game, "b", wrong(game, "b"));
  }
  const reasons = Object.fromEntries(standings(game).map(s => [s.id, s.forfeitReason]));
  assert.deepEqual(reasons, { a: null, b: "wrongTaps", c: "left" });
});

/* ---------- ready to start ---------- */

test("the game can start only when at least two players are in and everyone is ready", () => {
  const p = (id, ready, connected = true) => ({ id, ready, connected });
  assert.equal(readiness([p("a", true)]).canStart, false);
  assert.deepEqual(readiness([p("a", true), p("b", false)]), { players: 2, waitingFor: ["b"], canStart: false });
  assert.equal(readiness([p("a", true), p("b", true)]).canStart, true);
  // Offline players aren't dealt in, so they don't hold the game up.
  assert.deepEqual(readiness([p("a", true), p("b", true), p("c", false, false)]), { players: 2, waitingFor: [], canStart: true });
});

test("every phone picks the same line for the same player", () => {
  const all = [
    { id: "a", place: 1, won: 5, wrongTotal: 0, forfeited: false },
    { id: "b", place: 2, won: 2, wrongTotal: 0, forfeited: false },
  ];
  assert.equal(verdictFor(all[0], all, 123), verdictFor(all[0], all, 123));
  assert.ok(VERDICTS.first.includes(verdictFor(all[0], all, 123)));
});

/* ---------- opening countdown ---------- */

test("taps during the opening countdown don't count, and times start when it ends", () => {
  const game = createGame(makeDeck(7), "tower", ["a", "b"], 1000, COUNTDOWN_MS);
  assert.equal(viewFor(game, "a", 1000).startsInMs, COUNTDOWN_MS);
  assert.equal(applyTap(game, "a", right(game, "a"), game.centreSeq, 2000), "ignored");
  assert.equal(game.players.a.won, 0);
  const start = 1000 + COUNTDOWN_MS;
  assert.equal(viewFor(game, "a", start + 50).startsInMs, 0);
  assert.equal(applyTap(game, "a", right(game, "a"), game.centreSeq, start + 700), "correct");
  assert.deepEqual(game.players.a.matchTimes, [700]);
});
