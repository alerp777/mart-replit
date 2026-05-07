import { readCsrfFromCookie } from './adminAuthContext.js';
import { safeSessionSet } from './safeStorage';
import { toast } from '@/hooks/use-toast';

/**
 * Typed Error for non-2xx admin fetcher responses. Replaces the previous
 * `(error as any).status = …` pattern so callers can `instanceof`
 * narrow and read the HTTP status without `any`.
 */
export class AdminFetchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminFetchError';
    this.status = status;
  }
}

/**
 * Typed error for requests that exceeded the timeout window.
 * Callers can `instanceof TimeoutError` to show specific UX.
 */
export class TimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** Abort requests that take longer than this (milliseconds). */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Returns an AbortSignal that fires after `ms` milliseconds.
 * Merges with an optional external signal so either side can abort.
 */
function timeoutSignal(ms: number, externalSignal?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(new TimeoutError()), ms);

  // Clear the timer if the controller's own signal fires first
  controller.signal.addEventListener('abort', () => clearTimeout(timerId), { once: true });

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener(
        'abort',
        () => { clearTimeout(timerId); controller.abort(externalSignal.reason); },
        { once: true },
      );
    }
  }

  return controller.signal;
}

/**
 * If an error is a TimeoutError (or an AbortError caused by our timeout),
 * show a toast so the user knows the request hung.
 */
function handleTimeoutError(err: unknown, retry?: () => void): void {
  const isTimeout =
    err instanceof TimeoutError ||
    (err instanceof DOMException && err.name === 'AbortError' && err.message.includes('timeout'));
  if (!isTimeout) return;
  toast({
    title: 'Request timed out',
    description: 'Check your connection and try again.',
    variant: 'destructive',
    action: retry
      ? {
          altText: 'Retry',
          onClick: retry,
        } as any
      : undefined,
  });
}

// Global handlers set by the app
let getAccessToken: (() => string | null) | null = null;
let refreshToken: (() => Promise<string>) | null = null;

/**
 * Set up global token handlers
 * Called from the App component to connect the fetcher to the auth context
 */
export function setupAdminFetcherHandlers(
  tokenGetter: () => string | null,
  tokenRefresher: () => Promise<string>
) {
  getAccessToken = tokenGetter;
  refreshToken = tokenRefresher;
}

/**
 * Admin API fetcher with auto-refresh, CSRF protection, and 30-second timeout.
 * - Automatically includes Authorization header with access token
 * - Automatically includes X-CSRF-Token header by reading from cookie
 * - Automatically refreshes token on 401 and retries
 * - Redirects to login on repeated 401
 * - Aborts and shows a toast after FETCH_TIMEOUT_MS
 */
export async function fetchAdmin(
  endpoint: string,
  options: RequestInit = {}
): Promise<any> {
  if (!getAccessToken || !refreshToken) {
    throw new Error('Admin fetcher not initialized. Call setupAdminFetcherHandlers first.');
  }

  let token = getAccessToken();

  // If no token, try to refresh
  if (!token) {
    try {
      token = await refreshToken();
    } catch (err) {
      // Refresh failed - need to redirect to login
      console.error('Token refresh failed (no token):', err);
      const loginUrl = `${import.meta.env.BASE_URL || '/'}login`;
      safeSessionSet('admin_session_expired', 'Your session has expired. Please log in again.');
      window.location.href = loginUrl;
      throw err;
    }
  }

  const csrf = readCsrfFromCookie();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'X-CSRF-Token': csrf,
    ...(options.headers as Record<string, string> | undefined),
  };

  const makeRequest = async (accessToken: string) => {
    const signal = timeoutSignal(FETCH_TIMEOUT_MS, options.signal as AbortSignal | undefined);

    let response: Response;
    try {
      response = await fetch(`/api/admin${endpoint}`, {
        ...options,
        signal,
        headers: {
          ...headers,
          'Authorization': `Bearer ${accessToken}`,
        },
        credentials: 'include', // Include cookies (refresh_token, csrf_token)
      });
    } catch (err) {
      if (err instanceof TimeoutError || (err instanceof DOMException && err.name === 'AbortError')) {
        handleTimeoutError(new TimeoutError());
      }
      throw err;
    }

    // Handle 401 Unauthorized
    if (response.status === 401) {
      // Try to refresh token once
      try {
        const newToken = await refreshToken!();
        headers['Authorization'] = `Bearer ${newToken}`;

        const retrySignal = timeoutSignal(FETCH_TIMEOUT_MS);
        // Retry the request with new token
        const retryResponse = await fetch(`/api/admin${endpoint}`, {
          ...options,
          signal: retrySignal,
          headers,
          credentials: 'include',
        });

        if (!retryResponse.ok) {
          throw new Error(`HTTP ${retryResponse.status}`);
        }

        return retryResponse;
      } catch (err) {
        // Refresh or retry failed - redirect to login
        console.error('Token refresh failed:', err);
        const loginUrl = `${import.meta.env.BASE_URL || '/'}login`;
        safeSessionSet('admin_session_expired', 'Your session has expired. Please log in again.');
        window.location.href = loginUrl;
        throw new Error('Session expired. Please log in again.');
      }
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new AdminFetchError(errorData.error || `HTTP ${response.status}`, response.status);
    }

    return response;
  };

  const response = await makeRequest(token);
  return response.json();
}

/**
 * Same as fetchAdmin but takes an absolute API path (e.g. `/api/kyc/...`,
 * `/api/payments/...`) instead of being scoped to `/api/admin`.
 * Use this for admin-authenticated routes that live outside `/api/admin/*`.
 */
export async function fetchAdminAbsolute(
  path: string,
  options: RequestInit = {}
): Promise<any> {
  if (!getAccessToken || !refreshToken) {
    throw new Error('Admin fetcher not initialized. Call setupAdminFetcherHandlers first.');
  }
  if (!path.startsWith('/')) {
    throw new Error(`fetchAdminAbsolute requires an absolute path starting with "/", got: ${path}`);
  }

  let token = getAccessToken();
  if (!token) {
    try {
      token = await refreshToken();
    } catch (err) {
      console.error('Token refresh failed (no token, absolute):', err);
      const loginUrl = `${import.meta.env.BASE_URL || '/'}login`;
      safeSessionSet('admin_session_expired', 'Your session has expired. Please log in again.');
      window.location.href = loginUrl;
      throw err;
    }
  }

  const csrf = readCsrfFromCookie();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'X-CSRF-Token': csrf,
    ...(options.headers as Record<string, string> | undefined),
  };

  let response: Response;
  try {
    const signal = timeoutSignal(FETCH_TIMEOUT_MS, options.signal as AbortSignal | undefined);
    response = await fetch(path, {
      ...options,
      signal,
      headers: { ...headers, 'Authorization': `Bearer ${token}` },
      credentials: 'include',
    });
  } catch (err) {
    handleTimeoutError(err);
    throw err;
  }

  if (response.status === 401) {
    try {
      const newToken = await refreshToken!();
      headers['Authorization'] = `Bearer ${newToken}`;
      const retrySignal = timeoutSignal(FETCH_TIMEOUT_MS);
      response = await fetch(path, { ...options, signal: retrySignal, headers, credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      console.error('Token refresh failed (absolute):', err);
      const loginUrl = `${import.meta.env.BASE_URL || '/'}login`;
      safeSessionSet('admin_session_expired', 'Your session has expired. Please log in again.');
      window.location.href = loginUrl;
      throw new Error('Session expired. Please log in again.');
    }
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new AdminFetchError(errorData.error || `HTTP ${response.status}`, response.status);
  }

  return response.json();
}

/**
 * Same as fetchAdminAbsolute but returns the raw Response (not parsed JSON).
 * Use for binary downloads (blobs, CSV exports) while still benefiting from
 * Bearer + CSRF + auto-refresh.
 */
export async function fetchAdminAbsoluteResponse(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  if (!getAccessToken || !refreshToken) {
    throw new Error('Admin fetcher not initialized. Call setupAdminFetcherHandlers first.');
  }
  if (!path.startsWith('/')) {
    throw new Error(`fetchAdminAbsoluteResponse requires an absolute path starting with "/", got: ${path}`);
  }

  let token = getAccessToken();
  if (!token) {
    try { token = await refreshToken(); }
    catch (err) {
      console.error('Token refresh failed (no token, response):', err);
      safeSessionSet('admin_session_expired', 'Your session has expired. Please log in again.');
      window.location.href = `${import.meta.env.BASE_URL || '/'}login`;
      throw err;
    }
  }

  const csrf = readCsrfFromCookie();
  const baseHeaders: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'X-CSRF-Token': csrf,
    ...(options.headers as Record<string, string> | undefined),
  };

  let response: Response;
  try {
    const signal = timeoutSignal(FETCH_TIMEOUT_MS, options.signal as AbortSignal | undefined);
    response = await fetch(path, { ...options, signal, headers: baseHeaders, credentials: 'include' });
  } catch (err) {
    handleTimeoutError(err);
    throw err;
  }

  if (response.status === 401) {
    try {
      const newToken = await refreshToken!();
      baseHeaders['Authorization'] = `Bearer ${newToken}`;
      const retrySignal = timeoutSignal(FETCH_TIMEOUT_MS);
      response = await fetch(path, { ...options, signal: retrySignal, headers: baseHeaders, credentials: 'include' });
    } catch (err) {
      console.error('Token refresh failed (response):', err);
      safeSessionSet('admin_session_expired', 'Your session has expired. Please log in again.');
      window.location.href = `${import.meta.env.BASE_URL || '/'}login`;
      throw new Error('Session expired. Please log in again.');
    }
  }

  return response;
}

/**
 * Read the current in-memory access token (or null). Useful for non-fetch
 * call sites such as Socket.IO `auth` payloads.
 */
export function getAdminAccessToken(): string | null {
  return getAccessToken ? getAccessToken() : null;
}

/**
 * Convenience methods for common HTTP verbs
 */
export async function adminGet(endpoint: string): Promise<any> {
  return fetchAdmin(endpoint, { method: 'GET' });
}

export async function adminPost(endpoint: string, data?: any): Promise<any> {
  return fetchAdmin(endpoint, {
    method: 'POST',
    body: data ? JSON.stringify(data) : undefined,
  });
}

export async function adminPut(endpoint: string, data?: any): Promise<any> {
  return fetchAdmin(endpoint, {
    method: 'PUT',
    body: data ? JSON.stringify(data) : undefined,
  });
}

export async function adminDelete(endpoint: string): Promise<any> {
  return fetchAdmin(endpoint, { method: 'DELETE' });
}

export async function adminPatch(endpoint: string, data?: any): Promise<any> {
  return fetchAdmin(endpoint, {
    method: 'PATCH',
    body: data ? JSON.stringify(data) : undefined,
  });
}
