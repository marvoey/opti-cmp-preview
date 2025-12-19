import type { APIRoute } from "astro";

// CMP API Base URL from environment variables
const CMP_API_BASE_URL = import.meta.env.CMP_API_BASE_URL;

if (!CMP_API_BASE_URL) {
  throw new Error("CMP_API_BASE_URL is not defined in .env file.");
}

export const POST: APIRoute = async ({ request }) => {
  console.log("Received CMP preview webhook request.");
  console.log("Content-Type:", request.headers.get("content-type"));

  try {
    // Get the raw body text first
    const rawBody = await request.text();
    console.log("Raw Body:", rawBody);
    console.log("Body length:", rawBody.length);

    // Try to parse as JSON if body is not empty
    let body = null;
    if (rawBody && rawBody.length > 0) {
      try {
        body = JSON.parse(rawBody);
        console.log("Parsed JSON Body:", body);
      } catch (parseError) {
        console.log("Body is not JSON, treating as text");
      }
    }

    // TODO: Process the webhook data here
    // You can now use CMP_API_BASE_URL to make API calls if needed

    return new Response(
      JSON.stringify({
        message: "Webhook received successfully",
        received: true,
        bodyReceived: rawBody.length > 0
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  } catch (error) {
    console.error("Error processing webhook:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to process webhook",
        details: error instanceof Error ? error.message : String(error)
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
};
