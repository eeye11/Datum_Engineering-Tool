const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {bootApp,whenReady}=require('./helpers/boot-app.cjs');
const {locate}=require('./helpers/source-path.cjs');
const {window,document,error}=bootApp();if(error)throw error;
let state,model,dimensions,tool,placement;
before(async()=>{
 await whenReady();state=require(locate('editor-state.js')).drawingState;
 model=require(locate('drawing-state.js')).default;
 dimensions=require(locate('dimension-model.js')).default;
 tool=require(locate('angle-tool.js'));placement=require(locate('dimension-placement.js'));
 const canvas=document.querySelector('.drawing-canvas');
 Object.defineProperties(canvas,{clientWidth:{value:900,configurable:true},clientHeight:{value:600,configurable:true}});
 canvas.getBoundingClientRect=()=>({left:0,top:0,width:900,height:600});
 state.camera={zoom:1,panX:0,panY:0};
});
after(()=>window.close());
function fixture(){state.objects=[];model.clearInteraction(state);return state;}
function line(a,b){return model.addObject(state,model.geometryFactories.line(a,b));}
function dimension(a,b,point,options={}){return model.geometryFactories.dimension({dimensionType:'angular',refs:[{featureId:a.id,anchor:'start',endAnchor:'end'},{featureId:b.id,anchor:'start',endAnchor:'end'}],placement:point,...options});}
function click(point){const p=model.engineeringToScreen(point,{width:900,height:600},state);placement.handleDimensionClick({rawPointerPoint:point},{clientX:p.x,clientY:p.y});}
test('Angle picks two lines, previews a true right angle, asks for a label and returns to Select',async()=>{
 fixture();const a=line({x:-40,y:0},{x:60,y:0});const b=line({x:10,y:-50},{x:10,y:70});
 model.setActiveTool(state,'angle');click({x:-20,y:0});assert.equal(state.interaction.dimensionStage,'first');
 click({x:10,y:40});assert.equal(state.interaction.dimensionStage,'placement');
 click({x:30,y:20});
 const popup=document.querySelector('.drawing-creation-dimension');assert.equal(popup.getAttribute('aria-label'),'Angle');
 const input=popup.querySelector('input');assert.ok(input.value.includes('90'),'default label is the actual angle');
 input.value='θ';input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 await Promise.resolve();assert.equal(state.activeTool,'select');
 const d=state.objects.find(o=>o.type==='dimension');assert.equal(d.content,'θ');assert.equal(d.name,'Angle');
 assert.equal(d.sourceRefs[0].featureId,a.id);assert.equal(d.sourceRefs[1].featureId,b.id);
 const g=dimensions.graphicsFor(d,state);assert.equal(g.rightAngle,true);assert.equal(g.arc.length,3);assert.deepEqual(g.vertex,{x:10,y:0});
 assert.ok(Math.abs(g.measurement.value-90)<1e-9);
 const saved=JSON.parse(model.serializeDrawing(state));const loaded=saved.objects.find(o=>o.id===d.id);
 assert.equal(dimensions.formatMeasurement(loaded,saved),'θ');assert.equal(dimensions.graphicsFor(loaded,saved).rightAngle,true);
 require(locate('dimension-tool.js')).openDimensionValuePrompt(d);
 const editor=document.querySelector('.dimension-value-editor');assert.equal(editor.getAttribute('aria-label'),'Angle');
 editor.querySelector('input').value='90°';editor.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
 assert.equal(state.objects.find(o=>o.id===d.id).content,'90°');
});
test('right-angle corners remain accurate for rotated geometry; near-right angles stay arcs',()=>{
 fixture();const root={x:35,y:-12},theta=.37;
 const a=line(root,{x:root.x+100*Math.cos(theta),y:root.y+100*Math.sin(theta)});
 const b=line(root,{x:root.x-70*Math.sin(theta),y:root.y+70*Math.cos(theta)});
 const d=dimension(a,b,{x:root.x+10,y:root.y+35});
 const g=dimensions.graphicsFor(d,state);assert.equal(g.rightAngle,true);
 const [p,q,r]=g.arc;const u={x:q.x-p.x,y:q.y-p.y},v={x:r.x-q.x,y:r.y-q.y};
 assert.ok(Math.abs(u.x*v.x+u.y*v.y)<1e-7,'square sides are perpendicular');
 const near=(89.99*Math.PI/180)+theta;b.geometry.end={x:root.x+70*Math.cos(near),y:root.y+70*Math.sin(near)};
 assert.equal(dimensions.graphicsFor(d,state).rightAngle,false,'89.99 degrees must not be rounded into a square');
});
test('placement chooses acute or obtuse sectors using the true intersection of extended lines',()=>{
 fixture();const a=line({x:0,y:0},{x:100,y:0});const b=line({x:120,y:10},{x:120+Math.sqrt(3)*30,y:40});
 const acute=dimension(a,b,{x:150,y:10}),obtuse=dimension(a,b,{x:90,y:20});
 const g=dimensions.graphicsFor(acute,state);assert.ok(Math.abs(g.vertex.x-(120-Math.sqrt(3)*10))<1e-7);assert.ok(Math.abs(g.vertex.y)<1e-7);
 assert.ok(Math.abs(dimensions.measurementFor(acute,state).value-30)<1e-7);
 assert.ok(Math.abs(dimensions.measurementFor(obtuse,state).value-150)<1e-7);
});
test('rectangle sub-edges retain exact references and follow edits; parallel picks are refused',()=>{
 fixture();const rect=model.addObject(state,model.geometryFactories.rectangle({x:0,y:40},100,40));
 model.setActiveTool(state,'angle');tool.handleAngleClick({x:50,y:40});tool.handleAngleClick({x:100,y:20});
 assert.equal(state.interaction.dimensionStage,'placement');
 const refs=state.interaction.dimensionRefs;assert.equal(refs[0].featureId,rect.id);assert.equal(refs[1].featureId,rect.id);
 assert.notEqual(refs[0].anchor,refs[1].anchor);assert.ok(refs.every(ref=>ref.endAnchor));
 const d=model.geometryFactories.dimension({dimensionType:'angular',refs,placement:{x:80,y:20}});
 assert.equal(dimensions.graphicsFor(d,state).rightAngle,true);rect.geometry.rotation=25;
 assert.ok(Math.abs(dimensions.measurementFor(d,state).value-90)<1e-7);
 fixture();line({x:0,y:0},{x:80,y:0});line({x:0,y:30},{x:80,y:30});model.setActiveTool(state,'angle');
 tool.handleAngleClick({x:40,y:0});tool.handleAngleClick({x:40,y:30});assert.equal(state.interaction.dimensionStage,'first');
 assert.equal(state.objects.filter(o=>o.type==='dimension').length,0);
 assert.equal(tool.angleLineAt({x:500,y:500}),null);
});
test('polygon edges can be picked and measured without becoming detached points',()=>{
 fixture();const polygon=model.addObject(state,model.geometryFactories.polygon({x:0,y:0},50,4));
 const measurement=require(locate('measurement-core.js')).default;
 const vertices=[0,1,2].map(i=>measurement.resolveAnchor(polygon,`vertex${i}`));
 const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
 model.setActiveTool(state,'angle');tool.handleAngleClick(mid(vertices[0],vertices[1]));tool.handleAngleClick(mid(vertices[1],vertices[2]));
 assert.equal(state.interaction.dimensionStage,'placement');
 const d=model.geometryFactories.dimension({dimensionType:'angular',refs:state.interaction.dimensionRefs,placement:{x:0,y:0}});
 assert.equal(dimensions.graphicsFor(d,state).rightAngle,true);
});
test('right-angle markers export the same square path as the canvas',()=>{
 fixture();const a=line({x:0,y:0},{x:80,y:0});const b=line({x:0,y:0},{x:0,y:80});
 const d=dimension(a,b,{x:20,y:20},{dimensionKind:'variable',content:'90°'});
 const source=require(locate('annotations.js')).annotationSourceWriter(d,{state});
 assert.ok(source.includes('(20,0) -- (20,20) -- (0,20)'),source);
 assert.equal(source.includes('arc['),false);
});
