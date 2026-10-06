// Draws a card: its symbols scattered in a circle at different sizes and angles, like the
// physical game. Each symbol is a button carrying its id in data-symbol.

// Slot positions (fractions of the card) for each number of symbols per card, plus the
// base symbol size as a fraction of the card's width.
const ring = (n, radius) => Array.from({ length: n }, (_, i) => {
  const angle = (2 * Math.PI * i) / n;
  return [0.5 + radius * Math.cos(angle), 0.5 + radius * Math.sin(angle)];
});
const LAYOUTS = {
  3: { slots: ring(3, 0.25), size: 0.27 },
  4: { slots: ring(4, 0.26), size: 0.24 },
  6: { slots: [[0.5, 0.5], ...ring(5, 0.31)], size: 0.19 },
  8: { slots: [[0.5, 0.5], ...ring(7, 0.33)], size: 0.16 },
  12: { slots: [...ring(4, 0.16), ...ring(8, 0.355)], size: 0.125 },
};

const random = (min, max) => min + Math.random() * (max - min);

// Keyed by the card's symbols, so a card keeps the same look every time it's drawn, even
// when it arrives as a fresh copy from the server.
const layoutCache = new Map();

export function clearLayouts() {
  layoutCache.clear();
}

function layoutFor(card) {
  const key = card.join(",");
  if (!layoutCache.has(key)) {
    const { slots, size } = LAYOUTS[card.length];
    const spin = random(0, 2 * Math.PI);
    const order = [...slots.keys()].sort(() => Math.random() - 0.5);
    layoutCache.set(key, card.map((symbol, i) => {
      const [x, y] = slots[order[i]];
      const dx = x - 0.5, dy = y - 0.5;
      return {
        symbol,
        x: 0.5 + dx * Math.cos(spin) - dy * Math.sin(spin),
        y: 0.5 + dx * Math.sin(spin) + dy * Math.cos(spin),
        size: size * random(0.8, 1.15),
        turn: random(-35, 35),
      };
    }));
  }
  return layoutCache.get(key);
}

export function renderCard(el, card, emoji, animation) {
  el.replaceChildren(...layoutFor(card).map(({ symbol, x, y, size, turn }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "symbol";
    button.dataset.symbol = symbol;
    button.textContent = emoji[symbol];
    button.setAttribute("aria-label", emoji[symbol]);
    button.style.left = `${x * 100}%`;
    button.style.top = `${y * 100}%`;
    button.style.width = button.style.height = `calc(var(--card-size) * ${size * 1.3})`;
    button.style.fontSize = `calc(var(--card-size) * ${size})`;
    button.style.setProperty("--turn", `${turn}deg`);
    return button;
  }));
  if (animation) replayAnimation(el, animation);
}

export function replayAnimation(el, className) {
  el.classList.remove(className);
  void el.offsetWidth; // restart the CSS animation
  el.classList.add(className);
}

// Calls onTap(button) as soon as a finger touches a symbol (pointerdown matters in a speed
// game). Keyboard users still get click; detail === 0 means it didn't come from a pointer.
export function onSymbolTap(container, onTap) {
  container.addEventListener("pointerdown", event => {
    const button = event.target.closest(".symbol");
    if (button) onTap(button);
  });
  container.addEventListener("click", event => {
    const button = event.target.closest(".symbol");
    if (button && event.detail === 0) onTap(button);
  });
}
