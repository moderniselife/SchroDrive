import { NextResponse } from "next/server"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8978"

export async function GET() {
  const url = `${BACKEND_URL}/api/downloads`
  
  try {
    console.log(`[api/downloads] Fetching from ${url}`)
    const res = await fetch(url, {
      cache: "no-store",
    })
    
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error(`[api/downloads] Backend error: ${res.status} - ${text}`)
      throw new Error(`Backend returned ${res.status}`)
    }
    
    const data = await res.json()
    return NextResponse.json(data)
  } catch (error: any) {
    console.error(`[api/downloads] Error:`, error.message)
    return NextResponse.json(
      { ok: false, error: error.message, downloads: [] },
      { status: 500 }
    )
  }
}
