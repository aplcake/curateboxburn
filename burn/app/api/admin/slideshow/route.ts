import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API       = process.env.API_URL!;
const ADMIN_KEY = process.env.ADMIN_API_KEY!;

export async function POST(req: NextRequest) {
  const body = await req.json();

  const r = await fetch(`${API}/admin/slideshow`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key':  ADMIN_KEY,
    },
    body: JSON.stringify(body),
  });

  const data = await r.json();
  return NextResponse.json(data, { status: r.status });
}
