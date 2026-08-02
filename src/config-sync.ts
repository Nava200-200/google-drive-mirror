import { Vault } from "obsidian";
import { GoogleDriveClient } from "./drive-client";
import { OAuthManager } from "./oauth";
import { SyncStatus } from "./sync-status";
import { ConfigSyncStateStore, ConfigBase } from "./config-sync-state";
import {
  reconcileConfig,
  ConfigAction,
  ConfigLocalState,
  ConfigRemoteState,
} from "./config-reconcile";
import {
  encryptSentinel,
  decryptSentinel,
  isEncSentinel,
  makeVerifier,
  checkVerifier,
  EncBox,
  EncSentinel,
} from "./crypto-box";
import { md5Hex } from "./md5";
import { PluginSettings, CONFIG_SYNC_DEVICE_LOCAL_KEYS } from "./types";
import {
  deleteAtPath,
  getAtPath,
  setAtPath,
} from "./config-paths";
import { log } from "./logger";
import { t } from "./i18n";

/** Name of a plugin's settings file inside its plugin folder. */
const DATA_FILE = "data.json";

/**
 * The Drive config root MIRRORS the vault's config folder: everything lives
 * under an `.obsidian/` subtree at its vault-relative path. So the root can
 * later also hold other config trees (`.trash/`, appearance, …) without a
 * layout migration.
 */
const CONFIG_DIR = ".obsidian";
/** Relative path of the passphrase verifier blob (inside `.obsidian/`). */
const VERIFIER_PATH = `${CONFIG_DIR}/config-sync-verifier.json`;

/**
 * `.obsidian`-relative path of a plugin's settings file — the SAME shape it has
 * under the local vault config folder, so Drive paths line up with vault paths.
 */
function pluginDataRelPath(pluginId: string): string {
  return `${CONFIG_DIR}/plugins/${pluginId}/${DATA_FILE}`;
}

/**
 * Inverse of `pluginDataRelPath`: extracts the plugin id from an
 * `.obsidian/plugins/<id>/data.json` relative path, or null if it doesn't match.
 */
function pluginIdFromRelPath(rel: string): string | null {
  const m = rel.match(
    new RegExp(`^${CONFIG_DIR}/plugins/([^/]+)/${DATA_FILE}$`)
  );
  return m ? m[1] : null;
}

/** What a config-sync run resolved to (for the caller / UI). */
export type ConfigSyncOutcome =
  | { kind: "noop" }
  | { kind: "uploaded" }
  | { kind: "downloaded" }
  // mixed multi-file (any of upload/download/delete happened)
  | {
      kind: "changed";
      uploaded: number;
      downloaded: number;
      deleted: number;
    }
  | { kind: "conflict"; localMtime: number; remoteMtime: number }
  // `mismatch` marks the specific "stored passphrase no longer matches the
  // folder's encrypted data" case, which the caller notifies about even during
  // an unattended run (so a stale stored passphrase doesn't fail silently).
  | { kind: "skipped"; reason: string; mismatch?: boolean };

/** How a detected conflict should be resolved (from the modal). */
export type ConflictChoice = "keepLocal" | "keepRemote";

/**
 * Thrown when a downloaded config blob cannot be decrypted with the entered
 * passphrase (wrong / incompatible key). The caller surfaces a specific message
 * and writes nothing.
 */
export class DecryptError extends Error {
  constructor(cause?: unknown) {
    super(`config-sync decrypt failed: ${cause}`);
    this.name = "DecryptError";
  }
}

/** One local config file to process. */
interface LocalConfigFile {
  /** `.obsidian`-relative path (the Drive path + state key). */
  relPath: string;
  /** Full vault-adapter path on this device. */
  adapterPath: string;
  /** True for THIS plugin's own data.json (device-local key handling + apply). */
  isOwn: boolean;
}

/** Remote side of one config file. */
interface RemoteConfigFile {
  driveId: string;
  rawMd5: string;
  mtime: number;
}

/**
 * Turns arbitrary JSON into deterministic bytes: keys sorted recursively, then
 * UTF-8 encoded. Two devices with the same logical config then hash identically
 * regardless of key insertion order.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** UTF-8 encode a string to an ArrayBuffer (for md5Hex / upload). */
function utf8(s: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(s);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

/**
 * Config sync for this plugin's own `data.json` and — when enabled — every OTHER
 * installed plugin's `data.json`.
 *
 * Separate subsystem from note sync (`SyncEngine`): shares only the OAuth
 * account and Drive transport. The only deletion it performs is trashing the
 * Drive copy of a plugin the user explicitly DESELECTED. Every file is
 * WHOLE-FILE encrypted under the per-device passphrase (which is never
 * uploaded), so the Drive copy is fully opaque — safe even for third-party
 * plugins that store secrets in their data.json.
 */
export class ConfigSyncEngine {
  /**
   * @param onDownloaded Called after THIS plugin's own data.json is written on
   *   this device (the caller re-runs loadSettings/rebuild — see main.ts). Not
   *   called for other plugins (they need an Obsidian reload to pick up changes).
   * @param onSettingsChanged Called when the engine mutated the live settings
   *   object (clearing resolved plugin include/remove intent) and it must be
   *   persisted. The caller runs `saveSettings()`.
   */
  constructor(
    private vault: Vault,
    private drive: GoogleDriveClient,
    private oauth: OAuthManager,
    private state: ConfigSyncStateStore,
    private status: SyncStatus,
    private pluginId: string,
    private getSettings: () => PluginSettings,
    private onDownloaded: () => Promise<void>,
    private onSettingsChanged: () => Promise<void>
  ) {}

  private folderId(): string {
    return this.getSettings().configDriveFolderId;
  }

  private sharedId(): string | undefined {
    return this.getSettings().configDriveSharedId || undefined;
  }

  private pluginsDir(): string {
    return `${this.vault.configDir}/plugins`;
  }

  /**
   * Reads and parses THIS plugin's own `data.json` (for the settings UI's
   * "properties to sync" tree). Returns `{}` if missing/unreadable.
   */
  async readOwnData(): Promise<Record<string, unknown>> {
    try {
      const p = this.ownAdapterPath();
      if (!(await this.vault.adapter.exists(p))) return {};
      return JSON.parse(await this.vault.adapter.read(p)) as Record<
        string,
        unknown
      >;
    } catch {
      return {};
    }
  }

  private ownAdapterPath(): string {
    return `${this.pluginsDir()}/${this.pluginId}/${DATA_FILE}`;
  }

  // ---------- Local collection ----------

  /**
   * Builds the list of local config files to sync: always this plugin's own
   * data.json, plus (when `configSyncOtherPlugins`) every other plugin's
   * data.json present on this device.
   */
  private async collectLocalFiles(
    remotePluginIds: ReadonlySet<string>
  ): Promise<LocalConfigFile[]> {
    const files: LocalConfigFile[] = [
      {
        relPath: pluginDataRelPath(this.pluginId),
        adapterPath: this.ownAdapterPath(),
        isOwn: true,
      },
    ];

    if (!this.getSettings().configSyncOtherPlugins) return files;

    // Effective selection = (already in Drive) ∪ (explicitly ticked here),
    // minus (explicitly unticked here, pending removal). "In Drive" makes a
    // plugin synced from ANOTHER device sync from this one too, without needing
    // the local include list — the fix for the missing device-2 checkboxes.
    const included = new Set(this.getSettings().configSyncPluginIds);
    for (const id of remotePluginIds) included.add(id);
    const removing = new Set(this.getSettings().configSyncPluginRemoveIds);

    // Enumerate plugin folders and include each selected + installed data.json.
    try {
      const dir = this.pluginsDir();
      if (!(await this.vault.adapter.exists(dir))) return files;
      const listing = await this.vault.adapter.list(dir);
      for (const folderPath of listing.folders) {
        const id = folderPath.split("/").pop();
        if (!id || id === this.pluginId) continue;
        if (!included.has(id) || removing.has(id)) continue; // not selected
        const adapterPath = `${dir}/${id}/${DATA_FILE}`;
        if (await this.vault.adapter.exists(adapterPath)) {
          files.push({
            relPath: pluginDataRelPath(id),
            adapterPath,
            isOwn: false,
          });
        }
      }
    } catch (e) {
      log.warn("Config sync: cannot enumerate plugin folders:", e);
    }
    return files;
  }

  /**
   * Lists installed OTHER plugins with a display name (from their manifest.json,
   * falling back to the folder id). Public API only — no `app.plugins`. Used by
   * the settings UI to render the per-plugin checkboxes.
   */
  async listInstalledPlugins(): Promise<{ id: string; name: string }[]> {
    const out: { id: string; name: string }[] = [];
    try {
      const dir = this.pluginsDir();
      if (!(await this.vault.adapter.exists(dir))) return out;
      const listing = await this.vault.adapter.list(dir);
      for (const folderPath of listing.folders) {
        const id = folderPath.split("/").pop();
        if (!id || id === this.pluginId) continue;
        let name = id;
        try {
          const manifestPath = `${dir}/${id}/manifest.json`;
          if (await this.vault.adapter.exists(manifestPath)) {
            const m = JSON.parse(
              await this.vault.adapter.read(manifestPath)
            ) as { name?: string };
            if (m.name) name = m.name;
          }
        } catch {
          // Unreadable manifest → fall back to the folder id.
        }
        out.push({ id, name });
      }
    } catch (e) {
      log.warn("Config sync: cannot list installed plugins:", e);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  /**
   * Which OTHER plugin ids currently have a settings file in the Drive config
   * folder (i.e. are synced). This is the SHARED source of truth for the
   * per-plugin selection: a plugin synced from another device shows up here, so
   * the settings UI can reflect it even though the local allowlist is empty.
   * Returns an empty set if not signed in / no folder / listing fails.
   */
  async listSyncedPluginIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    if (!this.oauth.isConfigured() || !this.folderId()) return ids;
    try {
      const { files } = await this.fetchRemote();
      for (const rel of files.keys()) {
        const id = pluginIdFromRelPath(rel);
        if (id && id !== this.pluginId) ids.add(id);
      }
    } catch (e) {
      log.warn("Config sync: cannot list synced plugin ids:", e);
    }
    return ids;
  }

  /**
   * Reads a local file and produces its PLAINTEXT normalized payload + hash +
   * mtime. For our own file, device-local keys are stripped first. Returns null
   * if the file is missing/unreadable/not-JSON.
   */
  private async readLocal(
    file: LocalConfigFile
  ): Promise<{ plaintext: string; hash: string; mtime: number } | null> {
    let raw: string;
    let mtime = 0;
    try {
      if (!(await this.vault.adapter.exists(file.adapterPath))) return null;
      raw = await this.vault.adapter.read(file.adapterPath);
      const stat = await this.vault.adapter.stat(file.adapterPath);
      mtime = stat?.mtime ?? 0;
    } catch (e) {
      log.error(`Config sync: cannot read ${file.relPath}:`, e);
      return null;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (e) {
      log.error(`Config sync: ${file.relPath} is not valid JSON:`, e);
      return null;
    }

    // Only OUR file has fields to strip; other plugins' files sync whole (we
    // can't know their device-specific fields).
    if (file.isOwn) {
      // 1) Device-local top-level keys (always stripped).
      for (const key of CONFIG_SYNC_DEVICE_LOCAL_KEYS) delete parsed[key];
      // 2) User-chosen ignore paths (may be nested, e.g. targets[].excludeFolders).
      for (const path of this.getSettings().configIgnorePaths) {
        deleteAtPath(parsed, path);
      }
    }

    const plaintext = stableStringify(parsed);
    // Hash the PLAINTEXT (pre-encryption): the encrypted blob changes every
    // upload (random IV), so hashing it would never reach a noop.
    return { plaintext, hash: md5Hex(utf8(plaintext)), mtime };
  }

  /** Encrypts a plaintext payload into a whole-file `{__enc}` blob for upload. */
  private async encryptPayload(
    plaintext: string,
    passphrase: string
  ): Promise<ArrayBuffer> {
    const box = await encryptSentinel(plaintext, passphrase);
    return utf8(JSON.stringify(box));
  }

  /**
   * Applies a downloaded (encrypted) blob to a local file: decrypts it, and for
   * our own file preserves this device's device-local keys. Throws DecryptError
   * on a wrong passphrase (nothing written).
   */
  private async applyDownloaded(
    file: LocalConfigFile,
    encryptedBuf: ArrayBuffer,
    passphrase: string
  ): Promise<void> {
    let sentinel: unknown;
    try {
      sentinel = JSON.parse(new TextDecoder().decode(encryptedBuf));
    } catch (e) {
      throw new Error(`Config sync: downloaded blob is not valid JSON: ${e}`);
    }
    if (!isEncSentinel(sentinel)) {
      throw new Error("Config sync: downloaded blob is not an encrypted config.");
    }

    let plaintext: string;
    try {
      plaintext = await decryptSentinel(sentinel as EncSentinel, passphrase);
    } catch (e) {
      throw new DecryptError(e);
    }

    let incoming: Record<string, unknown>;
    try {
      incoming = JSON.parse(plaintext) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`Config sync: decrypted config is not valid JSON: ${e}`);
    }

    if (file.isOwn) {
      // Preserve this device's local values from the CURRENT file.
      let current: Record<string, unknown> = {};
      try {
        if (await this.vault.adapter.exists(file.adapterPath)) {
          current = JSON.parse(
            await this.vault.adapter.read(file.adapterPath)
          ) as Record<string, unknown>;
        }
      } catch {
        // Missing/corrupt local file → nothing to preserve.
      }
      // 1) Device-local top-level keys (folder pointer, passphrase, …).
      for (const key of CONFIG_SYNC_DEVICE_LOCAL_KEYS) {
        if (key in current) incoming[key] = current[key];
      }
      // 2) Ignored paths: the incoming payload never carried them (stripped on
      //    upload), so overlay this device's local values so a download doesn't
      //    blank them out (e.g. targets[].excludeFolders).
      for (const path of this.getSettings().configIgnorePaths) {
        const localVal = getAtPath(current, path);
        if (localVal !== undefined) setAtPath(incoming, path, localVal);
      }
    }

    await this.vault.adapter.write(
      file.adapterPath,
      JSON.stringify(incoming)
    );
  }

  // ---------- Remote listing ----------

  /**
   * Lists the config folder ONCE and returns a map of `.obsidian`-relative path
   * → remote file, plus the verifier blob. Excludes the verifier from the map.
   */
  private async fetchRemote(): Promise<{
    files: Map<string, RemoteConfigFile>;
    verifier: EncBox | null;
  }> {
    const { files } = await this.drive.listFiles(
      this.folderId(),
      this.sharedId()
    );
    const map = new Map<string, RemoteConfigFile>();
    let verifierId: string | null = null;
    for (const f of files) {
      const rel = this.drive.pathOf(f);
      if (rel === VERIFIER_PATH) {
        verifierId = f.id;
        continue;
      }
      map.set(rel, {
        driveId: f.id,
        rawMd5: f.md5Checksum ?? "",
        mtime: f.modifiedTimeMs,
      });
    }

    let verifier: EncBox | null = null;
    if (verifierId) {
      try {
        const buf = await this.drive.downloadFile(verifierId);
        verifier = JSON.parse(new TextDecoder().decode(buf)) as EncBox;
      } catch (e) {
        log.warn("Config sync: cannot read verifier blob:", e);
      }
    }
    return { files: map, verifier };
  }

  // ---------- Run ----------

  /**
   * Runs one config-sync pass over all in-scope files. `resolveConflict` is
   * called per conflicting file; returning undefined skips THAT file (leaves its
   * base untouched so it re-conflicts next run).
   */
  async sync(
    passphrase: string,
    resolveConflict: (
      localMtime: number,
      remoteMtime: number
    ) => Promise<ConflictChoice | undefined>
  ): Promise<ConfigSyncOutcome> {
    this.status.start(t("configSyncRunning"), Date.now());
    try {
      const outcome = await this.syncInner(passphrase, resolveConflict);
      this.finishForOutcome(outcome);
      return outcome;
    } catch (e) {
      this.status.finish("error", t("configSyncFailed", { error: String(e) }));
      throw e;
    }
  }

  private finishForOutcome(outcome: ConfigSyncOutcome): void {
    switch (outcome.kind) {
      case "uploaded":
        this.status.finish("done", t("configSyncUploaded"));
        break;
      case "downloaded":
        this.status.finish("done", t("configSyncDownloaded"));
        break;
      case "changed":
        this.status.finish(
          "done",
          t("configSyncChanged", {
            up: outcome.uploaded,
            down: outcome.downloaded,
            del: outcome.deleted,
          })
        );
        break;
      case "noop":
      case "conflict":
        this.status.finish("done", t("configSyncNoop"));
        break;
      case "skipped":
        this.status.finish(
          "done",
          t("configSyncSkipped", { reason: outcome.reason })
        );
        break;
    }
  }

  private async syncInner(
    passphrase: string,
    resolveConflict: (
      localMtime: number,
      remoteMtime: number
    ) => Promise<ConflictChoice | undefined>
  ): Promise<ConfigSyncOutcome> {
    if (!this.oauth.isConfigured()) {
      return { kind: "skipped", reason: t("configSyncNotSignedIn") };
    }
    if (!this.folderId()) {
      return { kind: "skipped", reason: t("configSyncNoFolder") };
    }
    if (!passphrase) {
      return { kind: "skipped", reason: t("configSyncNoPassphrase") };
    }

    const { files: remoteMap, verifier } = await this.fetchRemote();

    // Verify the passphrase up front against the stored verifier, so a wrong
    // passphrase fails before we write anything.
    if (verifier && !(await checkVerifier(verifier, passphrase))) {
      return {
        kind: "skipped",
        reason: t("configSyncWrongPassphrase"),
        mismatch: true,
      };
    }

    // Plugin ids currently synced in Drive — the shared selection truth.
    const remotePluginIds = new Set<string>();
    for (const rel of remoteMap.keys()) {
      const id = pluginIdFromRelPath(rel);
      if (id && id !== this.pluginId) remotePluginIds.add(id);
    }

    const localFiles = await this.collectLocalFiles(remotePluginIds);

    // The union of paths present locally and/or remotely. (Remote-only files —
    // e.g. a plugin installed on the other device — are downloaded, never
    // deleted.) The verifier is already excluded from remoteMap.
    const relPaths = new Set<string>();
    const localByPath = new Map<string, LocalConfigFile>();
    for (const f of localFiles) {
      relPaths.add(f.relPath);
      localByPath.set(f.relPath, f);
    }
    for (const rel of remoteMap.keys()) relPaths.add(rel);

    let uploaded = 0;
    let downloaded = 0;
    let deleted = 0;
    let ownDownloaded = false;

    // --- Deselection handling (the ONE place config sync deletes) ------------
    // Deletion is driven ONLY by an EXPLICIT untick (`configSyncPluginRemoveIds`)
    // — never merely by "absent from the local selection", because another
    // device may legitimately want a plugin this device doesn't. For each
    // explicitly-removed plugin: trash its Drive copy (only if WE synced it, i.e.
    // it has a base entry), drop its base, and remove it from the run so it isn't
    // re-downloaded. A file we never synced (no base) is never trashed.
    const removeIds = new Set(this.getSettings().configSyncPluginRemoveIds);
    const clearedRemoveIds = new Set<string>();
    for (const id of removeIds) {
      const rel = pluginDataRelPath(id);
      const base = this.state.get(rel);
      const remote = remoteMap.get(rel);
      if (base && remote) {
        try {
          await this.drive.trashFile(remote.driveId);
          deleted++;
        } catch (e) {
          log.warn(`Config sync: could not trash deselected ${rel}:`, e);
        }
      }
      if (base) this.state.delete(rel);
      relPaths.delete(rel);
      // The removal has been applied (or there was nothing to remove) → clear
      // the pending-remove intent so it doesn't linger.
      clearedRemoveIds.add(id);
    }
    // Track a cancelled conflict + its mtimes, so a run where the ONLY thing
    // that happened was a cancelled conflict reports "conflict" (the caller
    // shows no notice) rather than a misleading "noop".
    let cancelledConflict: { localMtime: number; remoteMtime: number } | null =
      null;

    // Ensure a verifier exists before the first upload (first push writes it).
    let verifierWritten = Boolean(verifier);

    for (const relPath of relPaths) {
      const localFile =
        localByPath.get(relPath) ?? this.remoteOnlyLocalFile(relPath);
      const remote = remoteMap.get(relPath);

      const localRead = localByPath.has(relPath)
        ? await this.readLocal(localFile)
        : null;

      const local: ConfigLocalState = localRead
        ? { exists: true, hash: localRead.hash, mtime: localRead.mtime }
        : { exists: false, hash: "", mtime: 0 };
      const remoteState: ConfigRemoteState = remote
        ? {
            exists: true,
            driveId: remote.driveId,
            rawMd5: remote.rawMd5,
            mtime: remote.mtime,
          }
        : { exists: false, driveId: "", rawMd5: "", mtime: 0 };

      const base = this.state.get(relPath);
      let action: ConfigAction = reconcileConfig(local, remoteState, base);

      if (action.type === "conflict") {
        const choice = await resolveConflict(local.mtime, remoteState.mtime);
        if (!choice) {
          // Skip this file; base untouched so it re-conflicts next run.
          cancelledConflict = {
            localMtime: local.mtime,
            remoteMtime: remoteState.mtime,
          };
          continue;
        }
        action = { type: choice === "keepLocal" ? "upload" : "download" };
      }

      if (action.type === "noop") continue;

      if (action.type === "upload") {
        if (!localRead) continue; // nothing to upload
        if (!verifierWritten) {
          await this.writeVerifier(passphrase);
          verifierWritten = true;
        }
        const buf = await this.encryptPayload(localRead.plaintext, passphrase);
        const up = remoteState.exists
          ? await this.drive.updateFile(remoteState.driveId, relPath, buf)
          : await this.drive.createFile(
              this.folderId(),
              relPath,
              buf,
              this.sharedId()
            );
        this.state.set({
          path: relPath,
          hash: localRead.hash,
          driveId: up.id,
          remoteRawMd5: up.md5Checksum ?? "",
          localMtime: localRead.mtime,
          remoteMtime: up.modifiedTimeMs,
        });
        uploaded++;
      } else if (action.type === "download") {
        const buf = await this.drive.downloadFile(remoteState.driveId);
        // Throws DecryptError on a wrong passphrase → nothing written.
        await this.applyDownloaded(localFile, buf, passphrase);
        // Recompute the plaintext hash of the just-applied file so the base
        // agrees with both sides.
        const applied = await this.readLocal(localFile);
        this.state.set({
          path: relPath,
          hash: applied?.hash ?? "",
          driveId: remoteState.driveId,
          remoteRawMd5: remoteState.rawMd5,
          localMtime: applied?.mtime ?? 0,
          remoteMtime: remoteState.mtime,
        });
        downloaded++;
        if (localFile.isOwn) ownDownloaded = true;
      }
    }

    await this.state.save();

    // Clear resolved intent so it doesn't linger. Once a plugin is in Drive the
    // union (in-Drive ∪ ticked) keeps it selected without the include entry; a
    // removed plugin has been trashed. Only clear include ids that actually
    // reached Drive (still-pending uploads stay so a later run retries).
    const settings = this.getSettings();
    let intentChanged = false;
    if (clearedRemoveIds.size > 0) {
      const nextRemove = settings.configSyncPluginRemoveIds.filter(
        (id) => !clearedRemoveIds.has(id)
      );
      if (nextRemove.length !== settings.configSyncPluginRemoveIds.length) {
        settings.configSyncPluginRemoveIds = nextRemove;
        intentChanged = true;
      }
    }
    const syncedNow = new Set<string>();
    for (const rel of this.state.all().map((b) => b.path)) {
      const id = pluginIdFromRelPath(rel);
      if (id) syncedNow.add(id);
    }
    const nextInclude = settings.configSyncPluginIds.filter(
      (id) => !syncedNow.has(id)
    );
    if (nextInclude.length !== settings.configSyncPluginIds.length) {
      settings.configSyncPluginIds = nextInclude;
      intentChanged = true;
    }
    if (intentChanged) await this.onSettingsChanged();

    // Applying OUR OWN downloaded settings needs a live reload (targets/options).
    if (ownDownloaded) await this.onDownloaded();

    if (uploaded === 0 && downloaded === 0 && deleted === 0) {
      // Nothing changed. If a conflict was cancelled, report it (the caller
      // stays silent); otherwise everything was already in sync.
      if (cancelledConflict) {
        return {
          kind: "conflict",
          localMtime: cancelledConflict.localMtime,
          remoteMtime: cancelledConflict.remoteMtime,
        };
      }
      return { kind: "noop" };
    }
    // Single-file shortcuts only when nothing else happened.
    if (deleted === 0 && downloaded === 0 && uploaded === 1) {
      return { kind: "uploaded" };
    }
    if (deleted === 0 && uploaded === 0 && downloaded === 1) {
      return { kind: "downloaded" };
    }
    return { kind: "changed", uploaded, downloaded, deleted };
  }

  /** A LocalConfigFile descriptor for a remote-only path (for download+apply). */
  private remoteOnlyLocalFile(relPath: string): LocalConfigFile {
    // relPath is `.obsidian/plugins/<id>/data.json`; map back to the adapter
    // path under this vault's (possibly renamed) config dir.
    const withoutDir = relPath.startsWith(`${CONFIG_DIR}/`)
      ? relPath.slice(CONFIG_DIR.length + 1)
      : relPath;
    const adapterPath = `${this.vault.configDir}/${withoutDir}`;
    const isOwn = relPath === pluginDataRelPath(this.pluginId);
    return { relPath, adapterPath, isOwn };
  }

  /** Writes (or overwrites) the passphrase verifier blob in the config folder. */
  private async writeVerifier(passphrase: string): Promise<void> {
    const box = await makeVerifier(passphrase);
    const buf = utf8(JSON.stringify(box));
    await this.drive.createFile(
      this.folderId(),
      VERIFIER_PATH,
      buf,
      this.sharedId()
    );
  }

  /**
   * Sets up the passphrase on a folder that has no verifier yet (first-time
   * setup), or checks it against an existing verifier. Returns true if usable.
   */
  async establishPassphrase(passphrase: string): Promise<boolean> {
    if (!this.oauth.isConfigured() || !this.folderId()) return false;
    const { verifier } = await this.fetchRemote();
    if (!verifier) {
      await this.writeVerifier(passphrase);
      return true;
    }
    return checkVerifier(verifier, passphrase);
  }
}
