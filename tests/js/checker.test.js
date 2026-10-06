import { test } from "node:test";
import assert from "node:assert/strict";

import { SetChecker } from "../../src/client/shared/checker.js";

// q = 2 examples from working out the checks: each broken deck fails exactly one check.
const fano = [[0, 1, 2], [0, 3, 4], [0, 5, 6], [1, 3, 5], [1, 4, 6], [2, 3, 6], [2, 4, 5]];
const deck = cards => ({ q: 2, cards });
const checker = new SetChecker(2);
const failedChecks = (cards, options) => Object.keys(checker.findProblems(deck(cards), options)).sort();

test("Fano plane is valid", () => {
  assert.deepEqual(checker.findProblems(deck(fano)), {});
  assert.equal(checker.isValid(deck(fano)), true);
});

test("missing card fails only the card count", () => {
  assert.deepEqual(failedChecks(fano.slice(0, -1)), ["cardCount"]);
});

test("near-pencil fails only the card sizes", () => {
  const nearPencil = [[1, 2, 3, 4, 5, 6], ...[1, 2, 3, 4, 5, 6].map(i => [0, i])];
  assert.deepEqual(failedChecks(nearPencil), ["cardSizes"]);
});

test("windmill fails only the symbol count", () => {
  const windmill = Array.from({ length: 7 }, (_, i) => ["X", `a${i}`, `b${i}`]);
  assert.deepEqual(failedChecks(windmill), ["symbolCount"]);
});

test("moving one symbol fails only the pair check", () => {
  assert.deepEqual(failedChecks([[0, 1, 3], ...fano.slice(1)]), ["pairs"]);
});

test("repeated symbol on a card is caught", () => {
  assert.ok(failedChecks([[0, 0, 1], ...fano.slice(1)]).includes("cardSizes"));
});

test("capped deck relaxes only the counts", () => {
  assert.deepEqual(failedChecks(fano.slice(0, -1), { complete: false }), []);
  assert.deepEqual(failedChecks([[0, 1, 3], ...fano.slice(1, -1)], { complete: false }), ["pairs"]);
});
