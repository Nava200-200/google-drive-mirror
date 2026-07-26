import { describe, it, expect } from "vitest";
import {
  ConfigSyncStateStore,
  ConfigBase,
  CONFIG_STATE_FILE,
  isConfigStateFile,
} from "../../src/config-sync-state";
import { isStateFile } from "../../src/sync-state";
import { FakeStorage } from "../helpers/fake-storage";

const base = (path: string): ConfigBase => ({
  path,
  hash: `hash-${path}`,
  driveId: `drive-${path}`,
  remoteRawMd5: `md5-${path}`,
  localMtime: 100,
  remoteMtime: 200,
});

const OWN = ".obsidian/plugins/google-drive-mirror/data.json";
const OTHER = ".obsidian/plugins/some-plugin/data.json";

describe("ConfigSyncStateStore (per-file map)", () => {
  it("persists and reloads multiple per-file bases", async () => {
    const storage = new FakeStorage();
    const s1 = new ConfigSyncStateStore(storage.asStorage(), () => "scopeA");
    s1.set(base(OWN));
    s1.set(base(OTHER));
    await s1.save();

    const s2 = new ConfigSyncStateStore(storage.asStorage(), () => "scopeA");
    await s2.load();
    expect(s2.get(OWN)).toEqual(base(OWN));
    expect(s2.get(OTHER)).toEqual(base(OTHER));
    expect(s2.all()).toHaveLength(2);
  });

  it("returns null for an unknown path", async () => {
    const storage = new FakeStorage();
    const s = new ConfigSyncStateStore(storage.asStorage(), () => "scopeA");
    await s.load();
    expect(s.get(OWN)).toBeNull();
  });

  it("deletes a single entry", () => {
    const storage = new FakeStorage();
    const s = new ConfigSyncStateStore(storage.asStorage(), () => "scopeA");
    s.set(base(OWN));
    s.set(base(OTHER));
    s.delete(OWN);
    expect(s.get(OWN)).toBeNull();
    expect(s.get(OTHER)).not.toBeNull();
  });

  it("discards all bases when the scopeId does not match (copied vault)", async () => {
    const storage = new FakeStorage();
    const s1 = new ConfigSyncStateStore(storage.asStorage(), () => "scopeA");
    s1.set(base(OWN));
    await s1.save();

    const s2 = new ConfigSyncStateStore(storage.asStorage(), () => "scopeB");
    await s2.load();
    expect(s2.all()).toHaveLength(0);
  });

  it("re-saves with the current scopeId after discarding", async () => {
    const storage = new FakeStorage();
    const s1 = new ConfigSyncStateStore(storage.asStorage(), () => "scopeA");
    s1.set(base(OWN));
    await s1.save();

    const s2 = new ConfigSyncStateStore(storage.asStorage(), () => "scopeB");
    await s2.load();
    const persisted = storage.peek(CONFIG_STATE_FILE) as { scopeId: string };
    expect(persisted.scopeId).toBe("scopeB");
  });

  it("drops a legacy v1 single-base file (re-reconciles fresh, no delete)", async () => {
    const storage = new FakeStorage();
    // Old format: { version: 1, base: {...} } — no `entries` map.
    await storage.writeJson(CONFIG_STATE_FILE, {
      version: 1,
      scopeId: "scopeA",
      base: { hash: "x", driveId: "y", remoteRawMd5: "z", localMtime: 1, remoteMtime: 2 },
    });
    const s = new ConfigSyncStateStore(storage.asStorage(), () => "scopeA");
    await s.load();
    // No entries carried over — safe (a fresh reconcile only up/downloads).
    expect(s.all()).toHaveLength(0);
  });

  it("destroy() removes the file", async () => {
    const storage = new FakeStorage();
    const s = new ConfigSyncStateStore(storage.asStorage(), () => "scopeA");
    s.set(base(OWN));
    await s.save();
    await s.destroy();
    expect(storage.peek(CONFIG_STATE_FILE)).toBeUndefined();
  });

  it("clear() empties all entries", () => {
    const storage = new FakeStorage();
    const s = new ConfigSyncStateStore(storage.asStorage(), () => "scopeA");
    s.set(base(OWN));
    s.clear();
    expect(s.all()).toHaveLength(0);
  });
});

describe("config state file naming", () => {
  it("isConfigStateFile matches only the config state file", () => {
    expect(isConfigStateFile(CONFIG_STATE_FILE)).toBe(true);
    expect(isConfigStateFile("sync-state-abc.json")).toBe(false);
  });

  it("does NOT collide with the per-target isStateFile()", () => {
    expect(isStateFile(CONFIG_STATE_FILE)).toBe(false);
  });
});
