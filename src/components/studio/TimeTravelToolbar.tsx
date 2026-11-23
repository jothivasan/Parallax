/**
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useId } from 'react';
import { Play, Pause, SkipBack, SkipForward, RotateCcw, ChevronLeft, ChevronRight, Disc } from 'lucide-react';

interface TimeTravelToolbarProps {
  currentStep: number;
  totalSteps: number;
  isPlaying: boolean;
  playbackSpeedMs: number;
  hasBreakpoints: boolean;
  onStepForward: () => void;
  onStepBackward: () => void;
  onJumpToStep: (step: number) => void;
  onTogglePlay: () => void;
  onReset: () => void;
  onJumpToEnd: () => void;
  onContinueBreakpoint: () => void;
  onSpeedChange: (speedMs: number) => void;
  disabled?: boolean;
}

const speeds = [
  { value: 1200, label: '0.5×' },
  { value: 600, label: '1×' },
  { value: 400, label: '1.5×' },
  { value: 300, label: '2×' },
  { value: 150, label: '4×' },
];

export function TimeTravelToolbar({
  currentStep, totalSteps, isPlaying, playbackSpeedMs, hasBreakpoints,
  onStepForward, onStepBackward, onJumpToStep, onTogglePlay, onReset,
  onJumpToEnd, onContinueBreakpoint, onSpeedChange, disabled = false,
}: TimeTravelToolbarProps) {
  const id = useId();
  const hasTrace = totalSteps > 0;
  const isFirst = currentStep <= 0;
  const isLast = currentStep >= totalSteps - 1;
  const progress = totalSteps > 1 ? currentStep / (totalSteps - 1) : 0;
  const blocked = disabled || !hasTrace;
  const actions = [
    { label: 'Restart playback', icon: RotateCcw, run: onReset, disabled: blocked },
    { label: 'Jump to first step', icon: SkipBack, run: () => onJumpToStep(0), disabled: blocked || isFirst },
    { label: 'Previous step', icon: ChevronLeft, run: onStepBackward, disabled: blocked || isFirst },
    { label: isPlaying ? 'Pause playback' : 'Play trace', icon: isPlaying ? Pause : Play, run: onTogglePlay, disabled: blocked || totalSteps < 2, emphasized: true },
    { label: 'Next step', icon: ChevronRight, run: onStepForward, disabled: blocked || isLast },
    { label: 'Jump to last step', icon: SkipForward, run: onJumpToEnd, disabled: blocked || isLast },
    ...(hasBreakpoints ? [{ label: 'Next breakpoint', icon: Disc, run: onContinueBreakpoint, disabled: blocked || isLast }] : []),
  ];

  return (
    <div className="studio-playback" role="group" aria-label="Trace playback">
      <div className="studio-transport">
        {actions.map(({ label, icon: Icon, run, disabled: unavailable, emphasized }) => (
          <button key={label === 'Pause playback' || label === 'Play trace' ? 'play' : label} type="button" className={emphasized ? 'studio-icon studio-play' : 'studio-icon'} onClick={run} disabled={unavailable} aria-label={label} title={label}>
            <Icon size={15} fill={emphasized ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="studio-scrubber" style={{ '--trace-progress': `${100 * progress}%` } as React.CSSProperties}>
        <input type="range" aria-label="Execution step scrubber" aria-valuetext={hasTrace ? `Step ${currentStep + 1} of ${totalSteps}` : 'No trace'} min={0} max={Math.max(0, totalSteps - 1)} value={hasTrace ? currentStep : 0} onChange={(event) => onJumpToStep(Number(event.target.value))} disabled={blocked || totalSteps < 2} />
        <span className="studio-step-count" aria-label="Current step">{hasTrace ? currentStep + 1 : 0}<span> / {totalSteps}</span></span>
      </div>
      <label className="studio-speed" htmlFor={id}>
        <span className="sr-only">Playback speed</span>
        <select id={id} value={playbackSpeedMs} onChange={(event) => onSpeedChange(Number(event.target.value))} title="Playback speed">
          {!speeds.some(({ value }) => value === playbackSpeedMs) && <option value={playbackSpeedMs}>{(600 / playbackSpeedMs).toFixed(2)}×</option>}
          {speeds.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </div>
  );
}
