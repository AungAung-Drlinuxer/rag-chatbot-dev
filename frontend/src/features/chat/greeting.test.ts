import { describe, expect, it } from "vitest";

import { greetingFor } from "./greeting";

const at = (h: number) => new Date(2026, 10, 15, h, 0, 0);

describe("greetingFor", () => {
  it("morning covers 05:00 to 11:59", () => {
    expect(greetingFor(at(5))).toBe("Good morning");
    expect(greetingFor(at(8))).toBe("Good morning");
    expect(greetingFor(at(11))).toBe("Good morning");
  });

  it("afternoon covers 12:00 to 16:59", () => {
    expect(greetingFor(new Date(2026, 10, 15, 12, 0))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 10, 15, 16, 59))).toBe("Good afternoon");
  });

  it("evening covers 17:00 to 21:59", () => {
    expect(greetingFor(at(17))).toBe("Good evening");
    expect(greetingFor(new Date(2026, 10, 15, 21, 59))).toBe("Good evening");
  });

  it("night covers 22:00 to 04:59", () => {
    expect(greetingFor(at(22))).toBe("Good night");
    expect(greetingFor(at(23))).toBe("Good night");
    expect(greetingFor(at(0))).toBe("Good night");
    expect(greetingFor(new Date(2026, 10, 15, 4, 59))).toBe("Good night");
  });
});
