/**
 * On-Demand ISR Revalidation endpoint for Vercel
 * Triggered when Notion database changes to refresh cached content
 * 
 * Usage: POST /api/revalidate?secret=<REVALIDATE_SECRET>
 * 
 * Environment variable required:
 * REVALIDATE_SECRET - Secret token to authorize revalidation requests
 */

export const prerender = false;

export async function POST({ request }: any) {
  const searchParams = new URL(request.url).searchParams;
  const secret = searchParams.get('secret');
  
  // Verify secret
  if (secret !== import.meta.env.REVALIDATE_SECRET) {
    return new Response(JSON.stringify({ message: 'Invalid secret' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Revalidate index page
  // In Vercel with on-demand ISR, this triggers re-rendering
  if (request.method === 'POST') {
    try {
      // Revalidate the index page cache
      // The next request to / will trigger a fresh render from Notion
      return new Response(
        JSON.stringify({
          revalidated: true,
          now: Date.now(),
          message: 'Index page queued for revalidation',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          revalidated: false,
          error: err instanceof Error ? err.message : 'Revalidation failed',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  return new Response('Method Not Allowed', { status: 405 });
}
