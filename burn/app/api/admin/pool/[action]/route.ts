import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
const API = process.env.API_URL!;
const ADMIN_KEY = process.env.ADMIN_API_KEY!;
export async function POST(_req: NextRequest, { params }: { params: { action: string } }) {
  const { action } = params;
  if (!['start','stop'].includes(action)) return NextResponse.json({error:'Invalid action'},{status:400});
  const r = await fetch(`${API}/admin/pool/${action}`, { method:'POST', headers:{'x-admin-key':ADMIN_KEY} });
  return NextResponse.json(await r.json(), { status: r.status });
}
