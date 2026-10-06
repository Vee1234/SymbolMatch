// JavaScript port of DeckGenerator.py. Implements docs/CardGenerationAlgorithm.txt.
// A deck is { q, cards }, where each card is an array of symbols. Plain arrays keep
// decks easy to send between the Worker and the phones as JSON.

// Symbols per card that the algorithm supports: q + 1 for prime q.
export const SUPPORTED_SYMBOLS_PER_CARD = [3, 4, 6, 8, 12];

export function isPrime(n) {
  if (!Number.isInteger(n) || n < 2) return false;
  for (let d = 2; d * d <= n; d++) {
    if (n % d === 0) return false;
  }
  return true;
}

export function deckSizeFor(q) {
  return q * q + q + 1;
}

export function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export class DeckGenerator {
  constructor(q, symbols) {
    if (!isPrime(q)) {
      throw new RangeError(`q must be prime, got ${q}`);
    }
    const deckSize = deckSizeFor(q);
    if (symbols.length !== deckSize) {
      throw new RangeError(`q = ${q} needs exactly ${deckSize} symbols, got ${symbols.length}`);
    }
    if (new Set(symbols).size !== symbols.length) {
      throw new RangeError("symbols must all be different");
    }

    this.q = q;
    this.symbols = [...symbols]; // own copy, so later changes to the caller's array can't affect it
  }

  // maxCards caps the deck (e.g. 57) for large q, where the full deck would be huge.
  // Any subset of a valid deck is still valid: every pair still shares exactly one symbol.
  generate({ maxCards = Infinity } = {}) {
    const q = this.q;
    const symbols = [...this.symbols]; // working copy: shuffled and used up by this call only
    const grid = Array.from({ length: q }, () => Array.from({ length: q }, () => [])); // grid[x][y]
    const vanishingPoints = Array.from({ length: q + 1 }, () => []);

    // Steps 1-2
    shuffle(symbols);
    const infinitySymbol = symbols.pop();
    for (const card of vanishingPoints) {
      card.push(infinitySymbol);
    }

    // Step 3
    for (let g = 0; g <= q; g++) {
      // Step 4
      const direction = g < q ? [1, g] : [0, 1];
      // Step 5
      for (let i = 0; i < q; i++) {
        // Step 6
        const r = symbols.pop();
        // Step 7
        let [x, y] = g < q ? [0, i] : [i, 0];
        // Step 8
        for (let k = 0; k < q; k++) {
          // Step 9
          grid[x][y].push(r);
          // Step 10
          [x, y] = [(x + direction[0]) % q, (y + direction[1]) % q];
        }
        // Step 11
        vanishingPoints[g].push(r);
      }
    }

    // Step 12
    const cards = [...grid.flat(), ...vanishingPoints];
    // Step 13
    for (const card of cards) {
      shuffle(card);
    }
    shuffle(cards);
    // Step 14
    return { q, cards: cards.slice(0, maxCards) };
  }
}
