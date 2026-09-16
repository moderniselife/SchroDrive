import { NextRequest, NextResponse } from "next/server"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8978"

export async function GET(request: NextRequest) {
  const includeResolved = request.nextUrl.searchParams.get("includeResolved") === "true"
  try {
    const response = await fetch(`${BACKEND_URL}/api/organizer/review?includeResolved=${includeResolved}`, { cache: "no-store" })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message, entries: [] }, { status: 502 })
  }
}

