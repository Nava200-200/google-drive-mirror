/**
 * Englische Übersetzungen — die AUTORITATIVE Quelle für alle i18n-Schlüssel.
 * Der `Messages`-Typ (unten abgeleitet) definiert das Schlüssel-Set; alle
 * anderen Sprachen sind `Partial<Messages>` und fallen auf diese Werte zurück.
 *
 * Konvention: Emoji-/Symbol-Präfixe (↑ ↓ 🗑 ⚔ 📁 …) stehen im CODE, nicht in
 * den Strings — so bleiben sie über alle Sprachen konsistent. `{name}` markiert
 * einen Interpolations-Platzhalter (siehe `t()` in ../index.ts).
 */

export const en = {
  // ---- Commands / Ribbon (main.ts) ----
  ribbonSyncTooltip: "Google Drive Mirror: Sync now",
  commandSyncNow: "Sync now",
  commandLogin: "Sign in with Google",

  // ---- Status bar (main.ts) ----
  statusBarReady: "Drive: ready",
  statusBarRunning: "Drive: {message}",
  statusBarDone: "Drive: {message}",
  statusBarError: "Drive: {message}",
  statusBarTooltip: "Google Drive Mirror — click to sync",

  // ---- Notices (main.ts) ----
  noticeSyncAlreadyRunning: "Google Drive Mirror: A sync is already running…",
  noticeSignInFirst: "Google Drive Mirror: Please sign in in the settings first.",
  noticeLoginSuccess: "Google Drive Mirror: Signed in, token saved.",
  noticeNoTargets:
    "Google Drive Mirror: No sync target configured yet. Add one in the settings.",

  // ---- Settings: headings & Google Cloud (settings-tab.ts) ----
  settingsTitle: "Google Drive Mirror",
  headingCloudAccess: "1. Google Cloud access",
  cloudHelp:
    "In the Google Cloud Console, create an OAuth client ID of type “Desktop app”, enable the Google Drive API, and enter the client ID and secret here. Details in the README.",
  clientIdName: "Client ID",
  clientIdDesc: "OAuth 2.0 client ID of your Google Cloud app.",
  clientSecretName: "Client secret",
  clientSecretDesc: "OAuth 2.0 client secret of your Google Cloud app.",
  loginName: "Sign-in",
  loginDescSignedIn: "✅ Signed in. Sign in again if access was revoked.",
  loginDescSignedOut: "Not signed in.",
  loginDescSignedOutMobile:
    "Not signed in. Sign in on desktop first, then copy the token there and paste it below.",
  loginButtonReauth: "Sign in again",
  loginButtonSignIn: "Sign in with Google",
  loginFailed: "Sign-in failed: {error}",
  logoutTooltip: "Sign out (delete token)",
  tokenCopyName: "Copy sign-in token (for mobile)",
  tokenCopyDesc:
    "Copies your sign-in token so you can paste it into Obsidian on your phone or tablet, which can't sign in directly.",
  tokenCopyButton: "Copy sign-in token",
  tokenCopied: "Sign-in token copied. Paste it into Obsidian on your other device.",
  tokenCopyManual: "Copy this sign-in token: {token}",
  tokenImportSummary: "Sign in with a token from another device",
  tokenImportHelp:
    "On mobile you can't sign in directly. Sign in on desktop, tap “Copy sign-in token” there, then paste it here.",
  tokenImportName: "Sign-in token",
  tokenImportDesc:
    "Paste the token you copied from a signed-in desktop. Requires the same client ID and secret above.",
  tokenImportPlaceholder: "Paste the sign-in token",
  tokenImportButton: "Sign in with token",
  tokenImportNoInput: "Paste the sign-in token first.",

  // ---- Settings: sync targets (settings-tab.ts) ----
  headingTargets: "2. Sync targets",
  targetsHelp:
    "Each target syncs one local (sub)folder with one Google Drive folder. A whole-vault target automatically excludes the local folders of the other targets, so a subfolder is never mirrored into two Drives at once.",
  targetsEmpty: "No sync target yet. Add one below.",
  targetAddButton: "Add sync target",
  targetDefaultName: "Target {index}",
  targetNameName: "Name",
  targetNameDesc: "A label for this target (only shown here).",
  targetNamePlaceholder: "e.g. Work notes",
  targetRemoveTooltip: "Remove this target (keeps files, drops the sync base)",
  excludeFoldersName: "Excluded folders",
  excludeFoldersDesc:
    "Comma-separated vault-relative folders to exclude from this target (on top of the other targets, which are excluded automatically). Applies to both sides. Empty = nothing extra.",
  excludeFoldersPlaceholder: "Archive, Private/Journal",

  // ---- Settings: folders (settings-tab.ts) ----
  headingFolders: "2. Folders",
  syncWholeVaultName: "Sync entire vault",
  syncWholeVaultDesc:
    "On: all files of the vault are synced (except the .obsidian config folder). Off: only a selected subfolder. Only one target can sync the whole vault.",
  syncWholeVaultLocked:
    "Only one target can sync the whole vault — “{name}” already does. Choose a subfolder for this target.",
  localFolderName: "Local vault folder",
  localFolderDescSet: "Vault-relative subfolder that is synced.",
  localFolderDescEmpty:
    "⚠️ Please choose a folder — without a selection nothing is synced.",
  localFolderPlaceholder: "e.g. Notes/Sync",
  driveFolderName: "Google Drive folder",
  driveFolderDescSet: "Current: “{name}”",
  driveFolderDescEmpty: "No folder chosen yet.",
  driveFolderPlaceholderReady: "Type to search Drive folders…",
  driveFolderPlaceholderNotReady: "Sign in first, then search folders",
  driveFolderCheckButton: "Check",
  sharedDriveSuffix: " (Shared Drive)",
  driveFolderFound: "Folder found: “{name}”{location}",
  driveFolderInvalid: "Invalid folder: {error}",
  driveFolderCreateTooltip: "Create new Drive folder “Obsidian”",
  driveFolderCreated: "Folder “{name}” created.",
  driveFolderCreateFailed: "Could not create folder: {error}",

  // ---- Settings: file filter & delete behavior (settings-tab.ts) ----
  allowedExtensionsName: "Allowed file extensions",
  allowedExtensionsDesc:
    "Comma-separated, without the dot (e.g. “md, png, jpg, pdf”). Empty = all file types. Google Docs/Sheets/Slides are always skipped because they cannot be downloaded as binary files.",
  allowedExtensionsPlaceholder: "md, png, jpg, pdf",
  ignorePatternsName: "Ignore patterns",
  ignorePatternsDesc:
    "Comma-separated list of files/folders to exclude from sync — no quotes. Accepts plain extensions (tmp, .log) and glob patterns (*.tmp, drafts/*, **/node_modules/**). Paths are relative to the sync folder. Applies to both sides. Empty = ignore nothing.",
  ignorePatternsPlaceholder: "*.tmp, .DS_Store, drafts/*",
  neverDeleteRemoteName: "Do not delete in Google Drive",
  neverDeleteRemoteDesc:
    "When enabled, a locally deleted file is NOT removed from Google Drive. The file stays in Drive and does not come back locally. Via “Only in Drive” below you can download individual files locally again. Default: off.",
  syncGoogleDocsName: "Sync Google Docs & Sheets (view-only)",
  syncGoogleDocsDesc:
    "Create a small note per Google Doc and Sheet that embeds the live Google editor (editable on desktop; opens externally on mobile). The file itself is not downloaded and never uploaded back. Default: off.",

  // ---- Google Docs/Sheets embed (gdoc-embed.ts) ----
  gdocOpenInDrive: "Open in Google Docs",
  gsheetOpenInDrive: "Open in Google Sheets",
  gdocInvalidBlock: "Invalid Google file embed (missing document id).",

  // ---- Settings: auto-sync (settings-tab.ts) ----
  headingAutoSync: "3. Automatic sync",
  autoSyncEnabledName: "Enable auto-sync",
  autoSyncEnabledDesc:
    "Uploads local changes shortly after saving and polls Drive at an interval.",
  pollIntervalName: "Drive poll interval (seconds)",
  pollIntervalDesc: "How often Drive is checked for changes (minimum 15).",
  localDebounceName: "Delay after local change (ms)",
  localDebounceDesc: "Debounce to batch quick successive saves.",
  logRetentionName: "Log retention (hours)",
  logRetentionDesc:
    "Log entries older than this are deleted automatically. 0 = never delete automatically.",
  debugLoggingName: "Debug logging",
  debugLoggingDesc:
    "Writes verbose info messages to the developer console. Enable only for troubleshooting.",
  batchEnabledName: "Sync in batches",
  batchEnabledDesc:
    "Process a large sync in batches and resume until finished, keeping memory bounded (recommended on mobile). Turn off to sync everything in one pass — faster on capable devices, but a very large sync can crash the app on mobile.",
  batchSizeName: "Batch size",
  batchSizeDesc:
    "Maximum file transfers per run before resuming (50–2000). Higher means fewer resume passes but more memory per run. Default 400.",

  // ---- Settings: actions & status (settings-tab.ts) ----
  headingActionsStatus: "4. Actions & status",
  syncNowName: "Sync now",
  lastSyncDesc: "Last sync: {time}",
  neverSyncedDesc: "No sync performed yet.",
  syncStartButton: "Start sync",
  syncRunningButton: "Sync running…",
  syncLogName: "Sync log",
  syncLogDesc: "Full, live-updating log of the sync actions.",
  showLogButton: "Show log",
  clearLogTooltip: "Clear log",
  resetSyncStateName: "Reset sync state",
  resetSyncStateDesc:
    "Deletes the internal sync history (not your files). Useful when things are inconsistent. On the next sync all files are reconciled from scratch.",
  resetButton: "Reset",
  resetSyncStateNotice: "Sync state reset.",

  // ---- Settings: sync tree (settings-tab.ts) ----
  syncTreeName: "Sync tree",
  syncTreeDesc:
    "All synced folders and files. The checkbox shows whether an entry exists locally. Entries kept only in Google Drive (deleted locally but retained) are unchecked — check one to restore it locally on the next sync. Currently only in Drive: {count}.",
  syncTreeCheckboxTitle: "Uncheck to restore locally",
  syncTreeCheckboxLocalTitle: "Stored locally and in Google Drive",
  syncTreeCheckboxRestoreTitle: "Only in Google Drive — check to restore locally",
  syncTreeColName: "Name",
  syncTreeColLocal: "Local",
  syncTreeColIgnored: "Ignored",
  syncTreeCheckboxIgnoredTitle:
    "Excluded by this target's filters (ignore patterns, extension whitelist, or excluded folders)",
  syncTreeCheckboxNotIgnoredTitle: "Not excluded by this target's filters",
  syncTreeRestored: "“{path}” will be restored on the next sync.",
  syncTreeRefresh: "Refresh tree",
  syncTreeEmpty: "Nothing synced yet.",
  syncTreeFilterPlaceholder: "Filter by name or path…",
  syncTreeNoMatch: "No entries match the filter.",

  // ---- Live status line (settings-tab.ts) ----
  statusLineReady: "Ready.",
  statusLineRunning: "{message} · {secs}s",
  statusLineDone: "{message}",
  statusLineError: "{message}",

  // ---- Log modal (settings-tab.ts) ----
  logModalTitle: "Google Drive Mirror — Log",
  logModalClearButton: "Clear log",
  logModalCount: "{count} entries",
  logModalEmpty: "No entries yet.",

  // ---- Sync status defaults (sync-status.ts) ----
  statusReady: "Ready",
  statusSyncStarted: "Sync started…",

  // ---- Sync engine: phases & messages (sync-engine.ts) ----
  engineNoDriveFolder: "Google Drive Mirror: No Drive folder configured.",
  engineReadingLocal: "Reading local files…",
  engineFetchingDrive: "Fetching Google Drive…",
  engineFetchingDriveProgress:
    "Fetching Google Drive… {folders} folders, {files} files",
  engineDuplicateSameContent:
    "Multiple identical Drive files “{path}” — one chosen.",
  engineDuplicateDifferent:
    "Multiple different Drive files with the same path “{path}” — skipped. Please remove/rename the duplicate in Drive.",
  engineDuplicateFolder:
    "Multiple Drive folders with the same path “{path}” — skipped. Please remove/rename the duplicate in Drive.",
  engineCountSummary:
    "{localFiles} local · {remoteFiles} Drive files, {localFolders}/{remoteFolders} folders",
  engineNoChanges: "No changes to transfer.",
  engineBatchLimited:
    "Large sync: processing {batch} of {total} this run; the rest continues on the next sync.",
  engineBatchMore:
    "Synced {done} of {total}. Run sync again to continue the rest.",
  engineActionError: "{type} “{path}”: {error}",
  engineActionDone: "{action} ✓",
  engineRemoteFolderNotDeleted:
    "Drive folder “{path}” not deleted: still contains files (protection against subtree loss).",
  engineSyncFailed: "Sync failed: {error}",
  engineNoticePrefix: "Google Drive Mirror: {message}",
  engineRemoteFolderCreated: "Drive folder “{path}” created ✓",
  engineLocalFolderCreated: "Local folder “{path}” created ✓",
  engineRemoteFolderDeleted: "Drive folder “{path}” deleted ✓",
  engineLocalFolderDeleted: "Local folder “{path}” deleted ✓",
  engineFolderKeptRemote:
    "Folder deleted locally, kept in Drive “{path}”",

  // ---- Sync engine: action descriptions (describeAction) ----
  uploadAction: "Upload “{path}”",
  downloadAction: "Download “{path}”",
  deleteLocalAction: "Delete locally “{path}”",
  deleteRemoteAction: "Delete in Drive “{path}”",
  keepRemoteDropLocalAction: "Deleted locally, kept in Drive “{path}”",
  conflictAction: "Conflict “{path}” ({winner} wins)",
  conflictWinnerLocal: "local",
  conflictWinnerRemote: "Drive",

  // ---- Sync engine: summary line (summaryText) ----
  summaryUploaded: "{count} up",
  summaryDownloaded: "{count} down",
  summaryDeletedRemote: "{count} deleted in Drive",
  summaryDeletedLocal: "{count} deleted locally",
  summaryConflicts: "{count} conflicts",
  summaryNoChanges: "no changes",
  summaryDoneWithErrors: "Done with {count} error(s): {head}",
  summaryDone: "Done: {head}",

  // ---- Sync engine: final notice (formatSummary) ----
  noticeDeletedRemote: "Drive {count}",
  noticeDeletedLocal: "local {count}",
  noticeErrorMore: "\n…and {count} more",
  noticeErrorTail:
    "\n⚠ {count} error(s) (details in the console):\n{shown}{more}",
  noticeSummary: "Google Drive Mirror: {head}{errTail}",

  // ---- OAuth errors (oauth.ts) ----
  oauthCredentialsMissing:
    "Client ID and client secret must be set in the settings first.",
  oauthNoRefreshToken:
    "Google did not return a refresh token. Please revoke the app's access at https://myaccount.google.com/permissions and sign in again (prompt=consent forces a new refresh token).",
  oauthNotSignedIn: "Google Drive Mirror is not signed in (no refresh token).",
  oauthTokenRefreshFailed:
    "Token refresh failed ({status}): {text}. The refresh token may have expired — please sign in again.",
  oauthPageSuccess: "Sign-in successful",
  oauthPageFailure: "Sign-in failed",
  oauthPageClose: "You can close this window and return to Obsidian.",
  oauthError: "OAuth error: {error}",
  oauthNoCode: "No auth code received.",
  oauthStateMismatch: "State does not match (CSRF protection).",
  oauthTimeout: "Sign-in timed out (5 minutes).",
  oauthCodeExchangeFailed: "Code exchange failed ({status}): {text}",
  oauthLoopbackDesktopOnly:
    "The loopback sign-in is only available on desktop.",
  oauthImportEmpty: "No token entered.",

  // ---- Suggesters (suggesters.ts) ----
  suggestWholeVault: "/ (entire vault)",
  suggestSharedDriveBadge: "  · Shared Drive",

  // ---- Drive client (drive-client.ts) ----
  driveNotAFolder: "The given ID is not a folder.",
  driveApiFailed: "Drive API \"{action}\" failed ({status}): {text}",
  driveActionListFiles: "list files",
  driveActionDownloadFile: "download file",
  driveActionCreateFile: "create file",
  driveActionSearchSubfolder: "search subfolder",
  driveActionCreateSubfolder: "create subfolder",
  driveActionUpdateFile: "update file",
  driveActionTrashFile: "move file to trash",
  driveActionCheckFolder: "check folder",
  driveActionSearchFolder: "search folder",
  driveActionCreateFolder: "create folder",
} as const;

/** Schlüssel-Set + Wert-Typen aller Übersetzungen (Autoritätsquelle). */
export type Messages = Record<keyof typeof en, string>;
