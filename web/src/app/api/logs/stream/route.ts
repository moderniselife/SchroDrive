const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8978"

export async function GET() {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await fetch(`${BACKEND_URL}/api/logs/stream`, {
          cache: "no-store",
        })

        if (!response.body) {
          controller.close()
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          
          const chunk = decoder.decode(value, { stream: true })
          controller.enqueue(encoder.encode(chunk))
        }

        controller.close()
      } catch (error: any) {
        console.error("[api/logs/stream] Error:", error.message)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
}
