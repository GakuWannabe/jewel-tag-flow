import { readFileSync } from "node:fs";
import { transpileModule } from "typescript";
import { describe, expect, it } from "vitest";

function loadFunction(path: string, name: string, end: string) {
  const source = readFileSync(path, "utf8");
  const start = source.indexOf(`export function ${name}`);
  const snippet = source.slice(start, source.indexOf(end, start)).replace("export function", "function");
  const js = transpileModule(snippet, { compilerOptions: { target: 9 } }).outputText;
  return new Function("huidsDone", `${js}; return ${name};`)((s: any, i: any) => (s.itemHuids[i.id]?.length ?? 0) === i.pcs);
}

describe("staff tray rules", () => {
  const suggest = loadFunction("src/routes/_authenticated/station/index.tsx", "suggestTrays", "function StationPick");
  const trays = [{ id: "A", compartment_count: 18 }, { id: "B", compartment_count: 12 }];
  for (const [pieces, expected] of [[13, [["A", 13]]], [18, [["A", 18]]], [19, [["A", 18], ["B", 1]]], [12, [["B", 12]]], [30, [["A", 18], ["B", 12]]]] as const) {
    it(`allocates ${pieces} across the requested physical trays`, () => {
      expect(suggest(trays, pieces).map((p: any) => [p.tray.id, p.count])).toEqual(expected);
    });
  }
  it("never repeats a physical tray when capacity is insufficient", () => {
    expect(suggest(trays, 31).map((p: any) => [p.tray.id, p.count])).toEqual([["A", 18], ["B", 12]]);
  });
  const done = loadFunction("src/routes/_authenticated/station/$sessionId.tsx", "doneMap", "function SessionScreen");
  it("weighing finishes independently of HUID assignment", () => {
    expect(done({ items: [{ id: "pair", pcs: 2, gross_weight: 10 }], itemHuids: {}, session: { status: "loaded" } })).toEqual({ load: true, weigh: true, huid: false, finish: false });
  });
  it("a pair needs two HUIDs", () => {
    expect(done({ items: [{ id: "pair", pcs: 2, gross_weight: null }], itemHuids: { pair: ["ABC123"] }, session: { status: "loaded" } }).huid).toBe(false);
    expect(done({ items: [{ id: "pair", pcs: 2, gross_weight: null }], itemHuids: { pair: ["ABC123", "DEF456"] }, session: { status: "loaded" } }).huid).toBe(true);
  });
});