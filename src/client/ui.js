// Small helpers shared by the solo game (app.js) and the friends game (friends.js).

export const $ = id => document.getElementById(id);

export function show(screenId) {
  if (document.documentElement.dataset.screen === screenId) return; // already showing
  for (const el of document.querySelectorAll(".screen")) el.hidden = el.id !== screenId;
  for (const copy of document.querySelectorAll(".card.flying")) copy.remove(); // a card mid-slide
  document.documentElement.dataset.screen = screenId;
  window.scrollTo(0, 0);
}

// A short buzz for a correct match, on phones that can vibrate. (Safari on iPhone can't,
// so there it does nothing.)
export function buzz() {
  try { navigator.vibrate?.(30); } catch { /* not allowed */ }
}

// Slides a copy of one card onto another (a won card going onto your pile, or your card
// going down on the centre), so the real cards can update underneath straight away.
export function slideCard(from, to) {
  flyCard(from, from.getBoundingClientRect(), to.getBoundingClientRect());
}

// Flies a copy of card from the box `start` to the box `end` (both screen rectangles),
// growing or shrinking to fit each: a centre card flying off to the player who won it, or
// a card flying in from the player who put it down. fadeOut fades the copy as it lands;
// hideCard hides the real card until the copy arrives.
export function flyCard(card, start, end, { fadeOut = false, hideCard = false, duration = 320 } = {}) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const a = card.getBoundingClientRect();
  if (!a.width || !start.width || !end.width) return;
  const at = r => `translate(${r.left + r.width / 2 - (a.left + a.width / 2)}px, ${r.top + r.height / 2 - (a.top + a.height / 2)}px) scale(${r.width / a.width})`;
  const copy = card.cloneNode(true);
  copy.removeAttribute("id");
  copy.classList.remove("deal", "locked", "mine");
  copy.classList.add("flying");
  copy.setAttribute("aria-hidden", "true");
  Object.assign(copy.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
  document.body.append(copy);
  if (hideCard) card.style.visibility = "hidden";
  const done = () => {
    copy.remove();
    if (hideCard) card.style.visibility = "";
  };
  const move = copy.animate(
    [{ transform: at(start) }, { transform: at(end), opacity: fadeOut ? 0 : 1 }],
    { duration, easing: hideCard ? "ease-out" : "ease-in" },
  );
  move.onfinish = move.oncancel = done;
  // Browsers pause animations in background tabs, so don't rely on onfinish alone.
  setTimeout(done, duration + 300);
}

// Shows el for one run of its CSS animation, then hides it again.
export function popOnce(el, className) {
  el.hidden = false;
  el.classList.remove(className);
  void el.offsetWidth; // restart the CSS animation
  el.classList.add(className);
  clearTimeout(el.popTimer);
  const hide = () => {
    el.hidden = true;
    el.classList.remove(className);
  };
  el.onanimationend = event => event.target === el && hide();
  // Background tabs pause animations; reduced motion turns them off.
  el.popTimer = setTimeout(hide, 2000);
}

// localStorage can be unavailable (private browsing, blocked storage); the game works without it.
export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* not saved */ } },
};

let toastTimer = 0;
export function toast(message, tone = "") {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast show ${tone}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, 1600);
}

export function formatTime(ms) {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(1);
  return minutes ? `${minutes}:${seconds.padStart(4, "0")}` : `${seconds}s`;
}

// A row of radio-style buttons. options: [{ value, label }].
export function segmented(container, options, selected, onPick, { disabled = false } = {}) {
  container.replaceChildren(...options.map(({ value, label }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", value === selected);
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener("click", () => onPick(value));
    return button;
  }));
}

export function renderPips(el, used, total) {
  el.replaceChildren(...Array.from({ length: total }, (_, i) => {
    const pip = document.createElement("span");
    pip.className = i < used ? "pip used" : "pip";
    return pip;
  }));
  el.classList.toggle("last-chance", used >= total);
  el.setAttribute("aria-label", `${used} of ${total} mistakes used`);
}

// The 3, 2, 1, Go! that opens every game, drawn over the table. ms is how long is left (a
// friends game can be joined partway through); title is the mode and level; players is a
// list of elements for "Playing this round", or null to leave that out. onDone runs once
// the countdown has faded away.
let countdownTimer = 0;

export function runCountdown(ms, { title, players = null, onDone }) {
  stopCountdown();
  const overlay = $("countdown");
  $("countdownMode").textContent = title;
  $("countdownPlayersTitle").hidden = $("countdownPlayers").hidden = !players;
  $("countdownPlayers").replaceChildren(...(players ?? []));
  overlay.classList.remove("fading");
  overlay.hidden = false;

  const endsAt = performance.now() + ms;
  let shown = "";
  const tick = () => {
    const left = endsAt - performance.now();
    if (left <= 0) {
      overlay.classList.add("fading");
      countdownTimer = setTimeout(() => {
        overlay.hidden = true;
        countdownTimer = 0;
        onDone?.();
      }, 350);
      return;
    }
    const label = left > 3000 ? "3" : left > 2000 ? "2" : left > 1000 ? "1" : "Go!";
    if (label !== shown) {
      shown = label;
      const number = document.createElement("span");
      number.className = "count";
      number.textContent = label;
      $("countdownCircle").replaceChildren(number);
      $("countdownCircle").classList.toggle("is-go", label === "Go!");
      $("countdownHeading").textContent = label === "Go!" ? "Symbolic!" : "Get ready!";
    }
    countdownTimer = setTimeout(tick, 50);
  };
  tick();
}

export function stopCountdown() {
  clearTimeout(countdownTimer);
  countdownTimer = 0;
  $("countdown").hidden = true;
}

export const countdownRunning = () => countdownTimer !== 0;
