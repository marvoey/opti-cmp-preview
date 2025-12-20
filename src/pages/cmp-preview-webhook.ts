import type { APIRoute } from "astro";

// CMP API configuration from environment variables
const CMP_API_BASE_URL = import.meta.env.CMP_API_BASE_URL;
const CMP_OAUTH_CLIENT_ID = import.meta.env.CMP_OAUTH_CLIENT_ID;
const CMP_OAUTH_CLIENT_SECRET = import.meta.env.CMP_OAUTH_CLIENT_SECRET;
const CMP_AUTH_SERVER_URL = import.meta.env.CMP_AUTH_SERVER_URL;

if (!CMP_API_BASE_URL) {
  throw new Error("CMP_API_BASE_URL is not defined in .env file.");
}

if (!CMP_OAUTH_CLIENT_ID) {
  throw new Error("CMP_OAUTH_CLIENT_ID is not defined in .env file.");
}

if (!CMP_OAUTH_CLIENT_SECRET) {
  throw new Error("CMP_OAUTH_CLIENT_SECRET is not defined in .env file.");
}

if (!CMP_AUTH_SERVER_URL) {
  throw new Error("CMP_AUTH_SERVER_URL is not defined in .env file.");
}

// Token cache
interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  // Check if we have a valid cached token
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    console.log("Using cached access token");
    return tokenCache.accessToken;
  }

  console.log("Fetching new access token from CMP");

  const tokenUrl = `${CMP_AUTH_SERVER_URL}/o/oauth2/v1/token`;

  const params = new URLSearchParams({
    client_id: CMP_OAUTH_CLIENT_ID,
    client_secret: CMP_OAUTH_CLIENT_SECRET,
    grant_type: "client_credentials"
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to obtain access token: ${response.status} ${response.statusText}. Details: ${errorText}`
    );
  }

  const data = await response.json();

  if (!data.access_token || !data.expires_in) {
    throw new Error("Invalid token response: missing access_token or expires_in");
  }

  // Cache the token with 5-minute buffer before expiration
  const expiresInMs = (data.expires_in - 300) * 1000;
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs
  };

  console.log(`Access token obtained, expires in ${data.expires_in} seconds`);

  return data.access_token;
}

async function acknowledgePreview(
  contentId: string,
  versionId: string,
  previewId: string,
  acknowledgedBy: string,
  contentHash: string
): Promise<void> {
  const acknowledgeUrl = `${CMP_API_BASE_URL}/v3/structured-content/contents/${contentId}/versions/${versionId}/previews/${previewId}/acknowledge`;

  console.log("Acknowledging preview at:", acknowledgeUrl);

  // Get a valid access token (cached or fresh)
  const accessToken = await getAccessToken();

  const response = await fetch(acknowledgeUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      acknowledged_by: acknowledgedBy,
      content_hash: contentHash
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to acknowledge preview: ${response.status} ${response.statusText}. Details: ${errorText}`
    );
  }

  console.log("Preview acknowledged successfully");
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
        console.log("structured_contents:", body?.data?.assets?.structured_contents[0]);
      } catch (parseError) {
        console.log("Body is not JSON, treating as text");
        return new Response(
          JSON.stringify({
            error: "Invalid JSON payload"
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
    }

    // Extract required fields from webhook payload
    const contentId = body?.data?.assets?.structured_contents[0]?.id;
    const versionId = body?.data?.assets?.structured_contents[0]?.version_id;
    const previewId = body?.data?.preview_id;
    const updatedBy = body?.data?.assets?.structured_contents[0]?.content_body?.updated_by;
    const contentHash = body?.data?.assets?.structured_contents[0]?.content_body?.fields_version?.content_hash;

    if (!contentId || !versionId || !previewId || !updatedBy || !contentHash) {
      console.error("Missing required fields:", { contentId, versionId, previewId, updatedBy, contentHash });
      return new Response(
        JSON.stringify({
          error: "Missing required fields: contentId, versionId, previewId, updatedBy, or contentHash"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Acknowledge the preview with CMP
    try {
      await acknowledgePreview(contentId, versionId, previewId, updatedBy, contentHash);
      console.log("Preview acknowledged:", { contentId, versionId, previewId, updatedBy, contentHash });
    } catch (acknowledgeError) {
      console.error("Failed to acknowledge preview:", acknowledgeError);
      return new Response(
        JSON.stringify({
          error: "Failed to acknowledge preview",
          details: acknowledgeError instanceof Error ? acknowledgeError.message : String(acknowledgeError)
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // TODO: Generate the actual preview here

    return new Response(
      JSON.stringify({
        message: "Webhook received and preview acknowledged successfully",
        acknowledged: true,
        contentId,
        versionId,
        previewId
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
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
};
