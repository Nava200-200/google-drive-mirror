import { describe, it, expect } from "vitest";
import { isSystemPath } from "../../src/sync-engine";

/**
 * Config sync stores its files under an `.obsidian/` subtree inside the Drive
 * config root (mirroring the vault config folder). Note sync's remote import
 * filters every listed Drive file through `isSystemPath(relativePath, configDir)`
 * (sync-engine.ts). So even if a note target's Drive folder overlapped the config
 * root, note sync would SKIP the config files instead of pulling them into the
 * vault. This test pins that isolation guarantee.
 */
describe("config-sync isolation via isSystemPath", () => {
  const cfg = ".obsidian";

  it("skips the mirrored plugin data file", () => {
    expect(
      isSystemPath(".obsidian/plugins/google-drive-mirror/data.json", cfg)
    ).toBe(true);
  });

  it("skips the verifier blob", () => {
    expect(isSystemPath(".obsidian/config-sync-verifier.json", cfg)).toBe(true);
  });

  it("skips any future config tree under .obsidian", () => {
    for (const p of [
      ".obsidian/appearance.json",
      ".obsidian/hotkeys.json",
      ".obsidian/themes/Custom/theme.css",
      ".obsidian/plugins/other-plugin/data.json",
    ]) {
      expect(isSystemPath(p, cfg)).toBe(true);
    }
  });

  it("still syncs ordinary notes (does NOT over-match)", () => {
    expect(isSystemPath("Notes/todo.md", cfg)).toBe(false);
    // A note folder that merely contains the substring is not the config dir.
    expect(isSystemPath("my.obsidian-notes/a.md", cfg)).toBe(false);
  });

  it("honors a renamed config dir (not hardcoded .obsidian)", () => {
    expect(
      isSystemPath(".myconfig/plugins/google-drive-mirror/data.json", ".myconfig")
    ).toBe(true);
    // `.obsidian` at the vault root is ALWAYS excluded (it's a root dot-folder),
    // even when the config dir was renamed to something else.
    expect(isSystemPath(".obsidian/x.json", ".myconfig")).toBe(true);
  });

  describe("vault-root hidden dot-folders", () => {
    it("excludes any root-level dot-folder (.smart-env, .git, …)", () => {
      for (const p of [
        ".smart-env/embeddings.json",
        ".git/config",
        ".trash/old.md",
        ".foo",
        ".obsidian/app.json",
      ]) {
        expect(isSystemPath(p, cfg)).toBe(true);
      }
    });

    it("does NOT exclude a dot-file inside a normal folder", () => {
      expect(isSystemPath("Notes/.keep", cfg)).toBe(false);
      expect(isSystemPath("Attachments/.hidden/x.png", cfg)).toBe(false);
    });
  });
});
