const API = process.env.NEXT_PUBLIC_API_URL!;

export type BurnStatus = {
  burn1Open:  boolean;
  burn2Open:  boolean;
  burn2Count: number;
  totalBurn1: number;
  totalBurn2: number;
};

export const getStatus = async (): Promise<BurnStatus> => {
  const r = await fetch(`${API}/status`);
  if (!r.ok) throw new Error('Failed to fetch status');
  return r.json();
};

export const recordBurn = async (txHash: string, tier: 1 | 2) => {
  const r = await fetch(`${API}/burns`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ txHash, tier }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Failed to record burn');
  return data;
};

// Admin calls go through our own Next.js API routes (keeps ADMIN_API_KEY server-side)
export const adminAction = async (action: 'close' | 'open') => {
  const r = await fetch(`/api/admin/burn1/${action}`, { method: 'POST' });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Admin action failed');
  return data;
};

export const downloadCSV = () => {
  window.location.href = '/api/admin/export';
};
