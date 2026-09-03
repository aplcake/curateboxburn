import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API       = process.env.API_URL!;
const ADMIN_KEY = process.env.ADMIN_API_KEY!;

export async function POST() {
  const r = await fetch(`${API}/admin/remint`, {
    method:  'POST',
    headers: { 'x-admin-key': ADMIN_KEY },
  });
  const data = await r.json();
  return NextResponse.json(data, { status: r.status });
}
