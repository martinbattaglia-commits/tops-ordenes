import { describe, it, expect } from "vitest";
import { mapTable } from "./mapper";
import { asDetectedFormat, type RawTable } from "../kernel/types";
import type { MapperPort } from "../kernel/ports";

interface FakeRow { name: string | null; _fmt?: string }
const fakeMapper: MapperPort<FakeRow> = {
  format: asDetectedFormat("fake"),
  map: (row, fmt) => ({ name: row["name"] ?? null, _fmt: fmt }),
};

describe("mapTable", () => {
  it("maps each row via the mapper and stamps via mapper", () => {
    const t: RawTable = { headers: ["name", "extra"], rows: [{ name: "ana", extra: "z" }], sourceName: "x" };
    const out = mapTable<FakeRow>(t, fakeMapper, asDetectedFormat("fake"), ["name"]);
    expect(out.rows[0].name).toBe("ana");
    expect(out.rows[0]._fmt).toBe("fake");
    expect(out.unmappedHeaders).toEqual(["extra"]);
  });
});
