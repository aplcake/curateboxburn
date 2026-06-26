const API = process.env.NEXT_PUBLIC_API_URL;

// Guard against missing env var — shows a clear error rather than a cryptic 404
function apiUrl(path: string): string {
  if (!API) {
    console.error('[burn] NEXT_PUBLIC_API_URL is not set. Add it to Vercel env vars.');
    throw new Error('API URL not configured');
  }
  return `${API}${path}`;
}

export type BurnStatus = {
  eventLive:  boolean;
  burn1Open:  boolean;
  burn2Open:  boolean;
  burn2Count: number;
  totalBurn1: number;
  totalBurn2: number;
};

export const getStatus = async (): Promise<BurnStatus> => {
  const r = await fetch(apiUrl('/status'));
  if (!r.ok) throw new Error('Failed to fetch status');
  return r.json();
};

export type WalletBurns = { burnedTier1: boolean; burnedTier2: boolean };

export const getWalletBurns = async (address: string): Promise<WalletBurns> => {
  const r = await fetch(apiUrl(`/burns/wallet/${address}`));
  if (!r.ok) return { burnedTier1: false, burnedTier2: false };
  return r.json();
};

export const recordBurn = async (txHash: string, tier: 1 | 2) => {
  const r = await fetch(apiUrl('/burns'), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ txHash, tier }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Failed to record burn');
  return data;
};

// Admin calls go through Next.js API routes (keeps ADMIN_API_KEY server-side)
export const adminAction = async (action: 'close' | 'open') => {
  const r = await fetch(`/api/admin/burn1/${action}`, { method: 'POST' });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Admin action failed');
  return data;
};

export const setEventLive = async (live: boolean) => {
  const action = live ? 'go-live' : 'coming-soon';
  const r = await fetch(`/api/admin/event/${action}`, { method: 'POST' });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Failed to update event status');
  return data;
};

export type SlideshowItem = {
  id:         number;
  openseaUrl: string;
  name:       string | null;
  imageUrl:   string | null;
};

export const getSlideshow = async (): Promise<SlideshowItem[]> => {
  const r = await fetch(apiUrl('/slideshow'));
  if (!r.ok) return [];
  return r.json();
};

export type SlideshowSaveResult = {
  openseaUrl: string;
  name:       string | null;
  imageUrl:   string | null;
  error:      string | null;
};

export const saveSlideshow = async (urls: string[]): Promise<SlideshowSaveResult[]> => {
  const r = await fetch('/api/admin/slideshow', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ urls }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Failed to save slideshow');
  return data.results;
};

export const downloadCSV = () => {
  window.location.href = '/api/admin/export';
};
