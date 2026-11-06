const test = require('node:test');
const assert = require('node:assert/strict');
const { pictureViewBox } = require('../src/shared/rendering/picture-viewport.js');
const { createExportContext } = require('../src/shared/rendering/latex/export-transform.js');
const pt = 72.27 / 25.4;
const viewport = { width: 900, height: 600 };
const pixelsPerUnit = 4;

// A compiled vertex and its model-space selection handle must land at the
// same screen pixel, including when export fitting translates and reduces it.
for (const [name, bounds, points] of [
  ['triangle away from origin', {minX:30,minY:20,maxX:110,maxY:90}, [{x:30,y:20},{x:110,y:20},{x:65,y:90}]],
  ['large beam', {minX:-250,minY:-80,maxX:750,maxY:20}, [{x:-250,y:-80},{x:750,y:20}]],
]) {
  test(`${name}: compiled ink aligns with handles at every camera`, () => {
    const transform = createExportContext({bounds,maxWidth:160,maxHeight:200});
    for (const camera of [{zoom:1,panX:0,panY:0},{zoom:.35,panX:100,panY:-40},{zoom:2,panX:-30,panY:80}]) {
      const box = pictureViewBox(viewport,camera,pixelsPerUnit,transform);
      for (const p of points) {
        const exported = transform.point(p.x,p.y);
        const x = (exported.x*pt-box[0])/box[2]*viewport.width;
        const y = (-exported.y*pt-box[1])/box[3]*viewport.height;
        const expectedX = viewport.width/2+(p.x-camera.panX)*pixelsPerUnit*camera.zoom;
        const expectedY = viewport.height/2-(p.y-camera.panY)*pixelsPerUnit*camera.zoom;
        assert.ok(Math.abs(x-expectedX)<1e-8, `x: ${x} vs ${expectedX}`);
        assert.ok(Math.abs(y-expectedY)<1e-8, `y: ${y} vs ${expectedY}`);
      }
    }
  });
}

test('untransformed source origin aligns with the model origin',()=>{
  const box=pictureViewBox(viewport,{zoom:1,panX:0,panY:0},pixelsPerUnit);
  assert.equal((-box[0])/box[2]*viewport.width,viewport.width/2);
  assert.equal((-box[1])/box[3]*viewport.height,viewport.height/2);
});
