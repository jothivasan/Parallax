/**
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { ArchitectureAuditView } from '../../components/ArchitectureAuditView';
import { SecurityLab } from '../../components/SecurityLab';
import { Activity, RefreshCw, Server, ShieldCheck } from 'lucide-react';
import { getBackendConfig, isJsonApiResponse } from '../../config/backendConfig';

export const InternalArchitecturePage: React.FC = () => {
  return <ArchitectureAuditView />;
};

export const InternalSecurityPage: React.FC = () => {
  return <SecurityLab />;
};

export const InternalOperationsPage: React.FC = () => {
  const [health, setHealth] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [staticNotice, setStaticNotice] = useState<string | null>(null);

  const fetchTelemetry = async () => {
    setLoading(true);
    setStaticNotice(null);
    const backendCfg = getBackendConfig();
    if (backendCfg.isStaticOnlyDeployment) {
      setStaticNotice(
        'Static Browser Deployment active (VITE_DEPLOYMENT_MODE=static). Optional Native Execution Server telemetry is disabled.'
      );
      setLoading(false);
      return;
    }

    try {
      const [hRes, mRes] = await Promise.all([
        fetch(backendCfg.opsHealthUrl, { headers: { Accept: 'application/json' } }),
        fetch(backendCfg.opsMetricsUrl, { headers: { Accept: 'application/json' } }),
      ]);
      if (hRes.ok && isJsonApiResponse(hRes)) {
        setHealth(await hRes.json());
      } else {
        setHealth(null);
        setStaticNotice(
          'Optional Native Execution Server is not connected on this host. Browser Mode Web Worker and WASM runtimes operate client-side without server telemetry.'
        );
      }
      if (mRes.ok && isJsonApiResponse(mRes)) {
        setMetrics(await mRes.json());
      } else {
        setMetrics(null);
      }
    } catch {
      setHealth(null);
      setMetrics(null);
      setStaticNotice(
        'Optional Native Execution Server is unreachable. Browser Mode operates independently without the Express server.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
  }, []);

  return (
    <div className="space-y-6 text-zinc-100">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 flex items-center justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-emerald-400 mb-1">
            <Activity className="w-3.5 h-3.5" />
            Internal Runtime Operations &amp; Sandbox Telemetry
          </div>
          <h1 className="text-xl font-bold">Execution Coordinator &amp; Worker Metrics</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Live diagnostics from <code className="font-mono">/api/ops/health</code> and <code className="font-mono">/api/ops/metrics</code>. Separated from primary learner navigation.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchTelemetry}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 border border-zinc-700 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Telemetry
        </button>
      </div>

      {staticNotice && (
        <div
          data-testid="internal-ops-static-notice"
          className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-xs font-mono text-amber-200"
        >
          {staticNotice}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-emerald-400 mb-3">
            <Server className="w-4 h-4" />
            Service Health (/api/ops/health)
          </div>
          <pre className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-emerald-300 overflow-x-auto">
            {health
              ? JSON.stringify(health, null, 2)
              : loading
              ? 'Loading health snapshot...'
              : 'Native Execution Server not connected (Static Browser Mode active).'}
          </pre>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-emerald-400 mb-3">
            <ShieldCheck className="w-4 h-4" />
            Sandbox Metrics (/api/ops/metrics)
          </div>
          <pre className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-sky-300 overflow-x-auto max-h-96">
            {metrics
              ? JSON.stringify(metrics, null, 2)
              : loading
              ? 'Loading metrics snapshot...'
              : 'Native Execution Server not connected (Static Browser Mode active).'}
          </pre>
        </div>
      </div>
    </div>
  );
};
