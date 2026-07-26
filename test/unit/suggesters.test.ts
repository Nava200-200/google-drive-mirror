import { describe, expect, it } from "vitest";
import { looksLikeDriveId } from "../../src/suggesters";

describe("looksLikeDriveId", () => {
  it("treats a real Drive folder ID as an ID (suppresses name-search)", () => {
    // Typical Drive folder IDs: a single ~33-char URL-safe base64 token.
    expect(looksLikeDriveId("1a2B3c4D5e6F7g8H9i0J1k2L3m4N5o6P7")).toBe(true);
    expect(looksLikeDriveId("0AJx-abcDEFghijklmnopqrstuvwxyz012")).toBe(true);
    // Surrounding whitespace (e.g. a pasted ID) is ignored.
    expect(looksLikeDriveId("  1a2B3c4D5e6F7g8H9i0J1k2L3m4N5o6P7  ")).toBe(true);
  });

  it("treats a folder name the user is searching for as NOT an ID", () => {
    expect(looksLikeDriveId("Obsidian")).toBe(false);
    expect(looksLikeDriveId("My Notes")).toBe(false); // has a space
    expect(looksLikeDriveId("project-2026")).toBe(false); // too short
    expect(looksLikeDriveId("")).toBe(false);
    expect(looksLikeDriveId("   ")).toBe(false);
  });

  it("a long token with spaces is a search phrase, not an ID", () => {
    expect(looksLikeDriveId("a very long folder name to look for")).toBe(false);
  });
});
