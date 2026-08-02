/**
 * Central type definitions for the Google Drive sync plugin.
 */

/**
 * One configured sync target: a pairing of a Google Drive folder with a local
 * vault (sub)folder plus its own filters and deletion behavior. A plugin can
 * hold MANY targets (each syncing an independent scope). One target may be a
 * whole-vault sync (`localFolder === ""`); such a target automatically excludes
 * the local folders of all OTHER targets so a subfolder is never synced into
 * two Drives at once (see `excludeFolders`).
 *
 * All targets share the SAME OAuth account (the global credentials on
 * `PluginSettings`). Each target keeps its OWN sync base in a separate file
 * (`sync-state-<id>.json`) so a deletion in one scope never leaks into another.
 */
export interface SyncTarget {
  /** Stable identity (used for the per-target state file and the scope ID). */
  id: string;
  /** Human-readable name shown in the settings UI. */
  name: string;

  /** Google Drive folder ID that serves as the sync root for this target. */
  driveFolderId: string;
  /** Display name of the Drive folder (UI only). */
  driveFolderName: string;
  /**
   * ID of the Shared Drive, if the root folder lives in one.
   * Empty = regular "My Drive". Controls the Shared Drive parameters of the list API.
   */
  driveSharedId: string;

  /** Vault-relative subfolder that is synced ("" = whole vault). */
  localFolder: string;

  /**
   * Comma-separated list of allowed file extensions (without dot), e.g.
   * "md, png, jpg, pdf". Empty = all extensions allowed.
   * Google Editors files (Docs/Sheets/…) are always ignored regardless,
   * since they have no downloadable binary content.
   */
  allowedExtensions: string;

  /**
   * Comma-separated list of ignore patterns (blacklist), complementary to
   * `allowedExtensions`. Allows plain extensions (`tmp`, `.tmp`) as well as
   * glob patterns (`*.log`, `temp/*`, `**\/drafts\/**`). Empty = ignore nothing.
   * Applies on BOTH sides (local + Drive), so an ignored file is not
   * misinterpreted as "deleted on one side". See `src/ignore.ts`.
   */
  ignorePatterns: string;

  /**
   * Comma-separated list of vault-relative folders to exclude from this target,
   * on top of the automatic exclusion of other targets' local folders. Matched
   * against the sync-relative path like a folder prefix (an entry `drafts`
   * excludes `drafts` and everything under `drafts/`). Applies on BOTH sides
   * (local + Drive, files + folders) so an excluded path is never seen as
   * "deleted on one side". Empty = exclude nothing extra.
   */
  excludeFolders: string;

  /**
   * "Do not delete in Google Drive". When true, a LOCAL deletion is not
   * propagated to Drive — the Drive file is kept and the base entry
   * is set to `local=false, remote=true` (the file does not return locally as a
   * zombie). Via the "Drive only" tree in the settings the
   * `local=false` flag can be removed so the file is downloaded again.
   * Default: false.
   */
  neverDeleteRemote: boolean;

  /**
   * "Sync Google Docs (view-only)". When true, native Google Docs
   * (`application/vnd.google-apps.document`) found in this target's Drive folder
   * are represented in the vault as small stub notes (`<name>.gdoc.md`) that
   * embed the live Google editor. The document content itself is never
   * downloaded or uploaded — this is a discovery + view layer that sits OUTSIDE
   * the reconciler (stub files are auto-excluded from sync). Default: false.
   */
  syncGoogleDocs: boolean;
}

/** Persistent plugin settings (stored in data.json). */
export interface PluginSettings {
  /** OAuth client ID of the user's own Google Cloud app ("Desktop app" client). */
  clientId: string;
  /** OAuth client secret of the user's own Google Cloud app. */
  clientSecret: string;
  /**
   * Long-lived refresh token from which access tokens are derived. Obtained by
   * signing in on desktop; on mobile it is pasted in from the desktop token
   * (mobile can't run the interactive redirect flow).
   */
  refreshToken: string;

  /**
   * Configured sync targets. Each has its own Drive folder + local scope +
   * filters and its own sync base file. All share the global OAuth account.
   */
  targets: SyncTarget[];

  /** Automatic sync active? */
  autoSyncEnabled: boolean;
  /** Poll interval for Drive changes in seconds. */
  pollIntervalSeconds: number;
  /** Delay after a local change before upload (debounce) in ms. */
  localDebounceMs: number;

  /**
   * Retention duration for log entries in hours. Older entries are
   * removed automatically. 0 = never delete automatically.
   */
  logRetentionHours: number;

  /**
   * Verbose debug logging in the developer console. Off by default,
   * so the console only shows errors (Obsidian guideline).
   */
  debugLogging: boolean;

  /**
   * Process a large sync in BATCHES of at most `batchSize` file transfers per
   * run, resuming on the next run until caught up. Keeps peak memory bounded on
   * constrained devices (the iOS OOM guard). When off, a run processes
   * everything in one pass (faster on capable devices, but can crash a very
   * large first sync on mobile). Default off.
   */
  batchEnabled: boolean;
  /**
   * Max file transfers per run when `batchEnabled` (50–2000). Higher = fewer
   * resume passes but more memory per run. Default 400.
   */
  batchSize: number;

  // --- Config sync (this plugin's own settings across devices) -------------
  // A separate subsystem from note sync: it uploads this plugin's `data.json`
  // to a dedicated Drive folder so a second device inherits the same targets/
  // options. Credentials are AES-GCM encrypted with a per-device passphrase
  // that is never synced. These fields are DEVICE-LOCAL and are stripped from
  // the uploaded payload (see `configSyncDeviceLocalKeys`).

  /** Master switch for config sync. Off by default. */
  configSyncEnabled: boolean;
  /** Drive folder id that holds the synced config file. */
  configDriveFolderId: string;
  /** Human-readable name of that folder (for the settings UI). */
  configDriveFolderName: string;
  /** Shared-drive id if the config folder lives in a Shared Drive (else ""). */
  configDriveSharedId: string;
  /**
   * Device-local, OBFUSCATED config-sync passphrase (see crypto-box.ts). Stored
   * so config sync can run unattended (auto-sync) without re-prompting. Bound to
   * this device — a copied data.json won't de-obfuscate it. Never uploaded.
   * Empty = no passphrase stored on this device.
   */
  configPassphraseObf: string;
  /**
   * Also sync OTHER installed plugins' `data.json` (not just this plugin's).
   * Each other-plugin file is WHOLE-FILE encrypted under the passphrase (we
   * can't know which of their fields are secret). Off by default. Device-local
   * (a device without a plugin simply doesn't have its file to sync).
   */
  configSyncOtherPlugins: boolean;
  /**
   * Normalized dot-paths of THIS plugin's `data.json` that must NOT sync
   * (unchecked in the "properties to sync" tree). Array indices collapse to `[]`
   * (e.g. `targets[].excludeFolders`). Applied only to our own file. Device-local.
   */
  configIgnorePaths: string[];
  /**
   * OTHER plugin ids this device explicitly TICKED to sync (include intent).
   * The effective set of synced plugins is the union of these with the plugins
   * already present in the Drive config folder (installed here) — so a plugin
   * synced from another device shows as checked here too. Device-local.
   */
  configSyncPluginIds: string[];
  /**
   * OTHER plugin ids this device explicitly UNTICKED (pending-remove intent).
   * On the next sync their Drive copy is trashed (scoped to files this device
   * synced) and the id is cleared from here. Lets a plugin that's in Drive read
   * as unchecked immediately, with the actual removal deferred to the run.
   * Device-local.
   */
  configSyncPluginRemoveIds: string[];
}

/**
 * Settings keys that are DEVICE-LOCAL: stripped from THIS plugin's config
 * payload before it is uploaded (they would otherwise round-trip a device's own
 * Drive-folder pointer / passphrase onto another device). The rest of the file
 * (credentials included) is WHOLE-FILE encrypted under the passphrase.
 */
export const CONFIG_SYNC_DEVICE_LOCAL_KEYS = [
  "configSyncEnabled",
  "configDriveFolderId",
  "configDriveFolderName",
  "configDriveSharedId",
  "configPassphraseObf",
  "configSyncOtherPlugins",
  "configIgnorePaths",
  "configSyncPluginIds",
  "configSyncPluginRemoveIds",
] as const;

/**
 * State of a file (or folder) at the last successful sync —
 * the "memory" between two runs.
 *
 * Core of the deletion safety: `local`/`remote` remember on which side the
 * file ACTUALLY existed at the last processing. A deletion is only
 * propagated if the file was previously on BOTH sides (local && remote)
 * and is now missing on one — then it is a real deletion, not a new addition.
 */
export interface SyncStateEntry {
  /** Vault-relative path (key, plain text — also serves as ID). */
  path: string;
  /** Did the file exist locally at the last processing? */
  local: boolean;
  /** Did the file exist in Drive at the last processing? */
  remote: boolean;
  /** true if this entry describes a folder (no hash/mtime). */
  isFolder: boolean;
  /** Google Drive file ID (empty for a pure folder placeholder without a Drive counterpart). */
  driveId: string;
  /** MD5 hash of the content at the last sync (empty for folders). */
  md5: string;
  /** Size in bytes at the last sync. */
  size: number;
  /** Local mtime at the last sync (ms). */
  localMtime: number;
  /** Drive modifiedTime at the last sync (ms). */
  remoteMtime: number;
  /**
   * true if the file is DELIBERATELY kept in Drive only: deleted locally,
   * but not removed from Drive because of "Do not delete in Google Drive" and
   * intentionally NOT restored locally. Distinguishes this case from
   * a foreign/copied base (local=false), which very much should be
   * downloaded. Reset via the "Drive only" tree in the settings.
   */
  keptRemoteOnly?: boolean;
}

/** A Google Drive folder with a vault-relative path (from the recursive listFiles). */
export interface DriveFolder {
  id: string;
  relativePath: string;
}

/** A Google Drive file entry (subset of the API fields). */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** ms since epoch. */
  modifiedTimeMs: number;
  md5Checksum?: string;
  size?: number;
  /**
   * Path relative to the sync root folder, derived from the folder chain
   * (e.g. "sub/note.md"). Set by the recursive listFiles().
   */
  relativePath?: string;
}

/** Result categories of the reconciler for a single file. */
export type SyncAction =
  | { type: "upload"; path: string } // local -> Drive (new or changed)
  | { type: "download"; path: string; driveId: string } // Drive -> local
  | { type: "deleteLocal"; path: string } // deleted in Drive -> delete locally
  | { type: "deleteRemote"; path: string; driveId: string } // deleted locally -> delete in Drive
  // Do NOT propagate a local deletion to Drive (setting "Do not delete in
  // Google Drive"). No Drive operation; the engine sets the base entry to
  // local=false, remote=true, so the file stays in Drive and does not return
  // locally as a zombie.
  | { type: "keepRemoteDropLocal"; path: string; driveId: string }
  | { type: "conflict"; path: string; driveId: string; winner: "local" | "remote" } // both changed
  | { type: "noop"; path: string };

/** Actions for folders (sync/delete empty folders). */
export type FolderAction =
  | { type: "createLocalFolder"; path: string } // create folder locally
  | { type: "createRemoteFolder"; path: string } // create folder in Drive
  | { type: "deleteLocalFolder"; path: string } // delete folder locally
  | { type: "deleteRemoteFolder"; path: string; driveId: string } // delete folder in Drive
  // Locally deleted folder, but "Do not delete in Google Drive" active:
  // keep folder in Drive, set base to remote-only (keptRemoteOnly).
  | { type: "keepRemoteFolder"; path: string; driveId: string }
  | { type: "noopFolder"; path: string };

/** Aggregated result of a sync run (for notices/logs). */
export interface SyncSummary {
  uploaded: number;
  downloaded: number;
  deletedLocal: number;
  deletedRemote: number;
  conflicts: number;
  errors: string[];
  /**
   * True when the run stopped early because it hit the per-run action cap
   * (mobile batch limit) and more work remains. The caller re-runs the sync to
   * continue. Absent/false means the run processed everything.
   */
  moreRemaining?: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  clientId: "",
  clientSecret: "",
  refreshToken: "",
  targets: [],
  autoSyncEnabled: false,
  pollIntervalSeconds: 60,
  localDebounceMs: 2500,
  logRetentionHours: 24,
  debugLogging: false,
  batchEnabled: false,
  batchSize: 400,
  configSyncEnabled: false,
  configDriveFolderId: "",
  configDriveFolderName: "",
  configDriveSharedId: "",
  configPassphraseObf: "",
  configSyncOtherPlugins: false,
  // Seed the ignore list with excludeFolders — it's genuinely device-specific
  // (per-target local folder paths), so it shouldn't travel by default. The
  // user can re-enable it in the "properties to sync" tree.
  configIgnorePaths: ["targets[].excludeFolders"],
  configSyncPluginIds: [],
  configSyncPluginRemoveIds: [],
};

/** Builds a fresh, empty sync target with sensible defaults. */
/**
 * Ignore patterns a freshly created target starts with. Excludes Windows
 * executables and the contents of any `.git` repository (a `.git` folder at any
 * depth) from syncing. The user can edit or clear these per target.
 */
export const DEFAULT_IGNORE_PATTERNS = "*.exe, **/.git/**";

export function newTarget(id: string, name: string): SyncTarget {
  return {
    id,
    name,
    driveFolderId: "",
    driveFolderName: "",
    driveSharedId: "",
    localFolder: "",
    allowedExtensions: "",
    ignorePatterns: DEFAULT_IGNORE_PATTERNS,
    excludeFolders: "",
    neverDeleteRemote: false,
    syncGoogleDocs: false,
  };
}

/** OAuth scope: full Drive access, so that files created manually in Drive are also visible. */
export const OAUTH_SCOPE = "https://www.googleapis.com/auth/drive";
