import type { APIRoute } from "astro";

/**
 * Optimizely CMP Preview Webhook Handler
 *
 * This endpoint implements the "Render Preview with Push Strategy" protocol for Optimizely CMP.
 *
 * PROTOCOL OVERVIEW:
 * ------------------
 * Step 1: Webhook Delivery (implemented)
 *   - CMP delivers a preview request webhook when content needs rendering preview
 *   - Webhook contains content data, version info, and preview ID
 *
 * Step 2: Acknowledgment (implemented)
 *   - Preview generator acknowledges receipt after verifying it can handle the content type
 *   - Acknowledgment includes a content_hash from the webhook payload
 *   - CMP uses this hash as a digest signature to determine if previews have become outdated
 *
 * Step 3: Preview Generation (implemented)
 *   - Generate preview URLs for multiple device types/channels
 *   - Preview types: default, mobile, desktop, tablet, signage
 *   - URLs follow pattern: CMP_PREVIEW_URL/preview/{type}/{previewId}
 *
 * Step 4: Completion (implemented)
 *   - Submit preview links via the completion endpoint
 *   - Provide keyed_previews dictionary mapping preview types to URLs
 *
 * Step 5: Cleanup (TODO - not yet implemented)
 *   - Allow ~15 minutes before cleaning up draft content
 *   - CMP caches the URL for an indefinite period
 */

// CMP API configuration from environment variables
const CMP_API_BASE_URL = import.meta.env.CMP_API_BASE_URL;
const CMP_OAUTH_CLIENT_ID = import.meta.env.CMP_OAUTH_CLIENT_ID;
const CMP_OAUTH_CLIENT_SECRET = import.meta.env.CMP_OAUTH_CLIENT_SECRET;
const CMP_AUTH_SERVER_URL = import.meta.env.CMP_AUTH_SERVER_URL;
const CMP_PREVIEW_URL = import.meta.env.CMP_PREVIEW_URL;

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

if (!CMP_PREVIEW_URL) {
  throw new Error("CMP_PREVIEW_URL is not defined in .env file.");
}

/**
 * Token cache interface
 * CMP OAuth tokens are cached to avoid unnecessary token requests
 */
interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

/**
 * Obtains an OAuth access token from CMP for API authentication
 * Uses client_credentials grant type and caches the token until expiration
 *
 * @returns {Promise<string>} A valid OAuth access token
 */
async function getAccessToken(): Promise<string> {
  // Check if we have a valid cached token to avoid unnecessary API calls
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

  // Cache the token with 5-minute (300 seconds) buffer before expiration
  // This ensures we refresh the token before it actually expires
  const expiresInMs = (data.expires_in - 300) * 1000;
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs
  };

  console.log(`Access token obtained, expires in ${data.expires_in} seconds`);

  return data.access_token;
}

/**
 * PROTOCOL STEP 2: Acknowledge Preview Request
 *
 * Sends an acknowledgment to CMP confirming that this preview generator:
 * 1. Has received the webhook request
 * 2. Can handle the specific content type
 * 3. Will process the preview generation
 *
 * The content_hash is critical - CMP uses it as a digest signature to determine
 * if previews have become outdated when content changes.
 *
 * @param {string} contentId - The structured content ID from CMP
 * @param {string} versionId - The content version ID
 * @param {string} previewId - The unique preview request ID
 * @param {string} acknowledgedBy - The user who triggered the preview (from webhook payload)
 * @param {string} contentHash - Content hash from $.data.assets.structured_contents[0].content_body.fields_version.content_hash
 */
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

  // Send the acknowledgment to CMP with required fields:
  // - acknowledged_by: The user who triggered the preview (from webhook payload)
  // - content_hash: The content hash that CMP will use to track content changes
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

/**
 * PROTOCOL STEP 3: Generate Preview URLs
 *
 * Creates preview URLs for different device types/channels.
 * Each preview URL points to the preview page with a unique identifier.
 *
 * @param {string} contentId - The content ID to use in the preview URL
 * @returns {Record<string, string>} Dictionary of preview types mapped to their URLs
 */
function generatePreviewUrls(contentId: string): Record<string, string> {
  const previewTypes = ['default', 'mobile', 'desktop', 'tablet', 'signage'];
  const keyedPreviews: Record<string, string> = {};

  for (const type of previewTypes) {
    // Generate preview URL in format: CMP_PREVIEW_URL/preview/{type}/{previewId}
    keyedPreviews[type] = `${CMP_PREVIEW_URL}/preview/${type}/${contentId}`;
  }

  console.log("Generated preview URLs:", keyedPreviews);
  return keyedPreviews;
}

/**
 * PROTOCOL STEP 4: Submit Completion
 *
 * Submits the generated preview URLs back to CMP, completing the preview generation workflow.
 * CMP will cache these URLs and present them to content editors for preview.
 *
 * @param {string} contentId - The structured content ID from CMP
 * @param {string} versionId - The content version ID
 * @param {string} previewId - The unique preview request ID
 * @param {Record<string, string>} keyedPreviews - Dictionary mapping preview types to URLs
 */
async function submitPreviewCompletion(
  contentId: string,
  versionId: string,
  previewId: string,
  keyedPreviews: Record<string, string>
): Promise<void> {
  const completionUrl = `${CMP_API_BASE_URL}/v3/structured-content/contents/${contentId}/versions/${versionId}/previews/${previewId}/complete`;

  console.log("Submitting preview completion at:", completionUrl);
  console.log("Keyed previews:", keyedPreviews);

  // Get a valid access token (cached or fresh)
  const accessToken = await getAccessToken();

  // Submit the preview URLs to CMP
  const response = await fetch(completionUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      keyed_previews: keyedPreviews
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to submit preview completion: ${response.status} ${response.statusText}. Details: ${errorText}`
    );
  }

  console.log("Preview completion submitted successfully");
}

/**
 * PROTOCOL STEP 1: Webhook Delivery Handler
 *
 * This endpoint receives preview request webhooks from Optimizely CMP.
 * The webhook is triggered when a content editor requests a preview of their content.
 *
 * Webhook Payload Structure:
 * - data.preview_id: Unique identifier for this preview request
 * - data.assets.structured_contents[0].id: Content ID
 * - data.assets.structured_contents[0].version_id: Content version ID
 * - data.assets.structured_contents[0].content_body.updated_by: User who triggered the preview
 * - data.assets.structured_contents[0].content_body.fields_version.content_hash: Hash for tracking content changes
 * - data.assets.structured_contents[0].content_body.fields: The actual content fields to preview
 */
export const POST: APIRoute = async ({ request }) => {
  console.log("Received CMP preview webhook request.");
  console.log("Content-Type:", request.headers.get("content-type"));

  try {
    // Get the raw body text first
    const rawBody = await request.text();
    
    // Try to parse as JSON if body is not empty
    let data = null;
    if (rawBody && rawBody.length > 0) {
      try {
         data = JSON.parse(rawBody).data;
        console.log("Parsed Data:", data);
        console.log("structured_contents:", data?.assets?.structured_contents);
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
    // These fields are essential for the preview protocol:
    // - contentId, versionId, previewId: Identify the specific content and preview request
    // - updatedBy: The user who triggered the preview (required for acknowledgment)
    // - contentHash: Critical digest signature that CMP uses to track if content has changed
    const contentId = data?.assets?.structured_contents[0]?.id;
    const versionId = data?.assets?.structured_contents[0]?.version_id;
    const previewId = data?.preview_id;
    const updatedBy = data?.assets?.structured_contents[0]?.content_body?.updated_by;
    const contentHash = data?.assets?.structured_contents[0]?.content_body?.fields_version?.content_hash;

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

    // PROTOCOL STEP 2: Acknowledge the preview with CMP
    // This confirms we've received the webhook and can handle the content type
    // Must be done before starting the actual preview generation
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

    // PROTOCOL STEP 3: Generate Preview URLs
    // Generate preview URLs for different device types/channels
    const keyedPreviews = generatePreviewUrls(contentId);

    // PROTOCOL STEP 4: Submit Completion
    // Submit the preview URLs back to CMP
    try {
      await submitPreviewCompletion(contentId, versionId, previewId, keyedPreviews);
      console.log("Preview completion submitted:", { contentId, versionId, previewId, keyedPreviews });
    } catch (completionError) {
      console.error("Failed to submit preview completion:", completionError);
      return new Response(
        JSON.stringify({
          error: "Failed to submit preview completion",
          details: completionError instanceof Error ? completionError.message : String(completionError)
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // PROTOCOL STEP 5: Cleanup (TODO - NOT YET IMPLEMENTED)
    // -------------------------------------------------------
    // Schedule cleanup of draft content after ~15 minutes
    // Note: CMP caches the URL indefinitely, so the preview must remain accessible
    //       for at least 15 minutes after submission

    return new Response(
      JSON.stringify({
        message: "Webhook received, preview acknowledged and completed successfully",
        acknowledged: true,
        completed: true,
        contentId,
        versionId,
        previewId,
        keyedPreviews
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
