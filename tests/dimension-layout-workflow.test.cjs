const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {bootApp,whenReady}=require('./helpers/boot-app.cjs');
const {locate}=require('./helpers/source-path.cjs');
const {window,document,error}=bootApp();if(error)throw error;
let state,model,placement,preview,dimensions;
before(async()=>{
 await whenReady();state=require(locate('editor-state.js')).drawingState;
 model=require(locate('drawing-state.js')).default;
 placement=require(locate('dimension-placement.js'));preview=require(locate('preview.js'));
 dimensions=require(locate('dimension-model.js')).default;
 const canvas=document.querySelector('.drawing-canvas');
 Object.defineProperties(canvas,{clientWidth:{value:900,configurable:true},clientHeight:{value:600,configurable:true}});
 canvas.getBoundingClientRect=()=>({left:0,top:0,width:900,height:600});state.camera={zoom:1,panX:0,panY:0};
});
after(()=>window.close());
function click(point,altKey=false){const p=model.engineeringToScreen(point,{width:900,height:600},state);placement.handleDimensionClick({rawPointerPoint:point},{clientX:p.x,clientY:p.y,altKey});}
test('diagonal placement stays aligned and returns to Select',async()=>{
 state.objects=[];model.addObject(state,model.geometryFactories.line({x:0,y:0},{x:100,y:60}));
 for(const point of [{x:50,y:110},{x:140,y:30}]){
  model.setActiveTool(state,'dimension');click({x:0,y:0});click({x:100,y:60});
  preview.updatePreview({rawPointerPoint:point,effectiveConstructionPoint:point});
  assert.equal(state.interaction.dimensionChoice,'aligned');
  click(point);
  const input=document.querySelector('.drawing-creation-dimension input');input.value='L';
  input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  await Promise.resolve();assert.equal(state.activeTool,'select');
  const d=state.objects.filter(object=>object.type==='dimension').at(-1);
  assert.equal(d.dimensionType,'aligned');
  assert.ok(Math.abs(dimensions.measurementFor(d,state).value-Math.hypot(100,60))<1e-7);
 }
});
