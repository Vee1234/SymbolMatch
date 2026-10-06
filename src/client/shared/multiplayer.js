// Multiplayer rules, kept free of server and browser code so they can be tested with
// node --test. The game state is a plain object so the room can save it as-is.
//
// Two modes (GameRequirements.md), both with the shared card on top and yours below:
//   tower ("pick one up"): everyone starts with one card. The first to spot the symbol
//     their card shares with the centre card wins it; it becomes their new card. When the
//     centre pile runs out, whoever won the most cards wins.
//   well ("put one down"): the cards are dealt out. The first to spot the symbol their top
//     card shares with the centre card puts their card down on the centre. The first to
//     get rid of all their cards wins.
//
// Wrong taps work as in solo: one wrong tap per centre card is allowed, the second locks
// you out until the centre card changes, and the 6th wrong tap in a game forfeits.
//
// For the end-of-game summary the game also records times: when it started and ended,
// when each centre card was turned over, and how long each winning match took. Times are
// milliseconds from whatever clock the caller passes as `now` (the room uses Date.now()).

import { shuffle } from "./generator.js";
import { sharedSymbol, WRONG_TAPS_ALLOWED_PER_CARD, WRONG_TAPS_ALLOWED_PER_GAME } from "./game.js";

export const MULTIPLAYER_MODES = { tower: "tower", well: "well" };
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
// Every game opens with a 3, 2, 1, Go! countdown on everyone's phone (a second each).
// Taps don't count until it's over, and match times start from the end of it.
export const COUNTDOWN_MS = 4000;

// Before a game starts, every connected player has to say they're ready; the host can't
// start until they all have. players: the room's list, each with `connected` and `ready`.
// Offline players aren't dealt in, so they don't hold the game up.
export function readiness(players) {
  const inGame = players.filter(p => p.connected);
  const waitingFor = inGame.filter(p => !p.ready).map(p => p.id);
  return {
    players: inGame.length,
    waitingFor,
    canStart: inGame.length >= MIN_PLAYERS && waitingFor.length === 0,
  };
}

// countdownMs: how long until play starts (the room passes COUNTDOWN_MS).
export function createGame(deck, mode, playerIds, now = Date.now(), countdownMs = 0) {
  if (!Object.values(MULTIPLAYER_MODES).includes(mode)) {
    throw new RangeError(`unknown mode ${mode}`);
  }
  if (playerIds.length < MIN_PLAYERS || playerIds.length > MAX_PLAYERS) {
    throw new RangeError(`a game needs ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  }
  if (deck.cards.length < playerIds.length + 1) {
    throw new RangeError(`${playerIds.length} players need at least ${playerIds.length + 1} cards; choose more symbols per card`);
  }

  const cards = shuffle([...deck.cards]);
  const players = {};
  for (const id of playerIds) {
    players[id] = {
      pile: [], won: 0, wrongTotal: 0, wrongOnCentre: 0, wrongCentreSeq: -1, forfeited: false,
      matchTimes: [], streak: 0, bestStreak: 0,
    };
  }

  const centre = cards.pop();
  let centrePile = [];
  if (mode === MULTIPLAYER_MODES.tower) {
    for (const id of playerIds) players[id].pile.push(cards.pop());
    centrePile = cards;
  } else {
    cards.forEach((card, i) => players[playerIds[i % playerIds.length]].pile.push(card));
  }

  const startsAt = now + countdownMs;
  return {
    mode, order: [...playerIds], players, centre, centreSeq: 0, centrePile, status: "playing",
    startedAt: startsAt, endedAt: null, centreShownAt: startsAt, lastWinner: null,
  };
}

const topCard = player => player.pile[player.pile.length - 1];
const activeIds = game => game.order.filter(id => !game.players[id].forfeited);

export function isLockedOut(game, id) {
  const p = game.players[id];
  return p.wrongCentreSeq === game.centreSeq && p.wrongOnCentre > WRONG_TAPS_ALLOWED_PER_CARD;
}

// centreSeq is the centre card the player was looking at when they tapped. If the centre
// has changed since, someone else got there first and the tap is ignored without penalty.
// Returns "correct", "wrong", "lockedOut", "forfeit", "tooLate" or "ignored".
export function applyTap(game, id, symbol, centreSeq, now = Date.now()) {
  const p = game.players[id];
  if (game.status !== "playing" || !p || p.forfeited) return "ignored";
  if (now < game.startedAt) return "ignored"; // still counting down
  if (centreSeq !== game.centreSeq) return "tooLate";
  if (isLockedOut(game, id)) return "ignored";
  const yours = topCard(p);
  if (!yours.includes(symbol) && !game.centre.includes(symbol)) return "ignored";

  if (symbol === sharedSymbol(yours, game.centre)) {
    claim(game, id, now);
    return "correct";
  }

  if (p.wrongCentreSeq !== game.centreSeq) {
    p.wrongCentreSeq = game.centreSeq;
    p.wrongOnCentre = 0;
  }
  p.wrongTotal += 1;
  p.wrongOnCentre += 1;

  let result = "wrong";
  if (p.wrongTotal > WRONG_TAPS_ALLOWED_PER_GAME) {
    p.forfeited = true;
    p.forfeitReason = "wrongTaps";
    result = "forfeit";
  } else if (isLockedOut(game, id)) {
    result = "lockedOut";
  }
  checkStuckOrOver(game, now);
  return result;
}

function claim(game, id, now) {
  const p = game.players[id];
  // ?? covers games saved before times were recorded.
  (p.matchTimes ??= []).push(now - (game.centreShownAt ?? now));
  p.streak = game.lastWinner === id ? (p.streak ?? 0) + 1 : 1;
  p.bestStreak = Math.max(p.bestStreak ?? 0, p.streak);
  game.lastWinner = id;
  if (game.mode === MULTIPLAYER_MODES.tower) {
    p.pile.push(game.centre);
    p.won += 1;
    nextCentre(game, now);
  } else {
    game.centre = p.pile.pop();
    game.centreSeq += 1;
    game.centreShownAt = now;
    p.won += 1;
    if (p.pile.length === 0) end(game, now);
  }
}

function nextCentre(game, now) {
  game.centreSeq += 1;
  game.centreShownAt = now;
  if (game.centrePile.length === 0) {
    end(game, now);
    return;
  }
  game.centre = game.centrePile.pop();
}

function end(game, now) {
  game.status = "ended";
  game.endedAt = now;
}

// A player who leaves mid-game forfeits.
export function forfeitPlayer(game, id, now = Date.now()) {
  const p = game.players[id];
  if (!p || p.forfeited || game.status !== "playing") return;
  p.forfeited = true;
  p.forfeitReason = "left";
  checkStuckOrOver(game, now);
}

// If everyone still playing is locked out of the centre card, nobody can move: in tower the
// card is set aside and the next one turned over; in well everyone gets another go at it.
// The game also ends if fewer than two players are left.
function checkStuckOrOver(game, now) {
  const active = activeIds(game);
  if (active.length < MIN_PLAYERS) {
    end(game, now);
    return;
  }
  if (active.every(id => isLockedOut(game, id))) {
    if (game.mode === MULTIPLAYER_MODES.tower) {
      nextCentre(game, now);
    } else {
      game.centreSeq += 1;
      game.centreShownAt = now;
    }
  }
}

// Final standings, best first. Tower: most cards won. Well: fewest cards left.
// Forfeited players come last. Players with equal results share a place.
export function standings(game) {
  const score = id => {
    const p = game.players[id];
    const value = game.mode === MULTIPLAYER_MODES.tower ? -p.won : p.pile.length;
    return [p.forfeited ? 1 : 0, value];
  };
  const sorted = [...game.order].sort((a, b) => {
    const [fa, va] = score(a), [fb, vb] = score(b);
    return fa - fb || va - vb;
  });
  let place = 0;
  return sorted.map((id, i) => {
    const [f, v] = score(id);
    if (i === 0 || f !== score(sorted[i - 1])[0] || v !== score(sorted[i - 1])[1]) place = i + 1;
    const p = game.players[id];
    return {
      id, place, won: p.won, cardsLeft: p.pile.length, wrongTotal: p.wrongTotal,
      forfeited: p.forfeited, forfeitReason: p.forfeited ? p.forfeitReason ?? "left" : null,
    };
  });
}

// Each player's numbers for the end-of-game summary. averageMs and fastestMs are null for
// a player who never made a match.
export function playerStats(game) {
  return game.order.map(id => {
    const p = game.players[id];
    const times = p.matchTimes ?? [];
    return {
      id,
      won: p.won,
      cardsLeft: p.pile.length,
      wrongTotal: p.wrongTotal,
      forfeited: p.forfeited,
      matches: times.length,
      averageMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
      fastestMs: times.length ? Math.min(...times) : null,
      bestStreak: p.bestStreak ?? 0,
    };
  });
}

// Badges handed out at the end. Each goes to every player who ties for it, and a badge
// nobody qualifies for is left out.
export const BADGES = {
  quickest: { emoji: "⚡", name: "Quickest draw", description: "The single fastest match of the game" },
  fastestAverage: { emoji: "🏎️", name: "Consistently quick", description: "The fastest average match time (at least 3 matches)" },
  sharpshooter: { emoji: "🎯", name: "Sharpshooter", description: "Made matches without a single wrong tap" },
  hotStreak: { emoji: "🔥", name: "Hot streak", description: "Won the most centre cards in a row (at least 3)" },
  butterfingers: { emoji: "🧈", name: "Butterfingers", description: "The most wrong taps (at least 3)" },
};

export function awardBadges(stats) {
  const best = (eligible, value, pick) => {
    const players = stats.filter(eligible);
    if (!players.length) return [];
    const target = pick(...players.map(value));
    return players.filter(s => value(s) === target).map(s => s.id);
  };
  const awards = {
    quickest: best(s => s.fastestMs !== null, s => s.fastestMs, Math.min),
    fastestAverage: best(s => s.matches >= 3, s => s.averageMs, Math.min),
    sharpshooter: stats.filter(s => s.matches > 0 && s.wrongTotal === 0).map(s => s.id),
    hotStreak: best(s => s.bestStreak >= 3, s => s.bestStreak, Math.max),
    butterfingers: best(s => s.wrongTotal >= 3, s => s.wrongTotal, Math.max),
  };
  return Object.entries(awards)
    .filter(([, playerIds]) => playerIds.length)
    .map(([badge, playerIds]) => ({ badge, ...BADGES[badge], playerIds }));
}

// The end-of-game summary everyone sees: how long it took, each player's numbers and the
// badges. Only times and counts, never cards.
export function gameSummary(game) {
  const stats = playerStats(game);
  return {
    startedAt: game.startedAt ?? null,
    durationMs: typeof game.startedAt === "number" && typeof game.endedAt === "number" ? game.endedAt - game.startedAt : null,
    players: stats,
    badges: awardBadges(stats),
  };
}

// What one player is allowed to see: their own top card, the centre card, and a summary of
// everyone else (never other players' cards).
export function viewFor(game, id, now = Date.now()) {
  const summary = pid => {
    const p = game.players[pid];
    return {
      id: pid,
      won: p.won,
      cardsLeft: p.pile.length,
      wrongTotal: p.wrongTotal,
      lockedOut: isLockedOut(game, pid),
      forfeited: p.forfeited,
    };
  };
  const me = game.players[id];
  return {
    mode: game.mode,
    status: game.status,
    // How long the opening countdown has left; phones run it from this, so their clocks
    // don't need to agree with the room's.
    startsInMs: game.status === "playing" ? Math.max(0, (game.startedAt ?? 0) - now) : 0,
    centre: game.centre,
    centreSeq: game.centreSeq,
    centrePileLeft: game.centrePile.length,
    yourCard: me && !me.forfeited && game.status === "playing" ? topCard(me) : null,
    you: me ? summary(id) : null,
    players: game.order.map(summary),
    standings: game.status === "ended" ? standings(game) : null,
    summary: game.status === "ended" ? gameSummary(game) : null,
  };
}
