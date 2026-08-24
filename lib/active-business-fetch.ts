const ACTIVE_BUSINESS_KEY = 'moneymatters.activeBusinessId';

/**
 * Keeps the existing get_my_business_context() contract intact while making
 * the browser-selected business the first context row consumed by legacy
 * workspaces. RLS remains the authorization boundary; this only controls
 * active-business presentation/query scoping in the client.
 */
export const businessAwareFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (typeof window === 'undefined' || response.status >= 400) return response;

  const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
  if (!url.includes('/rest/v1/rpc/get_my_business_context')) return response;

  const activeBusinessId = window.localStorage.getItem(ACTIVE_BUSINESS_KEY);
  if (!activeBusinessId) return response;

  try {
    const payload = await response.clone().json();
    if (!Array.isArray(payload)) return response;
    const index = payload.findIndex((row) => row?.business_id === activeBusinessId);
    if (index <= 0) return response;

    const reordered = [payload[index], ...payload.slice(0, index), ...payload.slice(index + 1)];
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(reordered), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
};
