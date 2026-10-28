const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {bootApp,whenReady}=require('./helpers/boot-app.cjs');
const {locate}=require('./helpers/source-path.cjs');
const {window,document,error}=bootApp();
if(error)throw error;
let state,model,tool,refs;
before(async()=>{
 await whenReady();
 ({drawingState:state}=require(locate('editor-state.js')));
 model=require(locate('drawing-state.js')).default;
 tool=require(locate('dimension-tool.js'));
 const previous=model.snapshotDrawing(state);
 const line=model.addObject(state,model.geometryFactories.line({x:0,y:0},{x:100,y:0}));
 model.commitDrawingChange(state,previous);
 refs=[{featureId:line.id,anchor:'start'},{featureId:line.id,anchor:'end'}];
});
after(()=>window.close());
function submit(form){form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));}
test('variable placement requires entry, rejects blank, and cancellation creates nothing',()=>{
 model.setActiveTool(state,'dimension');
 const before=state.objects.length;
 tool.commitDimension('linear',refs,{x:40,y:20});
 assert.equal(state.objects.length,before);
 const popup=document.querySelector('.drawing-creation-dimension');
 assert.ok(popup,'placement opens required content entry');
 const input=popup.querySelector('input[type="text"]');
 assert.ok(input);
 input.value=''; input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 assert.equal(state.objects.length,before);
 assert.ok(popup.isConnected,'blank entry keeps the popup open');
 // Escape cancels rather than committing a blank dimension.
 input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 assert.equal(state.objects.length,before);
});
test('variable content is committed and can be reopened through the dimension editor',()=>{
 model.setActiveTool(state,'dimension');
 tool.commitDimension('linear',refs,{x:40,y:20});
 const popup=document.querySelector('.drawing-creation-dimension');
 const input=popup.querySelector('input[type="text"]');
 input.value='L/2';input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 const variable=state.objects.find(o=>o.type==='dimension'&&o.dimensionKind==='variable');
 assert.ok(variable);assert.equal(variable.content,'L/2');
 tool.openDimensionValuePrompt(variable);
 const form=document.querySelector('.dimension-value-editor');
 const content=form.querySelector('input');assert.equal(content.value,'L/2');
 content.value='';submit(form);assert.ok(form.isConnected);assert.equal(variable.content,'L/2');
 content.value='θ + b';submit(form);
 assert.equal(state.objects.find(o=>o.id===variable.id).content,'θ + b');
});
test('unified Dimension edits magnitude without resizing geometry or exposing modes',()=>{
 model.setActiveTool(state,'dimension');
 const before=structuredClone(state.objects.find(o=>o.id===refs[0].featureId).geometry);
 tool.commitDimension('linear',refs,{x:30,y:20});
 const popup=document.querySelector('.drawing-creation-dimension');
 const entry=popup.querySelector('input[type="text"]');
 entry.value='65 mm';entry.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 const dimension=state.objects.filter(o=>o.type==='dimension').at(-1);
 assert.equal(dimension.content,'65 mm');
 tool.openDimensionValuePrompt(dimension);
 const form=document.querySelector('.dimension-value-editor');
 assert.equal(form.querySelector('select'),null);
 const input=form.querySelector('input');assert.equal(input.readOnly,false);
 input.value='80 mm';submit(form);
 const current=state.objects.find(o=>o.id===dimension.id);
 assert.equal(current.content,'80 mm');
 assert.deepEqual(state.objects.find(o=>o.id===refs[0].featureId).geometry,before);
 assert.deepEqual(current.sourceRefs,dimension.sourceRefs);
});
