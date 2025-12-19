import type { APIRoute } from "astro";

// CMP API Base URL from environment variables
const CMP_API_BASE_URL = import.meta.env.CMP_API_BASE_URL;

if (!CMP_API_BASE_URL) {
  throw new Error("CMP_API_BASE_URL is not defined in .env file.");
}

export const POST: APIRoute = async ({ request }) => {
  console.log("Received CMP preview webhook request.");

  try {
    const body = await request.json();
    console.log("Request Body:", body);

    // TODO: Process the webhook data here
    // You can now use CMP_API_BASE_URL to make API calls if needed

    return new Response(
      JSON.stringify({
        message: "Webhook received successfully",
        received: true
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
        error: "Failed to process webhook"
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
