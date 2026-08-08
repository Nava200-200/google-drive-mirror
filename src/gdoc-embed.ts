/**
 * Google Workspace "live embed" feature — a discovery + view layer that is
 * fully SEPARATE from the two-way sync engine. Covers native Google Docs and
 * Google Sheets (extendable to Slides etc. via KIND_META).
 *
 * A Google Doc/Sheet (an `application/vnd.google-apps.*`) has no downloadable
 * binary content, so it can never take part in the reconciler (the engine
 * deliberately skips Google Apps files). Instead, when enabled per target, the
 * engine writes a tiny STUB note per file: `<name>.gdoc.md` (Docs) /
 * `<name>.gsheet.md` (Sheets). The stub holds only a pointer (the Drive file id
 * + a link), never the document content — so there is nothing to hash, upload,
 * or round-trip, and the sync's deletion-safety model is untouched.
 *
 * These stub files are auto-EXCLUDED from the reconciler on both sides (see
 * `isGoogleFileStub` usage in sync-engine.ts), exactly like a system path, so
 * they are never uploaded back to Drive nor treated as "deleted on one side".
 *
 * Rendering: a `gdoc` fenced code block inside the stub (carrying the `kind`) is
 * turned into a live, EDITABLE embed of the Google editor on desktop (Electron
 * `<webview>`), and into an "open in Google …" button on mobile (Obsidian
 * mobile has no `<webview>`, and Google refuses to be framed via a plain
 * `<iframe>`).
 *
 * The pure functions here (`buildStub`/`parseStub`/`editUrl`/…) are unit-tested
 * in test/unit/gdoc-embed.test.ts.
 */

import { Platform } from "obsidian";
import { t, MessageKey } from "./i18n";

/** Fenced language used inside a stub so the code-block processor picks it up. */
export const GDOC_BLOCK_LANG = "gdoc";

/** A supported native Google Workspace file kind. */
export type GoogleFileKind = "doc" | "sheet" | "slide" | "drawing" | "gfile";

/** Per-kind metadata: MIME type, editor URL, stub suffix, i18n labels. */
interface KindMeta {
  /** `application/vnd.google-apps.*` MIME type this kind maps to. */
  mime: string;
  /** Filename suffix marking a stub note of this kind (e.g. `.gdoc.md`). */
  suffix: string;
  /** Builds the canonical editor URL for a file id of this kind. */
  editUrl: (driveId: string) => string;
  /** i18n key for the "open in …" button/link label. */
  openLabelKey: MessageKey;
  /** Fallback base name when a title sanitizes to nothing. */
  fallbackPrefix: string;
}

/**
 * The single source of truth for each supported kind. Adding a new kind (e.g.
 * Slides) is a matter of one more entry here plus its i18n label + suffix.
 */
export const KIND_META: Record<GoogleFileKind, KindMeta> = {
  doc: {
    mime: "application/vnd.google-apps.document",
    suffix: ".gdoc.md",
    editUrl: (id) => `https://docs.google.com/document/d/${id}/edit`,
    openLabelKey: "gdocOpenInDrive",
    fallbackPrefix: "google-doc",
  },
  sheet: {
    mime: "application/vnd.google-apps.spreadsheet",
    suffix: ".gsheet.md",
    editUrl: (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`,
    openLabelKey: "gsheetOpenInDrive",
    fallbackPrefix: "google-sheet",
  },
  slide: {
    mime: "application/vnd.google-apps.presentation",
    suffix: ".gslides.md",
    editUrl: (id) => `https://docs.google.com/presentation/d/${id}/edit`,
    openLabelKey: "gslidesOpenInDrive",
    fallbackPrefix: "google-slides",
  },
  drawing: {
    mime: "application/vnd.google-apps.drawing",
    suffix: ".gdraw.md",
    editUrl: (id) => `https://docs.google.com/drawings/d/${id}/edit`,
    openLabelKey: "gdrawOpenInDrive",
    fallbackPrefix: "google-drawing",
  },
  gfile: {
    mime: "application/x-obsidian-gfile", // Dummy mime for large binary files
    suffix: ".gfile.md",
    editUrl: (id) => `https://drive.google.com/file/d/${id}/view`,
    openLabelKey: "gfileOpenInDrive",
    fallbackPrefix: "drive-file",
  },
};

/** MIME type of a native Google Doc (Docs editor file). */
export const GOOGLE_DOC_MIME = KIND_META.doc.mime;
/** MIME type of a native Google Sheet (Sheets editor file). */
export const GOOGLE_SHEET_MIME = KIND_META.sheet.mime;

/** Resolves a Google Apps MIME type to a supported kind, or null. */
export function kindForMime(mime: string): GoogleFileKind | null {
  for (const [kind, meta] of Object.entries(KIND_META)) {
    if (meta.mime === mime) return kind as GoogleFileKind;
  }
  return null;
}

/** True if a vault-relative path is any Google file stub note. */
export function isGoogleFileStub(path: string): boolean {
  const lower = path.toLowerCase();
  return Object.values(KIND_META).some((m) => lower.endsWith(m.suffix));
}

/**
 * Turns an arbitrary title into a filesystem-safe base name (without the stub
 * suffix). Strips characters Obsidian/OSes reject in filenames and collapses
 * whitespace; falls back to a per-kind name if nothing usable remains.
 */
export function stubBaseName(
  title: string,
  driveId: string,
  kind: GoogleFileKind = "doc"
): string {
  const cleaned = title
    // Characters illegal on common filesystems or special to Obsidian links.
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || `${KIND_META[kind].fallbackPrefix}-${driveId}`;
}

/** Vault-relative stub path for a file, placed under `dir` (its Drive folder). */
export function stubPath(
  dir: string,
  title: string,
  driveId: string,
  kind: GoogleFileKind = "doc"
): string {
  const name = `${stubBaseName(title, driveId, kind)}${KIND_META[kind].suffix}`;
  return dir ? `${dir}/${name}` : name;
}

/** Canonical editor URL for a file id of the given kind. */
export function editUrl(driveId: string, kind: GoogleFileKind = "doc"): string {
  return KIND_META[kind].editUrl(driveId);
}

/** Parsed contents of a Google file stub note. */
export interface StubData {
  driveId: string;
  title: string;
  kind: GoogleFileKind;
}

/**
 * Builds the full text of a stub note. Frontmatter carries machine-readable
 * pointers; the body has a human-readable link plus the `gdoc` code block that
 * the renderer replaces with the live embed. Deterministic (no timestamps), so
 * an unchanged file regenerates byte-identical content (no needless rewrites).
 */
export function buildStub(data: StubData): string {
  const { driveId, title, kind } = data;
  return [
    "---",
    "gdoc: true",
    `gdocKind: ${kind}`,
    `gdocId: ${driveId}`,
    `gdocTitle: ${JSON.stringify(title)}`,
    "---",
    "",
    `# ${title}`,
    "",
    `[${t(KIND_META[kind].openLabelKey)}](${editUrl(driveId, kind)})`,
    "",
    "```" + GDOC_BLOCK_LANG,
    `kind: ${kind}`,
    `id: ${driveId}`,
    `title: ${title}`,
    "```",
    "",
  ].join("\n");
}

/**
 * Extracts the id/title/kind from a stub note's frontmatter. Returns null if the
 * file is not a recognizable stub. Tolerant of hand edits: reads the
 * `gdocId`/`gdocTitle`/`gdocKind` frontmatter keys. A missing `gdocKind`
 * defaults to `doc` (backward compatible with pre-Sheets stubs).
 */
export function parseStub(content: string): StubData | null {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const body = fm[1];
  const idMatch = body.match(/^gdocId:\s*(.+)$/m);
  if (!idMatch) return null;
  const driveId = idMatch[1].trim();
  if (!driveId) return null;
  const titleMatch = body.match(/^gdocTitle:\s*(.+)$/m);
  let title = titleMatch ? titleMatch[1].trim() : "";
  // The title is JSON-encoded on write; decode defensively.
  if (title.startsWith('"')) {
    try {
      title = JSON.parse(title) as string;
    } catch {
      /* keep the raw value */
    }
  }
  const kindMatch = body.match(/^gdocKind:\s*(.+)$/m);
  const kind = normalizeKind(kindMatch?.[1]);
  return { driveId, title, kind };
}

/**
 * Parses the `kind:`/`id:`/`title:` lines of a `gdoc` fenced code block (the
 * block the renderer receives as its source). Returns null when no id is
 * present. A missing `kind` defaults to `doc` (backward compatible).
 */
export function parseGdocBlock(source: string): StubData | null {
  const idMatch = source.match(/^\s*id:\s*(.+)$/m);
  if (!idMatch) return null;
  const driveId = idMatch[1].trim();
  if (!driveId) return null;
  const titleMatch = source.match(/^\s*title:\s*(.+)$/m);
  const kindMatch = source.match(/^\s*kind:\s*(.+)$/m);
  return {
    driveId,
    title: titleMatch ? titleMatch[1].trim() : "",
    kind: normalizeKind(kindMatch?.[1]),
  };
}

/** Maps a raw kind string to a supported kind (defaults to `doc`). */
function normalizeKind(raw: string | undefined): GoogleFileKind {
  const v = raw?.trim();
  if (v === "sheet" || v === "slide" || v === "drawing" || v === "gfile") return v;
  return "doc";
}

/**
 * Renders a `gdoc` code block into `el`.
 *
 * Desktop (Electron): an editable `<webview>` loading the Google editor —
 * editing happens live in Google's own editor (no conversion, no round-trip).
 * Mobile: a link/button that opens the file externally, since Obsidian mobile
 * has no `<webview>` and Google blocks plain iframing.
 *
 * `openExternal` is injected so tests / non-Obsidian callers can substitute it.
 */
export function renderGdocBlock(
  el: HTMLElement,
  source: string,
  openExternal: (url: string) => void = (url) => window.open(url, "_blank")
): void {
  el.empty();
  const data = parseGdocBlock(source);
  if (!data) {
    el.createEl("div", {
      cls: "gds-gdoc-error",
      text: t("gdocInvalidBlock"),
    });
    return;
  }

  const url = editUrl(data.driveId, data.kind);
  const wrap = el.createDiv({ cls: "gds-gdoc-embed" });

  if (Platform.isDesktopApp) {
    // Electron <webview>: a full, editable Google editor. Not in the DOM typings,
    // so build it via createEl with attributes.
    const webview = wrap.createEl("webview" as keyof HTMLElementTagNameMap, {
      cls: "gds-gdoc-webview",
    });
    webview.setAttribute("src", url);
    // Allow the embedded page popups (e.g. share dialogs) to open externally.
    webview.setAttribute("allowpopups", "");
  } else {
    // Mobile: cannot embed; offer to open the file externally.
    const info = wrap.createDiv({ cls: "gds-gdoc-mobile" });
    if (data.title) info.createEl("div", { cls: "gds-gdoc-title", text: data.title });
    const btn = info.createEl("button", {
      cls: "mod-cta",
      text: t(KIND_META[data.kind].openLabelKey),
    });
    btn.addEventListener("click", () => openExternal(url));
  }
}
