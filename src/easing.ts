// CSS animation easing/timing functions
// All functions map t ∈ [0,1] → t' ∈ [0,1]

/**
 * Attempt a cubic bezier solve using Newton-Raphson,
 * falling back to bisection for stubborn cases.
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  // Given control points (0,0), (x1,y1), (x2,y2), (1,1):
  // B_x(t) = 3(1-t)^2*t*x1 + 3(1-t)*t^2*x2 + t^3
  // B_y(t) = 3(1-t)^2*t*y1 + 3(1-t)*t^2*y2 + t^3
  // For a given x, solve B_x(t)=x for t, then return B_y(t).

  function sampleX(t: number): number {
    return ((1 - 3 * x2 + 3 * x1) * t + (3 * x2 - 6 * x1)) * t * t + 3 * x1 * t;
  }

  function sampleY(t: number): number {
    return ((1 - 3 * y2 + 3 * y1) * t + (3 * y2 - 6 * y1)) * t * t + 3 * y1 * t;
  }

  function sampleDerivX(t: number): number {
    return (3 - 9 * x2 + 9 * x1) * t * t + (6 * x2 - 12 * x1) * t + 3 * x1;
  }

  function solveT(x: number): number {
    // Newton-Raphson
    let t = x;
    for (let i = 0; i < 8; i++) {
      const dx = sampleX(t) - x;
      if (Math.abs(dx) < 1e-7) return t;
      const d = sampleDerivX(t);
      if (Math.abs(d) < 1e-7) break;
      t -= dx / d;
    }

    // Bisection fallback
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 20; i++) {
      const v = sampleX(t) - x;
      if (Math.abs(v) < 1e-7) return t;
      if (v > 0) hi = t; else lo = t;
      t = (lo + hi) / 2;
    }
    return t;
  }

  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return sampleY(solveT(x));
  };
}

/** CSS `steps(n)` timing function (jump-end behavior) */
function steps(n: number): (t: number) => number {
  return (t: number): number => {
    if (t >= 1) return 1;
    return Math.floor(t * n) / n;
  };
}

// Pre-built standard easing curves
const LINEAR = (t: number): number => t;
const EASE = cubicBezier(0.25, 0.1, 0.25, 1.0);
const EASE_IN = cubicBezier(0.42, 0, 1.0, 1.0);
const EASE_OUT = cubicBezier(0, 0, 0.58, 1.0);
const EASE_IN_OUT = cubicBezier(0.42, 0, 0.58, 1.0);

/**
 * Look up a CSS timing function by name.
 * Supports: linear, ease, ease-in, ease-out, ease-in-out, steps(N)
 */
export function getTimingFunction(name: string): (t: number) => number {
  switch (name) {
    case 'linear': return LINEAR;
    case 'ease': return EASE;
    case 'ease-in': return EASE_IN;
    case 'ease-out': return EASE_OUT;
    case 'ease-in-out': return EASE_IN_OUT;
    default: {
      // steps(N)
      const stepsMatch = name.match(/^steps\((\d+)\)$/);
      if (stepsMatch) return steps(parseInt(stepsMatch[1], 10));
      return LINEAR;
    }
  }
}
