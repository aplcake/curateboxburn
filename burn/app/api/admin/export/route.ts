import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API = process.env.API_URL!;

export async function GET(req: NextRequest) {
  const adminKey = req.headers.get('x-admin-key');
  if (!adminKey)
    return NextResponse.json({ error: 'Admin key required' }, { status: 401 });

  const r = await fetch(`${API}/admin/burns/export`, {
    headers: { 'x-admin-key': adminKey },
  });

  if (!r.ok)
    return NextResponse.json({ error: 'Export failed' }, { status: r.status });

  const csv  = await r.text();
  return new NextResponse(csv, {
    headers: {
      'Content-Type':        'text/csv',
      'Content-Disposition': 'attachment; filename="burns.csv"',
    },
  });
}
