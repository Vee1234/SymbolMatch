// JavaScript port of SetChecker.py. Checks a deck of the form { q, cards }.
//
// A complete deck (every card the algorithm makes) must pass all four checks exactly.
// A capped deck ({ complete: false }) is a subset of one: the card and symbol counts
// can only be at most the full-deck size, but card sizes and pairs are checked as usual.

import { deckSizeFor } from "./generator.js";

export class SetChecker {
  constructor(q) {
    this.cardCount = deckSizeFor(q);
    this.symbolCount = deckSizeFor(q);
    this.cardSize = q + 1;
  }

  findProblems(deck, { complete = true } = {}) {
    const problems = {};
    const countOk = complete ? (n, target) => n === target : (n, target) => n <= target;

    const cardCount = SetChecker.countCards(deck);
    if (!countOk(cardCount, this.cardCount)) {
      problems.cardCount = cardCount;
    }

    const invalidCardSizes = this.findInvalidCardSizes(deck);
    if (invalidCardSizes.length) {
      problems.cardSizes = invalidCardSizes;
    }

    const symbolCount = SetChecker.countSymbols(deck);
    if (!countOk(symbolCount, this.symbolCount)) {
      problems.symbolCount = symbolCount;
    }

    const invalidPairs = SetChecker.findInvalidPairs(deck);
    if (invalidPairs.length) {
      problems.pairs = invalidPairs;
    }

    return problems;
  }

  isValid(deck, options) {
    return Object.keys(this.findProblems(deck, options)).length === 0;
  }

  static countCards(deck) {
    return deck.cards.length;
  }

  findInvalidCardSizes(deck) {
    return deck.cards.filter(card => new Set(card).size !== this.cardSize);
  }

  static countSymbols(deck) {
    return new Set(deck.cards.flat()).size;
  }

  static findInvalidPairs(deck) {
    const cards = deck.cards;
    const sets = cards.map(card => new Set(card));
    const invalidPairs = [];
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        const shared = [...sets[i]].filter(symbol => sets[j].has(symbol));
        if (shared.length !== 1) {
          invalidPairs.push([cards[i], cards[j]]);
        }
      }
    }
    return invalidPairs;
  }
}
