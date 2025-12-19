import type { APIRoute } from "astro";

// CMP API Base URL from environment variables
const CMP_API_BASE_URL = import.meta.env.CMP_API_BASE_URL;

if (!CMP_API_BASE_URL) {
  throw new Error("CMP_API_BASE_URL is not defined in .env file.");
}

export const POST: APIRoute = ({ request }) => {
  console.log("Received CMP preview webhook request.");
  console.log("Request Body:", request.body);
  return new Response(
    JSON.stringify({
      message: "This was a POST!",
    })
  );
};
