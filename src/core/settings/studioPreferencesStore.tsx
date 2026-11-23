/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Local-first preferences store and React context for the Parallax Studio.
 * Defaults to the Light theme for new users and persists changes to localStorage.
 * Public marketing pages always remain light regardless of Studio theme selection.
 */

import React, { createContext, useContext, useState, useEffect } from "react";
import { LanguageId } from "../types";
import { ExecutionModePreference } from "../execution/contracts";

export type StudioTheme = "light" | "dark";

export interface StudioPreferences {
  theme: StudioTheme;
  defaultLanguage: LanguageId;
  defaultExecutionMode: ExecutionModePreference;
  playbackSpeedMs: number;
  editorFontSize: 12 | 13 | 14 | 15;
  editorTabSize: 2 | 4;
  editorLineWrapping: boolean;
  defaultExplanationMode: "beginner" | "technical";
}

const STORAGE_KEY = "dryrun.studio_preferences.v1";

export const DEFAULT_STUDIO_PREFERENCES: StudioPreferences = {
  theme: "light",
  defaultLanguage: "javascript",
  defaultExecutionMode: "auto",
  playbackSpeedMs: 600,
  editorFontSize: 13,
  editorTabSize: 2,
  editorLineWrapping: false,
  defaultExplanationMode: "beginner",
};

function parseExecutionModePreference(val: unknown): ExecutionModePreference {
  if (val === "browser" || val === "native" || val === "auto") {
    return val;
  }
  return "auto";
}

export function loadStudioPreferences(): StudioPreferences {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_STUDIO_PREFERENCES;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STUDIO_PREFERENCES;
    const parsed = JSON.parse(raw);
    return {
      theme: parsed.theme === "dark" ? "dark" : "light",
      defaultLanguage: parsed.defaultLanguage || "javascript",
      defaultExecutionMode: parseExecutionModePreference(
        parsed.defaultExecutionMode,
      ),
      playbackSpeedMs: Number(parsed.playbackSpeedMs) || 600,
      editorFontSize: [12, 13, 14, 15].includes(Number(parsed.editorFontSize))
        ? (Number(parsed.editorFontSize) as 12 | 13 | 14 | 15)
        : 13,
      editorTabSize: Number(parsed.editorTabSize) === 4 ? 4 : 2,
      editorLineWrapping: Boolean(parsed.editorLineWrapping),
      defaultExplanationMode:
        parsed.defaultExplanationMode === "technical"
          ? "technical"
          : "beginner",
    };
  } catch {
    return DEFAULT_STUDIO_PREFERENCES;
  }
}

export function saveStudioPreferences(prefs: StudioPreferences): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}

interface StudioPreferencesContextValue {
  preferences: StudioPreferences;
  updatePreferences: (patch: Partial<StudioPreferences>) => void;
  toggleStudioTheme: () => void;
  resetPreferences: () => void;
}

const StudioPreferencesContext = createContext<StudioPreferencesContextValue>({
  preferences: DEFAULT_STUDIO_PREFERENCES,
  updatePreferences: () => {},
  toggleStudioTheme: () => {},
  resetPreferences: () => {},
});

export const StudioPreferencesProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [preferences, setPreferences] = useState<StudioPreferences>(() =>
    loadStudioPreferences(),
  );

  useEffect(() => {
    saveStudioPreferences(preferences);
  }, [preferences]);

  const updatePreferences = (patch: Partial<StudioPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...patch }));
  };

  const toggleStudioTheme = () => {
    setPreferences((prev) => ({
      ...prev,
      theme: prev.theme === "light" ? "dark" : "light",
    }));
  };

  const resetPreferences = () => {
    setPreferences(DEFAULT_STUDIO_PREFERENCES);
    saveStudioPreferences(DEFAULT_STUDIO_PREFERENCES);
  };

  return (
    <StudioPreferencesContext.Provider
      value={{
        preferences,
        updatePreferences,
        toggleStudioTheme,
        resetPreferences,
      }}
    >
      {children}
    </StudioPreferencesContext.Provider>
  );
};

export function useStudioPreferences(): StudioPreferencesContextValue {
  return useContext(StudioPreferencesContext);
}
