import { NextResponse } from "next/server"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8978"

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/config`, {
      cache: "no-store",
    })
    
    if (!res.ok) {
      throw new Error(`Backend returned ${res.status}`)
    }
    
    const data = await res.json()
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("[api/config] Failed to fetch config:", error.message)
    return NextResponse.json(
      { 
        ok: false, 
        error: error.message,
      },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    const res = await fetch(`${BACKEND_URL}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    
    if (!res.ok) {
      throw new Error(`Backend returned ${res.status}`)
    }
    
    const data = await res.json()
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("[api/config] Failed to save config:", error.message)
    return NextResponse.json(
      { 
        ok: false, 
        error: error.message,
      },
      { status: 500 }
    )
  }
}
