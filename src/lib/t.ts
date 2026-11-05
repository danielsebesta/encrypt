/** Tiny translate helper with no locale JSON imports. */
export function t(dict: Record<string, string>, key: string): string {
  return dict[key] ?? key;
}

/** Inside the installed app the wording talks about the phone and the app; everywhere else it says browser. */
export function tApp(dict: Record<string, string>, key: string, app: boolean): string {
  return (app ? dict[`${key}.app`] : undefined) ?? dict[key] ?? key;
}
