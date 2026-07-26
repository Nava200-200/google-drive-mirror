import { PluginStorage } from "./storage";
import { log } from "./logger";

/** State file name for config sync (this plugin's own `data.json`). */
export const CONFIG_STATE_FILE = "config-sync-state.json";

/**
 * Is `fileName` the config-sync state file? Used by `cleanupOrphanStateFiles`
 * so this file is not swept as an orphan. Deliberately distinct from
 * `isStateFile()` (prefix `sync-state-`) so the two never collide.
 */
export function isConfigStateFile(fileName: string): boolean {
  return fileName === CONFIG_STATE_FILE;
}

/**
 * The base of the config-sync 3-way comparison for ONE synced file. Config sync
 * mirrors a set of `.obsidian`-relative files (our own `data.json` plus, when
 * enabled, other plugins' `data.json`), so the store holds ONE base per file
 * keyed by its relative path. Records the last-synced hash on each side so the
 * next run can tell "changed locally" from "changed remotely" from "unchanged".
 */
export interface ConfigBase {
  /** The file's `.obsidian`-relative path (the map key). */
  path: string;
  /**
   * MD5 of the last-synced PLAINTEXT content (pre-encryption). Used to detect a
   * LOCAL change. Content-derived and stable across devices, unlike Drive's md5
   * (which changes every upload due to a random IV, since we whole-file encrypt).
   */
  hash: string;
  /** Drive file id of the uploaded (encrypted) file. */
  driveId: string;
  /**
   * Drive's own `md5Checksum` of the uploaded (encrypted) blob at last sync.
   * Used to detect a REMOTE change: compare against Drive's current md5. Cannot
   * be compared to `hash` (different bytes), only to itself across runs.
   */
  remoteRawMd5: string;
  /** Local file mtime (ms) at last sync — for conflict "newer wins". */
  localMtime: number;
  /** Drive modifiedTime (ms) at last sync — for conflict "newer wins". */
  remoteMtime: number;
}

/** Serialization format of the config-sync state file. */
interface ConfigStateFile {
  version: 2;
  /**
   * Identity of the vault + config Drive folder this base applies to. If it
   * doesn't match on load (file copied from another vault, or the folder was
   * changed), the base is discarded — a fresh base can only cause a
   * download/upload, never a deletion (config sync never deletes anyway).
   */
  scopeId?: string;
  /** Per-file base, keyed by `.obsidian`-relative path. */
  entries: Record<string, ConfigBase>;
}

/**
 * Persistent base for config sync (one base per mirrored file). Mirrors
 * `SyncStateStore`, in its own file (`config-sync-state.json`). Never drives a
 * deletion.
 */
export class ConfigSyncStateStore {
  private entries: Record<string, ConfigBase> = {};

  /**
   * @param storage Persistence helper (plugin folder).
   * @param scopeId Returns the current scope identity (vault + config Drive
   *                folder). A function because it can change at runtime.
   * @param fileName State file name. Defaults to `config-sync-state.json`.
   */
  constructor(
    private storage: PluginStorage,
    private scopeId: () => string,
    private fileName: string = CONFIG_STATE_FILE
  ) {}

  /**
   * Loads the base map. Discards it if the persisted `scopeId` doesn't match the
   * current one (copied from another vault / folder changed). Tolerates the old
   * v1 single-base format by dropping it (a fresh reconcile only downloads/
   * uploads, never deletes — safe).
   */
  async load(): Promise<void> {
    const data = await this.storage.readJson<
      (ConfigStateFile & { base?: ConfigBase | null }) | null
    >(this.fileName, null);
    if (!data) {
      this.entries = {};
      return;
    }
    const current = this.scopeId();
    if (data.scopeId && data.scopeId !== current) {
      log.warn(
        "Config-sync state from a different vault/folder " +
          `(${data.scopeId} ≠ ${current}) -> discarded. ` +
          "Next config sync reconciles fresh (no deletion)."
      );
      this.entries = {};
      await this.save();
      return;
    }
    // v2 map, or drop a legacy v1 single-base (re-reconciles fresh, no delete).
    this.entries = data.entries ?? {};
  }

  /** Persists the current base map to the file. */
  async save(): Promise<void> {
    const file: ConfigStateFile = {
      version: 2,
      scopeId: this.scopeId(),
      entries: this.entries,
    };
    await this.storage.writeJson(this.fileName, file);
  }

  /** Deletes the underlying state file. */
  async destroy(): Promise<void> {
    await this.storage.remove(this.fileName);
  }

  get(path: string): ConfigBase | null {
    return this.entries[path] ?? null;
  }

  set(base: ConfigBase): void {
    this.entries[base.path] = base;
  }

  delete(path: string): void {
    delete this.entries[path];
  }

  all(): ConfigBase[] {
    return Object.values(this.entries);
  }

  clear(): void {
    this.entries = {};
  }
}
