import { NextRequest, NextResponse } from "next/server"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8978"

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  try {
    const response = await fetch(`${BACKEND_URL}/api/organizer/review/${encodeURIComponent(id)}/audit`, { cache: "no-store" })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message, audit: [] }, { status: 502 })
  }
}
