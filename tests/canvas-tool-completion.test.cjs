const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {bootApp,whenReady}=require('./helpers/boot-app.cjs');
const {locate}=require('./helpers/source-path.cjs');
const {window,document,error}=bootApp();if(error)throw error;
let state,model,canvas,annotate,hit,box,dimensions;
before(async()=>{
 await whenReady();
 state=require(locate('editor-state.js')).drawingState;
 model=require(locate('drawing-state.js')).default;
 annotate=require(locate('annotate-model.js')).default;
 hit=require(locate('hit-testing.js'));box=require(locate('box-selection.js'));
 dimensions=require(locate('dimension-model.js')).default;
 canvas=document.querySelector('.drawing-canvas');
 Object.defineProperties(canvas,{clientWidth:{value:900,configurable:true},clientHeight:{value:600,configurable:true}});
 canvas.getBoundingClientRect=()=>({left:0,top:0,width:900,height:600});
 state.camera={zoom:1,panX:0,panY:0};
});
after(()=>window.close());
function pointer(point){const p=model.engineeringToScreen(point,{width:900,height:600},state);return{clientX:p.x,clientY:p.y,button:0,pointerId:1};}
function add(object){const previous=model.snapshotDrawing(state);const stored=model.addObject(state,object);model.commitDrawingChange(state,previous);return stored;}
test('a completed creation returns any armed tool to Select; edits and incomplete drafts do not',async()=>{
 for(const tool of ['rectangle','point-force','dimension','note']){
  model.setActiveTool(state,tool);
  await Promise.resolve();assert.equal(state.activeTool,tool,'arming alone keeps the tool');
  add(model.geometryFactories.line({x:-10,y:-20},{x:10,y:-20}));
  await Promise.resolve();assert.equal(state.activeTool,'select');
 }
 model.setActiveTool(state,'rectangle');const before=model.snapshotDrawing(state);
 state.objects[0].geometry.end.x+=2;model.commitDrawingChange(state,before);
 await Promise.resolve();assert.equal(state.activeTool,'rectangle','an edit is not a new creation');
 model.setActiveTool(state,'select');
});
test('partial rectangle-to-line dimensions use endpoints, never infer an angle, and save free points',async()=>{
 state.objects=[];
 const rectangle=add(model.geometryFactories.rectangle({x:0,y:40},100,40,0));
 const internal=add(model.geometryFactories.line({x:65,y:0},{x:65,y:40}));
 await Promise.resolve();
 const {dimensionEndpointAt,endpointPosition}=require(locate('dimension-endpoints.js'));
 const left=dimensionEndpointAt({x:0.5,y:20},state);
 const middle=dimensionEndpointAt({x:65.5,y:20},state);
 assert.equal(left.featureId,rectangle.id);assert.equal(middle.featureId,internal.id);
 assert.ok(Math.abs(endpointPosition(left,state).x)<1e-7);
 const placement=require(locate('dimension-placement.js'));
 model.setActiveTool(state,'dimension');
 const click=p=>placement.handleDimensionClick({rawPointerPoint:p,effectiveConstructionPoint:p},pointer(p));
 click({x:0,y:20});click({x:65,y:20});
 assert.equal(state.interaction.dimensionStage,'placement');
 assert.equal(state.interaction.dimensionChoice,'horizontal');
 click({x:35,y:60});
 const input=document.querySelector('.drawing-creation-dimension input[type="text"]');assert.ok(input);
 input.value='65 mm';input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 await Promise.resolve();assert.equal(state.activeTool,'select');
 const d=state.objects.find(o=>o.type==='dimension');
 assert.equal(dimensions.measurementFor(d,state).value,65);
 const free=model.geometryFactories.dimension({dimensionType:'horizontal',dimensionKind:'variable',content:'L',refs:[{kind:'canvas-point',point:{x:-50,y:80}},{kind:'canvas-point',point:{x:-10,y:80}}],placement:{x:-30,y:100}});
 add(free);assert.equal(dimensions.measurementFor(free,state).value,40);
 const saved=JSON.parse(model.serializeDrawing(state));
 const restored=saved.objects.find(o=>o.id===free.id);
 assert.equal(dimensions.measurementFor(restored,saved).value,40);
 const nearCorner=dimensionEndpointAt({x:99,y:39.5},state);
 assert.deepEqual(endpointPosition(nearCorner,state),{x:100,y:40});
});
test('blank and populated notes can be picked and box-selected at the far end of their text',()=>{
 state.objects=[];
 for(const text of ['', 'This entire note can be dragged']){
  const note=add(model.geometryFactories.annotate({kind:'note',text,position:{x:0,y:0}}));
  for(const zoom of [0.5,1,2]){
   state.camera.zoom=zoom;
   const bounds=annotate.textBoundsOf(note,state);
   const point={x:bounds.maxX-0.5,y:0};
   assert.equal(hit.objectAtPoint(point)?.id,note.id,`right side is hittable at zoom ${zoom}`);
   assert.equal(box.objectIntersectsSelection(note,{minX:point.x-0.2,maxX:point.x+0.2,minY:-1,maxY:1}),true);
   const frame=require(locate('selection-transform.js')).selectionBounds(state.objects,[note.id],state);
   assert.ok(frame.maxX>=bounds.maxX && frame.minY<frame.maxY,'selection visibly surrounds the words');
  }
  state.objects=[];
 }
 state.camera.zoom=1;
});
test('notes focus on canvas immediately, update while typing, and finish on Enter or outside click',async()=>{
 const {commitAnnotate}=require(locate('annotate-creation.js'));
 model.setActiveTool(state,'note');
 const created=commitAnnotate({kind:'note',position:{x:0,y:0}});
 await new Promise(resolve=>setTimeout(resolve,20));
 let input=document.querySelector('.drawing-canvas-text-editor textarea');assert.ok(input);
 assert.equal(document.activeElement,input);assert.equal(state.activeTool,'select');
 assert.equal(document.querySelector('.drawing-inline-entry'),null);
 input.value='Live text';input.dispatchEvent(new window.Event('input',{bubbles:true}));
 assert.equal(state.objects.find(o=>o.id===created.id).text,'Live text');
 input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 assert.equal(document.querySelector('.drawing-canvas-text-editor'),null);
 assert.equal(state.activeTool,'select');
 model.undo(state);assert.equal(state.objects.find(o=>o.id===created.id).text,'','typing is one undoable edit');
 const current=state.objects.find(o=>o.id===created.id);
 const {openNoteEditorFor}=require(locate('canvas-click.js'));
 openNoteEditorFor(current);input=document.querySelector('.drawing-canvas-text-editor textarea');
 input.value='Click away';input.dispatchEvent(new window.Event('input',{bubbles:true}));
 document.body.dispatchEvent(new window.Event('pointerdown',{bubbles:true}));
 assert.equal(state.objects.find(o=>o.id===created.id).text,'Click away');
 openNoteEditorFor(state.objects.find(o=>o.id===created.id));input=document.querySelector('.drawing-canvas-text-editor textarea');
 input.value='Discard';input.dispatchEvent(new window.Event('input',{bubbles:true}));
 input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 assert.equal(state.objects.find(o=>o.id===created.id).text,'Click away');
});
