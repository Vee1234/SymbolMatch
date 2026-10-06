// Emoji used as symbols: everyday objects that are quick to recognise, with no faces
// (GameRequirements.md). Look-alike pairs are left out (e.g. apple/tomato, car/taxi)
// so every symbol can be told apart at a glance. 12 symbols per card needs 133.

import { shuffle } from "./generator.js";

export const EMOJI = [
  // Food
  "🍎", "🍌", "🍇", "🍉", "🍓", "🍒", "🍍", "🥝", "🍋", "🍐",
  "🥥", "🥕", "🌽", "🥦", "🍄", "🥑", "🌶️", "🍆", "🥨", "🍞",
  "🧀", "🥚", "🍕", "🍔", "🌭", "🌮", "🍟", "🍩", "🍪", "🎂",
  "🍦", "🍭", "🍫", "🍿", "☕", "🥛", "🍯", "🧁", "🥐", "🍣",
  // Sport and games
  "⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🎱", "🏓", "🥊", "🎯",
  "🎳", "🪁", "🛹", "⛸️", "🎲", "🧩",
  // Music and art
  "🎨", "🎸", "🎺", "🥁", "🎻", "🎹", "🎤", "🎧",
  // Gadgets
  "📷", "📺", "💻", "⌚", "📱", "☎️", "💡", "🔦",
  // Home and tools
  "🕯️", "🔑", "🔒", "🔨", "🪓", "🔧", "✂️", "📎", "📌", "✏️",
  "📏", "📚", "✉️", "📦", "🧸", "🪑", "🛏️", "🚪", "🧹", "🧺",
  "🧽", "🪣", "🧲", "🔔",
  // Other objects
  "⏰", "⌛", "🧭", "🔭", "🔬", "💊", "🧪", "💎", "👑", "🎩",
  "👓", "🎈", "🎁", "🎀",
  // Clothes
  "👟", "👠", "🧤", "🧣", "🧦", "👕", "👖", "👗", "🎒", "☂️",
  // Transport
  "🚗", "🚌", "🚑", "🚒", "🚜", "🚲", "🛴", "🚂", "🚁", "✈️",
  "🚀", "⛵", "🚢", "⚓",
  // Nature
  "🌳", "🌵", "🌴", "🌻", "🌹", "🌷", "🍁", "🍀", "🌈", "☀️",
  "🌙", "⭐", "🔥", "💧", "❄️", "⚡",
];

// A random selection of n emoji for one game, so every game looks different.
export function pickEmoji(n) {
  if (n > EMOJI.length) {
    throw new RangeError(`only ${EMOJI.length} emoji available, ${n} requested`);
  }
  return shuffle([...EMOJI]).slice(0, n);
}
