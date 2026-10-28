const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {bootApp,whenReady}=require('./helpers/boot-app.cjs');
const {locate}=require('./helpers/source-path.cjs');
const {window,document,error}=bootApp();if(error)throw error;
let state,model,annotations,picker;
before(async()=>{
 await whenReady();state=require(locate('editor-state.js')).drawingState;
 model=require(locate('drawing-state.js')).default;
 annotations=require(locate('annotate-model.js')).default;
 picker=require(locate('symbol-picker.js')).default;
});
after(()=>window.close());
test('Symbol belongs to Text, and Greek has all 24 letters in both cases',()=>{
 const {annotateToolGroups}=require(locate('tools.js'));
 assert.ok(annotateToolGroups.find(g=>g.id==='annotate-text').tools.some(t=>t.id==='symbol'));
 assert.equal(annotateToolGroups.some(g=>g.id==='annotate-symbols'),false);
 const lower=annotations.SYMBOL_LIBRARY.find(g=>g.id==='greek-math');
 const upper=annotations.SYMBOL_LIBRARY.find(g=>g.id==='greek-uppercase');
 assert.equal(lower.symbols.length,24);assert.equal(upper.symbols.length,24);
 assert.equal(lower.symbols.map(s=>s.text).join(''),'αβγδεζηθικλμνξοπρστυφχψω');
 assert.equal(upper.symbols.map(s=>s.text).join(''),'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ');
 const all=picker.allSymbols();assert.ok(all.length>=180);
 assert.equal(new Set(all.map(s=>s.id)).size,all.length,'saved symbol IDs are unique');
 for(const id of ['datum','diameter','theta','sum','integral','delta-sym','micro'])assert.ok(annotations.SYMBOL_BY_ID[id],'legacy '+id);
});
test('search works by name, glyph, category and TeX command',()=>{
 for(const term of ['theta','θ','\\theta','calculus','uppercase']){
  const matches=picker.allSymbols().filter(s=>picker.matches(s,term));assert.ok(matches.length,term);
 }
 const dialog=picker.open({onPick:()=>{}});
 const search=dialog.querySelector('[data-symbol-search]');search.value='∇';search.dispatchEvent(new window.Event('input',{bubbles:true}));
 assert.equal(dialog.querySelectorAll('[data-symbol-id]').length,1);
 assert.equal(dialog.querySelector('[data-symbol-id]').dataset.symbolId,'nabla');picker.close();
});
test('choosing a symbol places that glyph, returns to Select, and exports the chosen glyph',async()=>{
 const {handleAnnotateClick}=require(locate('annotate-creation.js'));
 model.setActiveTool(state,'symbol');
 handleAnnotateClick({effectiveConstructionPoint:{x:0,y:0}});
 await new Promise(resolve=>setTimeout(resolve,10));
 const item=document.querySelector('[data-symbol-id="greek-upper-psi"]');assert.ok(item);
 item.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
 assert.equal(state.interaction.annotateSymbolId,'greek-upper-psi');
 handleAnnotateClick({effectiveConstructionPoint:{x:20,y:10}});
 await Promise.resolve();
 const placed=state.objects.find(o=>o.annotateKind==='symbol');assert.ok(placed);
 assert.equal(placed.geometry.symbolId,'greek-upper-psi');
 assert.equal(annotations.textOf(placed),'Ψ');assert.equal(state.activeTool,'select');
 const {annotationSourceWriter}=require(locate('annotations.js'));
 const source=annotationSourceWriter(placed);assert.ok(source.includes('$\\Psi$'),source);
 const restored=JSON.parse(model.serializeDrawing(state)).objects.find(o=>o.id===placed.id);
 assert.equal(annotations.textOf(restored),'Ψ');
});
test('source and SVG exporters support the added Unicode symbols without raw glyphs',()=>{
 const {texText}=require(locate('statics-primitives.js'));
 const {latexText}=require(locate('svg-to-tikz.js'));
 for(const symbol of picker.allSymbols()){
  if(!symbol.tex)continue;
  if(symbol.text.codePointAt(0)<=127)continue;
  assert.ok(!texText(symbol.text).includes(symbol.text),'source '+symbol.label);
  assert.ok(!latexText(symbol.text).includes(symbol.text),'SVG '+symbol.label);
 }
 assert.equal(texText('A + B = C'),'A + B = C');
});
test('the entire symbol library compiles through the real TikZ backend',async()=>{
 const {loadTikz,renderTikz}=require('../server/tikz.js');
 const {annotationSourceWriter}=require(locate('annotations.js'));
 await loadTikz();
 const source=picker.allSymbols().map((s,i)=>annotationSourceWriter(
  model.geometryFactories.annotate({kind:'symbol',symbolId:s.id,position:{x:(i%12)*16,y:-Math.floor(i/12)*10}})
 )).join('\n');
 const svg=await renderTikz('\\begin{tikzpicture}[x=1mm,y=1mm]\n'+source+'\n\\end{tikzpicture}');
 assert.ok(svg.includes('<svg'));
});
