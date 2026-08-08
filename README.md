# Google Drive Mirror for Obsidian (Large File Stubbing Fork)

> **Note:** This is a fork of the original [Google Drive Mirror](https://github.com/laupas/obsidian-google-drive-mirror) by Pascal Lauener. It adds a specialized feature to "stub" large binary files (like PDFs and EPUBs >10MB) into small `.gfile.md` markdown notes that link to the Google Drive preview, rather than downloading them and bloating the vault.
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/llaaccssaapp)

Automatic **two-way sync** between your Obsidian vault (whole vault or a single subfolder) and a Google Drive folder. You can edit, add, or delete files in Obsidian **or** directly in Google Drive — both sides are reconciled.

- ✅ Manual sync (ribbon icon + command) **and** automatic sync (upload shortly after a local change + interval polling for Drive)
- 📝 **Google Workspace files, live inside Obsidian:** open a Doc, Sheet, Slides or Drawing as a note and **view — and edit on desktop — the real Google editor embedded right in the pane**. View-only integration: the file is never downloaded or uploaded, so nothing can be lost
- ⚙️ **Sync plugin settings across devices:** keep this plugin's own settings — and optionally **every other installed plugin's settings** — in sync between your devices, **passphrase-encrypted** (the passphrase never leaves your device). Never deletes; conflicts ask which side to keep (see [Sync plugin settings across devices](#sync-plugin-settings-across-devices-optional))
- ✅ **Whole vault** or a specific **subfolder** — toggleable
- ✅ **Recursive:** subfolders are mirrored; even empty folders are synced
- ✅ Conflict strategy **"newer wins"** (by timestamp); an edit always beats a deletion (no data loss)
- ✅ **Deletion safety:** only files that provably existed on both sides get deleted. Local deletions go to Obsidian's **`.trash` folder** in the vault, Drive deletions to the **Drive trash** — never permanent
- ✅ Optional **"Do not delete in Google Drive"** mode: local deletions are never propagated to Drive
- ✅ **Sync tree** in the settings: browse all synced folders and files; a checkbox per entry shows whether it exists locally, and files kept only in Drive can be restored locally per entry (auto-refreshes after each sync, plus a manual refresh button)
- ✅ All file types (Markdown, images, PDFs …), optionally narrowed by a **file-extension filter**
- ✅ **Shared Drives** (Team Drives) are supported — auto-detected when you pick the folder
- ✅ **Live status bar** + persistent **sync log** (viewable in the log window)
- 📱 Works on **desktop and mobile**. You sign in on desktop, then copy the sign-in token to mobile (mobile can't run the sign-in redirect flow — see [Mobile setup](#mobile-setup-sign-in-on-desktop-copy-the-token))

---

## 🛑 DANGER — Please read before first use

This plugin can **delete and overwrite files on both sides**. Misuse can cause data loss. Take these precautions seriously:

### 1. ALWAYS create a backup first

Before you run the plugin for the first time (or with a new folder): **back up your vault AND your Google Drive folder.** Two-way sync is powerful, but any sync software can destroy data when misconfigured. The trash (local `.trash`, Drive trash) is a safety net — **not a substitute for a real backup**.

### 2. NEVER copy `sync-state.json` into a new or empty vault

The plugin remembers the last sync state in `sync-state.json` (in the plugin folder). This file belongs **exclusively** to the vault where it was created.

> **If you copy this file into a new/empty vault, the plugin will "believe" that all the files it lists were deleted locally — and propagate those deletions to Google Drive. Your Drive folder would be emptied.**

The plugin protects you as far as it can (the state file is bound to vault name + Drive folder and is discarded on mismatch). **But this protection fails** if the new vault happens to use the same name and the same Drive folder. So don't rely on it:

- **Set up every vault fresh** (install the plugin, sign in, pick the folder) — never copy plugin data around by hand.
- If you move/duplicate a vault and are unsure: **delete `sync-state.json`** or click **"Reset sync state"** in the settings. The next sync will then reconcile cleanly (download) instead of deleting.

### 3. Test with unimportant data first

For your first run, try the plugin with a **throwaway vault** and a separate Drive folder before pointing it at your real notes.

---

## How it works (overview)

The plugin keeps a **state** (the "base") per file and folder: MD5 hash, timestamps, and — crucial for deletion safety — **which side the file actually existed on at the last sync** (`local`/`remote`). On the next run it compares the current local state, the Drive state, and this base:

- File changed only locally → **upload**
- File changed only in Drive → **download**
- File changed on both sides → **conflict** → newer wins
- File now missing on one side:
  - …and the base says it was **never** there → it's new → gets **copied**, never deleted
  - …and the base says it existed on **both** sides → real deletion → propagated to the **trash** (unless the other side changed it, in which case the edit wins)

This "existed-before" proof prevents the classic sync catastrophe where an empty or foreign state wipes the whole Drive folder. On top of that, the base is bound to **vault + Drive folder** — a state file copied from another vault is detected and discarded.

Deleted files are never gone permanently: locally they go to Obsidian's **`.trash` folder** in the vault, in Drive to the **trash**.

The full decision table lives in [`src/reconciler.ts`](src/reconciler.ts) and is covered by unit tests in [`test/unit/`](test/unit/).

**Folder structure:** the folder hierarchy is **mirrored** into Drive — subfolders are created and synced (even empty ones). Additionally, each file's vault-relative path is stored in Drive under `appProperties.obsidianPath` as a fallback.

---

## Setup

### 1. Create a Google Cloud app (one-time)

> **New to this / not technical?** Follow the illustrated, plain-language guide
> instead: **[Step-by-step Google setup](docs/google-cloud-setup.md)** — it
> walks through creating the Google app click by click.

The short version:

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or pick an existing one).
3. **APIs & Services → Library** → search for **"Google Drive API"** → **Enable**.
4. **APIs & Services → OAuth consent screen**:
   - Choose user type **"External"**.
   - Enter app name, support email, and developer contact.
   - Add your own Google address under **Test users** (while the app is in testing mode this is enough — **no Google verification required**).
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **"Desktop app"**.
   - After creation you receive a **client ID** and **client secret**.

> The loopback redirect (`http://127.0.0.1:<port>`) is automatically allowed for the "Desktop app" type — you don't need to register a redirect URI manually.

> **Using the plugin on mobile too?** No extra OAuth client is needed — you sign in on desktop and copy the token to mobile. See [Mobile setup](#mobile-setup-sign-in-on-desktop-copy-the-token).

### 2. Install the plugin

**Manual (for development/testing):**

```bash
git clone <this-repo> obsidian-google-drive-mirror
cd obsidian-google-drive-mirror
npm install
npm run build
```

The build produces a ready-to-install directory `.build/` (`main.js` + `manifest.json` + `styles.css`). Copy its contents into your vault under:

```
<Vault>/.obsidian/plugins/google-drive-mirror/
```

Enable the plugin in Obsidian under **Settings → Community plugins**.

### 3. Configure the plugin

In the plugin settings:

1. Enter the **client ID** and **client secret** from step 1.
2. Click **"Sign in with Google"** → a browser opens → pick your account and grant access. The refresh token is stored automatically.
3. Choose the **sync scope**: either leave **"Sync entire vault"** enabled (all files except the `.obsidian` config folder), or turn it off — then the **"Local vault folder"** field appears, where you **must** pick a subfolder (e.g. `Notes/Sync`).
4. Pick the **Google Drive folder**: just **type** in the field — a **suggestion list** of your Drive folders appears (live search). Click a folder, done. Alternatively paste an existing **folder ID** and click **"Verify"**, or use the folder-plus button to create a new "Obsidian" folder.
   - You can find the folder ID in the folder's URL in Google Drive: `drive.google.com/drive/folders/<THIS-ID>`.
   - The **Local vault folder** field also shows matching vault folders as suggestions while you type.
5. Optionally enable **auto-sync** and set the interval. Further options: **file-extension filter**, **"Do not delete in Google Drive"** (see below), **log retention** (hours), and **debug logging**.

### Mobile setup (sign in on desktop, copy the token)

The plugin runs on Obsidian mobile (iOS/Android) too, using the **same Google
account and the same synced data**. But mobile **can't sign in directly**:
Google removed the copy-paste (OOB) flow, rejects custom `obsidian://` redirects
for every client type, and a phone can't run the desktop loopback server. So
there is **no extra OAuth client to create** — instead you move the sign-in
token from desktop to mobile:

1. **On desktop**, sign in normally (enter client ID + secret, click **"Sign in
   with Google"**).
2. Still on desktop, in the plugin settings click **"Copy sign-in token"**. This
   copies your refresh token to the clipboard.
3. Get that token onto your phone (paste it into a note that syncs, send it to
   yourself, a password manager, etc.).
4. **On mobile**, open the plugin settings, enter the **same client ID and
   secret** as on desktop, expand **"Sign in with a token from another
   device"**, paste the token, and tap **"Sign in with token"**.

That's it — mobile is now signed in and syncs like desktop. The token is
account-level, so it works on any device with the same client credentials.

> The client ID/secret come from a **"Desktop app"** OAuth client (the same one
> from step 1 of the setup). Its secret isn't truly secret for installed apps,
> so putting it on your phone is expected and fine.

### "Do not delete in Google Drive" (optional)

When enabled, deleting a file (or folder) locally will **not** remove it from Google Drive — the Drive copy is kept, and it does **not** come back locally on the next sync. Default: off (a local deletion is propagated to Drive's trash).

### Sync tree

Below the settings you'll find a **sync tree** showing all synced folders and files. Each entry has a checkbox:

- **Checked (and greyed out)** — the entry exists both locally and in Drive (status only, not clickable).
- **Unchecked** — the entry is kept **only in Drive** (deleted locally but retained via "Do not delete in Google Drive"). **Check it** to restore the file locally on the next sync.

The tree **auto-refreshes after each sync**, and there's a **refresh button** next to the heading for a manual update. The heading also shows how many entries are currently only in Drive.

### Google Workspace files (view-only, optional)

Native Google Workspace files can't be synced as files — they have no downloadable binary, only the live cloud document. With the per-target **"Sync Google Workspace files"** toggle enabled, the plugin instead creates a small **stub note** in your vault for each one that **embeds the live Google editor**. Supported types and their stub suffixes:

| Type | Stub file |
|------|-----------|
| Google Docs | `<name>.gdoc.md` |
| Google Sheets | `<name>.gsheet.md` |
| Google Slides | `<name>.gslides.md` |
| Google Drawings | `<name>.gdraw.md` |

(Other Google types — Forms, Sites, etc. — are left as-is.)

- **Desktop:** the note shows the real, fully **editable** Google editor inline (it's the actual Google page — your edits save straight to Google, no conversion).
- **Mobile:** shows an **"Open in Google …"** button instead (mobile can't embed the editor).

These stub notes are pointers, not content: **the file is never downloaded and never uploaded back**, and the stubs are **excluded from the sync** entirely (they're never uploaded to Drive and never treated as deletions). Deleting a stub note doesn't touch the Google file; deleting the Google file doesn't auto-remove the stub. Default: **off**.

> Tip: the embed fills the full note pane width. Sign-in uses your browser's Google session inside the embed.

### Sync plugin settings across devices (optional)

A separate feature (its own tab in the settings) that keeps **this plugin's own settings** — your sync targets, filters, and options — in sync across your devices, so a second desktop or a phone inherits the same setup. It is **not** part of the folder sync above and never deletes anything.

How it works:

- **Its own Drive folder.** You pick a dedicated Drive folder; inside it the plugin mirrors the `.obsidian` structure (e.g. `.obsidian/plugins/google-drive-mirror/data.json`). Keep it separate from your note folders — the plugin's normal note sync automatically ignores anything under `.obsidian`, so the two never collide.
- **A passphrase you set per device.** Everything uploaded is **encrypted with a passphrase** that you enter on each device and that is **never uploaded**. Enter the *same* passphrase on every device. The passphrase is stored locally (obfuscated) so you don't have to re-type it every session and so it can run unattended — see the note below on what that does and doesn't protect.
- **Whole-file encryption.** Each settings file is encrypted as a single opaque blob, so credentials (and any secrets) are unreadable in Drive.
- **Conflicts ask.** If a settings file changed on both devices since the last sync, you're prompted to keep this device's version or Drive's. Otherwise the newer one wins. Nothing is ever deleted — a settings file present on only one device is only ever copied to the other.
- **Live-applies for this plugin.** After a download, this plugin's own settings take effect immediately (no restart).

**Also sync other plugins' settings (optional, off by default).** A second toggle additionally syncs the `data.json` of **every other installed plugin** (only for plugins already installed on both devices — it does not install or enable plugins). Each file is fully passphrase-encrypted, so any secrets other plugins store stay unreadable in Drive. Note: other plugins usually need an **Obsidian reload** to pick up downloaded settings.

> ⚠️ **On the stored passphrase:** it is stored **obfuscated and bound to the device**, not truly encrypted at rest — anyone with access to your local files could recover it (but they could already read your vault and credentials in that case). What it does guarantee: the passphrase **never reaches Drive**, so a leak of just the Drive folder cannot decrypt your settings. A settings file copied to another device won't carry a usable passphrase — you re-enter it there.

Trigger it manually with the command **"Sync plugin settings now"** or the button in the settings tab. It has its own live status line and log, just like the folder sync.

### 4. Get started

- **Manual:** ribbon icon (🔄), the command "Google Drive Mirror: Sync now", or click the status bar at the bottom.
- **Automatic:** with auto-sync enabled, local saves are uploaded after a short delay, and Drive is polled at the configured interval.
- **Status & log:** the status bar at the bottom shows live progress (`⏳ 3/12 …`, `✅`, `⚠️`). Via "Show log" in the settings you see the full, live-updating log.

> If you change the Drive folder or the sync scope, the internal sync history is reset automatically, so the next run reconciles cleanly (instead of deleting).

---

## Development

```bash
npm install
npm run dev      # esbuild in watch mode (inline sourcemap)
npm run build    # typecheck + production build -> main.js
npm test         # vitest (unit + integration)
```

Before any change to the sync logic: keep `npm test` green. The core logic (reconciler, deletion safety, folders) is test-covered.

Architecture:

| File                                         | Responsibility                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`src/main.ts`](src/main.ts)                 | Plugin entry point, commands, vault events, auto-sync timer, status bar                       |
| [`src/oauth.ts`](src/oauth.ts)               | OAuth loopback flow, token refresh against Google                                             |
| [`src/drive-client.ts`](src/drive-client.ts) | Google Drive REST API wrapper (list/upload/download/trash, folders, Shared Drives)            |
| [`src/sync-engine.ts`](src/sync-engine.ts)   | Orchestration, local hashing, execution of file and folder actions                            |
| [`src/reconciler.ts`](src/reconciler.ts)     | `reconcile()` (files) + `reconcileFolders()` (folders): diff, conflict and deletion decisions |
| [`src/sync-state.ts`](src/sync-state.ts)     | Persistent sync base (`local`/`remote` flags) in its own file                                 |
| [`src/sync-status.ts`](src/sync-status.ts)   | Live status + persistent log with retention                                                   |
| [`src/storage.ts`](src/storage.ts)           | Read/write JSON files in the plugin folder                                                    |
| [`src/settings-tab.ts`](src/settings-tab.ts) | Settings UI, log window                                                                       |
| [`src/suggesters.ts`](src/suggesters.ts)     | Autocomplete dropdowns for local and Drive folders                                            |
| [`src/logger.ts`](src/logger.ts)             | Central logger (debug logging optional)                                                       |

---

## Performance (large vaults)

Syncing thousands of files is optimized in three ways:

- **Hash cache:** unchanged files are not re-read or re-hashed. A file's MD5 is only recomputed when its size or modification time changed (like rsync). So the first sync is the slow one; every later sync mostly skips hashing.
- **Parallel transfers:** uploads and downloads run several at a time (bounded concurrency), which is dramatically faster than one-by-one over the network.
- **Automatic retry:** transient Google errors (rate limits, server hiccups) are retried with exponential backoff, so large runs don't fail on a single blip.

## Interrupting a sync

A sync can be interrupted at any time (closing Obsidian, a crash) — **without data loss**:

- Files already transferred are fully present on the other side (every upload is atomic, no half files are created).
- Progress is checkpointed **every 50 files**, plus once at the end. An interruption therefore costs at most the last few files of repeated work.
- The **next sync resumes** where it was interrupted, transferring only what's missing — files already present are recognized by content comparison and not transferred again.
- Thanks to the hash cache, the next run only re-reads files that actually changed, so re-checking a large vault after an interruption is fast.

## Known limitations / to-dos

- **Renames** are currently handled as delete + re-create (no rename tracking via the Drive ID). Works correctly, but generates unnecessary traffic.
- **Large files** are transferred via multipart upload in a single request (no resumable upload), and each file is read fully into RAM. For individual very large files (several hundred MB+) this is risky; for many small/medium files it's fine.
- **No delta/changes API:** Drive is polled via a full listing. For very large folders, the Drive Changes API (`changes.list` with `startPageToken`) would reduce the per-sync listing cost further. Deliberately not implemented yet — it requires caching the full remote state between runs, which is high-risk for a data-loss-sensitive plugin.
- **Conflict strategy** is fixed to "newer wins". A "keep both" option (conflict copy) could be added to the reconciler.

## License

MIT
