from CardSet import CardSet

class SetChecker:
    def __init__(self, q):
        self.card_count = q*q + q + 1
        self.symbol_count = q*q + q + 1
        self.card_size = q + 1

    def find_problems(self, card_set: CardSet):
        problems = {}

        card_count = self._count_cards(card_set)
        if card_count != self.card_count:
            problems["card_count"] = card_count

        invalid_card_sizes = self._find_invalid_card_sizes(card_set)
        if invalid_card_sizes:
            problems["card_sizes"] = invalid_card_sizes

        symbol_count = self._count_symbols(card_set)
        if symbol_count != self.symbol_count:
            problems["symbol_count"] = symbol_count

        invalid_pairs = self._find_invalid_pairs(card_set)
        if invalid_pairs:
            problems["pairs"] = invalid_pairs

        return problems

    def is_valid(self, card_set: CardSet):
        return not self.find_problems(card_set)

    @staticmethod
    def _count_cards(card_set: CardSet):
        return len(card_set.cards)

    def _find_invalid_card_sizes(self, card_set: CardSet):
        invalid_cards = []
        for card in card_set.cards:
            if len(set(card.symbols)) != self.card_size:
                invalid_cards.append(card)
        return invalid_cards

    @staticmethod
    def _count_symbols(card_set: CardSet):
        symbol_set = set()
        for card in card_set.cards:
            symbol_set.update(card.symbols)
        return len(symbol_set)

    @staticmethod
    def _find_invalid_pairs(card_set: CardSet):
        cards = card_set.cards
        invalid_pairs = []
        sets = [set(card.symbols) for card in cards]
        for i in range(len(sets)):
            for j in range(i + 1, len(sets)):
                if len(sets[i] & sets[j]) != 1:
                    invalid_pairs.append([cards[i], cards[j]])
        return invalid_pairs
