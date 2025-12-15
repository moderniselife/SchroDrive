import { NextResponse } from "next/server"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8978"

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/torrents`, {
      cache: "no-store",
    })
    
    if (!res.ok) {
      throw new Error(`Backend returned ${res.status}`)
    }
    
    const data = await res.json()
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("[api/torrents] Failed to fetch torrents:", error.message)
    return NextResponse.json(
      { 
        ok: false, 
        error: error.message,
        torrents: [],
      },
      { status: 500 }
    )
  }
}
