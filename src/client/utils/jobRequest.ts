export async function jobRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const data = await response.json().catch(() => undefined);
  if (!response.ok || data === undefined) {
    throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`);
  }
  return data;
}
