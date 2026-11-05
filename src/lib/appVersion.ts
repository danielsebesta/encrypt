export type AppVersion = { commit: string; date: string };

export const CURRENT_VERSION: AppVersion = { commit: __APP_COMMIT__, date: __APP_DATE__ };

export const isDevBuild = CURRENT_VERSION.commit === 'dev';

export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

/** The newest deployed build, as the site itself names it. Never served from a cache, so it reflects what a reload would load. */
export async function fetchLatestVersion(): Promise<AppVersion | null> {
  try {
    const response = await fetch('/build-integrity.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const data: { commitSha?: unknown; sourceDate?: unknown } = await response.json();
    if (typeof data?.commitSha !== 'string' || !/^[0-9a-f]{40}$/.test(data.commitSha)) return null;
    return { commit: data.commitSha, date: typeof data.sourceDate === 'string' ? data.sourceDate : '' };
  } catch {
    return null;
  }
}

export function formatVersionDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function describeVersion(version: AppVersion, locale: string): string {
  const date = formatVersionDate(version.date, locale);
  return date ? `${shortCommit(version.commit)} · ${date}` : shortCommit(version.commit);
}
