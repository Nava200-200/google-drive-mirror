import { describe, it, expect } from "vitest";
import {
  discoverPaths,
  deleteAtPath,
  getAtPath,
  setAtPath,
} from "../../src/config-paths";

describe("discoverPaths", () => {
  it("emits leaves and containers, collapsing array indices to []", () => {
    const obj = {
      a: 1,
      nested: { x: true },
      targets: [
        { name: "A", excludeFolders: ["p"] },
        { name: "B", excludeFolders: [] },
      ],
    };
    const paths = discoverPaths(obj);
    expect(paths).toContain("a");
    expect(paths).toContain("nested");
    expect(paths).toContain("nested.x");
    expect(paths).toContain("targets");
    expect(paths).toContain("targets[]");
    expect(paths).toContain("targets[].name");
    expect(paths).toContain("targets[].excludeFolders");
    // No per-index paths.
    expect(paths.some((p) => /\[\d+\]/.test(p))).toBe(false);
  });

  it("de-duplicates across array elements", () => {
    const obj = { targets: [{ excludeFolders: [] }, { excludeFolders: [] }] };
    const paths = discoverPaths(obj);
    expect(
      paths.filter((p) => p === "targets[].excludeFolders")
    ).toHaveLength(1);
  });

  it("skips given top-level keys", () => {
    const obj = { keep: 1, secret: "x", configPassphraseObf: "y" };
    const paths = discoverPaths(obj, ["secret", "configPassphraseObf"]);
    expect(paths).toContain("keep");
    expect(paths).not.toContain("secret");
    expect(paths).not.toContain("configPassphraseObf");
  });
});

describe("deleteAtPath", () => {
  it("deletes a top-level key", () => {
    const obj = { a: 1, b: 2 };
    deleteAtPath(obj, "a");
    expect(obj).toEqual({ b: 2 });
  });

  it("deletes a nested key", () => {
    const obj = { n: { x: 1, y: 2 } };
    deleteAtPath(obj, "n.x");
    expect(obj).toEqual({ n: { y: 2 } });
  });

  it("deletes a nested key on EVERY array element", () => {
    const obj = {
      targets: [
        { name: "A", excludeFolders: ["p"] },
        { name: "B", excludeFolders: ["q"] },
      ],
    };
    deleteAtPath(obj, "targets[].excludeFolders");
    expect(obj).toEqual({ targets: [{ name: "A" }, { name: "B" }] });
  });

  it("is a no-op for an absent path", () => {
    const obj = { a: 1 };
    deleteAtPath(obj, "x.y.z");
    deleteAtPath(obj, "targets[].excludeFolders");
    expect(obj).toEqual({ a: 1 });
  });
});

describe("getAtPath / setAtPath round-trip", () => {
  it("gets and sets a plain nested value", () => {
    const obj = { n: { x: 1 } };
    expect(getAtPath(obj, "n.x")).toBe(1);
    setAtPath(obj, "n.x", 99);
    expect(obj.n.x).toBe(99);
  });

  it("gets an array of per-element values for a [] path", () => {
    const obj = {
      targets: [{ excludeFolders: ["a"] }, { excludeFolders: ["b"] }],
    };
    expect(getAtPath(obj, "targets[].excludeFolders")).toEqual([["a"], ["b"]]);
  });

  it("preserves LOCAL values onto an INCOMING payload by array index", () => {
    // Simulate the download-preserve path: incoming came from Drive (no local
    // excludeFolders), local has this device's values; copy local onto incoming.
    const local = {
      targets: [{ excludeFolders: ["local-a"] }, { excludeFolders: ["local-b"] }],
    };
    const incoming = {
      targets: [{ excludeFolders: [] }, { excludeFolders: [] }],
    };
    const localVals = getAtPath(local, "targets[].excludeFolders");
    setAtPath(incoming, "targets[].excludeFolders", localVals);
    expect(incoming).toEqual({
      targets: [
        { excludeFolders: ["local-a"] },
        { excludeFolders: ["local-b"] },
      ],
    });
  });

  it("set does not fabricate structure where the container is absent", () => {
    const obj = { targets: [{ name: "A" }] }; // no excludeFolders key
    setAtPath(obj, "targets[].excludeFolders", [["x"]]);
    // Element exists → the leaf gets written (restoring a device value is fine).
    expect((obj.targets[0] as { excludeFolders?: unknown }).excludeFolders).toEqual(["x"]);
  });

  it("set handles a shorter incoming array than local (index missing)", () => {
    const local = {
      targets: [{ excludeFolders: ["a"] }, { excludeFolders: ["b"] }],
    };
    const incoming = { targets: [{ excludeFolders: [] }] }; // only one target
    const localVals = getAtPath(local, "targets[].excludeFolders");
    setAtPath(incoming, "targets[].excludeFolders", localVals);
    expect(incoming.targets).toHaveLength(1);
    expect(incoming.targets[0].excludeFolders).toEqual(["a"]);
  });
});
