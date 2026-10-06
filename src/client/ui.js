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
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const copy = from.cloneNode(true);
  copy.removeAttribute("id");
  copy.classList.remove("deal", "locked", "mine");
  copy.classList.add("flying");
  copy.setAttribute("aria-hidden", "true");
  Object.assign(copy.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` });
  document.body.append(copy);
  const move = copy.animate(
    [{ transform: "none" }, { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width})` }],
    { duration: 320, easing: "ease-in" },
  );
  move.onfinish = move.oncancel = () => copy.remove();
  // Browsers pause animations in background tabs, so don't rely on onfinish alone.
  setTimeout(() => copy.remove(), 600);
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
