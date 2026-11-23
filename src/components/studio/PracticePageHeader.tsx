/**
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useId } from 'react';

export function PracticePageHeader({ title, description, progressLabel, completed, total, testId }: {
  title: string;
  description: string;
  progressLabel: string;
  completed: number;
  total: number;
  testId?: string;
}) {
  const id = useId();
  return (
    <>
      <meta name="robots" content="noindex" />
      <header className="practice-heading">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <div className="practice-progress">
          <div><label htmlFor={id}>{progressLabel}</label><span data-testid={testId}>{completed} / {total}</span></div>
          <progress id={id} value={completed} max={total} />
        </div>
      </header>
    </>
  );
}
