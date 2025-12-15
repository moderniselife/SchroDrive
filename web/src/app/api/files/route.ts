import { NextResponse } from "next/server"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8978"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const path = searchParams.get("path") || "/"
    
    const url = `${BACKEND_URL}/api/files?path=${encodeURIComponent(path)}`
    console.log(`[api/files] Fetching from ${url}`)
    
    const res = await fetch(url, {
      cache: "no-store",
    })
    
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error(`[api/files] Backend error: ${res.status} - ${text}`)
      return NextResponse.json(
        { ok: false, error: `Backend returned ${res.status}`, items: [] },
        { status: res.status }
      )
    }
    
    const data = await res.json()
    return NextResponse.json(data)
  } catch (error: any) {
    console.error(`[api/files] Error:`, error.message)
    return NextResponse.json(
      { ok: false, error: error.message, items: [] },
      { status: 500 }
    )
  }
}
