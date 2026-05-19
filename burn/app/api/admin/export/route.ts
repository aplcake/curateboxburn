import { NextResponse } from 'next/server';

const API       = process.env.API_URL!;
const ADMIN_KEY = process.env.ADMIN_API_KEY!;

export async function GET() {
  const r = await fetch(`${API}/admin/burns/export`, {
    headers: { 'x-admin-key': ADMIN_KEY },
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
