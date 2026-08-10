/**
 * Resolve a path inside `public/`.
 *
 * Next rewrites its own bundle URLs for `basePath`, but not files served out of
 * `public/` — a bare "/terrain/gale-mola.bin" would 404 on a GitHub Pages
 * project site. Everything that fetches an asset goes through here.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function asset(path: string): string {
  return `${BASE_PATH}${path}`;
}
