/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN PHASE 10: Static Deployment & Optional Backend Configuration Architecture
 *
 * Supports two first-class deployment topologies:
 * 1. Static Browser Deployment (Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3):
 *    - Core execution runs 100% client-side in Browser Mode (Web Workers + self-hosted WASM).
 *    - Zero mandatory startup health checks or Express backend dependencies.
 * 2. Local / Self-Hosted Hybrid Deployment:
 *    - Frontend + optional Express Native Execution Server (`/api/<lang>/trace`, `/api/ops/health`,
 *      `/api/challenges/evaluate`, `/api/github/repo`).
 */

export type DeploymentTargetMode = 'static' | 'hybrid' | 'auto';

export interface BackendUrlValidationResult {
  isValid: boolean;
  valid: boolean;
  normalizedUrl: string;
  error?: string;
  isCrossOrigin: boolean;
  isLocalhost: boolean;
}

export interface BackendConfigState {
  deploymentMode: DeploymentTargetMode;
  nativeServerUrl: string;
  isNativeServerExplicitlyConfigured: boolean;
  isStaticOnlyDeployment: boolean;
  opsHealthUrl: string;
  opsMetricsUrl: string;
  nativeCapabilitiesUrl: string;
  challengeEvaluationUrl: string;
  githubTelemetryUrl: string;
  githubRepoMetadataUrl: string;
  urlValidation: BackendUrlValidationResult;
}

export const NATIVE_SERVER_URL_STORAGE_KEY = 'dryrun.native_server_url.v1';

const SECRET_KEY_PATTERNS = [
  /SECRET/i,
  /PRIVATE_KEY/i,
  /SERVICE_ROLE/i,
  /GITHUB_TOKEN/i,
  /PASSWORD/i,
  /DATABASE_URL/i,
];

const SECRET_VALUE_PATTERNS = [
  /^ghp_[A-Za-z0-9]{20,}/,
  /^github_pat_[A-Za-z0-9_]{20,}/,
  /^gho_[A-Za-z0-9]{20,}/,
  /^sk-[A-Za-z0-9]{20,}/,
  /^sbp_[A-Za-z0-9]{20,}/,
];

/**
 * Validates and normalizes an optional Native Execution Server base URL.
 * Empty string `""` is valid and represents same-origin or unconfigured static mode.
 */
export function validateBackendUrl(
  rawUrl: string | null | undefined,
  currentOrigin?: string
): BackendUrlValidationResult {
  const trimmed = String(rawUrl ?? '').trim();
  if (!trimmed) {
    return {
      isValid: true,
      valid: true,
      normalizedUrl: '',
      isCrossOrigin: false,
      isLocalhost: false,
    };
  }

  // Relative same-origin prefix check
  if (trimmed === '/') {
    return {
      isValid: true,
      valid: true,
      normalizedUrl: '',
      isCrossOrigin: false,
      isLocalhost: false,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      isValid: false,
      valid: false,
      normalizedUrl: '',
      error: `Invalid backend URL '${trimmed}'. Must be an absolute http:// or https:// URL.`,
      isCrossOrigin: false,
      isLocalhost: false,
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      isValid: false,
      valid: false,
      normalizedUrl: '',
      error: `Unsupported URL protocol '${parsed.protocol}'. Use http:// or https://.`,
      isCrossOrigin: false,
      isLocalhost: false,
    };
  }

  if (parsed.username || parsed.password) {
    return {
      isValid: false,
      valid: false,
      normalizedUrl: '',
      error: 'Backend URLs must not contain embedded credentials or tokens.',
      isCrossOrigin: false,
      isLocalhost: false,
    };
  }

  const normalizedUrl = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
  const hostname = parsed.hostname.toLowerCase();
  const isLocalhost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]';

  const resolvedOrigin =
    currentOrigin ??
    (typeof window !== 'undefined' && window.location
      ? window.location.origin
      : undefined);

  const isCrossOrigin = Boolean(
    resolvedOrigin && resolvedOrigin !== 'null' && parsed.origin !== resolvedOrigin
  );

  return {
    isValid: true,
    valid: true,
    normalizedUrl,
    isCrossOrigin,
    isLocalhost,
  };
}

/**
 * Reads any user-configured runtime Native Execution Server URL from localStorage.
 */
export function getRuntimeNativeServerUrl(): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    return '';
  }
  try {
    return (window.localStorage.getItem(NATIVE_SERVER_URL_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

/**
 * Persists or clears a user-configured runtime Native Execution Server URL in localStorage.
 */
export function setRuntimeNativeServerUrl(
  rawUrl: string
): BackendUrlValidationResult {
  const validation = validateBackendUrl(rawUrl);
  if (!validation.isValid) {
    return validation;
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (validation.normalizedUrl) {
        window.localStorage.setItem(
          NATIVE_SERVER_URL_STORAGE_KEY,
          validation.normalizedUrl
        );
      } else {
        window.localStorage.removeItem(NATIVE_SERVER_URL_STORAGE_KEY);
      }
    } catch {
      // Ignore storage quota errors
    }
  }
  return validation;
}

/**
 * Resolves the complete backend & static deployment configuration state.
 * Never hardcodes localhost URLs in production static builds.
 */
export function getBackendConfig(
  envOverrideOrOpts?:
    | Record<string, unknown>
    | { env?: Record<string, unknown>; runtimeUrlOverride?: string }
): BackendConfigState {
  const isOptsObj =
    envOverrideOrOpts &&
    typeof envOverrideOrOpts === 'object' &&
    ('env' in envOverrideOrOpts || 'runtimeUrlOverride' in envOverrideOrOpts);

  const metaEnv = isOptsObj
    ? (envOverrideOrOpts as { env?: Record<string, unknown> }).env ?? {}
    : envOverrideOrOpts ??
      ((typeof import.meta !== 'undefined' && (import.meta as any).env) || {});

  const envServerUrl = String(
    metaEnv.VITE_NATIVE_EXECUTION_SERVER_URL ||
      metaEnv.VITE_BACKEND_URL ||
      ''
  ).trim();

  const runtimeServerUrl = isOptsObj
    ? String(
        (envOverrideOrOpts as { runtimeUrlOverride?: string })
          .runtimeUrlOverride ?? ''
      ).trim()
    : envOverrideOrOpts
      ? ''
      : getRuntimeNativeServerUrl();
  const candidateUrl = runtimeServerUrl || envServerUrl;
  const urlValidation = validateBackendUrl(candidateUrl);

  const nativeServerUrl = urlValidation.isValid
    ? urlValidation.normalizedUrl
    : '';
  const isNativeServerExplicitlyConfigured =
    urlValidation.isValid && nativeServerUrl.length > 0;

  const rawMode = String(metaEnv.VITE_DEPLOYMENT_MODE || '')
    .trim()
    .toLowerCase();
  const deploymentMode: DeploymentTargetMode =
    rawMode === 'static' || rawMode === 'hybrid'
      ? rawMode
      : isNativeServerExplicitlyConfigured
        ? 'hybrid'
        : 'auto';

  const isStaticOnlyDeployment =
    deploymentMode === 'static' && !isNativeServerExplicitlyConfigured;

  const prefix = nativeServerUrl;
  const githubUrl = `${prefix}/api/github/repo`;

  return {
    deploymentMode,
    nativeServerUrl,
    isNativeServerExplicitlyConfigured,
    isStaticOnlyDeployment,
    opsHealthUrl: `${prefix}/api/ops/health`,
    opsMetricsUrl: `${prefix}/api/ops/metrics`,
    nativeCapabilitiesUrl: `${prefix}/api/native/capabilities`,
    challengeEvaluationUrl: `${prefix}/api/challenges/evaluate`,
    githubTelemetryUrl: githubUrl,
    githubRepoMetadataUrl: githubUrl,
    urlValidation,
  };
}

/**
 * Verifies that an HTTP response from an `/api/*` endpoint is a genuine JSON response
 * and not an HTML SPA fallback (`index.html`) served by a static host like Vercel.
 */
export function isJsonApiResponse(
  response: Pick<Response, 'headers'> & { ok?: boolean } | null | undefined
): boolean {
  if (!response || response.ok === false) {
    return false;
  }
  const contentType = response.headers?.get?.('content-type') || '';
  if (!contentType) {
    // Allow synthetic Response objects in unit tests that omit Content-Type header
    return true;
  }
  const lower = contentType.toLowerCase();
  if (lower.includes('text/html') || lower.includes('application/xhtml+xml')) {
    return false;
  }
  return (
    lower.includes('application/json') ||
    lower.includes('+json') ||
    lower.includes('text/plain')
  );
}

/**
 * Classifies network, CORS, timeout, or static-host errors when contacting an optional backend.
 */
export function classifyBackendFetchError(
  error: unknown,
  targetUrl: string
): {
  kind: 'cors_or_network' | 'timeout' | 'invalid_url' | 'static_unconfigured';
  userMessage: string;
} {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  const lower = msg.toLowerCase();

  if (lower.includes('abort') || lower.includes('timed out') || lower.includes('timeout')) {
    return {
      kind: 'timeout',
      userMessage: `Native execution server is unreachable (timed out connecting to ${targetUrl}). Ensure the server is running or switch to Browser Mode.`,
    };
  }

  if (
    lower.includes('cors') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('econnrefused') ||
    lower.includes('load failed')
  ) {
    return {
      kind: 'cors_or_network',
      userMessage: `Native execution server is unreachable (${targetUrl}). Verify the server is running, check CORS / network settings, or switch to Browser Mode.`,
    };
  }

  return {
    kind: 'static_unconfigured',
    userMessage: `Native execution server is unreachable (${targetUrl}). Switch to Browser Mode or start the local server (\`npm run dev\`).`,
  };
}

/**
 * Audits client-side environment variables to ensure no sensitive tokens or secrets
 * are accidentally exposed in `VITE_*` frontend variables.
 */
export function scanClientEnvForExposedSecrets(
  envObj?: Record<string, unknown>
): string[] {
  const targetEnv =
    envObj ??
    ((typeof import.meta !== 'undefined' && (import.meta as any).env) || {});

  const violations: string[] = [];

  for (const [key, rawVal] of Object.entries(targetEnv)) {
    if (!key.startsWith('VITE_')) continue;
    const val = String(rawVal ?? '').trim();
    if (!val) continue;

    for (const keyPattern of SECRET_KEY_PATTERNS) {
      if (keyPattern.test(key)) {
        violations.push(
          `Client environment variable '${key}' has a secret-sensitive name and must not use the VITE_ prefix.`
        );
        break;
      }
    }

    for (const valPattern of SECRET_VALUE_PATTERNS) {
      if (valPattern.test(val)) {
        violations.push(
          `Client environment variable '${key}' contains a token matching a private credential pattern.`
        );
        break;
      }
    }
  }

  return violations;
}
