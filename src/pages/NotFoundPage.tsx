/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Parallax Public 404 Page
 * Redesigned with Taste Skill (Light Theme · Developer Tool)
 */

import React from "react";
import { Link } from "react-router-dom";
import { Terminal, ArrowRight, Home } from "lucide-react";

export const NotFoundPage: React.FC = () => {
  return (
    <div className="bg-white text-zinc-900 min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full taste-card p-8 text-center space-y-5 bg-white border border-zinc-200 shadow-sm">
        <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto border border-blue-200">
          <Terminal className="w-6 h-6" />
        </div>
        <div className="space-y-2">
          <div className="text-xs font-mono text-blue-600 font-semibold">
            404 · Route Out of Bounds
          </div>
          <h1 className="font-display text-2xl font-bold text-zinc-900">
            Execution frame out of bounds
          </h1>
          <p className="text-xs text-zinc-600 leading-relaxed">
            The route you requested does not exist in Parallax. Return to the
            home page or launch the interactive Execution Studio.
          </p>
        </div>
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/"
            className="btn-pill w-full sm:w-auto px-5 py-2.5 rounded-full border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-800 transition-colors"
          >
            <Home className="w-3.5 h-3.5" />
            <span>Public Home</span>
          </Link>
          <Link
            to="/studio"
            className="btn-pill w-full sm:w-auto px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white transition-colors shadow-xs"
          >
            <span>Launch Studio</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
};
