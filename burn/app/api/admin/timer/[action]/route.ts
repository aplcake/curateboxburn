import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API       = process.env.API_URL!;
const ADMIN_KEY = process.env.ADMIN_API_KEY!;

export async function POST(
  _req: NextRequest,
  { params }: { params: { action: string } }
) {
  const { action } = params;
  if (!['start', 'stop'].includes(action))
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  const r = await fetch(`${API}/admin/timer/${action}`, {
    method:  'POST',
    headers: { 'x-admin-key': ADMIN_KEY },
  });
  const data = await r.json();
  return NextResponse.json(data, { status: r.status });
}
