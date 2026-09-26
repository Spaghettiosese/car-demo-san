// Combined-slip tire model.
//
// Slip ratio and slip angle are each normalised by the value at which that
// direction produces peak grip, combined into one slip vector (friction
// ellipse), and pushed through one curve. The curve rises linearly, peaks at
// s = 1 and then falls toward a sliding plateau, which is what makes a tyre
// "let go" progressively.

export const TIRES = {
  street: { name: 'Street', mu: 1.0, kPeak: 0.11, aPeak: 0.15, falloff: 0.82, wet: 0.78, loadSens: 0.07, width: 0.215, squeal: 1.0 },
  sport: { name: 'Sport', mu: 1.1, kPeak: 0.095, aPeak: 0.13, falloff: 0.78, wet: 0.72, loadSens: 0.08, width: 0.245, squeal: 1.1 },
  slick: { name: 'Semi-slick', mu: 1.24, kPeak: 0.085, aPeak: 0.115, falloff: 0.72, wet: 0.5, loadSens: 0.09, width: 0.275, squeal: 1.25 },
  offroad: { name: 'All-terrain', mu: 0.93, kPeak: 0.13, aPeak: 0.18, falloff: 0.9, wet: 0.88, loadSens: 0.05, width: 0.255, squeal: 0.7, offroad: true },
};

/** Normalised grip curve f(s): f(0)=0, peak f(1)=1, tends to `falloff` when sliding. */
export function tireCurve(s, falloff) {
  if (s < 1) return s * (2 - s);
  const d = (s - 1) * 1.2;
  return falloff + (1 - falloff) / (1 + d * d);
}

/** f(s)/s, finite at s = 0 (limit is 2). */
export function tireGain(s, falloff) {
  if (s < 1) return 2 - s;
  return tireCurve(s, falloff) / s;
}
