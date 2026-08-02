/**
 * Integration tests for SyncEngine.sync() — the interplay of
 * collectLocal() (hash collection), Drive listing, reconcile() and
 * applyAction() against an in-memory vault and a fake Drive client.
 *
 * These tests verify observable behavior via the public sync() API:
 * which Drive operations run, how the vault changes, what ends up afterward
 * in the sync base. This also indirectly covers the (private) filters
 * extensionAllowed / isGoogleAppsFile / inScope.
 *
 * Format: AAA.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SyncEngine } from "../../src/sync-engine";
import { SyncStateStore } from "../../src/sync-state";
import { SyncStatus } from "../../src/sync-status";
import { SyncStateEntry, SyncTarget, newTarget } from "../../src/types";
import { FakeVault } from "../helpers/fake-vault";
import { FakeDriveClient } from "../helpers/fake-drive";
import { FakeStorage } from "../helpers/fake-storage";
import { md5Hex } from "../helpers/md5";

/** Options for setup(): target fields + a pre-populated sync base. */
interface SetupOptions extends Partial<SyncTarget> {
  /** Pre-populated base entries (formerly settings.syncState). */
  syncState?: Record<string, SyncStateEntry>;
  /** Local folders of OTHER targets (excluded from this target's scope). */
  siblingLocalFolders?: string[];
  /** Per-run action cap (mobile batch limit). Default: unlimited. */
  perRunActionCap?: number;
}

/** Builds engine + fakes; returns all parts for arrange/assert. */
function setup(opts: SetupOptions = {}) {
  const { syncState, siblingLocalFolders, perRunActionCap, ...targetOverrides } =
    opts;
  const target: SyncTarget = {
    ...newTarget("t1", "Test target"),
    driveFolderId: "root",
    ...targetOverrides,
  };
  const vault = new FakeVault();
  const drive = new FakeDriveClient();
  const storage = new FakeStorage();
  const store = new SyncStateStore(storage.asStorage(), () => "test-scope");
  // Put the pre-populated base directly into the store.
  if (syncState) {
    for (const entry of Object.values(syncState)) store.set(entry);
  }
  const status = new SyncStatus(); // real, UI-free status/log instance
  const engine = new SyncEngine(
    vault as never,
    drive.asClient(),
    store,
    target,
    status,
    vault.fileManager as never,
    () => siblingLocalFolders ?? [],
    () => perRunActionCap ?? Infinity
  );
  return { engine, vault, drive, store, storage, target, status };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("SyncEngine.sync — Vorbedingungen", () => {
  it("gibt null zurück und macht nichts, wenn kein Drive-Ordner konfiguriert ist", async () => {
    // Arrange
    const { engine, drive } = setup({ driveFolderId: "" });

    // Act
    const summary = await engine.sync(false);

    // Assert
    expect(summary).toBeNull();
    expect(drive.calls.createFile).toEqual([]);
  });

  it("überspringt parallele Läufe (zweiter Aufruf während des ersten -> null)", async () => {
    // Arrange
    const { engine, vault } = setup();
    vault.seed("a.md", "inhalt");

    // Act: start two runs at the same time.
    const [first, second] = await Promise.all([
      engine.sync(false),
      engine.sync(false),
    ]);

    // Assert: exactly one runs, the other is skipped.
    const results = [first, second];
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });
});

describe("SyncEngine.sync — Upload (neue lokale Datei)", () => {
  it("lädt eine neue lokale Datei hoch und legt einen Base-Eintrag an", async () => {
    // Arrange
    const { engine, vault, drive, store } = setup();
    vault.seed("neu.md", "hallo welt");

    // Act
    const summary = await engine.sync(false);

    // Assert
    expect(summary?.uploaded).toBe(1);
    expect(drive.calls.createFile).toEqual([{ path: "neu.md" }]);
    expect(store.get("neu.md")).toBeDefined();
  });
});

describe("SyncEngine.sync — Download (neue remote Datei)", () => {
  it("lädt eine rein remote existierende Datei in den Vault und legt Base an", async () => {
    // Arrange
    const { engine, vault, drive, store } = setup();
    drive.seed({ path: "remote.md", content: "remote inhalt", md5: "r1" });

    // Act
    const summary = await engine.sync(false);

    // Assert
    expect(summary?.downloaded).toBe(1);
    expect(vault.has("remote.md")).toBe(true);
    expect(vault.read("remote.md")).toBe("remote inhalt");
    expect(store.get("remote.md")).toBeDefined();
  });
});

describe("SyncEngine.sync — Google-Apps-Dateien werden gefiltert", () => {
  it("überspringt eine Google-Docs-Datei (vnd.google-apps.*) komplett", async () => {
    // Arrange
    const { engine, vault, drive } = setup();
    drive.seed({
      path: "doc",
      content: "egal",
      md5: "g1",
      mimeType: "application/vnd.google-apps.document",
    });

    // Act
    const summary = await engine.sync(false);

    // Assert: no download, no local file.
    expect(summary?.downloaded).toBe(0);
    expect(drive.calls.downloadFile).toEqual([]);
    expect(vault.has("doc")).toBe(false);
  });
});

describe("SyncEngine.sync — Dateiendungs-Whitelist", () => {
  it("lädt nur erlaubte Endungen hoch (allowedExtensions='md')", async () => {
    // Arrange
    const { engine, vault, drive } = setup({ allowedExtensions: "md" });
    vault.seed("erlaubt.md", "text");
    vault.seed("verboten.png", "binary");

    // Act
    const summary = await engine.sync(false);

    // Assert
    expect(summary?.uploaded).toBe(1);
    expect(drive.calls.createFile).toEqual([{ path: "erlaubt.md" }]);
  });

  it("behandelt die Whitelist case-insensitive und mit optionalem Punkt", async () => {
    // Arrange
    const { engine, vault, drive } = setup({ allowedExtensions: ".MD, PNG" });
    vault.seed("a.md", "text");
    vault.seed("b.PNG", "img");
    vault.seed("c.txt", "no");

    // Act
    await engine.sync(false);

    // Assert
    const paths = drive.calls.createFile.map((c) => c.path).sort();
    expect(paths).toEqual(["a.md", "b.PNG"]);
  });
});

describe("SyncEngine.sync — Ignore-Muster (Blacklist)", () => {
  it("lädt ignorierte lokale Dateien nicht hoch (Endung + Glob)", async () => {
    // Arrange
    const { engine, vault, drive } = setup({
      ignorePatterns: "tmp, *.log",
    });
    vault.seed("keep.md", "text");
    vault.seed("scratch.tmp", "temp");
    vault.seed("run.log", "log");

    // Act
    const summary = await engine.sync(false);

    // Assert: only the non-ignored file is uploaded.
    expect(summary?.uploaded).toBe(1);
    expect(drive.calls.createFile).toEqual([{ path: "keep.md" }]);
  });

  it("lädt ignorierte Drive-Dateien nicht herunter", async () => {
    // Arrange
    const { engine, vault, drive } = setup({ ignorePatterns: "*.tmp" });
    drive.seed({ path: "keep.md", content: "a", md5: "m1" });
    drive.seed({ path: "junk.tmp", content: "b", md5: "m2" });

    // Act
    const summary = await engine.sync(false);

    // Assert
    expect(summary?.downloaded).toBe(1);
    expect(vault.has("keep.md")).toBe(true);
    expect(vault.has("junk.tmp")).toBe(false);
  });

  it("LÖSCHSCHUTZ: eine ignorierte Datei mit beidseitiger Base wird auf KEINER Seite gelöscht", async () => {
    // Arrange: file exists locally AND remotely, base attests both sides.
    // If the ignore filter only applied on one side, the reconciler would see
    // it as "deleted on one side" and would delete it on the other.
    const content = "geheim";
    const md5 = md5Hex(content);
    const { engine, vault, drive, store } = setup({
      ignorePatterns: "*.secret",
      syncState: {
        "note.secret": {
          path: "note.secret",
          local: true,
          remote: true,
          isFolder: false,
          driveId: "d1",
          md5,
          size: content.length,
          localMtime: 1000,
          remoteMtime: 1000,
        },
      },
    });
    vault.seed("note.secret", content);
    drive.seed({ path: "note.secret", content, md5, id: "d1" });

    // Act
    const summary = await engine.sync(false);

    // Assert: no deletion on either side, file is preserved everywhere.
    expect(summary?.deletedLocal).toBe(0);
    expect(summary?.deletedRemote).toBe(0);
    expect(drive.calls.trashFile).toEqual([]);
    expect(vault.has("note.secret")).toBe(true);
  });
});

describe("SyncEngine.sync — Ausschluss-Ordner (mehrere Ziele)", () => {
  it("ein Full-Vault-Ziel lädt Dateien im Ordner eines anderen Ziels NICHT hoch", async () => {
    // Arrange: whole-vault target; sibling target owns "work/".
    const { engine, vault, drive } = setup({
      localFolder: "",
      siblingLocalFolders: ["work"],
    });
    vault.seed("notes/keep.md", "im scope");
    vault.seed("work/owned.md", "gehört dem anderen Ziel");

    // Act
    const summary = await engine.sync(false);

    // Assert: only the non-excluded file is uploaded.
    expect(summary?.uploaded).toBe(1);
    expect(drive.calls.createFile).toEqual([{ path: "notes/keep.md" }]);
  });

  it("lädt Drive-Dateien im ausgeschlossenen Ordner NICHT herunter", async () => {
    // Arrange: whole-vault target; sibling owns "work/". Drive has a file
    // under the excluded folder and one outside it.
    const { engine, vault, drive } = setup({
      localFolder: "",
      siblingLocalFolders: ["work"],
    });
    drive.seed({ path: "keep.md", content: "a", md5: "m1" });
    drive.seed({ path: "work/skip.md", content: "b", md5: "m2" });

    // Act
    const summary = await engine.sync(false);

    // Assert: only the non-excluded file is downloaded.
    expect(summary?.downloaded).toBe(1);
    expect(vault.has("keep.md")).toBe(true);
    expect(vault.has("work/skip.md")).toBe(false);
  });

  it("LÖSCHSCHUTZ: eine ausgeschlossene Datei mit beidseitiger Base wird auf KEINER Seite gelöscht", async () => {
    // Arrange: file under excluded folder exists on both sides, base attests both.
    // If exclusion applied on one side only, the reconciler would delete it.
    const content = "wichtig";
    const md5 = md5Hex(content);
    const { engine, vault, drive, store } = setup({
      localFolder: "",
      siblingLocalFolders: ["work"],
      syncState: {
        "work/note.md": {
          path: "work/note.md",
          local: true,
          remote: true,
          isFolder: false,
          driveId: "d1",
          md5,
          size: content.length,
          localMtime: 1000,
          remoteMtime: 1000,
        },
      },
    });
    vault.seed("work/note.md", content);
    drive.seed({ path: "work/note.md", content, md5, id: "d1" });

    // Act
    const summary = await engine.sync(false);

    // Assert: no deletion on either side.
    expect(summary?.deletedLocal).toBe(0);
    expect(summary?.deletedRemote).toBe(0);
    expect(drive.calls.trashFile).toEqual([]);
    expect(vault.has("work/note.md")).toBe(true);
  });

  it("honoriert auch das manuelle excludeFolders-Feld (zusätzlich zu Geschwistern)", async () => {
    // Arrange
    const { engine, vault, drive } = setup({
      localFolder: "",
      excludeFolders: "archive",
    });
    vault.seed("keep.md", "text");
    vault.seed("archive/old.md", "alt");

    // Act
    const summary = await engine.sync(false);

    // Assert
    expect(summary?.uploaded).toBe(1);
    expect(drive.calls.createFile).toEqual([{ path: "keep.md" }]);
  });
});

describe("SyncEngine.sync — Scope auf Unterordner (localFolder)", () => {
  it("synct nur Dateien innerhalb von localFolder und strippt das Präfix im Drive-Pfad", async () => {
    // Arrange
    const { engine, vault, drive } = setup({ localFolder: "sync" });
    vault.seed("sync/drin.md", "im scope");
    vault.seed("aussen.md", "out of scope");

    // Act
    const summary = await engine.sync(false);

    // Assert: only the file inside the folder, and its path is relative to the folder.
    expect(summary?.uploaded).toBe(1);
    expect(drive.calls.createFile).toEqual([{ path: "drin.md" }]);
  });

  it("schreibt einen remote Download an den korrekten absoluten Vault-Pfad (Präfix vorangestellt)", async () => {
    // Arrange: remote path is sync-relative (as stored on upload).
    const { engine, vault, drive } = setup({ localFolder: "sync" });
    drive.seed({ path: "drin.md", content: "runtergeladen", md5: "r1" });

    // Act
    await engine.sync(false);

    // Assert: ends up under sync/drin.md in the vault.
    expect(vault.has("sync/drin.md")).toBe(true);
    expect(vault.read("sync/drin.md")).toBe("runtergeladen");
  });
});

describe("SyncEngine.sync — Löschung remote propagieren", () => {
  it("löscht lokal, wenn die Datei remote gelöscht wurde und lokal unverändert ist", async () => {
    // Arrange: base knows the file, still there locally, gone remotely.
    const md5 = md5Hex("stabiler inhalt");
    const { engine, vault, store } = setup({
      syncState: {
        "x.md": {
          path: "x.md",
          local: true,
          remote: true,
          isFolder: false,
          driveId: "d-x",
          md5,
          size: 14,
          localMtime: 1_000,
          remoteMtime: 1_000,
        },
      },
    });
    vault.seed("x.md", "stabiler inhalt");
    // Drive empty -> deleted remotely.

    // Act
    const summary = await engine.sync(false);

    // Assert
    expect(summary?.deletedLocal).toBe(1);
    expect(vault.has("x.md")).toBe(false);
    expect(store.get("x.md")).toBeUndefined();
  });

  it("routes a local deletion through FileManager.trashFile (deletion preference)", async () => {
    // Arrange: file known in the base, present locally, gone remotely.
    const md5 = md5Hex("stabiler inhalt");
    const vault = new FakeVault();
    const drive = new FakeDriveClient();
    const storage = new FakeStorage();
    const store = new SyncStateStore(storage.asStorage(), () => "test-scope");
    store.set({
      path: "x.md",
      local: true,
      remote: true,
      isFolder: false,
      driveId: "d-x",
      md5,
      size: 14,
      localMtime: 1_000,
      remoteMtime: 1_000,
    });
    vault.seed("x.md", "stabiler inhalt");

    // Spy on FileManager.trashFile (the ONLY deletion path); vault.trash must
    // never be called.
    const trashFile = vi.spyOn(vault.fileManager, "trashFile");
    const vaultTrash = vi.spyOn(vault, "trash");
    const target: SyncTarget = {
      ...newTarget("t1", "Test target"),
      driveFolderId: "root",
    };
    const engine = new SyncEngine(
      vault as never,
      drive.asClient(),
      store,
      target,
      new SyncStatus(),
      vault.fileManager as never,
      () => []
    );

    // Act
    const summary = await engine.sync(false);

    // Assert: routed through FileManager.trashFile, NOT vault.trash().
    expect(summary?.deletedLocal).toBe(1);
    expect(trashFile).toHaveBeenCalledTimes(1);
    expect(vaultTrash).not.toHaveBeenCalled();
    expect(vault.has("x.md")).toBe(false);
    expect(store.get("x.md")).toBeUndefined();
  });
});

describe("SyncEngine.sync — Do not delete in Google Drive (neverDeleteRemote)", () => {
  it("behält die Drive-Datei bei lokaler Löschung und setzt Base auf nur-remote", async () => {
    // Arrange: file was on both sides, now gone locally, unchanged remotely.
    const content = "bleibt in drive";
    const md5 = md5Hex(content);
    const { engine, drive, store } = setup({
      neverDeleteRemote: true,
      syncState: {
        "keep.md": {
          path: "keep.md",
          local: true,
          remote: true,
          isFolder: false,
          driveId: "d-keep",
          md5,
          size: content.length,
          localMtime: 1_000,
          remoteMtime: 1_000,
        },
      },
    });
    // File is missing locally; still present in Drive.
    drive.seed({ path: "keep.md", content, md5, id: "d-keep" });

    // Act
    const summary = await engine.sync(false);

    // Assert: NO Drive deletion; base set to remote-only with keptRemoteOnly.
    expect(drive.calls.trashFile).toEqual([]);
    expect(summary?.deletedRemote).toBe(0);
    const entry = store.get("keep.md");
    expect(entry).toMatchObject({
      local: false,
      remote: true,
      keptRemoteOnly: true,
    });
  });

  it("holt eine nur-remote-Datei NICHT als Zombie zurück (local=false verhindert Download)", async () => {
    // Arrange: base says local=false, remote=true; file present in Drive.
    const content = "nur remote";
    const md5 = md5Hex(content);
    const { engine, vault, drive } = setup({
      neverDeleteRemote: true,
      syncState: {
        "keep.md": {
          path: "keep.md",
          local: false,
          remote: true,
          keptRemoteOnly: true,
          isFolder: false,
          driveId: "d-keep",
          md5,
          size: content.length,
          localMtime: 0,
          remoteMtime: 1_000,
        },
      },
    });
    drive.seed({ path: "keep.md", content, md5, id: "d-keep" });

    // Act
    const summary = await engine.sync(false);

    // Assert: no download, file stays absent locally.
    expect(summary?.downloaded).toBe(0);
    expect(drive.calls.downloadFile).toEqual([]);
    expect(vault.has("keep.md")).toBe(false);
  });
});

describe("SyncEngine.sync — Fehler werden gesammelt, nicht geworfen", () => {
  it("sammelt einen Download-Fehler in summary.errors und läuft weiter", async () => {
    // Arrange
    const { engine, drive } = setup();
    drive.seed({ path: "kaputt.md", content: "x", md5: "r1", id: "d-boom" });
    vi.spyOn(drive, "downloadFile").mockRejectedValue(new Error("Netzwerk weg")); // "network gone"

    // Act
    const summary = await engine.sync(false);

    // Assert
    expect(summary?.errors.length).toBe(1);
    expect(summary?.errors[0]).toMatch(/Netzwerk weg/);
    expect(summary?.downloaded).toBe(0);
  });
});

describe("SyncEngine.sync — keine Änderungen", () => {
  it("macht bei identischem Stand (lokal == remote == base) keine Drive-Schreiboperation", async () => {
    // Arrange
    const content = "unveraendert";
    const md5 = md5Hex(content);
    const { engine, vault, drive } = setup({
      syncState: {
        "s.md": {
          path: "s.md",
          local: true,
          remote: true,
          isFolder: false,
          driveId: "d-s",
          md5,
          size: content.length,
          localMtime: 1_000,
          remoteMtime: 1_000,
        },
      },
    });
    vault.seed("s.md", content);
    drive.seed({ path: "s.md", content, md5, id: "d-s" });

    // Act
    const summary = await engine.sync(false);

    // Assert
    expect(summary).toMatchObject({
      uploaded: 0,
      downloaded: 0,
      deletedLocal: 0,
      deletedRemote: 0,
      conflicts: 0,
    });
    expect(drive.calls.createFile).toEqual([]);
    expect(drive.calls.updateFile).toEqual([]);
  });
});

describe("SyncEngine.sync — Checkpoint-Speichern bei großen Läufen", () => {
  it("speichert den State alle 50 Aktionen zwischen (plus einmal am Ende)", async () => {
    // Arrange: 120 new local files -> 120 uploads.
    const { engine, vault, storage } = setup();
    for (let i = 0; i < 120; i++) vault.seed(`f${i}.md`, `inhalt-${i}`);

    // Act
    const summary = await engine.sync(false);

    // Assert: 120 uploads, and sync-state.json was written 3 times
    // (checkpoint after 50 and 100, plus final save at end of run).
    expect(summary?.uploaded).toBe(120);
    expect(storage.writeCount("sync-state.json")).toBe(3);
  });

  it("ein Checkpoint enthält bereits die abgeschlossenen Übertragungen", async () => {
    // Arrange: exactly 50 uploads -> exactly 1 checkpoint (+ final save).
    const { engine, vault, storage } = setup();
    for (let i = 0; i < 50; i++) vault.seed(`g${i}.md`, `x${i}`);

    // Act
    await engine.sync(false);

    // Assert: after 50 actions, 1 checkpoint + 1 final save = 2 writes; the
    // persisted state contains all 50 entries (local & remote true).
    expect(storage.writeCount("sync-state.json")).toBe(2);
    const persisted = storage.peek("sync-state.json") as {
      entries: Record<string, { local: boolean; remote: boolean }>;
    };
    expect(Object.keys(persisted.entries)).toHaveLength(50);
    expect(persisted.entries["g0.md"]).toMatchObject({ local: true, remote: true });
  });
});

describe("SyncEngine.sync — Pfad-Kollision: doppelte Drive-Dateinamen", () => {
  it("überspringt den Pfad komplett, wenn zwei Drive-Dateien mit gleichem Pfad UNTERSCHIEDLICHEN Inhalt haben", async () => {
    // Arrange: two Drive files, same path, different md5.
    const { engine, drive, vault, store } = setup();
    drive.seed({ path: "dup.md", content: "version A", md5: "hA", id: "d-A" });
    drive.seed({ path: "dup.md", content: "version B", md5: "hB", id: "d-B" });

    // Act
    const summary = await engine.sync(false);

    // Assert: nothing downloaded, no base, one error reported.
    expect(drive.calls.downloadFile).toEqual([]);
    expect(vault.has("dup.md")).toBe(false);
    expect(store.get("dup.md")).toBeUndefined();
    expect(summary?.errors.some((e) => e.includes("dup.md"))).toBe(true);
  });

  it("wählt bei INHALTSGLEICHEN Duplikaten (gleicher md5) deterministisch eine und synct normal", async () => {
    // Arrange: two Drive files, same path, same md5.
    const { engine, drive, vault } = setup();
    drive.seed({ path: "dup.md", content: "same", md5: "hSame", id: "d-2" });
    drive.seed({ path: "dup.md", content: "same", md5: "hSame", id: "d-1" });

    // Act
    const summary = await engine.sync(false);

    // Assert: exactly one download (the smallest ID "d-1"), no error.
    expect(summary?.downloaded).toBe(1);
    expect(drive.calls.downloadFile).toEqual(["d-1"]);
    expect(vault.read("dup.md")).toBe("same");
    expect(summary?.errors ?? []).toEqual([]);
  });
});

describe("SyncEngine.sync — Schutz vor Remote-Teilbaum-Verlust", () => {
  it("löscht einen Drive-Ordner NICHT, wenn er noch Drive-Dateien enthält (auch wenn er lokal fehlt)", async () => {
    // Arrange: Drive has folder "sub" with a file "sub/keep.md". The base
    // says: "sub" was last present locally+remotely. Locally "sub" is now
    // completely missing (e.g. transient folder-enumeration hiccup). Without
    // protection reconcileFolders would deleteRemoteFolder("sub") -> trashes
    // the whole subtree.
    const { engine, drive, store } = setup();
    const subId = await drive.createFolderPath("root", "sub");
    // File lives remotely under sub/ and also doesn't exist locally -> stays
    // remote (base doesn't know it -> counts as new addition -> download, no delete).
    drive.seed({ path: "sub/keep.md", content: "wichtig", md5: "k1", id: "d-keep" });
    // Folder base: sub was present locally+remotely.
    store.set({
      path: "sub",
      local: true,
      remote: true,
      isFolder: true,
      driveId: subId,
      md5: "",
      size: 0,
      localMtime: 0,
      remoteMtime: 0,
    });

    // Act
    const summary = await engine.sync(false);

    // Assert: NO trashFolder; instead an error/notice that the folder
    // still contains files.
    expect(drive.calls.trashFolder).toEqual([]);
    expect(
      summary?.errors.some((e) => e.includes("sub") && e.includes("files"))
    ).toBe(true);
  });
});

describe("SyncEngine.sync — lokale Ordner aus Datei-Elternketten abgeleitet", () => {
  it("erkennt einen befüllten lokalen Ordner als vorhanden, auch wenn getAllLoadedFiles() leer ist", async () => {
    // Arrange: local file in subfolder; getAllLoadedFiles() is empty in the fake.
    // The folder "sub" must still count as locally present (derived from the
    // parent chain of "sub/a.md") and therefore be created in Drive.
    const { engine, vault, drive } = setup();
    vault.seed("sub/a.md", "inhalt");

    // Act
    await engine.sync(false);

    // Assert: folder "sub" was created in Drive (from the parent chain).
    expect(drive.calls.createFolderPath.map((c) => c.path)).toContain("sub");
  });
});

describe("SyncEngine.sync — Hash-Cache (mtime+size)", () => {
  it("liest eine unveränderte Datei NICHT erneut (nutzt gespeicherten MD5)", async () => {
    // Arrange: file identical locally + in Drive, base matches exactly (mtime+size+md5).
    const content = "unchanged content";
    const md5 = md5Hex(content);
    const size = new TextEncoder().encode(content).byteLength;
    const { engine, vault, drive } = setup({
      syncState: {
        "keep.md": {
          path: "keep.md",
          local: true,
          remote: true,
          isFolder: false,
          driveId: "d1",
          md5,
          size,
          localMtime: 1_000,
          remoteMtime: 1_000,
        },
      },
    });
    vault.seed("keep.md", content, 1_000); // mtime == base
    drive.seed({ path: "keep.md", content, md5, id: "d1" });

    // Act
    const summary = await engine.sync(false);

    // Assert: no transfer AND the file was not read (cache hit).
    expect(summary?.uploaded).toBe(0);
    expect(summary?.downloaded).toBe(0);
    expect(vault.adapter.readBinaryCalls).not.toContain("keep.md");
  });

  it("liest die Datei neu, wenn die mtime abweicht (kein Cache-Hit)", async () => {
    // Arrange: same size/content, but the file's mtime ≠ base -> suspect.
    const content = "content";
    const md5 = md5Hex(content);
    const size = new TextEncoder().encode(content).byteLength;
    const { engine, vault } = setup({
      syncState: {
        "f.md": {
          path: "f.md",
          local: true,
          remote: true,
          isFolder: false,
          driveId: "d1",
          md5,
          size,
          localMtime: 1_000, // base mtime
          remoteMtime: 1_000,
        },
      },
    });
    vault.seed("f.md", content, 9_999); // different mtime -> cache miss

    // Act
    await engine.sync(false);

    // Assert: file was read (re-hashed).
    expect(vault.adapter.readBinaryCalls).toContain("f.md");
  });

  it("liest eine neue Datei ohne Base (erster Sync hasht wie gehabt)", async () => {
    // Arrange
    const { engine, vault } = setup();
    vault.seed("new.md", "hello");

    // Act
    await engine.sync(false);

    // Assert
    expect(vault.adapter.readBinaryCalls).toContain("new.md");
  });
});

describe("SyncEngine.sync — per-run batch cap (mobile) + resume", () => {
  it("processes only the cap and reports moreRemaining", async () => {
    // Arrange: 5 remote files, cap of 2.
    const { engine, drive } = setup({ perRunActionCap: 2 });
    for (let i = 0; i < 5; i++) {
      drive.seed({ path: `f${i}.md`, content: `c${i}`, md5: `m${i}`, id: `d${i}` });
    }

    // Act
    const summary = await engine.sync(false);

    // Assert: only 2 downloaded this run; more remains.
    expect(summary?.downloaded).toBe(2);
    expect(summary?.moreRemaining).toBe(true);
  });

  it("resumes across runs and eventually completes all files", async () => {
    // Arrange: 5 remote files, cap of 2.
    const { engine, vault, drive, store } = setup({ perRunActionCap: 2 });
    for (let i = 0; i < 5; i++) {
      drive.seed({ path: `f${i}.md`, content: `c${i}`, md5: `m${i}`, id: `d${i}` });
    }

    // Act: run until the engine reports it's done (mimics main.runSync's loop).
    let totalDownloaded = 0;
    let passes = 0;
    let last;
    do {
      last = await engine.sync(false);
      totalDownloaded += last?.downloaded ?? 0;
      passes++;
      expect(passes).toBeLessThan(20); // guard against a runaway loop
    } while (last?.moreRemaining);

    // Assert: all 5 files ended up local; last run reported completion.
    expect(totalDownloaded).toBe(5);
    expect(last?.moreRemaining).toBeFalsy();
    for (let i = 0; i < 5; i++) {
      expect(await vault.adapter.exists(`f${i}.md`)).toBe(true);
      // Base marks each as two-sided (fully synced).
      const entry = store.get(`f${i}.md`);
      expect(entry?.local).toBe(true);
      expect(entry?.remote).toBe(true);
    }
  });

  it("a capped run performs NO deletions (folder-delete phase is deferred)", async () => {
    // Arrange: base attests a local file that no longer exists locally and isn't
    // on Drive, which WOULD normally reconcile to a deletion. Also queue enough
    // downloads to exceed the cap so the run is capped and returns before the
    // delete phase.
    const { engine, drive } = setup({
      perRunActionCap: 1,
      syncState: {
        "old.md": {
          path: "old.md",
          isFolder: false,
          local: true,
          remote: true,
          driveId: "old-id",
          md5: "old",
          size: 3,
        } as SyncStateEntry,
      },
    });
    for (let i = 0; i < 3; i++) {
      drive.seed({ path: `f${i}.md`, content: `c${i}`, md5: `m${i}`, id: `d${i}` });
    }

    // Act
    const summary = await engine.sync(false);

    // Assert: run was capped and did NOT trash anything (local or remote) — the
    // delete phase runs only on an uncapped, fully-settled run.
    expect(summary?.moreRemaining).toBe(true);
    expect(summary?.deletedRemote).toBe(0);
    expect(summary?.deletedLocal).toBe(0);
    expect(drive.calls.trashFile).toEqual([]);
    expect(drive.calls.trashFolder).toEqual([]);
  });
});

describe("SyncEngine.sync — remote store (streamed reconcile)", () => {
  it("downloads a remote file streamed through the remote store", async () => {
    // The fake streams the file via onFile → the engine stores it in the remote
    // store → batched reconcile → download.
    const { engine, vault, drive } = setup();
    drive.seed({ path: "stored.md", content: "hi", md5: "m1", id: "d1" });

    const summary = await engine.sync(false);

    expect(summary?.downloaded).toBe(1);
    expect(await vault.adapter.exists("stored.md")).toBe(true);
  });

  it("preserves duplicate-path resolution through the store (identical content -> smallest id)", async () => {
    // Two Drive files at the SAME path with identical md5 -> the store keeps the
    // smallest id and the engine downloads once.
    const { engine, drive, vault } = setup();
    drive.seed({ path: "dup.md", content: "x", md5: "same", id: "d2" });
    drive.seed({ path: "dup.md", content: "x", md5: "same", id: "d1" });

    const summary = await engine.sync(false);

    expect(summary?.downloaded).toBe(1);
    expect(drive.calls.downloadFile).toEqual(["d1"]);
    expect(await vault.adapter.exists("dup.md")).toBe(true);
  });
});

describe("SyncEngine.sync — Google Docs & Sheets (view-only stubs)", () => {
  const GDOC_MIME = "application/vnd.google-apps.document";
  const GSHEET_MIME = "application/vnd.google-apps.spreadsheet";

  it("writes a .gdoc.md stub for a Google Doc when syncGoogleDocs is on", async () => {
    const { engine, vault, drive } = setup({ syncGoogleDocs: true });
    drive.seed({
      path: "My Doc",
      content: "",
      md5: "",
      id: "doc1",
      mimeType: GDOC_MIME,
    });

    await engine.sync(false);

    expect(await vault.adapter.exists("My Doc.gdoc.md")).toBe(true);
    const text = await vault.adapter.read("My Doc.gdoc.md");
    expect(text).toContain("gdocId: doc1");
    expect(text).toContain("gdocKind: doc");
    expect(text).toContain("```gdoc");
  });

  it("writes a .gsheet.md stub for a Google Sheet when syncGoogleDocs is on", async () => {
    const { engine, vault, drive } = setup({ syncGoogleDocs: true });
    drive.seed({
      path: "Budget",
      content: "",
      md5: "",
      id: "sheet1",
      mimeType: GSHEET_MIME,
    });

    await engine.sync(false);

    expect(await vault.adapter.exists("Budget.gsheet.md")).toBe(true);
    const text = await vault.adapter.read("Budget.gsheet.md");
    expect(text).toContain("gdocId: sheet1");
    expect(text).toContain("gdocKind: sheet");
    expect(text).toContain("spreadsheets/d/sheet1/edit");
  });

  it("writes a .gslides.md stub for a Google Slides deck", async () => {
    const { engine, vault, drive } = setup({ syncGoogleDocs: true });
    drive.seed({
      path: "Deck",
      content: "",
      md5: "",
      id: "slide1",
      mimeType: "application/vnd.google-apps.presentation",
    });

    await engine.sync(false);

    expect(await vault.adapter.exists("Deck.gslides.md")).toBe(true);
    const text = await vault.adapter.read("Deck.gslides.md");
    expect(text).toContain("gdocKind: slide");
    expect(text).toContain("presentation/d/slide1/edit");
  });

  it("writes a .gdraw.md stub for a Google Drawing", async () => {
    const { engine, vault, drive } = setup({ syncGoogleDocs: true });
    drive.seed({
      path: "Diagram",
      content: "",
      md5: "",
      id: "draw1",
      mimeType: "application/vnd.google-apps.drawing",
    });

    await engine.sync(false);

    expect(await vault.adapter.exists("Diagram.gdraw.md")).toBe(true);
    const text = await vault.adapter.read("Diagram.gdraw.md");
    expect(text).toContain("gdocKind: drawing");
    expect(text).toContain("drawings/d/draw1/edit");
  });

  it("does NOT create a stub for an unsupported Apps kind (e.g. Forms)", async () => {
    const { engine, vault, drive } = setup({ syncGoogleDocs: true });
    drive.seed({
      path: "Survey",
      content: "",
      md5: "",
      id: "form1",
      mimeType: "application/vnd.google-apps.form",
    });

    await engine.sync(false);

    expect(await vault.adapter.exists("Survey.gdoc.md")).toBe(false);
    expect(await vault.adapter.exists("Survey.gsheet.md")).toBe(false);
    expect(await vault.adapter.exists("Survey.gslides.md")).toBe(false);
    expect(await vault.adapter.exists("Survey.gdraw.md")).toBe(false);
  });

  it("does NOT create a stub when syncGoogleDocs is off", async () => {
    const { engine, vault, drive } = setup({ syncGoogleDocs: false });
    drive.seed({
      path: "My Doc",
      content: "",
      md5: "",
      id: "doc1",
      mimeType: GDOC_MIME,
    });

    await engine.sync(false);

    expect(await vault.adapter.exists("My Doc.gdoc.md")).toBe(false);
  });

  it("never uploads a stub back to Drive and never deletes it (not synced content)", async () => {
    // A stub already exists locally; there is NO base entry for it. A normal
    // local-only file would be uploaded — a stub must not be, and must not be
    // deleted either (deletion safety by exclusion from the reconciler).
    const { engine, vault, drive } = setup({ syncGoogleDocs: true });
    vault.seed(
      "My Doc.gdoc.md",
      "---\ngdoc: true\ngdocId: doc1\n---\n"
    );
    drive.seed({
      path: "My Doc",
      content: "",
      md5: "",
      id: "doc1",
      mimeType: GDOC_MIME,
    });

    await engine.sync(false);

    // The stub was never uploaded as a Drive file...
    expect(drive.calls.createFile).toEqual([]);
    expect(drive.calls.updateFile).toEqual([]);
    // ...and it still exists locally (not trashed).
    expect(vault.has("My Doc.gdoc.md")).toBe(true);
  });

  it("is idempotent: a second run does not rewrite an up-to-date stub", async () => {
    const { engine, vault, drive } = setup({ syncGoogleDocs: true });
    drive.seed({
      path: "My Doc",
      content: "",
      md5: "",
      id: "doc1",
      mimeType: GDOC_MIME,
    });

    await engine.sync(false);
    const first = await vault.adapter.read("My Doc.gdoc.md");
    await engine.sync(false);
    const second = await vault.adapter.read("My Doc.gdoc.md");

    expect(second).toBe(first);
  });

  it("does not clobber a user's real note that happens to sit at the stub path", async () => {
    const { engine, vault, drive } = setup({ syncGoogleDocs: true });
    // A user file at the would-be stub path that is NOT our stub.
    vault.seed("My Doc.gdoc.md", "user content, not a stub");
    drive.seed({
      path: "My Doc",
      content: "",
      md5: "",
      id: "doc1",
      mimeType: GDOC_MIME,
    });

    await engine.sync(false);

    expect(await vault.adapter.read("My Doc.gdoc.md")).toBe(
      "user content, not a stub"
    );
  });
});

describe("SyncEngine.sync — all file types (adapter walk, incl. HEIC)", () => {
  it("uploads files with extensions Obsidian doesn't recognize (.heic, .avif)", async () => {
    // Arrange: files Obsidian's getFiles() would omit — collectLocal now walks
    // the adapter, so they must be collected and uploaded.
    const { engine, vault, drive, store } = setup();
    vault.seed("Photos/img.heic", "heic-bytes");
    vault.seed("Photos/pic.avif", "avif-bytes");

    // Act
    await engine.sync(false);

    // Assert
    const uploaded = drive.calls.createFile.map((c) => c.path).sort();
    expect(uploaded).toEqual(["Photos/img.heic", "Photos/pic.avif"]);
    expect(store.get("Photos/img.heic")).toBeDefined();
    expect(store.get("Photos/pic.avif")).toBeDefined();
  });

  it("NEVER walks the config dir, .trash, .DS_Store, or root dot-folders", async () => {
    // Arrange: a real file plus system + hidden paths a raw adapter walk surfaces.
    const { engine, vault, drive } = setup();
    vault.seed("note.md", "real");
    vault.seed(".obsidian/plugins/x/data.json", "{}");
    vault.seed(".obsidian/app.json", "{}");
    vault.seed(".trash/old.md", "trashed");
    vault.seed(".DS_Store", "junk");
    vault.seed("sub/.DS_Store", "junk");
    // Hidden plugin/cache folders at the vault root (the .smart-env regression).
    vault.seed(".smart-env/embeddings.json", "big");
    vault.seed(".git/config", "x");
    vault.seed(".obsidian-git-data", "x"); // root dot-file

    // Act
    await engine.sync(false);

    // Assert: only the real note uploaded; no system/hidden path leaked in.
    expect(drive.calls.createFile.map((c) => c.path)).toEqual(["note.md"]);
  });

  it("still syncs a dot-named file INSIDE a normal folder (not root)", async () => {
    // Arrange: only root-level dot-entries are excluded; a nested one is fine.
    const { engine, vault, drive } = setup();
    vault.seed("Notes/.keep", "keepme");

    // Act
    await engine.sync(false);

    // Assert
    expect(drive.calls.createFile.map((c) => c.path)).toEqual(["Notes/.keep"]);
  });

  it("a previously-synced file that became excluded is NOT deleted (Case 1)", async () => {
    // Arrange: .smart-env was uploaded by a prior run (base says local+remote),
    // then excluded by this fix. It's absent from both local + remote now → the
    // reconciler must NOT propagate a deletion (deletion-safety), just orphan it.
    const { engine, vault, drive, store } = setup();
    vault.seed("note.md", "real");
    store.set({
      path: ".smart-env/embeddings.json",
      local: true,
      remote: true,
      md5: "old",
      size: 3,
      localMtime: 1_000,
      remoteMtime: 1_000,
      driveId: "smart1",
      isFolder: false,
    });

    // Act
    await engine.sync(false);

    // Assert: the orphaned Drive file was never trashed.
    expect(drive.calls.trashFile).not.toContain("smart1");
  });

  it("scopes the walk to a subfolder target (files outside are not collected)", async () => {
    // Arrange
    const { engine, vault, drive } = setup({ localFolder: "Sync" });
    vault.seed("Sync/inside.heic", "in");
    vault.seed("Outside/other.heic", "out");

    // Act
    await engine.sync(false);

    // Assert: relative path is folder-stripped; outside file ignored.
    expect(drive.calls.createFile.map((c) => c.path)).toEqual(["inside.heic"]);
  });

  it("reuses the hash cache for an unchanged .heic (no re-read)", async () => {
    // Arrange: base already has the file at its current mtime+size.
    const { engine, vault, store } = setup();
    const content = "heic-bytes";
    vault.seed("img.heic", content); // fake mtime defaults to 1_000
    const stat = await vault.adapter.stat("img.heic");
    store.set({
      path: "img.heic",
      local: true,
      remote: true,
      md5: md5Hex(content),
      size: stat!.size,
      localMtime: stat!.mtime,
      remoteMtime: 1_000,
      driveId: "d1",
      isFolder: false,
    });
    // A matching remote so it reconciles to noop.
    // (drive listing is empty here; a noop upload path still must not re-read.)
    vault.adapter.readBinaryCalls.length = 0;

    // Act
    await engine.sync(false);

    // Assert: the unchanged .heic was NOT read (served from the hash cache).
    expect(vault.adapter.readBinaryCalls).not.toContain("img.heic");
  });

  it("propagates a local .heic deletion to Drive (not misread)", async () => {
    // Arrange: base says the .heic existed on BOTH sides; it's now gone locally.
    const { engine, vault, drive, store } = setup();
    drive.seed({ path: "img.heic", content: "heic-bytes", md5: "h1", id: "d1" });
    store.set({
      path: "img.heic",
      local: true,
      remote: true,
      md5: "h1",
      size: 10,
      localMtime: 1_000,
      remoteMtime: 1_000,
      driveId: "d1",
      isFolder: false,
    });
    // File absent locally (never seeded) → deleted locally.

    // Act
    await engine.sync(false);

    // Assert: deletion propagated to Drive trash, not treated as a new download.
    expect(drive.calls.trashFile).toContain("d1");
  });

  it("trashes a locally-present .heic when it's deleted in Drive", async () => {
    // Arrange: base says both sides had it; local still present, remote gone.
    const { engine, vault, store } = setup();
    vault.seed("img.heic", "heic-bytes");
    store.set({
      path: "img.heic",
      local: true,
      remote: true,
      md5: md5Hex("heic-bytes"),
      size: (await vault.adapter.stat("img.heic"))!.size,
      localMtime: 1_000,
      remoteMtime: 1_000,
      driveId: "d1",
      isFolder: false,
    });
    // Drive listing is empty (remote deleted).

    // Act
    await engine.sync(false);

    // Assert: the local .heic was trashed (removed from the vault map).
    expect(vault.has("img.heic")).toBe(false);
  });
});

describe("SyncEngine.sync — subfolder target does not leak its own root as a folder", () => {
  it("does NOT recreate the sync-root's own (nested) path as a folder in Drive", async () => {
    // Arrange: a deep subfolder target. In real Obsidian getAllLoadedFiles()
    // returns the sync-root TFolder itself; the fake now mirrors that (it derives
    // folders from the seeded file's parent chain, incl. the root). Before the
    // fix, the root's full vault path leaked as a folder and was recreated as an
    // empty "2 Areas → Projects → ARC ERP" chain in Drive.
    const { engine, drive, vault } = setup({
      localFolder: "2 Areas/Projects/ARC ERP",
    });
    vault.seed("2 Areas/Projects/ARC ERP/note.md", "hi");

    // Act
    await engine.sync(false);

    // Assert: the file uploaded at its sync-relative path; no folder create that
    // reintroduces the target's own root/parent path.
    expect(drive.calls.createFile).toEqual([{ path: "note.md" }]);
    const folderPaths = drive.calls.createFolderPath.map((c) => c.path);
    expect(folderPaths).not.toContain("2 Areas/Projects/ARC ERP");
    expect(folderPaths).not.toContain("2 Areas");
    // No stray folder creates at all for a flat one-file target.
    expect(folderPaths).toEqual([]);
  });

  it("still syncs a genuine empty subfolder INSIDE the target (sync-relative)", async () => {
    // Arrange: a real empty subfolder within the target. The fake derives it from
    // a placeholder file the target ignores, so the folder is "empty" as far as
    // synced content goes but present in getAllLoadedFiles().
    const { engine, drive, vault } = setup({
      localFolder: "2 Areas/Projects/ARC ERP",
      ignorePatterns: ".keep",
    });
    vault.seed("2 Areas/Projects/ARC ERP/empty-sub/.keep", "");

    // Act
    await engine.sync(false);

    // Assert: the empty subfolder is created in Drive at its sync-relative path;
    // the target's own root is NOT.
    const folderPaths = drive.calls.createFolderPath.map((c) => c.path);
    expect(folderPaths).toContain("empty-sub");
    expect(folderPaths).not.toContain("2 Areas/Projects/ARC ERP");
    // The ignored placeholder must not upload.
    expect(drive.calls.createFile).toEqual([]);
  });
});
