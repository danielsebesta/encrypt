export function t(dict: Record<string, string>, key: string): string {
  return dict[key] ?? key;
}

export function tApp(dict: Record<string, string>, key: string, app: boolean): string {
  return (app ? dict[`${key}.app`] : undefined) ?? dict[key] ?? key;
}
