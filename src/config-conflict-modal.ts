import { App, Modal, Setting } from "obsidian";
import { ConflictChoice } from "./config-sync";
import { t } from "./i18n";

/**
 * Asks the user which side to keep when this plugin's settings changed on BOTH
 * this device and Drive since the last config sync. Resolves with the chosen
 * direction, or `undefined` if the user cancels (then nothing is written).
 */
export class ConfigConflictModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private localMtime: number,
    private remoteMtime: number,
    private resolve: (choice: ConflictChoice | undefined) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(t("configConflictTitle"));
    this.contentEl.createEl("p", { text: t("configConflictBody") });

    const fmt = (ms: number) =>
      ms ? new Date(ms).toLocaleString() : "—";
    const info = this.contentEl.createDiv();
    info.createEl("div", {
      text: t("configConflictLocalMtime", { time: fmt(this.localMtime) }),
    });
    info.createEl("div", {
      text: t("configConflictRemoteMtime", { time: fmt(this.remoteMtime) }),
    });

    // Default the CTA to whichever side is newer ("newer wins" as a hint).
    const localIsNewer = this.localMtime >= this.remoteMtime;

    const buttons = new Setting(this.contentEl);
    buttons.addButton((b) => {
      b.setButtonText(t("configConflictKeepLocal"));
      if (localIsNewer) b.setCta();
      b.onClick(() => this.finish("keepLocal"));
    });
    buttons.addButton((b) => {
      b.setButtonText(t("configConflictKeepRemote"));
      if (!localIsNewer) b.setCta();
      b.onClick(() => this.finish("keepRemote"));
    });
    buttons.addButton((b) => {
      b.setButtonText(t("configConflictCancel"));
      b.onClick(() => this.finish(undefined));
    });
  }

  private finish(choice: ConflictChoice | undefined): void {
    this.resolved = true;
    this.resolve(choice);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    // Closing via Esc / click-outside counts as cancel.
    if (!this.resolved) this.resolve(undefined);
  }
}
