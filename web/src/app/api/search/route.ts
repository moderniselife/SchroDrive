import { NextResponse } from "next/server"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8978"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get("q") || ""
    const categories = searchParams.get("categories") || ""

    if (!query) {
      return NextResponse.json(
        { ok: false, error: "Missing query parameter 'q'", results: [] },
        { status: 400 }
      )
    }

    const url = new URL(`${BACKEND_URL}/api/search`)
    url.searchParams.set("q", query)
    if (categories) url.searchParams.set("categories", categories)

    const res = await fetch(url.toString(), {
      cache: "no-store",
    })
    
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (error: any) {
    console.error("[api/search] Failed to search:", error.message)
    return NextResponse.json(
      { ok: false, error: error.message, results: [] },
      { status: 500 }
    )
  }
}
