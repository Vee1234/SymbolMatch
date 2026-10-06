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

import { shuffle } from "./generator.js";
import { sharedSymbol, WRONG_TAPS_ALLOWED_PER_CARD, WRONG_TAPS_ALLOWED_PER_GAME } from "./game.js";

export const MULTIPLAYER_MODES = { tower: "tower", well: "well" };
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export function createGame(deck, mode, playerIds) {
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
    players[id] = { pile: [], won: 0, wrongTotal: 0, wrongOnCentre: 0, wrongCentreSeq: -1, forfeited: false };
  }

  const centre = cards.pop();
  let centrePile = [];
  if (mode === MULTIPLAYER_MODES.tower) {
    for (const id of playerIds) players[id].pile.push(cards.pop());
    centrePile = cards;
  } else {
    cards.forEach((card, i) => players[playerIds[i % playerIds.length]].pile.push(card));
  }

  return { mode, order: [...playerIds], players, centre, centreSeq: 0, centrePile, status: "playing" };
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
export function applyTap(game, id, symbol, centreSeq) {
  const p = game.players[id];
  if (game.status !== "playing" || !p || p.forfeited) return "ignored";
  if (centreSeq !== game.centreSeq) return "tooLate";
  if (isLockedOut(game, id)) return "ignored";
  const yours = topCard(p);
  if (!yours.includes(symbol) && !game.centre.includes(symbol)) return "ignored";

  if (symbol === sharedSymbol(yours, game.centre)) {
    claim(game, id);
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
    result = "forfeit";
  } else if (isLockedOut(game, id)) {
    result = "lockedOut";
  }
  checkStuckOrOver(game);
  return result;
}

function claim(game, id) {
  const p = game.players[id];
  if (game.mode === MULTIPLAYER_MODES.tower) {
    p.pile.push(game.centre);
    p.won += 1;
    nextCentre(game);
  } else {
    game.centre = p.pile.pop();
    game.centreSeq += 1;
    p.won += 1;
    if (p.pile.length === 0) game.status = "ended";
  }
}

function nextCentre(game) {
  game.centreSeq += 1;
  if (game.centrePile.length === 0) {
    game.status = "ended";
    return;
  }
  game.centre = game.centrePile.pop();
}

// A player who leaves mid-game forfeits.
export function forfeitPlayer(game, id) {
  const p = game.players[id];
  if (!p || p.forfeited || game.status !== "playing") return;
  p.forfeited = true;
  checkStuckOrOver(game);
}

// If everyone still playing is locked out of the centre card, nobody can move: in tower the
// card is set aside and the next one turned over; in well everyone gets another go at it.
// The game also ends if fewer than two players are left.
function checkStuckOrOver(game) {
  const active = activeIds(game);
  if (active.length < MIN_PLAYERS) {
    game.status = "ended";
    return;
  }
  if (active.every(id => isLockedOut(game, id))) {
    if (game.mode === MULTIPLAYER_MODES.tower) {
      nextCentre(game);
    } else {
      game.centreSeq += 1;
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
    return { id, place, won: p.won, cardsLeft: p.pile.length, forfeited: p.forfeited };
  });
}

// What one player is allowed to see: their own top card, the centre card, and a summary of
// everyone else (never other players' cards).
export function viewFor(game, id) {
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
    centre: game.centre,
    centreSeq: game.centreSeq,
    centrePileLeft: game.centrePile.length,
    yourCard: me && !me.forfeited && game.status === "playing" ? topCard(me) : null,
    you: me ? summary(id) : null,
    players: game.order.map(summary),
    standings: game.status === "ended" ? standings(game) : null,
  };
}
