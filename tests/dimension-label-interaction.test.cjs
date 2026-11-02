const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {bootApp,whenReady}=require('./helpers/boot-app.cjs');
const {locate}=require('./helpers/source-path.cjs');
const {window,document,error}=bootApp();
if(error)throw error;
let state,model,dimensions,drag,canvas;
before(async()=>{
 await whenReady();
 ({drawingState:state}=require(locate('editor-state.js')));
 model=require(locate('drawing-state.js')).default;
 dimensions=require(locate('dimension-model.js')).default;
 drag=require(locate('drag.js'));
 canvas=document.querySelector('.drawing-canvas');
 Object.defineProperties(canvas,{clientWidth:{value:900,configurable:true},clientHeight:{value:600,configurable:true}});
 canvas.getBoundingClientRect=()=>({left:0,top:0,width:900,height:600});
 canvas.setPointerCapture=()=>{};canvas.hasPointerCapture=()=>false;canvas.releasePointerCapture=()=>{};
 state.camera={zoom:1,panX:0,panY:0};
 model.setActiveTool(state,'select');
});
after(()=>window.close());
function event(point){const p=model.engineeringToScreen(point,{width:900,height:600},state);return{pointerId:11,button:0,clientX:p.x,clientY:p.y,shiftKey:false};}
for(const kind of ['smart','variable']){
 test(`${kind} dimension follows pointer displacement, never cumulative frame count`,()=>{
  const before=model.snapshotDrawing(state);
  const line=model.addObject(state,model.geometryFactories.line({x:-50,y:0},{x:50,y:0}));
  const d=model.addObject(state,model.geometryFactories.dimension({dimensionType:'horizontal',refs:[{featureId:line.id,anchor:'start'},{featureId:line.id,anchor:'end'}],placement:{x:0,y:30},dimensionKind:kind,content:kind==='variable'?'L':''}));
  model.commitDrawingChange(state,before);model.selectObject(state,d.id);
  const start=dimensions.graphicsFor(d,state).textFrame;
  assert.equal(drag.beginManipulationDrag(event(start)),true);
  for(const dy of [5,10,15,15,15,20,10,-10]){
   drag.updateManipulationDrag(event({x:start.x,y:start.y+dy}));
   const live=state.objects.find(item=>item.id===d.id);
   assert.ok(Math.abs(live.placement.y-(30+dy))<1e-7,`dy ${dy}: got ${live.placement.y}`);
  }
  drag.finishManipulationDrag(event({x:start.x,y:start.y-10}));
  assert.deepEqual(state.objects.find(item=>item.id===line.id).geometry,line.geometry,'moving the annotation never resizes its geometry');
  const moved=state.objects.find(item=>item.id===d.id);
  const next=dimensions.graphicsFor(moved,state).textFrame;
  assert.equal(drag.beginManipulationDrag(event(next)),true);
  drag.updateManipulationDrag(event({x:next.x,y:next.y+7}));drag.updateManipulationDrag(event({x:next.x,y:next.y+7}));
  drag.finishManipulationDrag(event({x:next.x,y:next.y+7}));
  assert.ok(Math.abs(state.objects.find(item=>item.id===d.id).placement.y-27)<1e-7);
 });
}
test('dimension glyphs have a correctly centred canvas-colour halo, without a covering plate',()=>{
 const theme=require(locate('theme.js')).default;
 const {appendDimensionText}=require(locate('dimension-render.js'));
 for(const [mode,background] of [['dark','#142426'],['light','#ffffff']]){
  theme.applyTheme(mode);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  appendDimensionText(svg,'65.77 mm',{x:40,y:30,angle:0},mode==='dark'?'#e8f5f3':'#000000',p=>p);
  assert.equal(svg.querySelectorAll('rect').length,0,'no opaque rectangle covers the magnitude');
  const text=svg.querySelector('text');
  assert.equal(text.getAttribute('stroke'),background);
  assert.equal(text.getAttribute('paint-order'),'stroke fill');
  assert.equal(Number(text.getAttribute('y')),0,'middle baseline is centred on the dimension line');
  assert.equal(text.textContent,'65.77 mm');
 }
});
