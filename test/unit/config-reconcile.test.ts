import { describe, it, expect } from "vitest";
import {
  reconcileConfig,
  ConfigLocalState,
  ConfigRemoteState,
} from "../../src/config-reconcile";
import { ConfigBase } from "../../src/config-sync-state";

const local = (over: Partial<ConfigLocalState> = {}): ConfigLocalState => ({
  exists: true,
  hash: "localhash",
  mtime: 1000,
  ...over,
});

const remote = (over: Partial<ConfigRemoteState> = {}): ConfigRemoteState => ({
  exists: true,
  driveId: "drive1",
  rawMd5: "remotemd5",
  mtime: 2000,
  ...over,
});

const base = (over: Partial<ConfigBase> = {}): ConfigBase => ({
  hash: "localhash",
  driveId: "drive1",
  remoteRawMd5: "remotemd5",
  localMtime: 1000,
  remoteMtime: 2000,
  ...over,
});

describe("reconcileConfig", () => {
  it("does nothing when neither side has the file", () => {
    expect(
      reconcileConfig(local({ exists: false }), remote({ exists: false }), null)
        .type
    ).toBe("noop");
  });

  it("uploads when only local exists (first push)", () => {
    expect(
      reconcileConfig(local(), remote({ exists: false }), null).type
    ).toBe("upload");
  });

  it("downloads when only remote exists (first pull, never deletes local)", () => {
    expect(
      reconcileConfig(local({ exists: false }), remote(), null).type
    ).toBe("download");
  });

  it("NEVER produces a delete action in any case", () => {
    const cases: Array<[ConfigLocalState, ConfigRemoteState, ConfigBase | null]> =
      [
        [local({ exists: false }), remote(), base()],
        [local(), remote({ exists: false }), base()],
        [local(), remote(), null],
        [local({ hash: "x" }), remote({ rawMd5: "y" }), base()],
      ];
    for (const [l, r, b] of cases) {
      const type = reconcileConfig(l, r, b).type;
      expect(["noop", "upload", "download", "conflict"]).toContain(type);
    }
  });

  describe("both sides exist, no base", () => {
    it("asks (conflict) because the change cannot be attributed", () => {
      expect(reconcileConfig(local(), remote(), null).type).toBe("conflict");
    });
  });

  describe("both sides exist, with base", () => {
    it("noop when neither side changed", () => {
      expect(reconcileConfig(local(), remote(), base()).type).toBe("noop");
    });

    it("uploads when only local changed", () => {
      expect(
        reconcileConfig(local({ hash: "new" }), remote(), base()).type
      ).toBe("upload");
    });

    it("downloads when only remote changed", () => {
      expect(
        reconcileConfig(local(), remote({ rawMd5: "new" }), base()).type
      ).toBe("download");
    });

    it("conflicts when both changed", () => {
      expect(
        reconcileConfig(
          local({ hash: "new" }),
          remote({ rawMd5: "new" }),
          base()
        ).type
      ).toBe("conflict");
    });
  });
});
