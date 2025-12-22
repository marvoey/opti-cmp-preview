import type { MiddlewareHandler } from 'astro';

export const onRequest: MiddlewareHandler = async (context, next) => {
  // Add ngrok-skip-browser-warning header to response
  // This won't help with iframe loads but documents the intent
  const response = await next();

  // Clone the response to modify headers
  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });

  // Add CORS headers to allow iframe embedding
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  newResponse.headers.set('X-Frame-Options', 'ALLOWALL');
  newResponse.headers.delete('X-Frame-Options'); // Remove if set by default

  return newResponse;
};
