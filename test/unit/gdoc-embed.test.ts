import { describe, expect, it } from "vitest";
import {
  GOOGLE_DOC_MIME,
  GOOGLE_SHEET_MIME,
  KIND_META,
  buildStub,
  editUrl,
  isGoogleFileStub,
  kindForMime,
  parseGdocBlock,
  parseStub,
  stubBaseName,
  stubPath,
} from "../../src/gdoc-embed";

describe("kindForMime", () => {
  it("maps the Google Apps MIME types to kinds", () => {
    expect(kindForMime(GOOGLE_DOC_MIME)).toBe("doc");
    expect(kindForMime(GOOGLE_SHEET_MIME)).toBe("sheet");
    expect(kindForMime("application/vnd.google-apps.presentation")).toBe("slide");
    expect(kindForMime("application/vnd.google-apps.drawing")).toBe("drawing");
  });
  it("returns null for unsupported kinds (e.g. Forms, folders)", () => {
    expect(kindForMime("application/vnd.google-apps.form")).toBeNull();
    expect(kindForMime("application/vnd.google-apps.folder")).toBeNull();
    expect(kindForMime("text/markdown")).toBeNull();
  });
});

describe("isGoogleFileStub", () => {
  it("recognizes .gdoc.md and .gsheet.md files (case-insensitive)", () => {
    expect(isGoogleFileStub("notes/My Doc.gdoc.md")).toBe(true);
    expect(isGoogleFileStub("Budget.GSHEET.MD")).toBe(true);
  });
  it("rejects normal notes", () => {
    expect(isGoogleFileStub("notes/My Doc.md")).toBe(false);
    expect(isGoogleFileStub("gdoc.md")).toBe(false); // needs the ".gdoc.md" suffix
    expect(isGoogleFileStub("a.gsheet")).toBe(false);
    expect(isGoogleFileStub("x.gsheet.md")).toBe(true);
  });
});

describe("stubBaseName", () => {
  it("strips filesystem-illegal characters", () => {
    expect(stubBaseName('Q3 / Plan: "draft"?', "id1")).toBe("Q3 Plan draft");
  });
  it("falls back to a per-kind name when nothing usable remains", () => {
    expect(stubBaseName("///", "abc123", "doc")).toBe("google-doc-abc123");
    expect(stubBaseName("", "abc123", "sheet")).toBe("google-sheet-abc123");
  });
});

describe("stubPath", () => {
  it("uses the kind's suffix", () => {
    expect(stubPath("sub", "My Doc", "id1", "doc")).toBe("sub/My Doc.gdoc.md");
    expect(stubPath("sub", "Budget", "id1", "sheet")).toBe("sub/Budget.gsheet.md");
  });
  it("handles the vault root (no dir)", () => {
    expect(stubPath("", "Budget", "id1", "sheet")).toBe("Budget.gsheet.md");
  });
});

describe("editUrl", () => {
  it("builds the canonical editor URL per kind", () => {
    expect(editUrl("abc123", "doc")).toBe(
      "https://docs.google.com/document/d/abc123/edit"
    );
    expect(editUrl("abc123", "sheet")).toBe(
      "https://docs.google.com/spreadsheets/d/abc123/edit"
    );
    expect(editUrl("abc123", "slide")).toBe(
      "https://docs.google.com/presentation/d/abc123/edit"
    );
    expect(editUrl("abc123", "drawing")).toBe(
      "https://docs.google.com/drawings/d/abc123/edit"
    );
  });
});

describe("buildStub / parseStub round-trip", () => {
  for (const kind of ["doc", "sheet", "slide", "drawing"] as const) {
    it(`parses back the id, title and kind it wrote (${kind})`, () => {
      const text = buildStub({ driveId: "abc123", title: "My File", kind });
      expect(parseStub(text)).toEqual({ driveId: "abc123", title: "My File", kind });
    });
  }

  it("preserves a title with special characters via JSON encoding", () => {
    const title = 'Weird: "quotes" and \\ backslash';
    const text = buildStub({ driveId: "id9", title, kind: "sheet" });
    expect(parseStub(text)).toEqual({ driveId: "id9", title, kind: "sheet" });
  });

  it("is deterministic (same input -> byte-identical output)", () => {
    const a = buildStub({ driveId: "x", title: "T", kind: "sheet" });
    const b = buildStub({ driveId: "x", title: "T", kind: "sheet" });
    expect(a).toBe(b);
  });

  it("defaults kind to doc for a pre-Sheets stub (no gdocKind)", () => {
    const legacy = "---\ngdoc: true\ngdocId: legacy1\ngdocTitle: \"Old\"\n---\n";
    expect(parseStub(legacy)).toEqual({ driveId: "legacy1", title: "Old", kind: "doc" });
  });

  it("returns null for a non-stub file", () => {
    expect(parseStub("# Just a note\n\nno frontmatter")).toBeNull();
    expect(parseStub("---\nfoo: bar\n---\n")).toBeNull();
  });
});

describe("parseGdocBlock", () => {
  it("extracts id, title and kind from the code block body", () => {
    expect(parseGdocBlock("kind: sheet\nid: abc123\ntitle: Budget")).toEqual({
      driveId: "abc123",
      title: "Budget",
      kind: "sheet",
    });
  });
  it("defaults kind to doc when absent", () => {
    expect(parseGdocBlock("id: abc123\ntitle: My Doc")).toEqual({
      driveId: "abc123",
      title: "My Doc",
      kind: "doc",
    });
  });
  it("returns null when no id is present", () => {
    expect(parseGdocBlock("title: My Doc")).toBeNull();
  });
});

describe("KIND_META", () => {
  it("has a distinct suffix per kind", () => {
    const suffixes = Object.values(KIND_META).map((m) => m.suffix);
    expect(new Set(suffixes).size).toBe(suffixes.length);
  });
});
