import random

from Card import Card
from CardSet import CardSet


class DeckGenerator:
    def __init__(self, q: int, symbols: list):
        if not self._is_prime(q):
            raise ValueError(f"q must be prime, got {q}")
        deck_size = q*q + q + 1
        if len(symbols) != deck_size:
            raise ValueError(f"q = {q} needs exactly {deck_size} symbols, got {len(symbols)}")
        if len(set(symbols)) != len(symbols):
            raise ValueError("symbols must all be different")

        self.q = q
        self.symbols = list(symbols)  # own copy, so later changes to the caller's list can't affect it

    def generate(self) -> CardSet:
        q = self.q
        symbols = list(self.symbols)  # working copy: shuffled and used up by this call only
        grid = [[Card() for _ in range(q)] for _ in range(q)]  # grid[x][y]
        vanishing_points = [Card() for _ in range(q + 1)]

        # Steps 1-2
        random.shuffle(symbols)
        infinity_symbol = symbols.pop()
        for card in vanishing_points:
            card.symbols.append(infinity_symbol)

        # Step 3
        for g in range(q + 1):
            # Step 4
            direction = (1, g) if g < q else (0, 1)
            # Step 5
            for i in range(q):
                # Step 6
                r = symbols.pop()
                # Step 7
                x, y = (0, i) if g < q else (i, 0)
                # Step 8
                for _ in range(q):
                    # Step 9
                    grid[x][y].symbols.append(r)
                    # Step 10
                    x, y = (x + direction[0]) % q, (y + direction[1]) % q
                # Step 11
                vanishing_points[g].symbols.append(r)

        # Step 12
        cards = [card for column in grid for card in column] + vanishing_points
        # Step 13
        for card in cards:
            random.shuffle(card.symbols)
        random.shuffle(cards)
        # Step 14
        return CardSet(q, cards)

    @staticmethod
    def _is_prime(n: int) -> bool:
        if n < 2:
            return False
        for d in range(2, int(n ** 0.5) + 1):
            if n % d == 0:
                return False
        return True
