// SPDX-License-Identifier: Apache-2.0

// Move the endpoints and control points independently so the contours fan out
// near the edges and converge on the horizon behind the studio.
const contours = Array.from({ length: 32 }, (_, index) => {
  const t = index / 31;
  return `M -8 ${110 + t * 186}
    C 150 ${77 + t * 202}, 245 ${244 + t * 43}, 455 ${233 + t * 64}
    S 722 ${260 + t * 40}, 876 ${237 + t * 57}
    C 1080 ${207 + t * 86}, 1145 ${50 + t * 251}, 1408 ${94 + t * 199}`;
});

export function Sunrise() {
  return (
    <svg className="px-dawn" viewBox="0 0 1400 300" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="px-daybreak" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop stopColor="#f9deb4"/>
          <stop offset=".6" stopColor="#f2ba84"/>
          <stop offset="1" stopColor="#e59c73"/>
        </linearGradient>
        <linearGradient id="px-contour-ink">
          <stop stopColor="#99654e"/>
          <stop offset=".48" stopColor="#bd8262"/>
          <stop offset="1" stopColor="#93644f"/>
        </linearGradient>
      </defs>
      <svg x="0" y="0" width="1400" height="300" viewBox="0 0 1400 300" preserveAspectRatio="xMidYMax meet">
        <circle className="px-sun" cx="700" cy="315" r="212" fill="url(#px-daybreak)"/>
      </svg>
      <g fill="none" stroke="url(#px-contour-ink)" strokeWidth=".8" opacity=".72">
        {contours.map((d, index) => <path key={index} d={d}/>)}
      </g>
    </svg>
  );
}
