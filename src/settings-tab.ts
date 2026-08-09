import {
  App,
  ButtonComponent,
  Modal,
  Notice,
  Platform,
  PluginSettingTab,
  Setting,
  normalizePath,
} from "obsidian";
import type GoogleDriveSyncPlugin from "./main";
import { DriveFolderSuggest, LocalFolderSuggest } from "./suggesters";
import { log, setDebugLogging } from "./logger";
import { t } from "./i18n";
import { isFilteredByTargetSettings } from "./ignore";
import { discoverPaths } from "./config-paths";
import { CONFIG_SYNC_DEVICE_LOCAL_KEYS } from "./types";
import type { PluginSettings, SyncStateEntry, SyncTarget } from "./types";
import type { SyncStatus } from "./sync-status";

/**
 * Settings UI: OAuth setup (your own Google Cloud app), folder selection,
 * auto-sync options.
 *
 * Note: In the `.addText/.addToggle` callbacks the component is named `c`
 * (not `t`), so it doesn't shadow the imported translation function `t()`.
 */
export class SettingsTab extends PluginSettingTab {
  private unsubscribe: (() => void) | null = null;
  private statusEl: HTMLElement | null = null;
  private syncButton: ButtonComponent | null = null;
  /** Config-sync live status line + its subscription + its sync button. */
  private configStatusEl: HTMLElement | null = null;
  private configUnsubscribe: (() => void) | null = null;
  private configSyncButton: ButtonComponent | null = null;
  /** Per-target stable tree containers, so each can be refilled without a full re-render. */
  private treeEls = new Map<string, HTMLElement>();
  /** Per-target description lines of the sync tree (for the "Drive-only" counter). */
  private treeDescSettings = new Map<string, Setting>();
  /** Per-target sync-tree filter query (lowercased, "" = no filter). */
  private treeFilters = new Map<string, string>();
  /** Target ids currently switching from "whole vault" to folder selection. */
  private pendingSubfolder = new Set<string>();

  constructor(app: App, private plugin: GoogleDriveSyncPlugin) {
    super(app, plugin);
  }

  hide(): void {
    // Release the subscription when the tab closes.
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.configUnsubscribe?.();
    this.configUnsubscribe = null;
    this.configStatusEl = null;
    this.configSyncButton = null;
    this.statusEl = null;
    this.treeEls.clear();
    this.treeDescSettings.clear();
    this.treeFilters.clear();
    this.pendingSubfolder.clear();
  }

  /**
   * The settings page is split into TABS (the flat page grew too long). Each tab
   * renders one section into a shared body container. `activeTab` persists across
   * re-renders within a session; default is "actions".
   */
  private static readonly TABS = [
    "account",
    "targets",
    "autosync",
    "config",
    "actions",
  ] as const;
  private activeTab: (typeof SettingsTab.TABS)[number] = "actions";

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    // Release the previous subscriptions (display can run multiple times).
    this.unsubscribe?.();
    this.configUnsubscribe?.();
    // The DOM is rebuilt below; drop stale per-target tree references.
    this.treeEls.clear();
    this.treeDescSettings.clear();

    new Setting(containerEl).setName(t("settingsTitle")).setHeading();

    // Tab bar.
    const tabBar = containerEl.createDiv({ cls: "gds-tab-bar" });
    const tabLabel: Record<(typeof SettingsTab.TABS)[number], string> = {
      account: t("tabAccount"),
      targets: t("tabTargets"),
      autosync: t("tabAutoSync"),
      config: t("tabConfigSync"),
      actions: t("tabActions"),
    };
    for (const tab of SettingsTab.TABS) {
      const btn = tabBar.createEl("button", {
        cls: "gds-tab" + (tab === this.activeTab ? " is-active" : ""),
        text: tabLabel[tab],
      });
      btn.onclick = () => {
        if (this.activeTab === tab) return;
        this.activeTab = tab;
        this.display();
      };
    }

    // Body for the active tab.
    const body = containerEl.createDiv({ cls: "gds-tab-body" });
    switch (this.activeTab) {
      case "account":
        this.renderAccountTab(body);
        break;
      case "targets":
        this.renderTargetsTab(body);
        break;
      case "autosync":
        this.renderAutoSyncTab(body);
        break;
      case "config":
        this.renderConfigSync(body, this.plugin.settings);
        break;
      case "actions":
        this.renderActionsTab(body);
        break;
    }
  }

  /** Account / Google Cloud app tab. */
  private renderAccountTab(containerEl: HTMLElement): void {
    const s = this.plugin.settings;

    // ---- 1. Google Cloud app ----
    new Setting(containerEl).setName(t("headingCloudAccess")).setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t("cloudHelp"),
    });

    new Setting(containerEl)
      .setName(t("clientIdName"))
      .setDesc(t("clientIdDesc"))
      .addText((c) =>
        c
          .setPlaceholder("....apps.googleusercontent.com")
          .setValue(s.clientId)
          .onChange(async (v) => {
            s.clientId = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t("clientSecretName"))
      .setDesc(t("clientSecretDesc"))
      .addText((c) => {
        c.inputEl.type = "password";
        c.setValue(s.clientSecret).onChange(async (v) => {
          s.clientSecret = v.trim();
          await this.plugin.saveSettings();
        });
      });

    // Interactive sign-in works only on desktop (loopback redirect). On mobile
    // the button is replaced by the token-import flow below.
    if (Platform.isDesktopApp) {
      new Setting(containerEl)
        .setName(t("loginName"))
        .setDesc(
          s.refreshToken ? t("loginDescSignedIn") : t("loginDescSignedOut")
        )
        .addButton((b) =>
          b
            .setButtonText(
              s.refreshToken ? t("loginButtonReauth") : t("loginButtonSignIn")
            )
            .setCta()
            .onClick(async () => {
              try {
                await this.plugin.login(); // shows the success notice itself
                this.display();
              } catch (e) {
                log.error("Login error:", e);
                new Notice(
                  t("loginFailed", {
                    error: e instanceof Error ? e.message : String(e),
                  }),
                  10000
                );
              }
            })
        )
        .addExtraButton((b) => {
          b.setIcon("log-out")
            .setTooltip(t("logoutTooltip"))
            .onClick(async () => {
              this.plugin.oauth.reset();
              await this.plugin.saveSettings();
              this.display();
            });
        });
    } else {
      // Mobile: show sign-in status + a logout button (import UI is below).
      new Setting(containerEl)
        .setName(t("loginName"))
        .setDesc(
          s.refreshToken ? t("loginDescSignedIn") : t("loginDescSignedOutMobile")
        )
        .addExtraButton((b) => {
          b.setIcon("log-out")
            .setTooltip(t("logoutTooltip"))
            .onClick(async () => {
              this.plugin.oauth.reset();
              await this.plugin.saveSettings();
              this.display();
            });
        });
    }

    this.renderTokenTransfer(containerEl);
  }

  /** Sync targets tab. */
  private renderTargetsTab(containerEl: HTMLElement): void {
    // ---- 2. Sync targets ----
    new Setting(containerEl).setName(t("headingTargets")).setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t("targetsHelp"),
    });

    const targets = this.plugin.getTargets();
    if (targets.length === 0) {
      containerEl.createDiv({
        cls: "gds-tree-empty",
        text: t("targetsEmpty"),
      });
    }
    for (const target of targets) {
      this.renderTarget(containerEl, target.id);
    }

    new Setting(containerEl).addButton((b) =>
      b
        .setButtonText(t("targetAddButton"))
        .setCta()
        .onClick(async () => {
          await this.plugin.addTarget();
          this.display();
        })
    );
  }

  /** Auto-sync tab (polling, debounce, retention, batching, debug). */
  private renderAutoSyncTab(containerEl: HTMLElement): void {
    const s = this.plugin.settings;

    // ---- 3. Auto-sync ----
    new Setting(containerEl).setName(t("headingAutoSync")).setHeading();

    new Setting(containerEl)
      .setName(t("autoSyncEnabledName"))
      .setDesc(t("autoSyncEnabledDesc"))
      .addToggle((c) =>
        c.setValue(s.autoSyncEnabled).onChange(async (v) => {
          s.autoSyncEnabled = v;
          await this.plugin.saveSettings();
          this.plugin.reconfigureAutoSync();
        })
      );

    new Setting(containerEl)
      .setName(t("pollIntervalName"))
      .setDesc(t("pollIntervalDesc"))
      .addText((c) =>
        c.setValue(String(s.pollIntervalSeconds)).onChange(async (v) => {
          const n = Math.max(15, parseInt(v, 10) || 60);
          s.pollIntervalSeconds = n;
          await this.plugin.saveSettings();
          this.plugin.reconfigureAutoSync();
        })
      );

    new Setting(containerEl)
      .setName(t("localDebounceName"))
      .setDesc(t("localDebounceDesc"))
      .addText((c) =>
        c.setValue(String(s.localDebounceMs)).onChange(async (v) => {
          s.localDebounceMs = Math.max(500, parseInt(v, 10) || 2500);
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("logRetentionName"))
      .setDesc(t("logRetentionDesc"))
      .addText((c) =>
        c.setValue(String(s.logRetentionHours)).onChange(async (v) => {
          const n = Math.max(0, parseInt(v, 10) || 0);
          s.logRetentionHours = n;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(t("batchEnabledName"))
      .setDesc(t("batchEnabledDesc"))
      .addToggle((c) =>
        c.setValue(s.batchEnabled).onChange(async (v) => {
          s.batchEnabled = v;
          await this.plugin.saveSettings();
          this.display(); // show/hide the batch-size slider
        })
      );

    // Batch size — only relevant (and shown) when batching is enabled.
    if (s.batchEnabled) {
      new Setting(containerEl)
        .setName(t("batchSizeName"))
        .setDesc(t("batchSizeDesc"))
        .addSlider((c) =>
          c
            .setLimits(50, 2000, 50)
            .setValue(s.batchSize)
            .setDynamicTooltip()
            .onChange(async (v) => {
              s.batchSize = v;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName(t("debugLoggingName"))
      .setDesc(t("debugLoggingDesc"))
      .addToggle((c) =>
        c.setValue(s.debugLogging).onChange(async (v) => {
          s.debugLogging = v;
          setDebugLogging(v);
          await this.plugin.saveSettings();
        })
      );
  }

  /** Actions & status tab (manual sync, live status, log, reset). */
  private renderActionsTab(containerEl: HTMLElement): void {
    // ---- 4. Actions & status ----
    new Setting(containerEl).setName(t("headingActionsStatus")).setHeading();

    const lastSync = this.plugin.getLastSyncMs();
    const syncSetting = new Setting(containerEl)
      .setName(t("syncNowName"))
      .setDesc(
        lastSync
          ? t("lastSyncDesc", { time: new Date(lastSync).toLocaleString() })
          : t("neverSyncedDesc")
      )
      .addButton((b) => {
        this.syncButton = b;
        b.setButtonText(t("syncStartButton"))
          .setCta()
          .onClick(async () => {
            // Don't await the sync, so the live status stays visible.
            void this.plugin.runSync(true);
          });
        this.refreshSyncButton();
      });

    // Live status line.
    this.statusEl = containerEl.createDiv({ cls: "gds-status" });

    // Sync log: button opens a live modal.
    new Setting(containerEl)
      .setName(t("syncLogName"))
      .setDesc(t("syncLogDesc"))
      .addButton((b) =>
        b.setButtonText(t("showLogButton")).onClick(() => {
          new SyncLogModal(this.app, this.plugin).open();
        })
      )
      .addExtraButton((b) =>
        b
          .setIcon("trash-2")
          .setTooltip(t("clearLogTooltip"))
          .onClick(() => this.plugin.status.clearLog())
      );

    // Subscribe to live updates (status + button state + "last sync").
    let wasSyncing = this.plugin.isSyncing();
    this.unsubscribe = this.plugin.status.subscribe(() => {
      this.renderStatus();
      this.refreshSyncButton();
      const syncing = this.plugin.isSyncing();
      if (!syncing && this.plugin.getLastSyncMs()) {
        syncSetting.setDesc(
          t("lastSyncDesc", {
            time: new Date(this.plugin.getLastSyncMs()).toLocaleString(),
          })
        );
      }
      // Rebuild the trees after a just-completed sync
      // (make new keptRemoteOnly entries visible live).
      if (wasSyncing && !syncing) this.refreshAllTrees();
      wasSyncing = syncing;
    });
    this.renderStatus();

    new Setting(containerEl)
      .setName(t("resetSyncStateName"))
      .setDesc(t("resetSyncStateDesc"))
      .addButton((b) =>
        b
          .setWarning()
          .setButtonText(t("resetButton"))
          .onClick(async () => {
            await this.plugin.resetAllBases();
            new Notice(t("resetSyncStateNotice"));
            this.display();
          })
      );
  }

  /**
   * Token transfer (desktop → mobile). Mobile can't run the interactive
   * redirect flow, so the user signs in on desktop, copies the refresh token
   * here, and pastes it on mobile.
   *
   * - Desktop, signed in: a "Copy sign-in token" button.
   * - Everywhere: a collapsible "sign in with a token" paste field. On mobile
   *   it's expanded by default (it's the only way to sign in there).
   */
  /**
   * Config-sync section: sync THIS plugin's own settings across devices. A
   * separate subsystem from note sync — its own toggle, dedicated Drive folder,
   * per-device passphrase (never persisted), and manual sync button.
   */
  private renderConfigSync(
    containerEl: HTMLElement,
    s: PluginSettings
  ): void {
    new Setting(containerEl).setName(t("configSyncHeading")).setHeading();

    new Setting(containerEl)
      .setName(t("configSyncEnabledName"))
      .setDesc(t("configSyncEnabledDesc"))
      .addToggle((c) =>
        c.setValue(s.configSyncEnabled).onChange(async (v) => {
          s.configSyncEnabled = v;
          await this.plugin.saveSettings();
          this.display(); // show/hide the rest of the section
        })
      );

    // The folder / passphrase / sync controls only matter when enabled.
    if (!s.configSyncEnabled) return;

    // Properties of OUR data.json to sync (collapsible checkbox tree).
    this.renderConfigPropsTree(containerEl, s);

    // Also sync OTHER plugins' settings (whole-file encrypted).
    new Setting(containerEl)
      .setName(t("configSyncOtherPluginsName"))
      .setDesc(t("configSyncOtherPluginsDesc"))
      .addToggle((c) =>
        c.setValue(s.configSyncOtherPlugins).onChange(async (v) => {
          s.configSyncOtherPlugins = v;
          await this.plugin.saveSettings();
          this.display(); // show/hide the per-plugin list
        })
      );

    // Per-plugin selection (only when the toggle is on).
    if (s.configSyncOtherPlugins) {
      this.renderConfigPluginList(containerEl, s);
    }

    // Dedicated Drive folder for the config file.
    new Setting(containerEl)
      .setName(t("configSyncFolderName"))
      .setDesc(t("configSyncFolderDesc"))
      .addText((c) => {
        c.setPlaceholder(t("configSyncFolderPlaceholder"))
          .setValue(s.configDriveFolderName || s.configDriveFolderId)
          .onChange(async (v) => {
            // Free-text id entry; validated via the Check button.
            s.configDriveFolderId = v.trim();
            await this.plugin.saveSettings();
          });
      })
      .addButton((b) =>
        b.setButtonText(t("configSyncCheckFolderButton")).onClick(async () => {
          try {
            const folder = await this.plugin.drive.getFolder(
              s.configDriveFolderId
            );
            s.configDriveFolderId = folder.id;
            s.configDriveFolderName = folder.name;
            s.configDriveSharedId = folder.driveId ?? "";
            await this.plugin.saveSettings();
            const loc = folder.driveId ? t("sharedDriveSuffix") : "";
            new Notice(
              t("driveFolderFound", { name: folder.name, location: loc })
            );
            this.display();
          } catch (e) {
            new Notice(
              t("driveFolderInvalid", {
                error: e instanceof Error ? e.message : String(e),
              })
            );
          }
        })
      )
      .addExtraButton((b) =>
        b
          .setIcon("folder-plus")
          .setTooltip(t("configSyncCreateFolderButton"))
          .onClick(async () => {
            try {
              const folder =
                await this.plugin.drive.createFolder("Obsidian config");
              s.configDriveFolderId = folder.id;
              s.configDriveFolderName = folder.name;
              s.configDriveSharedId = "";
              await this.plugin.saveSettings();
              new Notice(t("driveFolderCreated", { name: folder.name }));
              this.display();
            } catch (e) {
              new Notice(
                t("driveFolderCreateFailed", {
                  error: e instanceof Error ? e.message : String(e),
                })
              );
            }
          })
      );

    // Per-device passphrase (in-memory only). Establishing it validates against
    // the folder's verifier blob (or writes one on first use).
    let pendingPass = "";
    new Setting(containerEl)
      .setName(t("configSyncPassphraseName"))
      .setDesc(t("configSyncPassphraseDesc"))
      .addText((c) => {
        c.setPlaceholder(t("configSyncPassphrasePlaceholder")).onChange((v) => {
          pendingPass = v;
        });
        c.inputEl.type = "password";
      })
      .addButton((b) =>
        b
          .setButtonText(t("configSyncSetPassphraseButton"))
          .onClick(async () => {
            if (!pendingPass) return;
            try {
              const ok = await this.plugin.configSync.establishPassphrase(
                pendingPass
              );
              if (ok) {
                await this.plugin.setConfigPassphrase(pendingPass);
                new Notice(t("configSyncPassphraseSet"));
              } else {
                new Notice(t("configSyncPassphraseRejected"), 12000);
              }
            } catch (e) {
              new Notice(
                t("configSyncFailed", {
                  error: e instanceof Error ? e.message : String(e),
                }),
                12000
              );
            }
            this.display();
          })
      );

    // Sync button — enabled only once a passphrase is set this session.
    new Setting(containerEl)
      .setName(t("configSyncSyncButton"))
      .addButton((b) => {
        this.configSyncButton = b;
        b.setButtonText(t("configSyncSyncButton")).setCta();
        b.onClick(() => {
          void this.plugin.runConfigSync(true);
        });
        this.refreshConfigSyncButton();
      });

    // Live status line (same look as note sync).
    this.configStatusEl = containerEl.createDiv({ cls: "gds-status" });

    // Config-sync log: opens the SAME live modal, bound to the config log.
    new Setting(containerEl)
      .setName(t("syncLogName"))
      .setDesc(t("syncLogDesc"))
      .addButton((b) =>
        b.setButtonText(t("showLogButton")).onClick(() => {
          new SyncLogModal(this.app, this.plugin, this.plugin.configStatus).open();
        })
      )
      .addExtraButton((b) =>
        b
          .setIcon("trash-2")
          .setTooltip(t("clearLogTooltip"))
          .onClick(() => this.plugin.configStatus.clearLog())
      );

    // Subscribe live to the config status (status line + button state).
    this.configUnsubscribe = this.plugin.configStatus.subscribe(() => {
      this.renderStatusInto(this.configStatusEl, this.plugin.configStatus);
      this.refreshConfigSyncButton();
    });
    this.renderStatusInto(this.configStatusEl, this.plugin.configStatus);
  }

  /** Disables the config-sync button while a run is in progress / no passphrase. */
  private refreshConfigSyncButton(): void {
    if (!this.configSyncButton) return;
    this.configSyncButton.setDisabled(
      this.plugin.isConfigSyncing() || !this.plugin.hasConfigPassphrase()
    );
  }

  /**
   * "Properties to sync" — a collapsible checkbox tree of this plugin's own
   * data.json paths. Checked = sync; unchecked = keep on this device only
   * (added to `configIgnorePaths`). Async: reads data.json, then fills the tree.
   */
  private renderConfigPropsTree(
    containerEl: HTMLElement,
    s: PluginSettings
  ): void {
    new Setting(containerEl)
      .setName(t("configSyncPropsName"))
      .setDesc(t("configSyncPropsDesc"))
      .setHeading();
    const treeEl = containerEl.createDiv({ cls: "gds-cfg-tree" });

    void (async () => {
      const data = await this.plugin.configSync.readOwnData();
      const paths = discoverPaths(data, CONFIG_SYNC_DEVICE_LOCAL_KEYS).sort();
      treeEl.empty();
      if (paths.length === 0) return;

      const ignored = new Set(s.configIgnorePaths);
      // Descendants of an ignored container are implicitly ignored too.
      const isIgnored = (p: string) =>
        ignored.has(p) ||
        [...ignored].some((ig) => p === ig || p.startsWith(`${ig}.`));

      // Persist a change: `paths` is the set of leaf/descendant paths a checkbox
      // governs. Toggling on removes them from the ignore set; off adds the node.
      const setSynced = async (node: string, synced: boolean) => {
        const next = new Set(s.configIgnorePaths);
        if (synced) {
          // Un-ignore this node and any ignored descendants of it.
          for (const ig of [...next]) {
            if (ig === node || ig.startsWith(`${node}.`)) next.delete(ig);
          }
        } else {
          // Ignore this node; drop now-redundant descendant entries.
          for (const ig of [...next]) {
            if (ig.startsWith(`${node}.`)) next.delete(ig);
          }
          next.add(node);
        }
        s.configIgnorePaths = [...next];
        await this.plugin.saveSettings();
        this.display(); // re-render so descendant checkboxes reflect the change
      };

      // Build parent→children structure to render containers as <details>.
      const children = new Map<string, string[]>();
      for (const p of paths) {
        const parent = p.includes(".")
          ? p.slice(0, p.lastIndexOf("."))
          : "";
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent)!.push(p);
      }

      const renderLevel = (parentEl: HTMLElement, parent: string) => {
        for (const p of children.get(parent) ?? []) {
          const hasKids = children.has(p);
          const label = p.includes(".") ? p.slice(p.lastIndexOf(".") + 1) : p;
          if (hasKids) {
            const det = parentEl.createEl("details", {
              cls: "gds-cfg-node",
            });
            det.open = true;
            const sum = det.createEl("summary");
            const cb = sum.createEl("input", { type: "checkbox" });
            cb.checked = !isIgnored(p);
            cb.onchange = () => void setSynced(p, cb.checked);
            sum.createSpan({ text: ` ${label}` });
            const kids = det.createDiv({ cls: "gds-cfg-children" });
            renderLevel(kids, p);
          } else {
            const row = parentEl.createDiv({ cls: "gds-cfg-leaf" });
            const cb = row.createEl("input", { type: "checkbox" });
            cb.checked = !isIgnored(p);
            cb.onchange = () => void setSynced(p, cb.checked);
            row.createSpan({ text: ` ${label}` });
          }
        }
      };
      renderLevel(treeEl, "");
    })();
  }

  /**
   * Per-plugin selection list (only shown when "sync other plugins" is on).
   *
   * A plugin is "checked" when it's part of the effective selection:
   *   (already synced in Drive) ∪ (ticked here), minus (unticked here).
   * This makes a plugin synced from ANOTHER device show as checked here too
   * (its file is in the shared Drive folder), which was the missing state.
   * Ticking/unticking records intent; the next "Sync settings now" uploads new
   * ones and trashes deselected ones. Async: lists installed + Drive-synced,
   * then fills the rows.
   */
  private renderConfigPluginList(
    containerEl: HTMLElement,
    s: PluginSettings
  ): void {
    new Setting(containerEl)
      .setName(t("configSyncPluginsListName"))
      .setDesc(t("configSyncPluginsListDesc"))
      .setHeading();
    const listEl = containerEl.createDiv({ cls: "gds-cfg-plugins" });

    void (async () => {
      const [plugins, inDrive] = await Promise.all([
        this.plugin.configSync.listInstalledPlugins(),
        this.plugin.configSync.listSyncedPluginIds(),
      ]);
      listEl.empty();
      if (plugins.length === 0) {
        listEl.createDiv({
          cls: "gds-tree-empty",
          text: t("configSyncPluginsEmpty"),
        });
        return;
      }
      // Effective checked state for a plugin id.
      const isChecked = (id: string) =>
        !s.configSyncPluginRemoveIds.includes(id) &&
        (inDrive.has(id) || s.configSyncPluginIds.includes(id));

      for (const { id, name } of plugins) {
        new Setting(listEl)
          .setName(name)
          .setDesc(id)
          .addToggle((c) =>
            c.setValue(isChecked(id)).onChange(async (v) => {
              const include = new Set(s.configSyncPluginIds);
              const remove = new Set(s.configSyncPluginRemoveIds);
              if (v) {
                // Tick → include; cancel any pending removal.
                remove.delete(id);
                if (!inDrive.has(id)) include.add(id);
                else include.delete(id); // already in Drive → no include needed
              } else {
                // Untick → drop include; if it's in Drive, mark pending removal.
                include.delete(id);
                if (inDrive.has(id)) remove.add(id);
                else remove.delete(id);
              }
              s.configSyncPluginIds = [...include];
              s.configSyncPluginRemoveIds = [...remove];
              await this.plugin.saveSettings();
            })
          );
      }
    })();
  }

  private renderTokenTransfer(containerEl: HTMLElement): void {
    const signedIn = Boolean(this.plugin.exportRefreshToken());

    // Copy token (only useful on a signed-in desktop, to move to mobile).
    if (Platform.isDesktopApp && signedIn) {
      new Setting(containerEl)
        .setName(t("tokenCopyName"))
        .setDesc(t("tokenCopyDesc"))
        .addButton((b) =>
          b.setButtonText(t("tokenCopyButton")).onClick(async () => {
            const token = this.plugin.exportRefreshToken();
            try {
              await navigator.clipboard.writeText(token);
              new Notice(t("tokenCopied"), 6000);
            } catch {
              // Clipboard unavailable — show it so the user can copy manually.
              new Notice(t("tokenCopyManual", { token }), 15000);
            }
          })
        );
    }

    // Import token (the mobile sign-in path; also a desktop fallback).
    const details = containerEl.createEl("details", {
      cls: "gds-token-import",
    });
    details.open = !Platform.isDesktopApp && !signedIn;
    details.createEl("summary", { text: t("tokenImportSummary") });
    details.createEl("p", {
      cls: "setting-item-description",
      text: t("tokenImportHelp"),
    });

    let pasted = "";
    new Setting(details)
      .setName(t("tokenImportName"))
      .setDesc(t("tokenImportDesc"))
      .addText((c) =>
        c.setPlaceholder(t("tokenImportPlaceholder")).onChange((v) => {
          pasted = v.trim();
        })
      )
      .addButton((b) =>
        b
          .setButtonText(t("tokenImportButton"))
          .setCta()
          .onClick(async () => {
            if (!pasted) {
              new Notice(t("tokenImportNoInput"), 6000);
              return;
            }
            try {
              await this.plugin.importRefreshToken(pasted);
              this.display();
            } catch (e) {
              log.error("Token import error:", e);
              new Notice(
                t("loginFailed", {
                  error: e instanceof Error ? e.message : String(e),
                }),
                10000
              );
            }
          })
      );
  }

  /**
   * Renders one sync target as a collapsible block: name, Drive folder, local
   * scope (whole-vault toggle / subfolder), filters, excluded folders, deletion
   * behavior, and the target's own sync tree. A "remove" button deletes the
   * target (and its sync base).
   */
  private renderTarget(containerEl: HTMLElement, id: string): void {
    const target = this.plugin.getTargets().find((tg) => tg.id === id);
    if (!target) return;

    const details = containerEl.createEl("details", { cls: "gds-target" });
    details.open = true;
    const summary = details.createEl("summary", { cls: "gds-target-summary" });
    summary.createSpan({ text: `📁 ${target.name || target.id}` });
    const body = details.createDiv({ cls: "gds-target-body" });

    // --- Name + remove ---
    new Setting(body)
      .setName(t("targetNameName"))
      .setDesc(t("targetNameDesc"))
      .addText((c) =>
        c
          .setPlaceholder(t("targetNamePlaceholder"))
          .setValue(target.name)
          .onChange(async (v) => {
            await this.plugin.updateTarget(id, { name: v });
            summary.empty();
            summary.createSpan({ text: `📁 ${v || target.id}` });
          })
      )
      .addExtraButton((b) =>
        b
          .setIcon("trash-2")
          .setTooltip(t("targetRemoveTooltip"))
          .onClick(async () => {
            await this.plugin.removeTarget(id);
            this.display();
          })
      );

    // --- Local scope: whole vault vs. subfolder ---
    // Only ONE target may sync the whole vault. If another target already does,
    // this target's toggle is locked off and it must use a subfolder.
    const wholeVaultOwner = this.plugin.wholeVaultTargetId();
    const lockedByOther = wholeVaultOwner !== null && wholeVaultOwner !== id;
    const wholeVault =
      !lockedByOther &&
      target.localFolder.trim() === "" &&
      !this.pendingSubfolder.has(id);

    new Setting(body)
      .setName(t("syncWholeVaultName"))
      .setDesc(
        lockedByOther
          ? t("syncWholeVaultLocked", {
              name: this.wholeVaultOwnerName(wholeVaultOwner),
            })
          : t("syncWholeVaultDesc")
      )
      .addToggle((c) => {
        c.setValue(wholeVault)
          .setDisabled(lockedByOther)
          .onChange(async (v) => {
            if (v) {
              this.pendingSubfolder.delete(id);
              await this.plugin.setLocalFolderForTarget(id, "");
            } else {
              this.pendingSubfolder.add(id);
            }
            this.display();
          });
      });

    // Show the folder field whenever this target is not whole-vault (including
    // when it is locked off by another whole-vault target).
    if (!wholeVault) {
      new Setting(body)
        .setName(t("localFolderName"))
        .setDesc(
          target.localFolder
            ? t("localFolderDescSet")
            : t("localFolderDescEmpty")
        )
        .addText((c) => {
          c.setPlaceholder(t("localFolderPlaceholder"))
            .setValue(target.localFolder)
            .onChange(async (v) => {
              const val = v ? normalizePath(v.trim()) : "";
              if (val) this.pendingSubfolder.delete(id);
              await this.plugin.setLocalFolderForTarget(id, val);
            });
          new LocalFolderSuggest(this.app, c.inputEl, (path) => {
            void (async () => {
              this.pendingSubfolder.delete(id);
              await this.plugin.setLocalFolderForTarget(id, path);
              this.display();
            })();
          });
        });
    }

    // --- Drive folder ---
    new Setting(body)
      .setName(t("driveFolderName"))
      .setDesc(
        target.driveFolderId
          ? t("driveFolderDescSet", {
              name: target.driveFolderName || target.driveFolderId,
            })
          : t("driveFolderDescEmpty")
      )
      .addText((c) => {
        c.setPlaceholder(
          this.plugin.oauth.isConfigured()
            ? t("driveFolderPlaceholderReady")
            : t("driveFolderPlaceholderNotReady")
        )
          .setValue(target.driveFolderName || target.driveFolderId)
          .onChange(async (v) => {
            // Free input = folder ID (fallback for pasting an ID). No scope
            // reset here (only on an explicit pick/check with a changed ID).
            await this.plugin.updateTarget(id, { driveFolderId: v.trim() });
          });
        new DriveFolderSuggest(
          this.app,
          c.inputEl,
          this.plugin.drive,
          () => this.plugin.oauth.isConfigured(),
          (folder) => {
            void (async () => {
              await this.plugin.setDriveFolderForTarget(
                id,
                folder.id,
                folder.name,
                folder.driveId
              );
              this.display();
            })();
          }
        );
      })
      .addButton((b) =>
        b.setButtonText(t("driveFolderCheckButton")).onClick(async () => {
          try {
            const folder = await this.plugin.drive.getFolder(
              target.driveFolderId
            );
            await this.plugin.setDriveFolderForTarget(
              id,
              folder.id,
              folder.name,
              folder.driveId
            );
            const loc = folder.driveId ? t("sharedDriveSuffix") : "";
            new Notice(
              t("driveFolderFound", { name: folder.name, location: loc })
            );
            this.display();
          } catch (e) {
            new Notice(
              t("driveFolderInvalid", {
                error: e instanceof Error ? e.message : String(e),
              })
            );
          }
        })
      )
      .addExtraButton((b) =>
        b
          .setIcon("folder-plus")
          .setTooltip(t("driveFolderCreateTooltip"))
          .onClick(async () => {
            try {
              const folder = await this.plugin.drive.createFolder("Obsidian");
              await this.plugin.setDriveFolderForTarget(
                id,
                folder.id,
                folder.name,
                ""
              );
              new Notice(t("driveFolderCreated", { name: folder.name }));
              this.display();
            } catch (e) {
              new Notice(
                t("driveFolderCreateFailed", {
                  error: e instanceof Error ? e.message : String(e),
                })
              );
            }
          })
      );

    // --- Filters ---
    new Setting(body)
      .setName(t("allowedExtensionsName"))
      .setDesc(t("allowedExtensionsDesc"))
      .addText((c) =>
        c
          .setPlaceholder(t("allowedExtensionsPlaceholder"))
          .setValue(target.allowedExtensions)
          .onChange(async (v) => {
            await this.plugin.updateTarget(id, { allowedExtensions: v });
          })
      );

    new Setting(body)
      .setName(t("ignorePatternsName"))
      .setDesc(t("ignorePatternsDesc"))
      .addText((c) =>
        c
          .setPlaceholder(t("ignorePatternsPlaceholder"))
          .setValue(target.ignorePatterns)
          .onChange(async (v) => {
            await this.plugin.updateTarget(id, { ignorePatterns: v });
          })
      );

    new Setting(body)
      .setName(t("excludeFoldersName"))
      .setDesc(t("excludeFoldersDesc"))
      .addText((c) =>
        c
          .setPlaceholder(t("excludeFoldersPlaceholder"))
          .setValue(target.excludeFolders)
          .onChange(async (v) => {
            await this.plugin.updateTarget(id, { excludeFolders: v });
          })
      );

    // --- Deletion behavior ---
    new Setting(body)
      .setName(t("neverDeleteRemoteName"))
      .setDesc(t("neverDeleteRemoteDesc"))
      .addToggle((c) =>
        c.setValue(target.neverDeleteRemote).onChange(async (v) => {
          await this.plugin.updateTarget(id, { neverDeleteRemote: v });
        })
      );

    // --- Google Docs (view-only embed) ---
    new Setting(body)
      .setName(t("syncGoogleDocsName"))
      .setDesc(t("syncGoogleDocsDesc"))
      .addToggle((c) =>
        c.setValue(target.syncGoogleDocs).onChange(async (v) => {
          await this.plugin.updateTarget(id, { syncGoogleDocs: v });
        })
      );

    // --- Stub large binary files ---
    new Setting(body)
      .setName(t("stubLargeFilesName"))
      .setDesc(t("stubLargeFilesDesc"))
      .addToggle((c) =>
        c.setValue(target.stubLargeFiles).onChange(async (v) => {
          await this.plugin.updateTarget(id, { stubLargeFiles: v });
        })
      );

    // --- Stub large binary files threshold ---
    const defaultThreshold = 10;
    const storedThreshold = window.localStorage.getItem(`gdm-stub-threshold-${id}`);
    const currentThreshold = storedThreshold ? parseInt(storedThreshold, 10) : defaultThreshold;

    new Setting(body)
      .setName("Stub Large Files Threshold (MB)")
      .setDesc("Device-specific setting. Files larger than this (in MB) will be stubbed if the feature is enabled above.")
      .addSlider((slider) => {
        slider
          .setLimits(1, 100, 1)
          .setValue(currentThreshold)
          .setDynamicTooltip()
          .onChange((value) => {
            window.localStorage.setItem(`gdm-stub-threshold-${id}`, value.toString());
          });
      });

    // --- Sync tree (per target) ---
    const descSetting = new Setting(body)
      .setName(t("syncTreeName"))
      .addExtraButton((b) =>
        b
          .setIcon("refresh-cw")
          .setTooltip(t("syncTreeRefresh"))
          .onClick(() => this.refreshTree(id))
      );
    this.treeDescSettings.set(id, descSetting);

    // Filter box: narrows the tree to paths containing the query (live).
    const filterWrap = body.createDiv({ cls: "gds-tree-filter" });
    const filterInput = filterWrap.createEl("input", {
      type: "search",
      cls: "gds-tree-filter-input",
      placeholder: t("syncTreeFilterPlaceholder"),
    });
    filterInput.value = this.treeFilters.get(id) ?? "";
    filterInput.addEventListener("input", () => {
      this.treeFilters.set(id, filterInput.value.trim().toLowerCase());
      this.refreshTree(id);
    });

    const treeEl = body.createDiv({ cls: "gds-sync-tree" });
    this.treeEls.set(id, treeEl);
    this.refreshTree(id);
  }

  /** Display name of the whole-vault owner target (for the locked-toggle hint). */
  private wholeVaultOwnerName(ownerId: string | null): string {
    const owner = this.plugin.getTargets().find((tg) => tg.id === ownerId);
    return owner?.name || owner?.id || "?";
  }

  /** Refreshes the sync trees of all targets (after a completed sync). */
  private refreshAllTrees(): void {
    for (const id of this.treeEls.keys()) this.refreshTree(id);
  }

  /**
   * Refills one target's sync-tree container (without touching the rest of the
   * settings). Called after every sync (via the status subscription) and via
   * the per-target refresh button.
   */
  private refreshTree(id: string): void {
    const treeEl = this.treeEls.get(id);
    if (!treeEl) return;
    const entries = this.plugin.getSyncEntries(id);
    const remoteOnlyCount = entries.filter((e) => e.keptRemoteOnly).length;
    this.treeDescSettings
      .get(id)
      ?.setDesc(t("syncTreeDesc", { count: remoteOnlyCount }));

    treeEl.empty();
    if (entries.length === 0) {
      treeEl.createDiv({ cls: "gds-tree-empty", text: t("syncTreeEmpty") });
      return;
    }

    const query = this.treeFilters.get(id) ?? "";
    const filtered = filterEntries(entries, query);
    const target = this.plugin.getTargets().find((tg) => tg.id === id) ?? null;
    this.renderTreeHeader(treeEl);
    if (filtered.length === 0) {
      treeEl.createDiv({ cls: "gds-tree-empty", text: t("syncTreeNoMatch") });
      return;
    }
    const root = buildTree(filtered);
    // With an active filter, expand folders so the matches are visible.
    this.renderTreeNodes(treeEl, id, target, root.children, query.length > 0);
  }

  /**
   * Column header row for the tree: names the two right-aligned status columns
   * ("Local" / "Ignored"). Kept outside the scrolling body-per-row layout but
   * sharing the same flex structure so the columns line up with each row's
   * action bar.
   */
  private renderTreeHeader(treeEl: HTMLElement): void {
    const header = treeEl.createDiv({ cls: "gds-tree-row gds-tree-header" });
    header.createSpan({ cls: "gds-tree-label", text: t("syncTreeColName") });
    const actions = header.createDiv({ cls: "gds-tree-actions" });
    actions.createSpan({
      cls: "gds-tree-action gds-tree-col-head",
      text: t("syncTreeColLocal"),
    });
    actions.createSpan({
      cls: "gds-tree-action gds-tree-col-head",
      text: t("syncTreeColIgnored"),
    });
  }

  /** Renders the children of a tree node (folders as <details>, files as a row). */
  private renderTreeNodes(
    parentEl: HTMLElement,
    targetId: string,
    target: SyncTarget | null,
    nodes: TreeNode[],
    expand = false
  ): void {
    // Folders first, then files; each alphabetically (case-insensitive).
    const sorted = [...nodes].sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    for (const node of sorted) {
      if (node.isFolder) {
        const details = parentEl.createEl("details", { cls: "gds-tree-folder" });
        details.open = expand; // collapsed by default; expanded while filtering
        const summary = details.createEl("summary");
        // Row in its own div inside the <summary>, so the disclosure marker
        // stays on the left and our flex layout doesn't push it away.
        const row = summary.createDiv({ cls: "gds-tree-file gds-tree-folder-row" });
        this.renderTreeRow(row, targetId, target, node, `📁 ${node.name}`);
        const childrenEl = details.createDiv({ cls: "gds-tree-children" });
        this.renderTreeNodes(childrenEl, targetId, target, node.children, expand);
      } else {
        const row = parentEl.createDiv({ cls: "gds-tree-file" });
        this.renderTreeRow(row, targetId, target, node, node.name);
      }
    }
  }

  /**
   * Renders a tree row: label on the left, action bar on the right. The action
   * bar (`gds-tree-actions`) is the docking point for row-related buttons;
   * currently the "Drive-only" checkbox, later more (ignore, etc.).
   */
  private renderTreeRow(
    rowEl: HTMLElement,
    targetId: string,
    target: SyncTarget | null,
    node: TreeNode,
    label: string
  ): void {
    rowEl.addClass("gds-tree-row");

    // Label on the left.
    const nameCls = node.keptRemoteOnly
      ? "gds-tree-label gds-tree-remote-only"
      : "gds-tree-label";
    rowEl.createSpan({ cls: nameCls, text: label });

    // Action bar on the right (kept even when empty, so the column stays aligned).
    const actions = rowEl.createDiv({ cls: "gds-tree-actions" });
    this.renderRowActions(actions, targetId, target, node);
  }

  /**
   * Builds the row-related status columns (right-aligned), one per header
   * column. Add further buttons here — each via `addRowAction`.
   *
   * 1. "Local" checkbox on EVERY row:
   *    - normal (two-sided) entry: checked + disabled (display only).
   *    - "Drive-only" (keptRemoteOnly): unchecked + clickable; checking restores
   *      the file locally on the next sync.
   * 2. "Ignored" checkbox (read-only): checked + disabled when the path matches
   *    the target's ignore patterns / extension whitelist / exclude-folders.
   */
  private renderRowActions(
    actionsEl: HTMLElement,
    targetId: string,
    target: SyncTarget | null,
    node: TreeNode
  ): void {
    if (!node.path) {
      // Pure structure folders without a state entry keep no checkboxes, but
      // still reserve the two columns so the grid stays aligned.
      actionsEl.createSpan({ cls: "gds-tree-action" });
      actionsEl.createSpan({ cls: "gds-tree-action" });
      return;
    }

    const path = node.path;
    const remoteOnly = node.keptRemoteOnly;
    this.addRowAction(actionsEl, {
      cls: remoteOnly ? "gds-action-remote-only" : "gds-action-local",
      title: remoteOnly
        ? t("syncTreeCheckboxRestoreTitle")
        : t("syncTreeCheckboxLocalTitle"),
      control: (el) => {
        const cb = el.createEl("input", { type: "checkbox" });
        // Checked = exists locally. keptRemoteOnly = NOT local -> unchecked.
        cb.checked = !remoteOnly;
        if (!remoteOnly) {
          // Normal entry: status display only, not interactive.
          cb.disabled = true;
          return;
        }
        // "Drive-only": checking = restore (download locally).
        cb.onchange = async () => {
          if (cb.checked) {
            await this.plugin.restoreRemoteOnly(targetId, path);
            new Notice(t("syncTreeRestored", { path }));
            this.display();
          }
        };
      },
    });

    // "Ignored" column: read-only indicator of the target's own filters.
    const ignored = target
      ? isFilteredByTargetSettings(path, node.isFolder, {
          allowedExtensions: target.allowedExtensions,
          ignorePatterns: target.ignorePatterns,
          excludeFolders: target.excludeFolders,
        })
      : false;
    this.addRowAction(actionsEl, {
      cls: "gds-action-ignored",
      title: ignored
        ? t("syncTreeCheckboxIgnoredTitle")
        : t("syncTreeCheckboxNotIgnoredTitle"),
      control: (el) => {
        const cb = el.createEl("input", { type: "checkbox" });
        cb.checked = ignored;
        cb.disabled = true; // read-only status
      },
    });
  }

  /**
   * Adds a single row action to the action bar. Encapsulates the shared
   * behavior (a click does NOT toggle the enclosing <summary> open/closed)
   * and unifies future buttons.
   */
  private addRowAction(
    actionsEl: HTMLElement,
    opts: {
      cls?: string;
      title?: string;
      control: (host: HTMLElement) => void;
    }
  ): void {
    const host = actionsEl.createSpan({
      cls: `gds-tree-action ${opts.cls ?? ""}`.trim(),
    });
    if (opts.title) host.title = opts.title;
    // Interaction in the action bar must not toggle the <summary>.
    host.onclick = (e) => e.stopPropagation();
    opts.control(host);
  }

  /** Enables/disables the sync button and adjusts the text. */
  private refreshSyncButton(): void {
    if (!this.syncButton) return;
    const running = this.plugin.isSyncing();
    this.syncButton.setDisabled(running);
    this.syncButton.setButtonText(
      running ? t("syncRunningButton") : t("syncStartButton")
    );
  }

  /** Renders the live status line. */
  private renderStatus(): void {
    this.renderStatusInto(this.statusEl, this.plugin.status);
  }

  /** Renders a status line for any `SyncStatus` into any element (shared by
   * note sync and config sync). */
  private renderStatusInto(
    el: HTMLElement | null,
    status: SyncStatus
  ): void {
    if (!el) return;
    const p = status.getProgress();
    el.empty();
    el.removeClass("is-running", "is-done", "is-error");

    let label = t("statusLineReady");
    if (p.phase === "running") {
      el.addClass("is-running");
      // The message already carries the "(done/total)" count at its start (the
      // engine builds it via describeAction), so we do NOT render the count a
      // second time here — that produced the duplicate "(x/y) … (x/y)".
      const secs = p.startedMs ? Math.round((Date.now() - p.startedMs) / 1000) : 0;
      label = `⏳ ${t("statusLineRunning", {
        message: p.message,
        secs,
      })}`;
    } else if (p.phase === "done") {
      el.addClass("is-done");
      label = `✅ ${t("statusLineDone", { message: p.message })}`;
    } else if (p.phase === "error") {
      el.addClass("is-error");
      label = `⚠️ ${t("statusLineError", { message: p.message })}`;
    }
    el.setText(label);
  }
}

/**
 * Modal that shows the full sync log and updates **live** while it is open.
 * Newest entries on top.
 */
export class SyncLogModal extends Modal {
  private unsubscribe: (() => void) | null = null;
  private listEl: HTMLElement | null = null;
  private status: SyncStatus;

  /**
   * @param status Which log to show. Defaults to the note-sync status; the
   *               config-sync section passes `plugin.configStatus` so the SAME
   *               modal renders the config log.
   */
  constructor(
    app: App,
    private plugin: GoogleDriveSyncPlugin,
    status?: SyncStatus
  ) {
    super(app);
    this.status = status ?? plugin.status;
  }

  onOpen(): void {
    this.titleEl.setText(t("logModalTitle"));
    this.modalEl.addClass("gds-log-modal");

    const controls = this.contentEl.createDiv({ cls: "gds-log-controls" });
    const info = controls.createSpan({ cls: "gds-log-count" });
    const clearBtn = controls.createEl("button", { text: t("logModalClearButton") });
    clearBtn.onclick = () => this.status.clearLog();

    this.listEl = this.contentEl.createDiv({ cls: "gds-log gds-log--modal" });

    const render = () => {
      const entries = this.status.getLog();
      info.setText(t("logModalCount", { count: entries.length }));
      this.renderList(entries);
    };
    // Subscribe live; unsubscribe on close.
    this.unsubscribe = this.status.subscribe(render);
    render();
  }

  onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.empty();
  }

  private renderList(
    entries: ReadonlyArray<{ ts: number; level: string; message: string }>
  ): void {
    if (!this.listEl) return;
    this.listEl.empty();
    if (entries.length === 0) {
      this.listEl.createDiv({ cls: "gds-log-empty", text: t("logModalEmpty") });
      return;
    }
    // Newest first.
    for (const e of [...entries].reverse()) {
      const row = this.listEl.createDiv({ cls: `gds-log-row gds-log-${e.level}` });
      const time = new Date(e.ts).toLocaleString();
      row.createSpan({ cls: "gds-log-time", text: `${time}  ` });
      row.createSpan({ cls: "gds-log-msg", text: e.message });
    }
  }
}

/**
 * Filters the flat sync-state entries by a (already lowercased) query for the
 * sync-tree search box. An empty query returns everything unchanged.
 *
 * An entry is KEPT when:
 *  - its path contains the query (a direct match), OR
 *  - it is an ANCESTOR folder of a matching entry (so the path to a match stays
 *    visible), OR
 *  - it is a DESCENDANT of a matching FOLDER (so filtering a folder keeps its
 *    whole subtree).
 *
 * Pure function (no DOM), unit-tested in `test/unit/filter-entries.test.ts`.
 */
export function filterEntries(
  entries: SyncStateEntry[],
  query: string
): SyncStateEntry[] {
  if (!query) return entries;

  const matched = entries.filter((e) => e.path.toLowerCase().includes(query));
  if (matched.length === 0) return [];

  // Prefixes of matched FOLDERS: everything under them is kept.
  const matchedFolderPrefixes = matched
    .filter((e) => e.isFolder)
    .map((e) => e.path + "/");
  // Matched paths: their ancestor folders must stay visible.
  const matchedPaths = matched.map((e) => e.path);

  return entries.filter((e) => {
    const path = e.path;
    if (path.toLowerCase().includes(query)) return true;
    // Ancestor of a match?
    if (e.isFolder && matchedPaths.some((m) => m.startsWith(path + "/"))) {
      return true;
    }
    // Descendant of a matched folder?
    if (matchedFolderPrefixes.some((p) => path.startsWith(p))) return true;
    return false;
  });
}

/** A node in the sync tree (folder or file). */
export interface TreeNode {
  name: string;
  /** Full relative path (only set for real state entries). */
  path: string;
  isFolder: boolean;
  keptRemoteOnly: boolean;
  children: TreeNode[];
}

/**
 * Builds a tree structure from the flat sync-state entries. Intermediate
 * folders that have no state entry of their own (only derived from file paths)
 * are created as pure structure folders (without a checkbox).
 */
export function buildTree(entries: SyncStateEntry[]): TreeNode {
  const root: TreeNode = {
    name: "",
    path: "",
    isFolder: true,
    keptRemoteOnly: false,
    children: [],
  };

  const findOrAddChild = (parent: TreeNode, name: string): TreeNode => {
    let child = parent.children.find((c) => c.name === name);
    if (!child) {
      child = {
        name,
        path: parent.path ? `${parent.path}/${name}` : name,
        isFolder: true, // tentative; a file entry sets it to false below
        keptRemoteOnly: false,
        children: [],
      };
      parent.children.push(child);
    }
    return child;
  };

  for (const entry of entries) {
    const parts = entry.path.split("/").filter((p) => p.length > 0);
    if (parts.length === 0) continue;

    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      node = findOrAddChild(node, parts[i]);
      if (isLast) {
        // The leaf node takes on the properties of the state entry.
        node.isFolder = entry.isFolder;
        node.keptRemoteOnly = Boolean(entry.keptRemoteOnly);
      }
    }
  }

  return root;
}
