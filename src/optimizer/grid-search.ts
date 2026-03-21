// Parameter space exploration for strategy optimization
// Generates full cartesian product or random samples from numeric param ranges

/** Defines a numeric parameter range to explore during optimization */
export interface ParamRange {
  name: string;
  min: number;
  max: number;
  step: number;
}

/** Maximum combinations before truncation warning */
const MAX_COMBINATIONS = 1000;

/**
 * Generate all values in [min, max] with given step for a single param.
 * Example: { min: 1, max: 3, step: 1 } → [1, 2, 3]
 */
function rangeValues(range: ParamRange): number[] {
  const values: number[] = [];
  // Use a small epsilon to handle float rounding (e.g. 0.1 + 0.1 + 0.1 != 0.3)
  const eps = range.step * 1e-9;
  for (let v = range.min; v <= range.max + eps; v += range.step) {
    values.push(parseFloat(v.toFixed(10)));
  }
  return values;
}

/**
 * Compute cartesian product of per-param value arrays.
 * Each element is a Record<name, value> representing one param set.
 */
function cartesianProduct(
  paramValues: Array<{ name: string; values: number[] }>,
): Record<string, number>[] {
  if (paramValues.length === 0) return [{}];

  const [first, ...rest] = paramValues;
  const restProduct = cartesianProduct(rest);

  const result: Record<string, number>[] = [];
  for (const v of first.values) {
    for (const combo of restProduct) {
      result.push({ [first.name]: v, ...combo });
    }
  }
  return result;
}

/**
 * Generate all parameter combinations (full grid search).
 * Caps at MAX_COMBINATIONS and warns if the total space is larger.
 *
 * @param ranges - Array of ParamRange definitions
 * @returns Array of param sets (each is Record<name, value>)
 */
export function generateGrid(ranges: ParamRange[]): Record<string, number>[] {
  if (ranges.length === 0) return [{}];

  const paramValues = ranges.map(r => ({ name: r.name, values: rangeValues(r) }));

  // Count total combinations without materializing
  const totalCount = paramValues.reduce((acc, p) => acc * p.values.length, 1);

  if (totalCount > MAX_COMBINATIONS) {
    console.warn(
      `[grid-search] Total combinations ${totalCount} exceeds limit ${MAX_COMBINATIONS}. ` +
        `Truncating to first ${MAX_COMBINATIONS}. Consider using generateRandomSample() instead.`,
    );
  }

  const all = cartesianProduct(paramValues);
  return all.slice(0, MAX_COMBINATIONS);
}

/**
 * Generate a random sample of parameter sets from the given ranges.
 * Useful when the grid is too large to enumerate fully.
 *
 * @param ranges - Array of ParamRange definitions
 * @param count - Number of random samples to generate
 * @returns Array of randomly sampled param sets
 */
export function generateRandomSample(
  ranges: ParamRange[],
  count: number,
): Record<string, number>[] {
  const samples: Record<string, number>[] = [];

  for (let i = 0; i < count; i++) {
    const params: Record<string, number> = {};
    for (const range of ranges) {
      const steps = Math.floor((range.max - range.min) / range.step);
      const randomStep = Math.floor(Math.random() * (steps + 1));
      params[range.name] = parseFloat((range.min + randomStep * range.step).toFixed(10));
    }
    samples.push(params);
  }

  return samples;
}
