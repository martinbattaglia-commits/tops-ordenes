import { describe, it, expect } from "vitest";
import { toPriority, byPriorityThenRecency, type NotificationItem } from "./types";

const item = (over: Partial<NotificationItem>): NotificationItem => ({
  id: "x", source: "notification", priority: "normal", kind: "k", title: "t",
  message: null, href: "/x", createdAt: "2026-06-30T12:00:00.000Z", read: false, ...over,
});

describe("notifications/types", () => {
  it("toPriority mapea la columna a bucket visual", () => {
    expect(toPriority("urgent")).toBe("urgente");
    expect(toPriority("high")).toBe("importante");
    expect(toPriority("normal")).toBe("normal");
    expect(toPriority("low")).toBe("normal");
    expect(toPriority(null)).toBe("normal");
  });

  it("ordena por prioridad (urgente→normal) y luego por recencia", () => {
    const a = item({ id: "a", priority: "normal", createdAt: "2026-06-30T13:00:00.000Z" });
    const b = item({ id: "b", priority: "urgente", createdAt: "2026-06-30T10:00:00.000Z" });
    const c = item({ id: "c", priority: "importante", createdAt: "2026-06-30T11:00:00.000Z" });
    const d = item({ id: "d", priority: "urgente", createdAt: "2026-06-30T12:00:00.000Z" });
    const sorted = [a, b, c, d].sort(byPriorityThenRecency).map((x) => x.id);
    // urgentes primero (el más reciente d antes que b), luego importante, luego normal
    expect(sorted).toEqual(["d", "b", "c", "a"]);
  });
});
