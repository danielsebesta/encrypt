/** Tiny translate helper with no locale JSON imports. */
export function t(dict: Record<string, string>, key: string): string {
  return dict[key] ?? key;
}
