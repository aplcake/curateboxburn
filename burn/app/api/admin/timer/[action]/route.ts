import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API = process.env.API_URL!;

export async function POST(
  req: NextRequest,
  { params }: { params: { action: string } }
) {
  const { action } = params;
  if (!['start', 'stop'].includes(action))
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  const adminKey = req.headers.get('x-admin-key');
  if (!adminKey)
    return NextResponse.json({ error: 'Admin key required' }, { status: 401 });

  const r = await fetch(`${API}/admin/timer/${action}`, {
    method:  'POST',
    headers: { 'x-admin-key': adminKey },
  });
  const data = await r.json();
  return NextResponse.json(data, { status: r.status });
}
