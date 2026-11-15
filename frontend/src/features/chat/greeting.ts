/**
 * One greeting, four bands — the same words on the chat page and the welcome card.
 *
 *   05:00–11:59  Good morning
 *   12:00–16:59  Good afternoon
 *   17:00–21:59  Good evening
 *   22:00–04:59  Good night
 *
 * The boundaries are stated once here because two copies (the hero and the empty-state
 * card) drifted before: one said "evening" from 17:00, the other from 18:00.
 */
export function greetingFor(date: Date = new Date()): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 22) return "Good evening";
  return "Good night";
}
