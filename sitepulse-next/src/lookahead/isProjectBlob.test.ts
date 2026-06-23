import { describe, it, expect } from "vitest";
import { isProjectBlob } from "./isProjectBlob";
import { makeBlankProjectBlob } from "./lib/defaults";

describe("isProjectBlob", () => {
  it("accepts a freshly-built blank project blob", () => {
    expect(isProjectBlob(makeBlankProjectBlob("Demo"))).toBe(true);
  });

  it("accepts a multi-area blob", () => {
    const blob = makeBlankProjectBlob("Two areas");
    const extraId = "area-2";
    blob.areas[extraId] = {
      id: extraId,
      name: "Exterior",
      weeks: { "2026-06-01": { flags: {}, groups: [] } },
      currentWeek: "2026-06-01",
      view: { numWeeks: 3, showSat: true, showSun: false, carryForward: true, taskColW: 300 },
    };
    blob.areaOrder.push(extraId);
    expect(isProjectBlob(blob)).toBe(true);
  });

  it("rejects nullish and primitive values", () => {
    expect(isProjectBlob(null)).toBe(false);
    expect(isProjectBlob(undefined)).toBe(false);
    expect(isProjectBlob("{}")).toBe(false);
    expect(isProjectBlob(42)).toBe(false);
    expect(isProjectBlob(true)).toBe(false);
  });

  it("rejects an array (areas must be a keyed object, not a list)", () => {
    expect(isProjectBlob([])).toBe(false);
  });

  it("rejects a blob missing the areas map", () => {
    const blob = makeBlankProjectBlob("No areas") as unknown as Record<string, unknown>;
    delete blob.areas;
    expect(isProjectBlob(blob)).toBe(false);
  });

  it("rejects an empty areas map", () => {
    const blob = makeBlankProjectBlob("Empty areas");
    blob.areas = {};
    blob.areaOrder = [];
    expect(isProjectBlob(blob)).toBe(false);
  });

  it("rejects a blob whose project meta is missing the project-wide arrays", () => {
    const blob = makeBlankProjectBlob("Bad meta") as unknown as Record<string, unknown>;
    blob.project = { info: {} }; // no subs/holidays/milestones arrays
    expect(isProjectBlob(blob)).toBe(false);
  });

  it("rejects a blob whose project.info is not an object", () => {
    const blob = makeBlankProjectBlob("Bad info");
    (blob.project as unknown as Record<string, unknown>).info = "not-an-object";
    expect(isProjectBlob(blob)).toBe(false);
  });

  it("rejects a blob with a structurally-invalid area (missing currentWeek)", () => {
    const blob = makeBlankProjectBlob("Bad area");
    const id = blob.areaOrder[0];
    delete (blob.areas[id] as unknown as Record<string, unknown>).currentWeek;
    expect(isProjectBlob(blob)).toBe(false);
  });

  it("rejects a blob with a non-string in areaOrder", () => {
    const blob = makeBlankProjectBlob("Bad order") as unknown as Record<string, unknown>;
    blob.areaOrder = [123];
    expect(isProjectBlob(blob)).toBe(false);
  });

  it("rejects a blob missing currentAreaId", () => {
    const blob = makeBlankProjectBlob("No current") as unknown as Record<string, unknown>;
    delete blob.currentAreaId;
    expect(isProjectBlob(blob)).toBe(false);
  });
});
