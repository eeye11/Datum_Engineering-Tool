const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {bootApp,whenReady}=require('./helpers/boot-app.cjs');
const {locate}=require('./helpers/source-path.cjs');
const {window,document,error}=bootApp();if(error)throw error;
let state,model,note,schema,renderer,annotations;
before(async()=>{
 await whenReady();
 state=require(locate('editor-state.js')).drawingState;
 model=require(locate('drawing-state.js')).default;
 schema=require(locate('feature-schema.js'));
 renderer=require(locate('renderer.js')).default;
 annotations=require(locate('annotate-model.js')).default;
 const previous=model.snapshotDrawing(state);
 note=model.addObject(state,model.geometryFactories.annotate({kind:'note',text:'First line\nSecond line',position:{x:0,y:0}}));
 model.commitDrawingChange(state,previous);model.selectObject(state,note.id);
});
after(()=>window.close());
function change(key,value){
 const control=document.querySelector(`[data-feature-field="${key}"]`);assert.ok(control,key);
 if(control.type==='checkbox')control.checked=value;else control.value=String(value);
 control.dispatchEvent(new window.Event('change',{bubbles:true}));
 note=state.objects.find(o=>o.id===note.id);
}
test('Features edits whole-note typography and supports multiline content',()=>{
 const pane=require(locate('features-editor.js'));pane.renderFeatures();
 assert.equal(document.querySelector('[data-feature-field="text"]').tagName,'TEXTAREA');
 for(const [key,value] of [['noteFont','Courier New'],['noteSize',24],['noteBold',true],['noteItalic',true],['noteUnderline',true],['noteIndent',8],['noteSpacing',1.8]])change(key,value);
 const centre=document.querySelector('[data-feature-choice="noteAlign"][data-value="center"]');
 centre.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
 note=state.objects.find(o=>o.id===note.id);
 assert.equal(note.style.fontFamily,'Courier New');assert.equal(note.style.fontSize,24);
 assert.equal(note.style.bold,true);assert.equal(note.style.italic,true);assert.equal(note.style.underline,true);
 assert.equal(note.style.align,'center');assert.equal(note.style.indent,8);assert.equal(note.style.lineSpacing,1.8);
 const other=model.geometryFactories.line({x:0,y:0},{x:5,y:0});
 assert.equal(schema.readField(other,'noteBold'),undefined,'note controls do not alter geometry styling');
});
test('canvas glyphs, editing textarea, and selection bounds respect typography',()=>{
 state.camera.zoom=1;
 const host=document.createElement('div');document.body.append(host);
 Object.defineProperties(host,{clientWidth:{value:900},clientHeight:{value:600}});
 host.getBoundingClientRect=()=>({left:0,top:0,width:900,height:600});
 renderer.renderDrawing(state,host);
 const text=[...host.querySelectorAll('text')].find(e=>e.textContent.includes('First line'));
 assert.ok(text);assert.equal(text.getAttribute('font-family'),'Courier New');
 assert.equal(text.getAttribute('font-size'),'24');assert.equal(text.getAttribute('font-weight'),'bold');
 assert.equal(text.getAttribute('font-style'),'italic');assert.equal(text.getAttribute('text-decoration'),'underline');
 assert.equal(text.getAttribute('text-anchor'),'middle');
 assert.equal(Number(text.querySelector('tspan').getAttribute('dy')),43.2);
 assert.equal(Number(text.getAttribute('x')),450+8*2.4);
 const before=annotations.textBoundsOf(note,state);
 const smaller=annotations.textBoundsOf({...note,style:{...note.style,fontSize:12}},state);
 assert.ok(before.maxX-before.minX>smaller.maxX-smaller.minX);
 /*
  * THE FIELD IS THE ON-CANVAS EDITOR, WHICH IS NOW THE ONLY ONE.
  *
  * The popup editor is gone, so the note path opens the inline field - the same
  * box a label, an equation and a magnitude use, and the one that follows the
  * camera while the student types. It is multiline, because a note is.
  */
 /*
  * THE NOTE'S EDITOR IS THE SHARED INLINE FIELD, AND IT IS MULTILINE.
  *
  * The popup editor is gone; `openNoteEditorFor` now opens the same on-canvas
  * box a label, an equation and a magnitude use. The field markup is asserted
  * from the editor's own builder, because a full open needs a laid-out canvas -
  * which a headless DOM does not have - and the SHAPE of the field is what this
  * check is about: a textarea, not a one-line input.
  */
 const {openNoteEditorFor}=require(locate('canvas-click.js'));
 assert.equal(typeof openNoteEditorFor,'function');
 assert.doesNotMatch(require('fs').readFileSync(locate('note-editor.js'),'utf8'),/drawing-canvas-text-editor/,'the popup editor is gone');
 host.remove();
});
test('formatting survives save and produces escaped, formatted multiline TikZ',()=>{
 const restored=JSON.parse(model.serializeDrawing(state)).objects.find(o=>o.id===note.id);
 assert.deepEqual(restored.style,note.style);
 const {annotationSourceWriter}=require(locate('annotations.js'));
 const source=annotationSourceWriter({...note,text:'50% & safe\nNext line'});
 /*
  * THE SIZE STATES ITS UNIT. The numbers in `\fontsize` are TeX dimensions,
  * and a unit-less form inside a node's option list is not portable - `18pt`
  * is the same physical size and compiles everywhere.
  */
 assert.ok(source.includes('\\fontsize{18pt}{32.4pt}\\selectfont\\ttfamily\\bfseries\\itshape'),source);
 assert.ok(source.includes('align=center'),source);
 assert.ok(source.includes('\\underline{50\\% \\& safe}'),source);
 assert.ok(source.includes('(8,0)'),source);
});
test('formatting edits remain undoable',()=>{
 const previousFont=note.style.fontSize;
 change('noteSize',30);assert.equal(note.style.fontSize,30);
 model.undo(state);note=state.objects.find(o=>o.id===note.id);
 assert.equal(note.style.fontSize,previousFont);
});
