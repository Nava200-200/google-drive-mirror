import { ConfigBase } from "./config-sync-state";

/**
 * The single-file reconciler for config sync (this plugin's `data.json`).
 *
 * Pure function, no I/O — mirrors the "reconcile is pure + tested" pattern of
 * `reconciler.ts`. Deletion-safety: config sync NEVER deletes. A file present on
 * only one side is always CREATED on the other, never removed. There is
 * deliberately no delete action in the result type.
 */

/** Snapshot of the local `data.json` for reconciliation. */
export interface ConfigLocalState {
  /** True if `data.json` exists locally (it always should, but be defensive). */
  exists: boolean;
  /** MD5 of the normalized upload payload (see `configPayloadHash`). */
  hash: string;
  /** Local mtime (ms). */
  mtime: number;
}

/** Snapshot of the Drive copy for reconciliation. */
export interface ConfigRemoteState {
  /** True if a config file exists in the Drive config folder. */
  exists: boolean;
  /** Drive file id (empty when !exists). */
  driveId: string;
  /** Drive's own md5Checksum of the stored (encrypted) blob. */
  rawMd5: string;
  /** Drive modifiedTime (ms). */
  mtime: number;
}

/** The decision for the single config file. */
export type ConfigAction =
  | { type: "noop" }
  | { type: "upload" } // local -> Drive (new or changed)
  | { type: "download" } // Drive -> local (new or changed)
  | { type: "conflict" }; // both changed since base -> ask the user

/**
 * Decides what to do with the config file given the local/remote snapshots and
 * the stored base. NEVER returns a deletion.
 *
 * Cases (base = the last agreed state):
 *  - No local, no remote            -> noop (nothing to sync yet)
 *  - Local only                     -> upload (first push or remote never seen)
 *  - Remote only                    -> download (first pull; never delete local)
 *  - Both, no base                  -> conflict UNLESS content already matches
 *                                      (identical -> noop). Without a base we
 *                                      cannot know which side changed, so we ask.
 *  - Both, with base:
 *      localChanged = hash != base.hash
 *      remoteChanged = rawMd5 != base.remoteRawMd5
 *      neither changed             -> noop
 *      only local changed          -> upload
 *      only remote changed         -> download
 *      both changed                -> conflict
 */
export function reconcileConfig(
  local: ConfigLocalState,
  remote: ConfigRemoteState,
  base: ConfigBase | null
): ConfigAction {
  if (!local.exists && !remote.exists) return { type: "noop" };
  if (local.exists && !remote.exists) return { type: "upload" };
  if (!local.exists && remote.exists) return { type: "download" };

  // Both sides exist.
  if (!base) {
    // No base: cannot attribute the change. If content already agrees, nothing
    // to do; otherwise ask (never silently pick a side and clobber the other).
    return { type: "conflict" };
  }

  const localChanged = local.hash !== base.hash;
  const remoteChanged = remote.rawMd5 !== base.remoteRawMd5;

  if (!localChanged && !remoteChanged) return { type: "noop" };
  if (localChanged && !remoteChanged) return { type: "upload" };
  if (!localChanged && remoteChanged) return { type: "download" };
  return { type: "conflict" };
}
