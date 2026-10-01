export async function fetchWithCf(
  url: string,
  init?: RequestInit
): Promise<string> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`fetchWithCf ${res.status}: ${url}`);
  }
  return res.text();
}