const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {bootApp,whenReady}=require('./helpers/boot-app.cjs');
const {locate}=require('./helpers/source-path.cjs');
const {window,document,error}=bootApp();
if(error)throw error;
let state,model,drag,canvas;
before(async()=>{
 await whenReady();
 ({drawingState:state}=require(locate('editor-state.js')));
 model=require(locate('drawing-state.js')).default;
 drag=require(locate('drag.js'));
 canvas=document.querySelector('.drawing-canvas');
 Object.defineProperties(canvas,{clientWidth:{value:900,configurable:true},clientHeight:{value:600,configurable:true}});
 canvas.getBoundingClientRect=()=>({left:0,top:0,width:900,height:600});
 canvas.setPointerCapture=()=>{};canvas.hasPointerCapture=()=>false;canvas.releasePointerCapture=()=>{};
 model.setActiveTool(state,'select');
 state.camera={zoom:1,panX:0,panY:0};
});
after(()=>window.close());
function event(p){const s=model.engineeringToScreen(p,{width:900,height:600},state);return{pointerId:7,button:0,clientX:s.x,clientY:s.y,shiftKey:false};}
function create(){const previous=model.snapshotDrawing(state);const object=model.addObject(state,model.geometryFactories.rectangle({x:0,y:0},80,50));model.commitDrawingChange(state,previous);model.selectObject(state,object.id);return object.id;}
test('a single rectangle can be dragged by its interior repeatedly',()=>{
 const id=create();
 for(let i=0;i<5;i++){
  const object=state.objects.find(o=>o.id===id);
  const initial={...object.geometry.position};
  const box=require(locate("selection-transform.js")).selectionBounds(state.objects,[id]);
  const start={x:(box.minX+box.maxX)/2,y:(box.minY+box.maxY)/2};
  assert.equal(drag.beginManipulationDrag(event(start)),true,`drag ${i} starts`);
  drag.updateManipulationDrag(event({x:start.x+15,y:start.y+12}));
  drag.finishManipulationDrag(event({x:start.x+15,y:start.y+12}));
  const moved=state.objects.find(o=>o.id===id);
  assert.ok(Math.abs(moved.geometry.position.x-initial.x-15)<1e-7,`drag ${i} x`);
  assert.ok(Math.abs(moved.geometry.position.y-initial.y-12)<1e-7,`drag ${i} y`);
 }
});
test('pressing an unselected outline starts a move without a separate selection click',()=>{
 const id=create();model.clearSelection(state);
 const start={x:40,y:0};
 assert.equal(drag.beginManipulationDrag(event(start)),true);
 drag.updateManipulationDrag(event({x:50,y:10}));drag.finishManipulationDrag(event({x:50,y:10}));
 assert.ok(state.selection.selectedObjectIds.includes(id));
 assert.equal(state.objects.find(o=>o.id===id).geometry.position.x,10);
});
test('a handle drag edits the current model instance after source synchronisation replaces objects',()=>{
 const id=create();
 const object=state.objects.find(item=>item.id===id);
 const start=require(locate('feature-geometry.js')).default.rectangleCorners(object.geometry)[0];
 assert.equal(drag.beginManipulationDrag(event(start)),true);
 const initial=JSON.stringify(object.geometry);
 state.objects=structuredClone(state.objects);
 drag.updateManipulationDrag(event({x:start.x-20,y:start.y+15}));
 drag.finishManipulationDrag(event({x:start.x-20,y:start.y+15}));
 assert.notEqual(JSON.stringify(state.objects.find(item=>item.id===id).geometry),initial,
   'a handle must update the model, not the detached object captured at pointerdown');
});
