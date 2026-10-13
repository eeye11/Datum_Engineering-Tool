/*
 * Explores the arc radius against the vertical rule's half-length, so the arc can
 * be pushed OUT toward the edges the way the reference draws it.
 */
const rad = (x) => (x * Math.PI) / 180;
const CX = 12,
  CY = 12;

/*
 * The reference, as a proportion of a 24-unit box:
 *   - the vertical rule spans nearly the whole height  -> half-length ~10.5
 *   - the arc's diameter is nearly the same as that span, a touch smaller
 *   - so the arc's radius is roughly 0.75 of the rule's half-length
 */
const cases = [
  { vHalf: 10.6, R: 7.8 },
  { vHalf: 10.6, R: 8.2 },
  { vHalf: 10.6, R: 8.6 },
  { vHalf: 10.6, R: 9.0 },
];

for (const { vHalf, R } of cases) {
  const gap = 150;
  const aU = 180 + gap / 2,
    aL = 180 - gap / 2;
  const p = (a) =>
    `${(CX + R * Math.cos(rad(a))).toFixed(2)},${(CY + R * Math.sin(rad(a))).toFixed(2)}`;
  console.log(
    `vHalf ${vHalf} R ${R}  rule ${(CY - vHalf).toFixed(1)}..${(CY + vHalf).toFixed(1)}` +
      `  arc west ${(CX - R).toFixed(2)} east ${(CX + R).toFixed(2)}` +
      `  top ${(CY - R).toFixed(2)} bottom ${(CY + R).toFixed(2)}` +
      `  ends ${p(aU)} / ${p(aL)}`,
  );
}
