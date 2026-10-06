// Small helpers shared by the solo game (app.js) and the friends game (friends.js).

export const $ = id => document.getElementById(id);

export function show(screenId) {
  for (const el of document.querySelectorAll(".screen")) el.hidden = el.id !== screenId;
  window.scrollTo(0, 0);
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
