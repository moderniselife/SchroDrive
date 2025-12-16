import { NextResponse } from "next/server"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8978"

export async function GET() {
  const url = `${BACKEND_URL}/api/torrents`
  
  try {
    console.log(`[api/torrents] Fetching from ${url}`)
    const res = await fetch(url, {
      cache: "no-store",
    })
    
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error(`[api/torrents] Backend error: ${res.status} - ${text}`)
      throw new Error(`Backend returned ${res.status}`)
    }
    
    const data = await res.json()
    return NextResponse.json(data)
  } catch (error: any) {
    console.error(`[api/torrents] Failed to fetch from ${url}:`, error.message)
    return NextResponse.json(
      { 
        ok: false, 
        error: error.message,
        backendUrl: BACKEND_URL,
        torrents: [],
      },
      { status: 500 }
    )
  }
}
