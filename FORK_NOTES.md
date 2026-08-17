# Fork Notes — Nava200-200/google-drive-mirror

This repository is a personal fork of [platers/google-drive-mirror](https://github.com/platers/google-drive-mirror).

## Branch Structure

| Branch | Purpose |
|---|---|
| `main` | Fork base — contains the **large file stubbing** feature (`stubLargeFiles`). Tracks upstream loosely. |
| `feature/config-sync-ui-overhaul` | **This branch.** Adds `.obsidian` config sync overhaul: root settings files, redesigned sync-tree UI, plugin exclusion management. |

## Features Added Over Upstream

### On `main`
- **Large File Stubbing** (`stubLargeFiles` target setting): Files > 10 MB are not downloaded. Instead, a lightweight `.gfile.md` stub is created with a link to the Google Drive preview. Prevents vault bloat from PDFs, EPUBs, etc.

### On `feature/config-sync-ui-overhaul`
- **Root `.obsidian` settings sync**: Sync `app.json`, `appearance.json`, `hotkeys.json`, etc. across devices (opt-in checklist).
- **Redesigned Config tab**: File-tree UI (mirrors the vault sync tree) for selecting what to sync — plugins, root settings, themes, snippets.
- **Plugin exclusion list**: Instead of a raw ID list, toggle plugins in/out of sync from a visual list. Excluded plugins are never uploaded.
- **Stale ID cleanup**: Removed phantom plugin IDs (`gdocs`, `google-sync`) from defaults.

## Setup on a New Device

1. **Clone this repo** into `.obsidian/plugins/google-drive-mirror/`:
   ```
   git clone https://github.com/Nava200-200/google-drive-mirror .obsidian/plugins/google-drive-mirror
   git checkout feature/config-sync-ui-overhaul
   ```
2. **Build**: `npm install && npm run build`
3. **Enable** the plugin in Obsidian Settings → Community Plugins.
4. **Authenticate**: Settings → Google Drive Mirror → Account → Sign in.
5. **Config sync**: Settings → Google Drive Mirror → Config → set passphrase → Sync settings now.
   - All plugin settings and selected root config files will pull from Drive automatically.

## Device-Local Values (Never Sync These)

The following are intentionally excluded from config sync — they are per-device:

| Setting | Why device-local |
|---|---|
| `targets[].excludeFolders` | Local folder paths differ per machine |
| `workspace.json` | Open tabs, pane layout — per screen/device |
| `workspace-mobile.json` | Mobile layout |
| `workspaces.json` | Named workspace snapshots |
| OAuth tokens (`refreshToken`, `clientSecret`) | Sensitive credentials |

## Merging Upstream Changes

```bash
git fetch upstream
git checkout main
git merge upstream/main
# resolve conflicts if any, then:
git checkout feature/config-sync-ui-overhaul
git merge main
```
