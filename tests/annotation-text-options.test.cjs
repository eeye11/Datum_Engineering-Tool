const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {bootApp,whenReady}=require('./helpers/boot-app.cjs');
const {locate}=require('./helpers/source-path.cjs');
const {window,document,error}=bootApp();if(error)throw error;
before(whenReady);after(()=>window.close());
test('Special Symbols replaces selected text at the caret and emits normal edit events',async()=>{
 const {openSpecialSymbols,insertAtCaret}=await import('../src/shared/ui/editors/special-symbols-insert.js');
 const input=document.createElement('textarea');document.body.append(input);
 input.value='angle = value';input.focus();input.setSelectionRange(8,13);
 let edits=0;input.addEventListener('input',()=>edits++);

 /* The command is the menu's; there is no per-field button beside the input. */
 assert.equal(typeof openSpecialSymbols,'function');
 assert.equal(input.nextElementSibling,null,'no symbol button is attached to a text field');
 insertAtCaret(input,'θ');
 assert.equal(input.value,'angle = θ');assert.equal(edits,1);
 assert.equal(input.selectionStart,input.value.length);input.remove();
});
test('dimension text size persists and controls layout, SVG, and TeX',()=>{
 const model=require(locate('drawing-state.js')).default;
 const dims=require(locate('dimension-model.js')).default;
 const schema=require(locate('feature-schema.js'));
 const state=model.createDrawingState();
 const line=model.addObject(state,model.geometryFactories.line({x:0,y:0},{x:100,y:0}));
 const d=model.addObject(state,model.geometryFactories.dimension({dimensionType:'horizontal',dimensionKind:'variable',content:'L',refs:[{featureId:line.id,anchor:'start'},{featureId:line.id,anchor:'end'}],placement:{x:50,y:20}}));
 /*
  * A DIMENSION'S SIZE IS STATED IN POINTS, and that one number is the frame's
  * type, the print size and the `\fontsize` in the source.
  *
  * Unlike a note (whose `fontSize` is canvas pixels), a dimension is a printed
  * engineering annotation first: 11 is the value a drafter would write, it is
  * what the source prints, and the panel quotes it unchanged. See
  * `dimensionFontPt`.
  */
 const small=dims.graphicsFor(d,state);
 assert.equal(schema.writeField(d,'dimensionTextSize',24),true);
 const large=dims.graphicsFor(d,state);

 assert.equal(large.label.fontPt,24,'the print size is the size the panel states');
 assert.ok(large.textFrame.fontSize>small.textFrame.fontSize,'a bigger size makes a bigger frame');
 assert.ok(Math.abs(large.textFrame.y-20)>Math.abs(small.textFrame.y-20),'the label clears a taller type');

 const source=require(locate('annotations.js')).annotationSourceWriter(d,{state});
 assert.ok(source.includes('fontsize{24}'),source);
 const saved=JSON.parse(model.serializeDrawing(state));
 assert.equal(saved.objects.find(o=>o.id===d.id).style.fontSize,24);
 assert.equal(schema.writeField(d,'dimensionTextSize',-5),false);
});
test('circle callouts have equal bounds, survive saving, and export as circles',()=>{
 const model=require(locate('drawing-state.js')).default;
 const annotate=require(locate('annotate-model.js')).default;
 const schema=require(locate('feature-schema.js'));
 const state=model.createDrawingState();
 const object={id:'balloon',name:'Callout 1',type:'annotate',annotateKind:'callout',text:'α 12',geometry:{start:{x:0,y:0},end:{x:30,y:20},position:{x:30,y:20}},style:{}};
 state.objects.push(object);
 assert.equal(schema.writeField(object,'calloutShape','circle'),true);
 const box=annotate.calloutBox(object,state);
 assert.ok(Math.abs(box.maxX-box.minX-(box.maxY-box.minY))<1e-9);
 const source=require(locate('annotations.js')).annotationSourceWriter(object,{state});
 assert.ok(source.includes('circle[radius='),source);
 const saved=JSON.parse(model.serializeDrawing(state));
 assert.equal(saved.objects.find(o=>o.id===object.id).style.calloutShape,'circle');
 assert.equal(schema.writeField(object,'calloutShape','rectangle'),true);
 assert.equal(schema.writeField(object,'calloutShape','triangle'),false);
});
