// Minimal API helper using fetch with 401 auto-logout
const apiFetch = async (path, opts = {}) => {
  // Determine API base robustly:
  const base = (() => {
    // Server-side fallback
    if (typeof window === 'undefined') return '../server-php/index.php/api';

    // Explicit override (dev tunnel or config)
    if (window.API_BASE) return String(window.API_BASE).replace(/\/+$|\s+/g, '');

    // Derive project root from pathname (first path segment), e.g. '/3D1.1'
    const origin = window.location.origin.replace(/\/+$/, '');
    const parts = window.location.pathname.split('/').filter(Boolean);
    // If site is being served from a top-level /public (dev tunnel), don't treat 'public' as the project folder
    let projectRoot = '';
    if (parts.length) {
      const first = String(parts[0]).toLowerCase();
      if (first !== 'public') {
        projectRoot = '/' + parts[0];
      }
    }
    return origin + projectRoot + '/server-php/index.php/api';
  })();
  const url = base.replace(/\/+$/,'') + '/' + String(path).replace(/^\/?/, '');
  const token = localStorage.getItem('token');
  const headers = Object.assign({}, opts.headers || {});
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (!headers['Content-Type'] && opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  try {
    try {
      if (typeof window !== 'undefined' && typeof window.__touchSessionActivity === 'function') {
        window.__touchSessionActivity();
      }
    } catch (e) {}
    console.debug('[apiFetch] Request', opts.method || 'GET', url);
    const res = await fetch(url, Object.assign({}, opts, { headers }));

    // Read the response body as text once to avoid re-reading the stream.
    const resText = await res.text();

    if (!res.ok) {
      // handle 401 -> clear auth and redirect to login
      if (res.status === 401) {
        try { localStorage.removeItem('token'); localStorage.removeItem('user'); } catch (e) {}
        window.location.hash = '#/login';
        const err = new Error('Unauthorized');
        err.status = 401;
        throw err;
      }

      // Try to parse JSON from the text body for structured error info
      let body = null;
      try { body = resText ? JSON.parse(resText) : null; } catch (e) { body = resText; }
      const err = new Error((body && body.error) ? body.error : res.statusText || 'API error');
      err.status = res.status;
      err.body = body;
      throw err;
    }

    // For successful responses, attempt to parse JSON from the text
    try {
      try {
        if (typeof window !== 'undefined' && typeof window.__touchSessionActivity === 'function') {
          window.__touchSessionActivity();
        }
      } catch (e) {}
      return resText ? JSON.parse(resText) : null;
    } catch (parseErr) {
      console.error('[apiFetch] Invalid JSON received from', url, resText.slice(0,1000));
      const e = new Error('Invalid JSON response from ' + url + ': ' + (resText && resText.slice ? resText.slice(0,500) : String(resText)));
      e.bodyText = resText;
      throw e;
    }
  } catch (err) {
    // Preserve API errors (status/body) so callers can show real backend messages.
    const hasApiMeta = !!(err && (typeof err.status !== 'undefined' || typeof err.body !== 'undefined'));
    if (hasApiMeta) throw err;

    // Network or other unexpected errors
    console.error('[apiFetch] Network error', err, 'url=', url);
    const e = new Error('Network request failed to ' + url + ': ' + (err && err.message ? err.message : String(err)));
    e.original = err;
    throw e;
  }
};

const apiGet = (path) => apiFetch(path);
const apiPost = (path, payload) => apiFetch(path, { method: 'POST', body: JSON.stringify(payload) });
const apiPut = (path, payload) => apiFetch(path, { method: 'PUT', body: JSON.stringify(payload) });
const apiDelete = (path, payload) => apiFetch(path, { method: 'DELETE', body: payload ? JSON.stringify(payload) : undefined });

// expose globals for legacy code that expects apiGet/apiPost
try { window.apiFetch = apiFetch; window.apiGet = apiGet; window.apiPost = apiPost; window.apiPut = apiPut; window.apiDelete = apiDelete; } catch(e) {}

// exports for module consumers
export { apiFetch, apiGet, apiPost, apiPut, apiDelete };
