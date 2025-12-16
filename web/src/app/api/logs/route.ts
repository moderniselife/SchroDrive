import { NextResponse } from "next/server"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8978"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = searchParams.get("limit") || "100"
    const level = searchParams.get("level") || "all"

    const res = await fetch(`${BACKEND_URL}/api/logs?limit=${limit}&level=${level}`, {
      cache: "no-store",
    })
    
    const data = await res.json()
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("[api/logs] Failed to fetch logs:", error.message)
    return NextResponse.json(
      { ok: false, error: error.message, logs: [] },
      { status: 500 }
    )
  }
}

export async function DELETE() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/logs`, {
      method: "DELETE",
    })
    
    const data = await res.json()
    return NextResponse.json(data)
  } catch (error: any) {
    console.error("[api/logs] Failed to clear logs:", error.message)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    )
  }
}
