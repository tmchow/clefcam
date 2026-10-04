export type Category =
  "Gestures" | "Objects" | "Background" | "Surfaces" | "Custom";
export type Rule = {
  id: string;
  label: string;
  text: string;
  category: Category;
  icon: string;
  enabled: boolean;
};
export type Match = "matched" | "unmet" | "checking" | "uncertain";
export const presets: Rule[] = [
  [
    "peace",
    "Peace sign",
    "A visible hand is making a peace sign: index and middle fingers extended in a V, other fingers folded.",
    "Gestures",
    "peace",
  ],
  [
    "thumb",
    "Thumbs up",
    "A visible hand is making a thumbs-up gesture, with its thumb pointing up and the other fingers folded.",
    "Gestures",
    "thumb",
  ],
  [
    "palm",
    "Open palm",
    "A visible hand has an open palm facing the camera, with all five fingers extended.",
    "Gestures",
    "hand",
  ],
  [
    "mug",
    "Mug visible",
    "At least one drinking mug with a handle is clearly visible.",
    "Objects",
    "mug",
  ],
  [
    "book",
    "Book visible",
    "At least one physical book is clearly visible.",
    "Objects",
    "book",
  ],
  [
    "open-book",
    "Open book",
    "At least one physical book is clearly visible AND that same book is open with inside pages visible.",
    "Objects",
    "book",
  ],
  [
    "white",
    "Mostly white background",
    "The background behind the foreground subject is mostly white or off-white. A white object or countertop alone does not satisfy this.",
    "Background",
    "white",
  ],
  [
    "dark",
    "Mostly dark background",
    "The background behind the foreground subject is mostly dark or black. A dark object or countertop alone does not satisfy this.",
    "Background",
    "dark",
  ],
  [
    "counter",
    "White countertop",
    "A white or off-white countertop surface is clearly visible. The color of the background alone does not satisfy this.",
    "Surfaces",
    "counter",
  ],
  [
    "wood",
    "Wooden surface",
    "A wooden surface with visible wood texture or grain is clearly visible.",
    "Surfaces",
    "wood",
  ],
].map(([id, label, text, category, icon]) => ({
  id,
  label,
  text,
  category: category as Category,
  icon,
  enabled: true,
}));
export const MAX_RULES = 6;
export const MAX_AGE = 5000;
export function classify(value: unknown): Match {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    return "uncertain";
  return value >= 0.85 ? "matched" : value <= 0.25 ? "unmet" : "uncertain";
}
export function acceptedFrame(
  version: number,
  current: number,
  capturedAt: number,
  now: number,
  hidden: boolean,
) {
  return version === current && !hidden && now - capturedAt <= MAX_AGE;
}
export class CaptureGate {
  private streak = 0;
  private first = 0;
  reset() {
    this.streak = 0;
    this.first = 0;
  }
  accept(states: Match[], now: number) {
    if (!states.length || !states.every((s) => s === "matched")) {
      this.reset();
      return false;
    }
    if (!this.streak) this.first = now;
    this.streak++;
    return this.streak >= 2 && now - this.first >= 900;
  }
}
