import { NextResponse } from "next/server"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8978"

export async function POST() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/restart`, {
      method: "POST",
    })
    
    if (!res.ok) {
      throw new Error(`Backend returned ${res.status}`)
    }
    
    const data = await res.json()
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("[api/restart] Failed to restart:", error.message)
    return NextResponse.json(
      { 
        ok: false, 
        error: error.message,
      },
      { status: 500 }
    )
  }
}
