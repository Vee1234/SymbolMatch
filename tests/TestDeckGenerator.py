import unittest

from DeckGenerator import DeckGenerator
from SetChecker import SetChecker


def symbol_pool(q):
    return list(range(q*q + q + 1))


class TestDeckGenerator(unittest.TestCase):
    def test_generated_decks_are_valid(self):
        for q in (2, 3, 5, 7, 11):
            with self.subTest(q=q):
                deck = DeckGenerator(q, symbol_pool(q)).generate()
                self.assertEqual(SetChecker(q).find_problems(deck), {})

    def test_one_generator_makes_many_valid_decks(self):
        generator = DeckGenerator(7, symbol_pool(7))
        checker = SetChecker(7)
        for _ in range(5):
            self.assertEqual(checker.find_problems(generator.generate()), {})

    def test_deck_uses_exactly_the_given_symbols(self):
        pool = [f"symbol{n}" for n in range(57)]
        deck = DeckGenerator(7, pool).generate()
        used = {symbol for card in deck.cards for symbol in card.symbols}
        self.assertEqual(used, set(pool))

    def test_callers_symbol_list_is_not_changed(self):
        pool = symbol_pool(7)
        DeckGenerator(7, pool).generate()
        self.assertEqual(pool, symbol_pool(7))

    def test_rejects_q_that_is_not_prime(self):
        for q in (0, 1, 4, 6, 9):
            with self.subTest(q=q):
                with self.assertRaises(ValueError):
                    DeckGenerator(q, symbol_pool(q))

    def test_rejects_wrong_number_of_symbols(self):
        with self.assertRaises(ValueError):
            DeckGenerator(7, list(range(56)))
        with self.assertRaises(ValueError):
            DeckGenerator(7, list(range(58)))

    def test_rejects_repeated_symbols(self):
        pool = symbol_pool(2)
        pool[-1] = pool[0]
        with self.assertRaises(ValueError):
            DeckGenerator(2, pool)


if __name__ == "__main__":
    unittest.main()
