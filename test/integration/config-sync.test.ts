import { describe, it, expect, beforeEach } from "vitest";
import { Vault } from "obsidian";
import { ConfigSyncEngine, ConflictChoice } from "../../src/config-sync";
import { ConfigSyncStateStore } from "../../src/config-sync-state";
import { OAuthManager } from "../../src/oauth";
import { GoogleDriveClient } from "../../src/drive-client";
import { FakeVault } from "../helpers/fake-vault";
import { FakeDriveClient } from "../helpers/fake-drive";
import { FakeStorage } from "../helpers/fake-storage";
import { isEncSentinel } from "../../src/crypto-box";
import { SyncStatus } from "../../src/sync-status";
import { PluginSettings, DEFAULT_SETTINGS } from "../../src/types";

const PLUGIN_ID = "google-drive-mirror";
const DATA_PATH = `.obsidian/plugins/${PLUGIN_ID}/data.json`;
const CONFIG_FOLDER = "config-folder-id";
const PASS = "shared-passphrase-123";

/** A configured OAuth (isConfigured() true) without real network. */
function fakeOAuth(): OAuthManager {
  return {
    isConfigured: () => true,
  } as unknown as OAuthManager;
}

/** Builds a settings object as it would live in data.json. */
function settings(over: Partial<PluginSettings> = {}): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    clientId: "client-abc",
    clientSecret: "secret-xyz",
    refreshToken: "1//refresh-token-secret",
    configSyncEnabled: true,
    configDriveFolderId: CONFIG_FOLDER,
    targets: [],
    ...over,
  };
}

/** Writes a settings object to a device's data.json. */
function seedData(vault: FakeVault, s: PluginSettings, mtime = 1_000): void {
  vault.seed(DATA_PATH, JSON.stringify(s), mtime);
}

/**
 * Builds a device: a FakeVault holding data.json + a ConfigSyncEngine over the
 * SHARED drive. `getSettings` reads a mutable settings object; `onDownloaded`
 * re-reads data.json into it (mirrors main.ts loadSettings()).
 */
function device(
  drive: FakeDriveClient,
  initial: PluginSettings
): {
  vault: FakeVault;
  engine: ConfigSyncEngine;
  settings: PluginSettings;
  state: ConfigSyncStateStore;
  sync: (
    resolve?: (l: number, r: number) => Promise<ConflictChoice | undefined>
  ) => ReturnType<ConfigSyncEngine["sync"]>;
} {
  const vault = new FakeVault();
  seedData(vault, initial);
  // Mutable settings holder the engine reads through.
  const holder = { current: initial };
  const storage = new FakeStorage();
  const state = new ConfigSyncStateStore(
    storage.asStorage(),
    () => `vaultA::config::${CONFIG_FOLDER}`
  );
  const engine = new ConfigSyncEngine(
    vault as unknown as Vault,
    drive.asClient(),
    fakeOAuth(),
    state,
    new SyncStatus(undefined, () => 24, "config-sync-log.json"),
    PLUGIN_ID,
    () => holder.current,
    async () => {
      // Mirror main.onConfigDownloaded(): re-read data.json into the holder.
      holder.current = JSON.parse(
        await vault.adapter.read(DATA_PATH)
      ) as PluginSettings;
    }
  );
  const noConflict = async () => undefined;
  return {
    vault,
    engine,
    get settings() {
      return holder.current;
    },
    state,
    sync: (resolve = noConflict) => engine.sync(PASS, resolve),
  };
}

describe("config sync (integration)", () => {
  let drive: FakeDriveClient;
  beforeEach(() => {
    drive = new FakeDriveClient();
  });

  it("uploads with credentials ENCRYPTED and device-local fields stripped", async () => {
    const a = device(
      drive,
      settings({ configPassphraseObf: "obfuscated-blob-should-not-upload" })
    );
    await a.state.load();
    const outcome = await a.sync();
    expect(outcome.kind).toBe("uploaded");

    // Inspect what landed in Drive: the file is stored at the MIRRORED
    // .obsidian-relative path, not flat at the root.
    const { files } = await drive.listFiles(CONFIG_FOLDER);
    const configFile = files.find(
      (f) =>
        f.relativePath ===
        `.obsidian/plugins/${PLUGIN_ID}/data.json`
    );
    expect(configFile).toBeTruthy();
    // The verifier blob lives under .obsidian/ too.
    expect(
      files.find((f) => f.relativePath === ".obsidian/config-sync-verifier.json")
    ).toBeTruthy();
    const buf = await drive.downloadFile(configFile!.id);
    const uploaded = JSON.parse(new TextDecoder().decode(buf));
    const raw = new TextDecoder().decode(buf);

    // The ENTIRE file is one opaque encrypted blob (whole-file encryption).
    expect(isEncSentinel(uploaded)).toBe(true);
    // No plaintext leaks — neither credentials nor ordinary settings/keys.
    expect(raw).not.toContain("1//refresh-token-secret");
    expect(raw).not.toContain("secret-xyz");
    expect(raw).not.toContain("client-abc");
    expect(raw).not.toContain("refreshToken");
    // Device-local fields never leave the device (also not in plaintext).
    expect(raw).not.toContain("obfuscated-blob-should-not-upload");
    expect(raw).not.toContain("configDriveFolderId");
  });

  it("round-trips to a second device: credentials decrypt, targets appear", async () => {
    // Device A uploads a config with a target.
    const a = device(
      drive,
      settings({
        targets: [
          {
            id: "t1",
            name: "Notes",
            driveFolderId: "notes-folder",
            driveFolderName: "Notes",
            driveSharedId: "",
            localFolder: "Notes",
            allowedExtensions: "",
            ignorePatterns: "",
            excludeFolders: [],
            neverDeleteRemote: false,
            syncGoogleDocs: false,
          },
        ] as PluginSettings["targets"],
      })
    );
    await a.state.load();
    await a.sync();

    // Device B has its OWN folder pointer and no targets; pulls the config.
    const b = device(
      drive,
      settings({
        configDriveFolderName: "B's local name",
        targets: [],
      })
    );
    await b.state.load();
    // First pull with both sides present and no base -> conflict (ambiguous);
    // the user keeps Drive's version to adopt A's config.
    const outcome = await b.sync(async () => "keepRemote");
    expect(outcome.kind).toBe("downloaded");

    // B's data.json now has the decrypted credentials and A's target.
    const bData = JSON.parse(b.vault.read(DATA_PATH)) as PluginSettings;
    expect(bData.refreshToken).toBe("1//refresh-token-secret");
    expect(bData.clientSecret).toBe("secret-xyz");
    expect(bData.targets).toHaveLength(1);
    expect(bData.targets[0].name).toBe("Notes");
    // B's OWN device-local folder pointer is preserved (not overwritten by A's).
    expect(bData.configDriveFolderId).toBe(CONFIG_FOLDER);
  });

  it("aborts with nothing written when the passphrase is wrong", async () => {
    const a = device(drive, settings());
    await a.state.load();
    await a.sync();

    // Device B uses a DIFFERENT passphrase.
    const b = device(drive, settings({ targets: [] }));
    await b.state.load();
    const before = b.vault.read(DATA_PATH);
    const outcome = await b.engine.sync("wrong-passphrase", async () => undefined);
    // Verifier check catches it up front -> skipped, nothing written.
    expect(outcome.kind).toBe("skipped");
    expect(b.vault.read(DATA_PATH)).toBe(before);
  });

  it("is a noop when nothing changed since the last sync", async () => {
    const a = device(drive, settings());
    await a.state.load();
    expect((await a.sync()).kind).toBe("uploaded");
    // Second run with an unchanged local + unchanged remote.
    expect((await a.sync()).kind).toBe("noop");
  });

  it("surfaces a conflict when both sides changed since base, honoring the choice", async () => {
    // A uploads; A and B both establish a base.
    const a = device(drive, settings());
    await a.state.load();
    await a.sync();

    const b = device(drive, settings({ targets: [] }));
    await b.state.load();
    await b.sync(); // downloads -> base established on B

    // Now BOTH change: A adds a target and uploads.
    seedData(
      a.vault,
      settings({
        targets: [
          {
            id: "t2",
            name: "FromA",
            driveFolderId: "fa",
            driveFolderName: "FromA",
            driveSharedId: "",
            localFolder: "A",
            allowedExtensions: "",
            ignorePatterns: "",
            excludeFolders: [],
            neverDeleteRemote: false,
            syncGoogleDocs: false,
          },
        ] as PluginSettings["targets"],
      }),
      5_000
    );
    await a.sync();

    // B ALSO changes locally since its base.
    seedData(
      b.vault,
      settings({
        configDriveFolderName: "B local",
        logRetentionHours: 99,
      }),
      6_000
    );

    // B syncs: both changed -> conflict. Choose keepRemote -> A's version wins.
    let asked = false;
    const outcome = await b.sync(async () => {
      asked = true;
      return "keepRemote";
    });
    expect(asked).toBe(true);
    expect(outcome.kind).toBe("downloaded");
    const bData = JSON.parse(b.vault.read(DATA_PATH)) as PluginSettings;
    expect(bData.targets).toHaveLength(1);
    expect(bData.targets[0].name).toBe("FromA");
  });

  it("cancelling a conflict writes nothing", async () => {
    const a = device(drive, settings());
    await a.state.load();
    await a.sync();
    const b = device(drive, settings({ targets: [] }));
    await b.state.load();
    await b.sync();

    seedData(a.vault, settings({ logRetentionHours: 1 }), 5_000);
    await a.sync();
    seedData(b.vault, settings({ logRetentionHours: 2 }), 6_000);

    const before = b.vault.read(DATA_PATH);
    const outcome = await b.sync(async () => undefined); // cancel
    expect(outcome.kind).toBe("conflict");
    expect(b.vault.read(DATA_PATH)).toBe(before);
  });

  describe("other plugins' settings", () => {
    const OTHER_ID = "dataview";
    const OTHER_PATH = `.obsidian/plugins/${OTHER_ID}/data.json`;

    it("uploads other plugins' data.json ENCRYPTED when enabled", async () => {
      const a = device(drive, settings({ configSyncOtherPlugins: true }));
      // Seed a second plugin's data.json with a secret-looking value.
      a.vault.seed(OTHER_PATH, JSON.stringify({ apiKey: "sk-super-secret" }));
      await a.state.load();

      const outcome = await a.sync();
      // Our own file + the other plugin's file both uploaded.
      expect(["uploaded", "changed"]).toContain(outcome.kind);

      const { files } = await drive.listFiles(CONFIG_FOLDER);
      const other = files.find((f) => f.relativePath === OTHER_PATH);
      expect(other).toBeTruthy();
      const raw = new TextDecoder().decode(await drive.downloadFile(other!.id));
      // Whole-file encrypted: the secret never appears in the clear.
      expect(isEncSentinel(JSON.parse(raw))).toBe(true);
      expect(raw).not.toContain("sk-super-secret");
      expect(raw).not.toContain("apiKey");
    });

    it("downloads another plugin's settings onto a second device", async () => {
      const a = device(drive, settings({ configSyncOtherPlugins: true }));
      a.vault.seed(OTHER_PATH, JSON.stringify({ theme: "dark", n: 5 }));
      await a.state.load();
      await a.sync();

      // Device B has the plugin installed (data.json present) but different data.
      const b = device(
        drive,
        settings({ configSyncOtherPlugins: true, targets: [] })
      );
      b.vault.seed(OTHER_PATH, JSON.stringify({ theme: "light", n: 1 }));
      await b.state.load();
      // Own file: first pull is a conflict (keepRemote); other plugin: remote is
      // new to B's base too -> also resolved by the same handler.
      const outcome = await b.sync(async () => "keepRemote");
      expect(["downloaded", "changed"]).toContain(outcome.kind);

      // B's copy of the other plugin now matches A's.
      const applied = JSON.parse(b.vault.read(OTHER_PATH));
      expect(applied).toEqual({ theme: "dark", n: 5 });
    });

    it("does NOT touch other plugins when the toggle is off", async () => {
      const a = device(drive, settings({ configSyncOtherPlugins: false }));
      a.vault.seed(OTHER_PATH, JSON.stringify({ apiKey: "secret" }));
      await a.state.load();
      await a.sync();

      const { files } = await drive.listFiles(CONFIG_FOLDER);
      expect(files.find((f) => f.relativePath === OTHER_PATH)).toBeUndefined();
    });
  });
});
