/**
 * Dot-path helpers for config sync's "ignore properties" feature.
 *
 * The user picks which properties of THIS plugin's `data.json` should sync. A
 * property is addressed by a normalized dot-path where array indices collapse to
 * `[]`, so one path covers every element of an array. For example
 * `targets[].excludeFolders` matches `targets[0].excludeFolders`,
 * `targets[1].excludeFolders`, … at once.
 *
 * All functions are pure (no I/O) and unit-tested — nested strip/preserve must
 * be exact, or an ignored field could leak to Drive or a download could blank a
 * device-local value.
 */

type Json = unknown;
type JsonObject = Record<string, Json>;

function isObject(v: Json): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Walks `obj` and returns every discoverable dot-path, with array indices
 * collapsed to `[]` and de-duplicated. Includes intermediate container paths
 * (objects and arrays) as well as leaves, so a UI can render a tree.
 *
 * Example: `{ a: 1, targets: [{ x: 1, excludeFolders: [] }] }` →
 *   ["a", "targets", "targets[]", "targets[].x", "targets[].excludeFolders"]
 *
 * `skipTopLevel` omits the given top-level keys (e.g. device-local keys that
 * never sync anyway).
 */
export function discoverPaths(
  obj: Json,
  skipTopLevel: readonly string[] = []
): string[] {
  const out = new Set<string>();
  const skip = new Set(skipTopLevel);

  const walk = (value: Json, path: string, depth: number): void => {
    if (Array.isArray(value)) {
      // The array container itself is already recorded by the caller; descend
      // into each element under a single `[]` segment (collapsed).
      const childPath = `${path}[]`;
      // Record the `[]` node only if elements exist (so empty arrays are leaves).
      let recordedContainer = false;
      for (const el of value) {
        if (isObject(el) || Array.isArray(el)) {
          if (!recordedContainer) {
            out.add(childPath);
            recordedContainer = true;
          }
          walk(el, childPath, depth + 1);
        } else if (!recordedContainer) {
          // Array of primitives → `[]` is a leaf; record it once.
          out.add(childPath);
          recordedContainer = true;
        }
      }
      return;
    }
    if (isObject(value)) {
      for (const key of Object.keys(value)) {
        if (depth === 0 && skip.has(key)) continue;
        const childPath = path ? `${path}.${key}` : key;
        out.add(childPath);
        walk(value[key], childPath, depth + 1);
      }
    }
    // Primitive leaves are recorded by the caller (the key loop above).
  };

  walk(obj, "", 0);
  return [...out];
}

/** Splits a normalized dot-path into segments, e.g. "a.b[].c" → ["a","b[]","c"]. */
function segments(path: string): string[] {
  return path.split(".").filter((s) => s.length > 0);
}

/** Is this segment an array segment ("key[]")? Returns the bare key if so. */
function arraySegment(seg: string): string | null {
  return seg.endsWith("[]") ? seg.slice(0, -2) : null;
}

/**
 * Deletes the value(s) at `path` in `obj` (mutating). For `[]` segments it
 * descends into every array element. No-op if the path is absent.
 */
export function deleteAtPath(obj: Json, path: string): void {
  applyLeaf(obj, segments(path), "delete", undefined);
}

/**
 * Returns the value(s) at `path`. For a path with `[]`, returns an array of the
 * per-element values (in element order, missing entries as `undefined`). For a
 * plain path, returns the single value (or `undefined`).
 */
export function getAtPath(obj: Json, path: string): Json {
  const collected: Json[] = [];
  applyLeaf(obj, segments(path), "get", undefined, collected);
  const hasArray = segments(path).some((s) => arraySegment(s) !== null);
  if (hasArray) return collected;
  return collected.length > 0 ? collected[0] : undefined;
}

/**
 * Sets the value(s) at `path` from `value` (mutating `obj`). For a `[]` path,
 * `value` must be the array returned by `getAtPath`; each element's value is
 * written onto the corresponding array element (by index) when that element
 * exists. Intermediate objects are NOT created — this only writes where the
 * container already exists (we preserve LOCAL values onto an INCOMING payload,
 * which already has the same shape).
 */
export function setAtPath(obj: Json, path: string, value: Json): void {
  applyLeaf(obj, segments(path), "set", value);
}

/**
 * Core walker shared by delete/get/set. Descends `segs`; on the final segment
 * performs the op. `[]` segments fan out over array elements.
 */
function applyLeaf(
  node: Json,
  segs: string[],
  op: "delete" | "get" | "set",
  value: Json,
  collected?: Json[],
  valueIndex = 0
): void {
  if (segs.length === 0) return;
  const [seg, ...rest] = segs;
  const arrKey = arraySegment(seg);

  if (arrKey !== null) {
    // Array segment: node must be an object holding an array at arrKey.
    if (!isObject(node)) return;
    const arr = node[arrKey];
    if (!Array.isArray(arr)) return;
    if (rest.length === 0) {
      // The array itself is the leaf (e.g. "targets[]" as a primitive array).
      // Treat as operating on the whole array value under arrKey.
      if (op === "delete") delete node[arrKey];
      else if (op === "get") collected?.push(arr);
      else if (op === "set") node[arrKey] = value;
      return;
    }
    // Fan out into each element.
    arr.forEach((el, i) => {
      applyLeaf(
        el,
        rest,
        op,
        // For set with a fanned-out value array, pick the per-element value.
        Array.isArray(value) ? value[i] : value,
        collected,
        i
      );
    });
    return;
  }

  // Plain object segment.
  if (!isObject(node)) return;
  if (rest.length === 0) {
    if (op === "delete") delete node[seg];
    else if (op === "get") collected?.push(node[seg]);
    else if (op === "set") {
      // Only write when the container path exists (don't fabricate structure).
      if (seg in node || value !== undefined) node[seg] = value;
    }
    return;
  }
  applyLeaf(node[seg], rest, op, value, collected, valueIndex);
}
