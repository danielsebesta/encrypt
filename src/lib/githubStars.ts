const CACHE_MS = 60 * 60 * 1000;

let cache: { value: number | null; expiresAt: number } | null = null;

// Fetched at build time or from the Worker, so visitors' browsers never contact GitHub.
export async function getGithubStars(repo = 'danielsebesta/encrypt'): Promise<number | null> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;
  let value: number | null = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'encrypt.click/1' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json() as { stargazers_count?: unknown };
      if (typeof data.stargazers_count === 'number') value = data.stargazers_count;
    }
  } catch {}
  cache = { value, expiresAt: now + CACHE_MS };
  return value;
}
