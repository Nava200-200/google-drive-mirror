import { PluginStorage } from "./storage";
import { t } from "./i18n";

/**
 * Central sync status + log. Observable via simple listeners, so that the
 * status bar and settings UI can be updated live.
 *
 * The log is persisted in its own file (`sync-log.json`) in the plugin folder
 * (not data.json) and, on save, automatically pruned of entries older than
 * the configured retention period.
 */

/** Default log file name (note sync). Config sync injects its own. */
const LOG_FILE = "sync-log.json";

export type SyncPhase = "idle" | "running" | "done" | "error";

export interface SyncProgress {
  /** Current phase. */
  phase: SyncPhase;
  /** Short, human-readable status text (e.g. "Uploading 3/12"). */
  message: string;
  /** Completed steps in the current run. */
  current: number;
  /** Total steps in the current run (0 = unknown/none). */
  total: number;
  /** Start time of the running sync (ms) or 0. */
  startedMs: number;
}

export interface LogEntry {
  /** Timestamp (ms). */
  ts: number;
  level: "info" | "success" | "warn" | "error";
  message: string;
}

export class SyncStatus {
  private progress: SyncProgress = {
    phase: "idle",
    message: t("statusReady"),
    current: 0,
    total: 0,
    startedMs: 0,
  };

  private log: LogEntry[] = [];
  private readonly maxLog = 500;
  private listeners = new Set<() => void>();
  private saveHandle: number | null = null;

  /**
   * @param storage         Persistence helper (optional; without it nothing is saved).
   * @param retentionHours  Returns the current retention period in hours
   *                        (0 = never delete). A function, so that settings changes
   *                        take effect immediately.
   * @param logFile         Log file name. Defaults to the note-sync log; config
   *                        sync injects its own so the two logs stay separate.
   */
  constructor(
    private storage?: PluginStorage,
    private retentionHours: () => number = () => 24,
    private logFile: string = LOG_FILE
  ) {}

  /** Loads the log from the file and applies retention. */
  async load(): Promise<void> {
    if (!this.storage) return;
    const data = await this.storage.readJson<{ entries?: LogEntry[] }>(
      this.logFile,
      {}
    );
    this.log = data.entries ?? [];
    this.pruneOld();
    this.emit();
  }

  /** Persists the log (debounced), after retention pruning. */
  private scheduleSave(): void {
    if (!this.storage) return;
    if (this.saveHandle !== null) return; // already scheduled
    this.saveHandle = window.setTimeout(() => {
      this.saveHandle = null;
      void this.save();
    }, 1000);
  }

  async save(): Promise<void> {
    if (!this.storage) return;
    this.pruneOld();
    await this.storage.writeJson(this.logFile, { version: 1, entries: this.log });
  }

  /** Removes entries older than the retention period. */
  private pruneOld(): void {
    const hours = this.retentionHours();
    if (hours > 0) {
      const cutoff = nowMs() - hours * 3600_000;
      this.log = this.log.filter((e) => e.ts >= cutoff);
    }
    if (this.log.length > this.maxLog) {
      this.log.splice(0, this.log.length - this.maxLog);
    }
  }

  /** Subscribes to changes; returns an unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getProgress(): Readonly<SyncProgress> {
    return this.progress;
  }

  getLog(): ReadonlyArray<LogEntry> {
    return this.log;
  }

  clearLog(): void {
    this.log = [];
    this.emit();
    void this.save();
  }

  /** Triggers a re-render without changing data (e.g. for ticking duration). */
  touch(): void {
    if (this.progress.phase === "running") this.emit();
  }

  /**
   * Unconditionally notifies subscribers, regardless of phase. Used after the
   * plugin's `running` flag flips (e.g. at the end of a run) so UI that depends
   * on that flag re-evaluates — `touch()` won't do this once the phase is no
   * longer "running".
   */
  notify(): void {
    this.emit();
  }

  // ---- Mutations (called by the engine) ----

  start(message = t("statusSyncStarted"), startedMs: number): void {
    this.progress = {
      phase: "running",
      message,
      current: 0,
      total: 0,
      startedMs,
    };
    this.append("info", message);
  }

  setTotal(total: number): void {
    this.progress = { ...this.progress, total };
    this.emit();
  }

  /** Updates the running progress. */
  update(message: string, current: number, total?: number): void {
    this.progress = {
      ...this.progress,
      message,
      current,
      total: total ?? this.progress.total,
    };
    this.emit();
  }

  /** Writes a log line without a progress change. */
  append(level: LogEntry["level"], message: string): void {
    this.log.push({ ts: nowMs(), level, message });
    if (this.log.length > this.maxLog) {
      this.log.splice(0, this.log.length - this.maxLog);
    }
    this.emit();
    this.scheduleSave();
  }


  finish(phase: "done" | "error", message: string): void {
    this.progress = {
      ...this.progress,
      phase,
      message,
    };
    this.append(phase === "done" ? "success" : "error", message);
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* Listener errors must not affect the sync. */
      }
    }
  }
}

/**
 * Time helper. `Date.now()` is available in the normal plugin runtime; the
 * encapsulation makes testing easier.
 */
function nowMs(): number {
  return Date.now();
}
