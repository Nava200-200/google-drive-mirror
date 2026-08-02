import { Notice, Platform, Plugin, TAbstractFile, normalizePath } from "obsidian";
import { GoogleDriveClient } from "./drive-client";
import { OAuthManager } from "./oauth";
import { SettingsTab } from "./settings-tab";
import { PluginStorage } from "./storage";
import { SyncEngine } from "./sync-engine";
import { SyncStateStore, isStateFile, stateFileName } from "./sync-state";
import { SyncStatus } from "./sync-status";
import {
  ConfigSyncStateStore,
  isConfigStateFile,
} from "./config-sync-state";
import {
  ConfigSyncEngine,
  ConflictChoice,
  DecryptError,
} from "./config-sync";
import { ConfigConflictModal } from "./config-conflict-modal";
import { obfuscatePassphrase, deobfuscatePassphrase } from "./crypto-box";
import {
  DEFAULT_SETTINGS,
  PluginSettings,
  SyncStateEntry,
  SyncTarget,
  newTarget,
} from "./types";
import { log, setDebugLogging } from "./logger";
import { initLocale, t } from "./i18n";
import { isIgnored, parseIgnorePatterns } from "./ignore";
import { GDOC_BLOCK_LANG, renderGdocBlock } from "./gdoc-embed";
import { InMemoryRemoteStore, RemoteStore } from "./remote-store";
import {
  IndexedDbRemoteStore,
  indexedDbAvailable,
  remoteDbName,
  REMOTE_DB_PREFIX,
} from "./remote-store-idb";

/** Engine + state store pair for a single sync target. */
interface TargetRuntime {
  engine: SyncEngine;
  state: SyncStateStore;
}

/** Config sync's own log file (separate from the note-sync `sync-log.json`). */
const CONFIG_LOG_FILE = "config-sync-log.json";

/**
 * Plugin entry point. Wires up OAuth, Drive client and one sync engine PER
 * configured target, plus the auto-sync triggers (local vault events + Drive
 * poll interval). All targets share the same OAuth account and status/log, but
 * keep independent sync bases (one `sync-state-<id>.json` each).
 */
export default class GoogleDriveSyncPlugin extends Plugin {
  settings!: PluginSettings;
  oauth!: OAuthManager;
  drive!: GoogleDriveClient;
  status!: SyncStatus;
  private storage!: PluginStorage;

  /** One engine + state store per target id. Rebuilt when targets change. */
  private runtimes = new Map<string, TargetRuntime>();
  /** True while a (multi-target) sync run is in progress. */
  private running = false;

  /** Config-sync engine + state (this plugin's own settings across devices). */
  private configEngine!: ConfigSyncEngine;
  private configState!: ConfigSyncStateStore;
  /** Live status + log for config sync (own file, shown in settings). */
  configStatus!: SyncStatus;
  /** True while a config-sync run is in progress (independent of `running`). */
  private configRunning = false;
  /**
   * In-memory config-sync passphrase for this session. NEVER persisted to disk
   * and NEVER uploaded — the user re-enters it per device (per app session).
   */
  private configPassphrase = "";

  private pollHandle: number | null = null;
  private debounceHandle: number | null = null;
  private statusBarEl: HTMLElement | null = null;
  /** Paths written by the sync itself — ignore their events. */
  private suppressedPaths = new Set<string>();

  async onload(): Promise<void> {
    // Couple the UI language to the Obsidian setting (fallback English).
    initLocale();
    await this.loadSettings();
    setDebugLogging(this.settings.debugLogging);

    this.oauth = new OAuthManager(this.settings);
    this.drive = new GoogleDriveClient(this.oauth);

    this.storage = new PluginStorage(this.app.vault, this.manifest.id);

    // Load log from its own file; retention duration from settings.
    this.status = new SyncStatus(
      this.storage,
      () => this.settings.logRetentionHours
    );
    await this.status.load();

    // Build one engine + state store per configured target.
    await this.rebuildRuntimes();

    // Config sync (this plugin's own settings across devices). One state store,
    // scoped to vault + config Drive folder; shares the OAuth account + client.
    // Its OWN status/log (separate file) so its progress + log show in settings
    // exactly like note sync, without mixing into the note-sync log.
    this.configStatus = new SyncStatus(
      this.storage,
      () => this.settings.logRetentionHours,
      CONFIG_LOG_FILE
    );
    await this.configStatus.load();
    this.configState = new ConfigSyncStateStore(this.storage, () =>
      this.configScopeId()
    );
    await this.configState.load();
    this.configEngine = new ConfigSyncEngine(
      this.app.vault,
      this.drive,
      this.oauth,
      this.configState,
      this.configStatus,
      this.manifest.id,
      () => this.settings,
      () => this.onConfigDownloaded(),
      () => this.saveSettings()
    );
    // Restore the obfuscated passphrase into memory so unattended sync works.
    await this.restoreConfigPassphrase();

    // Remove state files of targets that no longer exist (data hygiene).
    await this.cleanupOrphanStateFiles();
    // Remove orphan remote-store IndexedDB databases (from crashed runs / removed
    // targets). Best-effort; never blocks load.
    void this.cleanupOrphanRemoteDbs();

    this.addSettingTab(new SettingsTab(this.app, this));

    // Status bar: shows live progress of the sync.
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("gds-statusbar");
    this.statusBarEl.onClickEvent(() => void this.runSync(true));
    this.status.subscribe(() => this.renderStatusBar());
    this.renderStatusBar();

    // Ribbon icon for quick manual sync.
    this.addRibbonIcon("refresh-cw", t("ribbonSyncTooltip"), () => {
      void this.runSync(true);
    });

    // Commands.
    this.addCommand({
      id: "sync-now",
      name: t("commandSyncNow"),
      callback: () => void this.runSync(true),
    });
    this.addCommand({
      id: "login",
      name: t("commandLogin"),
      callback: () => void this.login(),
    });
    this.addCommand({
      id: "sync-config-now",
      name: t("configSyncCommandName"),
      callback: () => void this.runConfigSync(true),
    });

    // Renders `gdoc` fenced code blocks (inside .gdoc.md stub notes) as a live,
    // editable Google editor embed on desktop / an "open externally" button on
    // mobile. See gdoc-embed.ts.
    this.registerMarkdownCodeBlockProcessor(GDOC_BLOCK_LANG, (source, el) => {
      renderGdocBlock(el, source);
    });

    // Watch local changes (only relevant when auto-sync is active).
    this.registerEvent(
      this.app.vault.on("modify", (f) => this.onLocalChange(f))
    );
    this.registerEvent(
      this.app.vault.on("create", (f) => this.onLocalChange(f))
    );
    this.registerEvent(
      this.app.vault.on("delete", (f) => this.onLocalChange(f))
    );
    this.registerEvent(
      this.app.vault.on("rename", (f) => this.onLocalChange(f))
    );

    // Sync once at startup (fetches Drive changes), if configured.
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.autoSyncEnabled && this.oauth.isConfigured()) {
        void this.runSync(false);
      }
      this.reconfigureAutoSync();
    });
  }

  onunload(): void {
    this.clearTimers();
  }

  // ---------- Target runtimes ----------

  /**
   * (Re)builds the engine + state store for every configured target. Each state
   * store binds to its own file and its own scope id (target id + Drive folder +
   * local folder). Called on load and whenever the target list changes.
   */
  async rebuildRuntimes(): Promise<void> {
    // Preserve stores of targets that still exist so their in-memory base isn't
    // dropped needlessly (avoids a redundant reload) — but a scope change is
    // handled explicitly via resetTargetBase(), so a plain rebuild reuses them.
    const next = new Map<string, TargetRuntime>();
    for (const target of this.settings.targets) {
      const existing = this.runtimes.get(target.id);
      if (existing) {
        next.set(target.id, existing);
        continue;
      }
      const state = new SyncStateStore(
        this.storage,
        () => this.scopeId(target),
        stateFileName(target.id)
      );
      await state.load();
      const engine = new SyncEngine(
        this.app.vault,
        this.drive,
        state,
        target,
        this.status,
        this.app.fileManager,
        () => this.siblingLocalFolders(target.id),
        // Per-run transfer cap from settings: batching off → unlimited (one
        // pass); on → batchSize per run, resuming until caught up.
        () =>
          this.settings.batchEnabled ? this.settings.batchSize : Infinity,
        () => this.createRemoteStore(target.id)
      );
      next.set(target.id, { engine, state });
    }
    this.runtimes = next;
  }

  /**
   * Local folders (vault-relative) of all targets EXCEPT `exceptId`. A target
   * uses these to exclude other targets' scopes from its own sync — so a
   * subfolder owned by one target is never mirrored into a second Drive by a
   * whole-vault target. Empty local folders (whole-vault targets) contribute
   * nothing, as there is no specific subfolder to exclude.
   */
  /**
   * Creates the per-run remote-listing store for a target. On mobile this is an
   * IndexedDB-backed store so the (potentially huge) Drive listing lives OUTSIDE
   * the JS heap — the reconcile-time OOM guard. On desktop an in-memory store is
   * fine (no memory pressure) and avoids IndexedDB entirely. A unique DB name
   * per target keeps concurrent-nothing clean; the store is cleared/disposed by
   * the engine each run.
   */
  private async createRemoteStore(targetId: string): Promise<RemoteStore> {
    // Use IndexedDB whenever it's available (desktop AND mobile). On mobile it's
    // the reconcile-time OOM guard (the large listing lives outside the JS
    // heap); on desktop it's not strictly needed but keeps ONE code path and
    // lets the DB be inspected in DevTools (Application → IndexedDB →
    // gds-remote-<id>). Falls back to in-memory only if IndexedDB is absent.
    if (indexedDbAvailable()) {
      try {
        // ONE deterministic DB name per target. sync() calls store.clear() at
        // run start, so reusing the same DB across runs is safe and avoids the
        // orphan-DB accumulation a per-run name caused (a crashed run never
        // disposes → leaks). runSync is serialized (this.running), so no two
        // runs for a target open it concurrently. open() also deletes any stale
        // DB of the SAME name first to avoid reopening a half-torn-down one.
        const name = remoteDbName(targetId);
        const store = await IndexedDbRemoteStore.open(name);
        log.info(`Remote store: IndexedDB (${name})`);
        return store;
      } catch (e) {
        log.warn("IndexedDB nicht verfügbar, nutze In-Memory-Store:", e);
      }
    }
    log.info("Remote store: in-memory (IndexedDB unavailable)");
    return new InMemoryRemoteStore();
  }

  private siblingLocalFolders(exceptId: string): string[] {
    return this.settings.targets
      .filter((tg) => tg.id !== exceptId && tg.localFolder.trim() !== "")
      .map((tg) => tg.localFolder.trim());
  }

  /**
   * Deletes `sync-state-*.json` files that don't belong to a current target,
   * and any leftover `sync-fetch-*.jsonl` temp spill files (always transient —
   * a run removes its own in a finally; a hard crash mid-fetch could leave one).
   */
  private async cleanupOrphanStateFiles(): Promise<void> {
    const valid = new Set(
      this.settings.targets.map((tg) => stateFileName(tg.id))
    );
    const files = await this.storage.listFileNames();
    for (const name of files) {
      // Never sweep the config-sync state file (not a per-target state file).
      if (isConfigStateFile(name)) continue;
      if (isStateFile(name) && !valid.has(name)) {
        await this.storage.remove(name);
        log.info("Verwaiste Sync-State-Datei entfernt:", name);
      } else if (name.startsWith("sync-fetch-") && name.endsWith(".jsonl")) {
        // Temp fetch-spill file; never meant to persist across loads.
        await this.storage.remove(name);
        log.info("Verwaiste Fetch-Spill-Datei entfernt:", name);
      }
    }
  }

  /**
   * Deletes orphan remote-store IndexedDB databases: any `gds-remote-*` DB whose
   * target no longer exists, plus (defensively) the current targets' DBs at load
   * time — they only hold a transient per-run listing that sync() clears/rebuilds
   * anyway, so clearing stale content from a crashed run is safe and frees space.
   * Best-effort; skipped silently if the runtime can't enumerate databases.
   */
  private async cleanupOrphanRemoteDbs(): Promise<void> {
    if (!indexedDbAvailable()) return;
    try {
      const names = await IndexedDbRemoteStore.listDatabaseNames();
      if (!names) return; // enumeration unsupported (old iOS) — leave as-is
      const active = new Set(
        this.settings.targets.map((tg) => remoteDbName(tg.id))
      );
      for (const name of names) {
        if (name.startsWith(REMOTE_DB_PREFIX) && !active.has(name)) {
          await IndexedDbRemoteStore.deleteDatabase(name);
          log.info("Verwaiste Remote-Store-DB entfernt:", name);
        }
      }
    } catch (e) {
      log.warn("Remote-Store-DB-Cleanup fehlgeschlagen:", e);
    }
  }

  // ---------- Sync triggers ----------

  /**
   * Manual/explicit sync. Runs every configured target SEQUENTIALLY (parallel
   * targets would fight over event suppression and Drive rate limits). The
   * shared `running` flag serializes overlapping calls.
   */
  async runSync(showNotice: boolean): Promise<void> {
    if (this.running) {
      if (showNotice) new Notice(t("noticeSyncAlreadyRunning"));
      return;
    }
    if (!this.oauth.isConfigured()) {
      if (showNotice) new Notice(t("noticeSignInFirst"));
      return;
    }
    const targets = this.settings.targets.filter((tg) => tg.driveFolderId);
    if (targets.length === 0) {
      if (showNotice) new Notice(t("noticeNoTargets"));
      return;
    }

    this.running = true;
    // Lightweight ticker so the elapsed time keeps updating even without new events.
    const ticker = window.setInterval(() => this.status.touch(), 1000);
    // Capture async failures that escape the engine's own try/catch (unhandled
    // rejections / global errors) during a run — logged (debug) rather than
    // lost. (A true OOM process-kill is NOT a JS error and cannot be caught
    // anywhere; this surfaces everything that IS a catchable error.)
    const stopDiag = this.installRunDiagnostics();
    log.debug(`run start — targets=${targets.length}`);
    try {
      await this.withSuppressedEvents(async () => {
        for (const target of targets) {
          const rt = this.runtimes.get(target.id);
          if (!rt) continue;
          // A single engine.sync() may process only a batch of the pending
          // actions (mobile per-run cap, to keep peak memory under the iOS
          // WebView limit). Re-run the same target until it reports no more
          // remaining work. A short yield between passes lets the WebView
          // reclaim memory from the finished batch before the next one. The
          // pass count is bounded as a safety net against an unexpected loop.
          const MAX_PASSES = 1000;
          for (let pass = 0; pass < MAX_PASSES; pass++) {
            const summary = await rt.engine.sync(showNotice);
            if (!summary?.moreRemaining) break;
            // Yield so the just-finished batch's memory can be collected.
            await sleep(250);
          }
        }
      });
    } catch (e) {
      // Anything the engine didn't catch lands here — surface it instead of
      // failing silently: error status + notice + console error.
      this.status.finish("error", t("engineNoticePrefix", { message: errString(e) }));
      if (showNotice) {
        new Notice(t("engineNoticePrefix", { message: errString(e) }), 15000);
      }
      log.error("runSync failed", e);
    } finally {
      this.running = false;
      window.clearInterval(ticker);
      stopDiag();
      log.debug("run end");
      // The final status emit (finish()) fired while `running` was still true,
      // so subscribers that gate on isSyncing() (sync button, status bar) saw
      // the stale value. Notify once more now that the flag has cleared, so the
      // button re-enables and the status bar settles on the final state.
      this.status.notify();
    }
  }

  // ---------- Config sync (this plugin's own settings) ----------

  /** Scope identity for the config-sync base (vault + config Drive folder). */
  private configScopeId(): string {
    const vault = this.app.vault.getName();
    const drive = this.settings.configDriveFolderId || "-";
    return `${vault}::config::${drive}`;
  }

  /**
   * Device-stable key for obfuscating the stored passphrase. Bound to the vault
   * + plugin id + a fixed app salt, so a data.json copied to another device
   * won't de-obfuscate (reads as "no passphrase set" there).
   */
  private deviceKey(): string {
    return `${this.app.vault.getName()}::${this.manifest.id}::gds-cfg-obf-v1`;
  }

  /** Session passphrase accessors (used by the settings UI). */
  hasConfigPassphrase(): boolean {
    return this.configPassphrase.length > 0;
  }

  /**
   * Sets the in-memory passphrase AND persists it obfuscated (device-local), so
   * unattended/auto config sync works without re-prompting after a restart.
   */
  async setConfigPassphrase(pass: string): Promise<void> {
    this.configPassphrase = pass;
    this.settings.configPassphraseObf = pass
      ? await obfuscatePassphrase(pass, this.deviceKey())
      : "";
    await this.saveSettings();
  }

  /**
   * Restores the passphrase into memory from its obfuscated device-local form on
   * load. If it can't be decoded here (copied device), treat as no passphrase.
   */
  private async restoreConfigPassphrase(): Promise<void> {
    const stored = this.settings.configPassphraseObf;
    if (!stored) return;
    const pass = await deobfuscatePassphrase(stored, this.deviceKey());
    this.configPassphrase = pass ?? "";
  }

  isConfigSyncing(): boolean {
    return this.configRunning;
  }

  /** Exposes the config engine so the settings UI can establish a passphrase. */
  get configSync(): ConfigSyncEngine {
    return this.configEngine;
  }

  /**
   * Manual config sync: uploads/downloads THIS plugin's own settings so devices
   * share the same targets/options. Separate from `runSync` (own `configRunning`
   * flag) — the two never block each other. The only deletion it performs is
   * trashing the Drive copy of a plugin the user DESELECTED (scoped to files
   * this device previously synced); it never deletes local files.
   */
  async runConfigSync(showNotice: boolean): Promise<void> {
    if (this.configRunning) {
      if (showNotice) new Notice(t("configSyncAlreadyRunning"));
      return;
    }
    if (!this.settings.configSyncEnabled) return;
    if (!this.oauth.isConfigured()) {
      if (showNotice) new Notice(t("noticeSignInFirst"));
      return;
    }
    if (!this.settings.configDriveFolderId) {
      if (showNotice) new Notice(t("configSyncPassphraseNeeded"));
      return;
    }
    if (!this.hasConfigPassphrase()) {
      if (showNotice) new Notice(t("configSyncPassphraseNeeded"));
      return;
    }

    this.configRunning = true;
    if (showNotice) new Notice(t("configSyncRunning"));
    // Ticker so the elapsed duration in the settings status line keeps updating.
    const ticker = window.setInterval(() => this.configStatus.touch(), 1000);
    try {
      const outcome = await this.configEngine.sync(
        this.configPassphrase,
        (localMtime, remoteMtime) =>
          this.askConfigConflict(localMtime, remoteMtime)
      );
      // A stored-passphrase MISMATCH is surfaced even during an unattended run
      // (showNotice=false), so a stale stored passphrase doesn't fail silently.
      if (outcome.kind === "skipped" && outcome.mismatch) {
        new Notice(t("configSyncDecryptFailed"), 15000);
        return;
      }
      if (!showNotice) return;
      switch (outcome.kind) {
        case "uploaded":
          new Notice(t("configSyncUploaded"));
          break;
        case "downloaded":
          new Notice(t("configSyncDownloaded"));
          break;
        case "changed":
          new Notice(
            t("configSyncChanged", {
              up: outcome.uploaded,
              down: outcome.downloaded,
              del: outcome.deleted,
            })
          );
          break;
        case "noop":
          new Notice(t("configSyncNoop"));
          break;
        case "conflict":
          // User cancelled the conflict modal — nothing changed.
          break;
        case "skipped":
          new Notice(t("configSyncSkipped", { reason: outcome.reason }));
          break;
      }
    } catch (e) {
      // A wrong/incompatible passphrase against already-encrypted Drive data
      // gets a specific, actionable message; anything else is generic.
      if (e instanceof DecryptError) {
        log.error("config sync: decrypt failed (passphrase mismatch)", e);
        if (showNotice) new Notice(t("configSyncDecryptFailed"), 15000);
      } else {
        log.error("config sync failed", e);
        if (showNotice) {
          new Notice(t("configSyncFailed", { error: errString(e) }), 15000);
        }
      }
    } finally {
      this.configRunning = false;
      window.clearInterval(ticker);
      // Re-notify once the flag has cleared so the settings button re-enables.
      this.configStatus.notify();
    }
  }

  /** Opens the conflict modal and resolves with the user's choice. */
  private askConfigConflict(
    localMtime: number,
    remoteMtime: number
  ): Promise<ConflictChoice | undefined> {
    return new Promise((resolve) => {
      new ConfigConflictModal(
        this.app,
        localMtime,
        remoteMtime,
        resolve
      ).open();
    });
  }

  /**
   * Called by the config engine right after it writes a downloaded data.json.
   * Re-loads settings and rebuilds runtimes so the new targets/options take
   * effect live, and re-points OAuth at the fresh settings object (credentials
   * may have changed). Ordering matters (self-write hazard): loadSettings() runs
   * BEFORE any subsequent saveSettings() can clobber the just-written file.
   */
  private async onConfigDownloaded(): Promise<void> {
    await this.loadSettings();
    this.oauth.setSettings(this.settings);
    setDebugLogging(this.settings.debugLogging);
    await this.rebuildRuntimes();
    this.reconfigureAutoSync();
  }

  /**
   * While a sync runs, route global unhandled errors / promise rejections into
   * the PERSISTENT sync log (immediately flushed) so a failure that tears down
   * the mobile WebView is still readable afterwards. Returns a cleanup fn.
   */
  private installRunDiagnostics(): () => void {
    const onRejection = (ev: PromiseRejectionEvent) => {
      log.error("unhandledrejection during sync:", errString(ev.reason));
    };
    const onError = (ev: ErrorEvent) => {
      log.error(
        `window error during sync: ${ev.message} @ ${ev.filename}:${ev.lineno}`
      );
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }

  /** Is a sync currently running? (for the UI). */
  isSyncing(): boolean {
    return this.running;
  }

  /** Updates the status bar based on the current sync status. */
  private renderStatusBar(): void {
    if (!this.statusBarEl) return;
    const p = this.status.getProgress();
    let icon = "🔄";
    let text = t("statusBarReady");
    switch (p.phase) {
      case "running": {
        icon = "⏳";
        // The message already carries the "(done/total)" count at its start (the
        // engine builds it via describeAction), so we do NOT render the count a
        // second time here — that produced the duplicate "(x/y) … (x/y)".
        text = t("statusBarRunning", { message: p.message });
        break;
      }
      case "done":
        icon = "✅";
        text = t("statusBarDone", { message: p.message });
        break;
      case "error":
        icon = "⚠️";
        text = t("statusBarError", { message: p.message });
        break;
    }
    this.statusBarEl.setText(`${icon} ${text}`);
    this.statusBarEl.title = t("statusBarTooltip");
  }

  /** Reacts to local vault changes (debounced upload sync). */
  private onLocalChange(file: TAbstractFile): void {
    if (!this.settings.autoSyncEnabled) return;
    if (!this.oauth.isConfigured()) return;
    // TAbstractFile (file OR folder) always has a path; anything without a path
    // is not a sync-relevant object. The actual scope filtering is done by
    // isInScope() further below (folders may trigger a sync).
    if (!file || !file.path) return;
    if (this.suppressedPaths.has(file.path)) return;
    if (!this.isInScope(file.path)) return;

    if (this.debounceHandle !== null) window.clearTimeout(this.debounceHandle);
    this.debounceHandle = window.setTimeout(() => {
      this.debounceHandle = null;
      void this.runSync(false);
    }, this.settings.localDebounceMs);
  }

  /** (Re-)configures the Drive poll timer according to the settings. */
  reconfigureAutoSync(): void {
    if (this.pollHandle !== null) {
      window.clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    if (!this.settings.autoSyncEnabled) return;

    const intervalMs = Math.max(15, this.settings.pollIntervalSeconds) * 1000;
    this.pollHandle = window.setInterval(() => {
      if (this.oauth.isConfigured() && !this.running) {
        void this.runSync(false);
      }
    }, intervalMs);
    this.registerInterval(this.pollHandle);
  }

  /**
   * Interactive Google login (DESKTOP only — uses the loopback redirect flow).
   * On mobile there is no way to receive the redirect; mobile users import a
   * refresh token exported from desktop instead (see importRefreshToken).
   */
  async login(): Promise<void> {
    await this.oauth.openLogin((url) => openExternal(url));
    await this.saveSettings();
    log.info(
      "Login finished, refreshToken set:",
      Boolean(this.settings.refreshToken)
    );
    new Notice(t("noticeLoginSuccess"));
  }

  /** The current refresh token, for copying to another device (may be ""). */
  exportRefreshToken(): string {
    return this.oauth.exportRefreshToken();
  }

  /**
   * Signs in on this device using a refresh token exported from a signed-in
   * desktop. Verifies it against Google, then persists. Throws if invalid.
   */
  async importRefreshToken(token: string): Promise<void> {
    await this.oauth.importRefreshToken(token);
    await this.saveSettings();
    log.info("Refresh token imported, signed in.");
    new Notice(t("noticeLoginSuccess"));
  }

  // ---------- Target management (from the settings UI) ----------

  /** All configured targets. */
  getTargets(): SyncTarget[] {
    return this.settings.targets;
  }

  /** Adds a new empty target, persists and rebuilds the runtimes. */
  async addTarget(): Promise<SyncTarget> {
    const id = generateTargetId();
    const name = t("targetDefaultName", {
      index: this.settings.targets.length + 1,
    });
    const target = newTarget(id, name);
    this.settings.targets.push(target);
    await this.saveSettings();
    await this.rebuildRuntimes();
    return target;
  }

  /**
   * Removes a target: drops its runtime, deletes its state file and persists.
   * The files themselves are untouched (only the sync base is discarded).
   */
  async removeTarget(id: string): Promise<void> {
    const rt = this.runtimes.get(id);
    if (rt) {
      await rt.state.destroy();
      this.runtimes.delete(id);
    }
    this.settings.targets = this.settings.targets.filter((tg) => tg.id !== id);
    await this.saveSettings();
    await this.rebuildRuntimes();
  }

  /** Persists after a target field changed (no scope reset). */
  async updateTarget(id: string, patch: Partial<SyncTarget>): Promise<void> {
    const target = this.settings.targets.find((tg) => tg.id === id);
    if (!target) return;
    Object.assign(target, patch);
    await this.saveSettings();
  }

  /**
   * Sets the Drive root folder for a target. If the folder ID changes, the
   * target's sync base is reset — otherwise the reconciler would compare the
   * files of the NEW folder against the base of the OLD folder.
   */
  async setDriveFolderForTarget(
    id: string,
    driveId: string,
    name: string,
    sharedId: string
  ): Promise<void> {
    const target = this.settings.targets.find((tg) => tg.id === id);
    if (!target) return;
    const changed = target.driveFolderId !== driveId;
    target.driveFolderId = driveId;
    target.driveFolderName = name;
    target.driveSharedId = sharedId;
    await this.saveSettings();
    if (changed) {
      await this.resetTargetBase(id);
      log.debug("Drive-Ordner gewechselt -> Sync-Base zurückgesetzt.");
    }
  }

  /**
   * Sets the local sync folder for a target ("" = whole vault). If the scope
   * changes, the target's sync base is reset (analogous to the Drive folder).
   *
   * Only ONE target may sync the whole vault (`folder === ""`) — otherwise the
   * same files would be mirrored into two Drives (whole-vault targets don't
   * exclude each other, since neither owns a specific subfolder). Setting a
   * second target to whole-vault is refused and returns false.
   */
  async setLocalFolderForTarget(id: string, folder: string): Promise<boolean> {
    const target = this.settings.targets.find((tg) => tg.id === id);
    if (!target) return false;
    // Guard: reject a second whole-vault target.
    if (folder === "") {
      const other = this.wholeVaultTargetId();
      if (other && other !== id) return false;
    }
    const changed = target.localFolder !== folder;
    target.localFolder = folder;
    await this.saveSettings();
    if (changed) {
      await this.resetTargetBase(id);
      log.debug("Lokaler Scope gewechselt -> Sync-Base zurückgesetzt.");
    }
    return true;
  }

  /**
   * Id of the target that syncs the whole vault (`localFolder === ""` with a
   * Drive folder configured), or null. Used to enforce "only one whole-vault
   * target" in the settings UI.
   */
  wholeVaultTargetId(): string | null {
    const target = this.settings.targets.find(
      (tg) => tg.localFolder.trim() === ""
    );
    return target ? target.id : null;
  }

  /** Clears the sync history of one target (not the files) and persists. */
  async resetTargetBase(id: string): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    rt.state.clear();
    await rt.state.save();
  }

  /** Clears the sync history of ALL targets. */
  async resetAllBases(): Promise<void> {
    for (const rt of this.runtimes.values()) {
      rt.state.clear();
      await rt.state.save();
    }
  }

  /** Most recent successful sync across all targets (ms; 0 = never). */
  getLastSyncMs(): number {
    let max = 0;
    for (const rt of this.runtimes.values()) {
      max = Math.max(max, rt.state.getLastSyncMs());
    }
    return max;
  }

  /** Sync-state entries of one target (for its sync tree in the settings). */
  getSyncEntries(id: string): SyncStateEntry[] {
    return this.runtimes.get(id)?.state.all() ?? [];
  }

  /**
   * Marks a "Drive-only" entry (file OR folder) of a target for restoration:
   * removes the keptRemoteOnly flag so it is downloaded/created locally on the
   * next sync. Persists immediately.
   */
  async restoreRemoteOnly(id: string, path: string): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    const entry = rt.state.get(path);
    if (!entry || !entry.keptRemoteOnly) return;
    rt.state.set({ ...entry, keptRemoteOnly: false });
    await rt.state.save();
  }

  /**
   * Unique identity of vault + Drive folder + local scope for a target. Binds
   * the sync base to exactly this combination, so a base copied from another
   * vault is detected and discarded. The target id keeps the scope unique even
   * if two targets happen to share the same Drive/local folder.
   */
  private scopeId(target: SyncTarget): string {
    const vault = this.app.vault.getName();
    const drive = target.driveFolderId || "-";
    const local = target.localFolder || "<vault>";
    return `${vault}::${target.id}::${drive}::${local}`;
  }

  // ---------- Event suppression during sync writes ----------

  /**
   * While the sync itself writes files, the modify/create/delete events it
   * triggers must not start another sync. We briefly mark all paths currently
   * in scope as suppressed.
   */
  private async withSuppressedEvents(fn: () => Promise<void>): Promise<void> {
    // Coarse but robust strategy: ignore all scope paths during the run;
    // release them again after a short delay. Enumerate via the adapter (not
    // vault.getFiles(), which omits unrecognized extensions like .heic) so those
    // files' events are suppressed too — otherwise the engine writing them mid-
    // run could re-trigger auto-sync.
    const snapshot = (await this.listAllFiles()).filter((p) =>
      this.isInScope(p)
    );
    snapshot.forEach((p) => this.suppressedPaths.add(p));
    try {
      await fn();
    } finally {
      // Delayed release so trailing events are still filtered.
      window.setTimeout(() => this.suppressedPaths.clear(), 1500);
    }
  }

  /**
   * All file paths in the vault via the filesystem adapter (sees every file,
   * including extensions Obsidian's getFiles() ignores). Prunes vault-root
   * dot-folders (config dir, `.trash`, `.smart-env`, …) at the folder level, so
   * hidden plugin/cache folders are never suppressed/collected. Best-effort —
   * errors skip that folder.
   */
  private async listAllFiles(): Promise<string[]> {
    const out: string[] = [];
    const queue: string[] = [""];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      let listing: { files: string[]; folders: string[] };
      try {
        listing = await this.app.vault.adapter.list(current);
      } catch {
        continue;
      }
      out.push(...listing.files);
      for (const sub of listing.folders) {
        const s = sub.startsWith("/") ? sub.slice(1) : sub;
        // Skip any vault-root dot-folder (first path segment starts with ".").
        if (s.split("/")[0].startsWith(".")) continue;
        queue.push(sub);
      }
    }
    return out;
  }

  /**
   * Does the vault path fall into ANY configured target's scope (and is not
   * ignored/excluded there)? Used to decide whether a local change should
   * trigger an auto-sync.
   */
  private isInScope(vaultPath: string): boolean {
    // Never sync system folders (especially for the whole vault). The config
    // folder is not necessarily ".obsidian" — use Vault#configDir. Also exclude
    // any vault-root dot-folder (.smart-env, .git, .trash, …): Obsidian hides
    // those and they must never trigger an auto-sync or be uploaded.
    const p = vaultPath.startsWith("/") ? vaultPath.slice(1) : vaultPath;
    if (p.split("/")[0].startsWith(".")) return false;
    const cfg = this.app.vault.configDir.replace(/^\.\//, "").replace(/\/+$/, "");
    if (p === cfg || p.startsWith(`${cfg}/`)) return false;

    return this.settings.targets.some((target) =>
      this.inTargetScope(target, vaultPath, p)
    );
  }

  /** Scope check for a single target (folder prefix + ignore + exclude). */
  private inTargetScope(
    target: SyncTarget,
    vaultPath: string,
    stripped: string
  ): boolean {
    const f = target.localFolder.trim();
    let rel = stripped;
    if (f) {
      const norm = normalizePath(f);
      const prefix = norm + "/";
      if (vaultPath !== norm && !vaultPath.startsWith(prefix)) return false;
      rel = vaultPath === norm ? "" : vaultPath.slice(prefix.length);
    }
    if (!rel) return true;

    // Ignore patterns (blacklist) on the sync-relative path.
    const patterns = parseIgnorePatterns(target.ignorePatterns);
    if (isIgnored(rel, patterns)) return false;

    // Excluded folders: other targets' scopes + this target's excludeFolders.
    for (const ex of this.excludeFoldersFor(target)) {
      if (rel === ex || rel.startsWith(ex + "/")) return false;
    }
    return true;
  }

  /**
   * Sync-relative excluded folder prefixes for a target (siblings' local
   * folders + user excludeFolders), mirroring the engine's computeExcludeFolders
   * for the auto-sync scope check. For a whole-vault target the prefix is empty,
   * so sibling folders map 1:1.
   */
  private excludeFoldersFor(target: SyncTarget): string[] {
    const result = new Set<string>();
    const f = target.localFolder.trim();
    const prefix = f ? normalizePath(f) + "/" : "";

    for (const sib of this.siblingLocalFolders(target.id)) {
      const norm = normalizePath(sib);
      if (!prefix) {
        result.add(norm);
      } else if (norm === prefix.slice(0, -1) || norm.startsWith(prefix)) {
        const rel = norm.slice(prefix.length);
        if (rel) result.add(rel);
      }
    }
    for (const raw of target.excludeFolders.split(",")) {
      const norm = normalizePath(raw.trim());
      if (norm) result.add(norm);
    }
    return [...result];
  }

  private clearTimers(): void {
    if (this.pollHandle !== null) window.clearInterval(this.pollHandle);
    if (this.debounceHandle !== null) window.clearTimeout(this.debounceHandle);
    this.pollHandle = null;
    this.debounceHandle = null;
  }

  // ---------- Persistence ----------

  /**
   * Loads the settings from data.json. Legacy single-target fields (from
   * versions before the multi-target model) are dropped — the user reconfigures
   * targets; the reconciler's deletion safety means a fresh base never deletes.
   */
  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as RawData | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
    // Ensure `targets` is always an array (older data.json has no such field).
    if (!Array.isArray(this.settings.targets)) this.settings.targets = [];
    // Strip legacy fields so they don't get written back into data.json.
    stripLegacyFields(this.settings as unknown as Record<string, unknown>);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

/**
 * Opens an external URL in the system browser. Used only by the DESKTOP login
 * flow (mobile doesn't sign in interactively). On desktop `window.open(url,
 * "_blank")` routes to the OS browser via Electron, so the loopback redirect
 * lands in the real browser.
 */
function openExternal(url: string): void {
  window.open(url, "_blank");
}

/** Generates a short, collision-resistant target id (no crypto dependency). */
function generateTargetId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${time}${rand}`;
}

/** Resolves after `ms` milliseconds (used to yield between sync batches). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Best-effort string form of an unknown thrown value, including a stack. */
function errString(e: unknown): string {
  if (e instanceof Error) {
    return e.stack ? `${e.message}\n${e.stack}` : e.message;
  }
  try {
    return String(e);
  } catch {
    return "<unstringifiable error>";
  }
}

/** Removes fields from earlier plugin versions that no longer belong here. */
function stripLegacyFields(obj: Record<string, unknown>): void {
  for (const key of [
    "driveFolderId",
    "driveFolderName",
    "driveSharedId",
    "localFolder",
    "allowedExtensions",
    "ignorePatterns",
    "neverDeleteRemote",
    "syncState",
    "lastSyncMs",
    // Removed feature (keep-device-awake / Screen Wake Lock, reverted in 0.1.28).
    // Strip it so a lingering value from 0.1.24–0.1.27 doesn't sit in data.json.
    "preventSleepDuringSync",
  ]) {
    delete obj[key];
  }
}

/** Raw form of data.json including any old, migrated fields. */
interface RawData extends Partial<PluginSettings> {
  syncState?: Record<string, SyncStateEntry>;
  lastSyncMs?: number;
}
