/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { StudioPreferencesProvider } from './core/settings/studioPreferencesStore';

// Layouts
import { MarketingLayout } from './layouts/MarketingLayout';
import { StudioLayout } from './layouts/StudioLayout';
import { InternalLayout } from './layouts/InternalLayout';

// Public Marketing Pages (Always Light Theme)
import { HomePage } from './pages/marketing/HomePage';
import { FeaturesPage } from './pages/marketing/FeaturesPage';
import { DocsPage } from './pages/marketing/DocsPage';
import { OpenSourcePage } from './pages/marketing/OpenSourcePage';

// Main Application Pages (/studio, /learn, /challenges, /settings)
import { StudioPage } from './pages/studio/StudioPage';
import { LearningPathPage } from './pages/studio/LearningPathPage';
import { ChallengesPage } from './pages/studio/ChallengesPage';
import { SettingsPage } from './pages/studio/SettingsPage';

// Protected Internal Developer & Operations Pages (/internal/*)
import {
  InternalArchitecturePage,
  InternalSecurityPage,
  InternalOperationsPage,
} from './pages/internal/InternalPages';

import { NotFoundPage } from './pages/NotFoundPage';

declare global {
  interface Window {
    __INITIAL_ROUTE__?: string;
  }
}

export default function App() {
  const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:';
  const initialRoute = (typeof window !== 'undefined' && window.__INITIAL_ROUTE__) || '/';

  const appRoutes = (
    <Routes>
      {/* A. Public Marketing Website (Always Light Theme) */}
      <Route element={<MarketingLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/pricing" element={<Navigate to="/open-source" replace />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/open-source" element={<OpenSourcePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route path="/login" element={<Navigate to="/studio" replace />} />
      <Route path="/signup" element={<Navigate to="/studio" replace />} />
      <Route path="/forgot-password" element={<Navigate to="/studio" replace />} />
      <Route path="/verify-email" element={<Navigate to="/studio" replace />} />

      {/* B. Main Application Experience (Supports Light Default + Dark Theme Switch) */}
      <Route element={<StudioLayout />}>
        <Route path="/studio" element={<StudioPage />} />
        <Route path="/learn" element={<LearningPathPage />} />
        <Route path="/challenges" element={<ChallengesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      {/* C. Internal Maintainer, Architecture & Operations Tools */}
      <Route path="/internal" element={<InternalLayout />}>
        <Route index element={<Navigate to="/internal/architecture" replace />} />
        <Route path="architecture" element={<InternalArchitecturePage />} />
        <Route path="security" element={<InternalSecurityPage />} />
        <Route path="operations" element={<InternalOperationsPage />} />
      </Route>
    </Routes>
  );

  return (
    <StudioPreferencesProvider>
      {isFileProtocol ? (
        <MemoryRouter initialEntries={[initialRoute]}>
          {appRoutes}
        </MemoryRouter>
      ) : (
        <BrowserRouter>
          {appRoutes}
        </BrowserRouter>
      )}
    </StudioPreferencesProvider>
  );
}
