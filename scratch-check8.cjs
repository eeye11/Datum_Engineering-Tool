const centre = { x: 50, y: 38.6863 };
const radius = 8;
const start = 135;
const signedSweep = -90;
const bend = Math.abs(signedSweep);

const radians = (start * Math.PI) / 180;
const radiansEnd = ((start + signedSweep) * Math.PI) / 180;

const tangent = (angle) => ({ x: -Math.sin(angle), y: Math.cos(angle) });

const reach = radius * Math.tan((bend * Math.PI) / 360);

const tStart = {
  x: centre.x + radius * Math.cos(radians),
  y: centre.y + radius * Math.sin(radians),
};
const tEnd = {
  x: centre.x + radius * Math.cos(radiansEnd),
  y: centre.y + radius * Math.sin(radiansEnd),
};

/* Four combinations, and both signs of the second arm's offset. */
for (const firstSign of [1, -1]) {
  for (const secondSign of [1, -1]) {
    const forward = tangent(radians);
    const back = tangent(radiansEnd);

    const c1 = {
      x: tStart.x + forward.x * reach * firstSign,
      y: tStart.y + forward.y * reach * firstSign,
    };
    const c2 = {
      x: tEnd.x + back.x * reach * secondSign,
      y: tEnd.y + back.y * reach * secondSign,
    };

    console.log(
      firstSign,
      secondSign,
      c1,
      c2,
      Math.hypot(c1.x - c2.x, c1.y - c2.y),
    );
  }
}
