import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API = process.env.API_URL!;

export async function POST(req: NextRequest) {
  const adminKey = req.headers.get('x-admin-key');
  if (!adminKey)
    return NextResponse.json({ error: 'Admin key required' }, { status: 401 });

  const r = await fetch(`${API}/admin/remint`, {
    method:  'POST',
    headers: { 'x-admin-key': adminKey },
  });
  const data = await r.json();
  return NextResponse.json(data, { status: r.status });
}
