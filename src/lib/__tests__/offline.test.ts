import { describe, it, expect, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  get: async (k: string) => store.get(k),
  set: async (k: string, v: unknown) => { await new Promise((r) => setTimeout(r, Math.random() * 5)); store.set(k, v); },
}));
vi.mock("../db", () => ({ db: { rpc: vi.fn(), from: vi.fn() } }));

describe("enqueue", () => {
  it("keeps all 18 ops enqueued synchronously", async () => {
    const { enqueue, useSync } = await import("../offline");
    void useSync;
    const ps = Array.from({ length: 18 }, (_, n) => enqueue({ fn: "set_compartment", args: { n }, label: `C${n}` }));
    await Promise.all(ps);
    const q = store.get("tl-queue-v1") as unknown[];
    expect(q).toHaveLength(18);
  });
});
