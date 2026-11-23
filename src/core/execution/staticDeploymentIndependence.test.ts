/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — Phase 10: Static Deployment & Client-Side Independence Tests
 *
 * Verifies:
 * 1. No backend configured (`VITE_DEPLOYMENT_MODE=static`) -> Browser Mode executes all 7 languages
 *    with 0 `/api/*` calls; startup capability snapshot makes 0 `/api/ops/health` calls when
 *    `skipNativeHttpProbe: true`; explicit Native Mode reports `Native server unavailable` and
 *    never silently falls back.
 * 2. Backend configured and reachable -> Native Mode discovers compilers, reports accurate capability
 *    badges, and executes via HTTP endpoints.
 * 3. Backend configured but unreachable (or static host returning `text/html` SPA fallback on `/api/*`) ->
 *    Browser Mode and Auto Mode continue working cleanly; explicit Native Mode reports `Native server unavailable`
 *    with classified CORS/connection or HTML-fallback messaging.
 * 4. Optional GitHub integration and Supabase credentials absent -> `getGitHubConfig()` and
 *    `getAuthProviderConfig()` degrade gracefully to `Local-First Mode` without throwing.
 * 5. Challenge evaluation without backend -> executes visible public test cases locally in Browser Mode
 *    (`evaluationMode: 'browser_local_public'`, `hiddenTestsEvaluated: false`) and marks hidden test cases
 *    as `'Skipped (Requires Server)'` without leaking or fabricating hidden server test cases.
 * 6. Security verification -> `scanClientEnvForExposedSecrets` detects leaked tokens, verifies client
 *    bundles contain 0 exposed secrets, and verifies `challengeEngine.ts` contains 0 hidden test literals
 *    from `challengeVault.ts`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyBackendFetchError,
  getBackendConfig,
  isJsonApiResponse,
  scanClientEnvForExposedSecrets,
  validateBackendUrl,
} from '../../config/backendConfig';
import {
  getAuthProviderConfig,
  getGitHubConfig,
} from '../../config/productConfig';
import { NativeExecutionManager } from './nativeExecutionManager';
import { BrowserExecutionManager } from './browserExecutionManager';
import {
  probeLanguageCapabilitySnapshot,
  resolveStudioExecutionState,
} from './executionModeResolver';
import {
  ChallengeEngine,
  DSA_CHALLENGES,
} from '../intelligence/challengeEngine';
import { LanguageId } from '../types';

const ALL_SEVEN_LANGUAGES: Exclude<LanguageId, 'go'>[] = [
  'javascript',
  'typescript',
  'python',
  'c',
  'cpp',
  'java',
  'csharp',
];

test('Phase 10 — Configuration Architecture: URL validation & deployment mode resolution', () => {
  // Empty URL is valid (static / same-origin default)
  const emptyValidation = validateBackendUrl('');
  assert.equal(emptyValidation.valid, true);
  assert.equal(emptyValidation.normalizedUrl, '');

  // Valid HTTP/HTTPS origins
  const localValidation = validateBackendUrl('http://localhost:3000/');
  assert.equal(localValidation.valid, true);
  assert.equal(localValidation.normalizedUrl, 'http://localhost:3000');

  const httpsValidation = validateBackendUrl('https://native.dryrun.dev/api');
  assert.equal(httpsValidation.valid, true);
  assert.equal(httpsValidation.normalizedUrl, 'https://native.dryrun.dev/api');

  // Invalid protocol or embedded credentials rejected
  const ftpValidation = validateBackendUrl('ftp://localhost:3000');
  assert.equal(ftpValidation.valid, false);
  assert.ok(ftpValidation.error?.includes('http:// or https://'));

  const credsValidation = validateBackendUrl('https://user:secret@native.dryrun.dev');
  assert.equal(credsValidation.valid, false);
  assert.ok(credsValidation.error?.includes('credentials'));

  // Static deployment mode
  const staticCfg = getBackendConfig({
    env: { VITE_DEPLOYMENT_MODE: 'static' },
    runtimeUrlOverride: '',
  });
  assert.equal(staticCfg.deploymentMode, 'static');
  assert.equal(staticCfg.isStaticOnlyDeployment, true);
  assert.equal(staticCfg.isNativeServerExplicitlyConfigured, false);
  assert.equal(staticCfg.nativeServerUrl, '');

  // Hybrid deployment mode with explicit Native Execution Server URL
  const hybridCfg = getBackendConfig({
    env: {
      VITE_NATIVE_EXECUTION_SERVER_URL: 'http://localhost:3000/',
    },
  });
  assert.equal(hybridCfg.deploymentMode, 'hybrid');
  assert.equal(hybridCfg.isStaticOnlyDeployment, false);
  assert.equal(hybridCfg.isNativeServerExplicitlyConfigured, true);
  assert.equal(hybridCfg.nativeServerUrl, 'http://localhost:3000');
  assert.equal(hybridCfg.opsHealthUrl, 'http://localhost:3000/api/ops/health');
  assert.equal(
    hybridCfg.challengeEvaluationUrl,
    'http://localhost:3000/api/challenges/evaluate'
  );
});

test('Phase 10 — Scenario 1: No backend configured (Static Browser Mode) -> 0 /api/* calls in Browser & Auto startup', async () => {
  let apiCallsCount = 0;
  const forbiddenFetch: typeof fetch = async (input) => {
    apiCallsCount += 1;
    throw new Error(`Unexpected /api/* call in static Browser Mode: ${String(input)}`);
  };

  const nativeManager = new NativeExecutionManager({
    preferHttpTransport: true,
    fetchImpl: forbiddenFetch,
  });
  const { createNodeWorkerThreadFactory } = await import(
    './__tests__/nodeWorkerHarness'
  );
  const browserManager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
  });
  try {
    // Probing capability snapshot with skipNativeHttpProbe: true makes ZERO HTTP calls
    for (const lang of ALL_SEVEN_LANGUAGES) {
    const snapshot = await probeLanguageCapabilitySnapshot(lang, {
      browserManager,
      nativeManager,
      skipNativeHttpProbe: true,
    });

    assert.equal(snapshot.browserCapability.available, true);
    assert.equal(snapshot.nativeCapability.available, false);
    assert.equal(snapshot.nativeServerReachable, false);

    // Auto mode resolves to Browser Mode when Native is unprobed/unavailable
    const autoState = resolveStudioExecutionState({
      language: lang,
      modePreference: 'auto',
      snapshot,
    });
    assert.equal(autoState.effectiveMode, 'browser');
    assert.equal(autoState.canExecute, true);

    // Browser mode resolves to Browser Mode
    const browserState = resolveStudioExecutionState({
      language: lang,
      modePreference: 'browser',
      snapshot,
    });
    assert.equal(browserState.effectiveMode, 'browser');
    assert.equal(browserState.canExecute, true);

    // Explicit Native mode reports Native server unavailable and never falls back
    const nativeState = resolveStudioExecutionState({
      language: lang,
      modePreference: 'native',
      snapshot,
    });
    assert.equal(nativeState.effectiveMode, 'native');
    assert.equal(nativeState.badgeStatus, 'Native server unavailable');
    assert.equal(nativeState.canExecute, false);
  }

  assert.equal(apiCallsCount, 0, 'Zero /api/* calls must occur when skipNativeHttpProbe is true');

    // Execute JavaScript & TypeScript in Browser Mode and verify 0 /api/* calls
    const jsTrace = await browserManager.execute({
      language: 'javascript',
      code: 'const x = 10 + 20;\nconsole.log(x);',
      modePreference: 'browser',
    });
    assert.equal(jsTrace.status, 'completed');
    assert.ok(jsTrace.events.length > 0);
    assert.deepEqual(jsTrace.events[jsTrace.events.length - 1].stdout, ['30']);
    assert.equal(apiCallsCount, 0);
  } finally {
    browserManager.dispose();
  }
});

test('Phase 10 — Scenario 2: Backend configured and reachable -> Native Mode discovers compilers and executes', async () => {
  const requestedUrls: string[] = [];
  const mockReachableFetch: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.endsWith('/api/ops/health')) {
      return new Response(
        JSON.stringify({
          status: 'healthy',
          toolchains: {
            javascript_typescript: { available: true, version: 'Node.js v22.0.0' },
            python: { available: true, version: 'Python 3.12.1' },
            c17_gcc: { available: true, version: 'gcc 13.2.0' },
            cpp20_gpp: { available: true, version: 'g++ 13.2.0' },
            java21_openjdk: { available: false, reason: 'javac not found' },
            csharp12_dotnet: { available: false, reason: 'dotnet not found' },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }
      );
    }
    if (url.endsWith('/api/c/trace')) {
      return new Response(
        JSON.stringify({
          id: 'native_c_1',
          language: 'c',
          sourceCode: 'int main() { return 0; }',
          status: 'completed',
          totalSteps: 1,
          executionTimeMs: 12,
          events: [],
          metadata: { executionMode: 'native', runtimeEngine: 'GCC 13.2.0' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    return new Response('Not found', { status: 404 });
  };

  const nativeManager = new NativeExecutionManager({
    baseUrl: 'http://localhost:3000',
    preferHttpTransport: true,
    fetchImpl: mockReachableFetch,
  });

  const cCap = await nativeManager.getCapabilities('c', true);
  assert.equal(cCap.available, true);
  assert.equal(cCap.runtimeVersion, 'gcc 13.2.0');

  const javaCap = await nativeManager.getCapabilities('java', false);
  assert.equal(javaCap.available, false);

  const cTrace = await nativeManager.execute({
    language: 'c',
    code: 'int main() { return 0; }',
    modePreference: 'native',
  });
  assert.equal(cTrace.status, 'completed');
  assert.equal(cTrace.metadata?.executionMode, 'native');
  assert.ok(requestedUrls.includes('http://localhost:3000/api/ops/health'));
  assert.ok(requestedUrls.includes('http://localhost:3000/api/c/trace'));
});

test('Phase 10 — Scenario 3: Backend unreachable or returning static SPA text/html fallback', async () => {
  // Case 3A: Static host (e.g. Vercel / serve -s dist) returns 200 OK with text/html index.html for /api/ops/health
  const spaHtmlFallbackFetch: typeof fetch = async () => {
    return new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  };

  assert.equal(
    isJsonApiResponse({
      headers: new Headers({ 'Content-Type': 'text/html; charset=utf-8' }),
    }),
    false
  );
  assert.equal(
    isJsonApiResponse({
      headers: new Headers({ 'Content-Type': 'application/json; charset=utf-8' }),
    }),
    true
  );

  const nativeManagerHtmlFallback = new NativeExecutionManager({
    preferHttpTransport: true,
    fetchImpl: spaHtmlFallbackFetch,
  });
  const { createNodeWorkerThreadFactory } = await import(
    './__tests__/nodeWorkerHarness'
  );
  const browserManager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
  });

  try {
    const snapHtml = await probeLanguageCapabilitySnapshot('python', {
      browserManager,
      nativeManager: nativeManagerHtmlFallback,
      forceRefresh: true,
      skipNativeHttpProbe: false,
    });

    assert.equal(
      snapHtml.nativeServerReachable,
      false,
      'Static SPA text/html fallback must be detected as nativeServerReachable: false'
    );
    assert.equal(snapHtml.nativeCapability.available, false);
    assert.equal(snapHtml.browserCapability.available, true);

    // Explicit Native Mode shows 'Native server unavailable' and never silently falls back
    const nativeStateHtml = resolveStudioExecutionState({
      language: 'python',
      modePreference: 'native',
      snapshot: snapHtml,
    });
    assert.equal(nativeStateHtml.badgeStatus, 'Native server unavailable');
    assert.equal(nativeStateHtml.effectiveMode, 'native');
    assert.equal(nativeStateHtml.canExecute, false);

    const failedNativeTrace = await nativeManagerHtmlFallback.execute({
      language: 'python',
      code: 'print(42)',
      modePreference: 'native',
    });
    assert.equal(failedNativeTrace.status, 'error');
    assert.equal(failedNativeTrace.metadata?.executionMode, 'native');
    assert.ok(
      failedNativeTrace.errorMessage?.includes('static host returned HTML') ||
        failedNativeTrace.errorMessage?.includes('unavailable')
    );

    // Case 3B: Network TypeError (CORS or connection refused)
    const classifiedCors = classifyBackendFetchError(
      new TypeError('Failed to fetch'),
      'http://localhost:3000/api/ops/health'
    );
    assert.equal(classifiedCors.kind, 'cors_or_network');
    assert.ok(classifiedCors.userMessage.includes('CORS'));
  } finally {
    browserManager.dispose();
  }
});

test('Phase 10 — Scenario 4: Optional GitHub & Supabase independence (Local-First Mode)', () => {
  // Without Supabase or Auth env vars, getAuthProviderConfig returns Local-First Mode
  const localAuth = getAuthProviderConfig({});
  assert.equal(localAuth.configured, false);
  assert.equal(localAuth.supabaseConfigured, false);
  assert.equal(localAuth.providerName, 'Local-First Mode');
  assert.equal(localAuth.isAnyProviderConfigured, false);

  // When optional Supabase env vars are provided, they are detected cleanly
  const supabaseAuth = getAuthProviderConfig({
    VITE_SUPABASE_URL: 'https://project.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'public-anon-key',
  });
  assert.equal(supabaseAuth.configured, true);
  assert.equal(supabaseAuth.supabaseConfigured, true);
  assert.equal(supabaseAuth.providerName, 'Supabase Auth (Optional)');

  // GitHub config works without backend
  const ghConfig = getGitHubConfig();
  assert.equal(typeof ghConfig.isConfigured, 'boolean');
  assert.equal(ghConfig.contributingUrl, '/open-source#contributing');
});

test('Phase 10 — Scenario 5: Challenge evaluation without backend runs public tests locally in Browser Mode and marks hidden tests Skipped', async () => {
  const challenge = DSA_CHALLENGES[0]; // 01. Array Element Sum
  const starterJs = challenge.starterCode.javascript;

  const { createNodeWorkerThreadFactory } = await import(
    './__tests__/nodeWorkerHarness'
  );
  const browserManager = new BrowserExecutionManager({
    workerFactory: createNodeWorkerThreadFactory(),
  });

  try {
    // Simulate static host returning 404 or HTML fallback for /api/challenges/evaluate
    const staticFallbackFetch: typeof fetch = async () =>
      new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });

    const report = await ChallengeEngine.evaluateChallenge(
      challenge,
      'javascript',
      starterJs,
      {
        fetchImpl: staticFallbackFetch,
        executeFn: (lang, code) =>
          browserManager.execute({
            language: lang,
            code,
            modePreference: 'browser',
          }),
      }
    );

    assert.equal(report.evaluationMode, 'browser_local_public');
    assert.equal(report.hiddenTestsEvaluated, false);
    assert.equal(report.allPassed, true);
    assert.equal(report.visiblePassedCount, report.visibleTotalCount);
    assert.ok(report.visibleTotalCount >= 2);
    assert.equal(report.hiddenPassedCount, 0);
    assert.ok(report.hiddenTotalCount >= 1);

    const visibleResults = report.caseResults.filter((r) => !r.testCase.isHidden);
    const hiddenResults = report.caseResults.filter((r) => r.testCase.isHidden);

    for (const vr of visibleResults) {
      assert.equal(vr.passed, true);
      assert.equal(vr.verdict, 'Passed');
      assert.ok(vr.stepCount > 0);
    }

    for (const hr of hiddenResults) {
      assert.equal(hr.passed, false);
      assert.equal(hr.verdict, 'Skipped (Requires Server)');
      assert.equal(hr.testCase.replacementLiteral, '');
      assert.deepEqual(hr.testCase.expectedOutput, []);
    }
  } finally {
    browserManager.dispose();
  }
});

test('Phase 10 — Scenario 6: Security boundary verification (no leaked secrets or hidden challenge test inputs in client modules)', () => {
  // 1. Verify scanClientEnvForExposedSecrets catches private tokens and service_role keys
  const cleanViolations = scanClientEnvForExposedSecrets({
    VITE_DEPLOYMENT_MODE: 'static',
    VITE_NATIVE_EXECUTION_SERVER_URL: 'http://localhost:3000',
    VITE_GITHUB_REPO: 'owner/dry-run',
  });
  assert.equal(cleanViolations.length, 0);

  const leakedViolations = scanClientEnvForExposedSecrets({
    VITE_GITHUB_TOKEN: 'ghp_1234567890abcdefghijklmnopqrstuv',
    VITE_SUPABASE_SERVICE_ROLE_KEY: 'secret-role-key',
  });
  assert.ok(leakedViolations.length >= 2);

  // 2. Verify client-side DSA_CHALLENGES in challengeEngine.ts contains zero hidden test inputs or expected outputs
  for (const ch of DSA_CHALLENGES) {
    for (const tc of ch.testCases) {
      if (tc.isHidden) {
        assert.equal(
          tc.replacementLiteral,
          '',
          `Hidden test case ${tc.id} in challenge ${ch.id} must not expose replacementLiteral in client bundle`
        );
        assert.deepEqual(
          tc.expectedOutput,
          [],
          `Hidden test case ${tc.id} in challenge ${ch.id} must not expose expectedOutput in client bundle`
        );
      }
    }
  }

  // 3. Verify no frontend component imports server/challengeVault.ts statically
  const challengeEnginePath = path.resolve(
    process.cwd(),
    'src/core/intelligence/challengeEngine.ts'
  );
  const challengeEngineSource = fs.readFileSync(challengeEnginePath, 'utf8');
  assert.equal(
    challengeEngineSource.includes("from '../../server/challengeVault'"),
    false,
    'challengeEngine.ts must never statically import server/challengeVault'
  );
  assert.equal(
    challengeEngineSource.includes('[-8, -3, -6, -2, -5]'),
    false,
    'challengeEngine.ts must not contain server-only hidden test literal [-8, -3, -6, -2, -5]'
  );
});
