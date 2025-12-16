const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8978"

export async function GET() {
  const url = `${BACKEND_URL}/api/downloads/stream`
  
  try {
    const res = await fetch(url, {
      cache: "no-store",
    })
    
    if (!res.ok || !res.body) {
      throw new Error(`Backend returned ${res.status}`)
    }
    
    // Forward the SSE stream directly
    return new Response(res.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    })
  } catch (error: any) {
    // Return error as SSE event
    const errorEvent = `event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`
    return new Response(errorEvent, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    })
  }
}
