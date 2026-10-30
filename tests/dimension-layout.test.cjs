const {test}=require('node:test');
const assert=require('node:assert/strict');
const {modulePath}=require('./helpers/source-path.cjs');
const model=require(modulePath('drawing-state.js')).default;
const dimensions=require(modulePath('dimension-model.js')).default;
const {dimensionLabelSize}=require(modulePath('dimension-layout.js'));
function fixture(){
 const state=model.createDrawingState();state.camera.zoom=1;
 const line=model.addObject(state,model.geometryFactories.line({x:0,y:0},{x:100,y:60}));
 const refs=[{featureId:line.id,anchor:'start'},{featureId:line.id,anchor:'end'}];
 const d=model.addObject(state,model.geometryFactories.dimension({dimensionType:'aligned',dimensionKind:'variable',content:'100 mm',refs,placement:{x:50,y:110}}));
 return {state,line,d};
}
test('diagonal dimensions stay aligned regardless of mouse placement',()=>{
 const {state,d}=fixture();
 for(const point of [{x:50,y:110},{x:140,y:30},{x:-40,y:-40}]){
  d.placement=point;const g=dimensions.graphicsFor(d,state);
  assert.ok(Math.abs(g.line[1].x-g.line[0].x-100)<1e-9);
  assert.ok(Math.abs(g.line[1].y-g.line[0].y-60)<1e-9);
  assert.ok(Math.abs(g.measurement.value-Math.hypot(100,60))<1e-7);
 }
});
test('linear text clears the measurement line on both sides and at different zoom levels',()=>{
 const {state,d}=fixture();d.content='Long label\nsecond line';
 for(const zoom of [.25,1,4])for(const mode of ['horizontal','vertical','aligned'])for(const point of [{x:140,y:130},{x:-40,y:-40}]){
  state.camera.zoom=zoom;d.orientation=mode;d.placement=point;
  const g=dimensions.graphicsFor(d,state),[a,b]=g.line;
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
  const distance=Math.abs((g.textFrame.x-a.x)*dy-(g.textFrame.y-a.y)*dx)/length;
  const size=dimensionLabelSize(d.content,state);
  assert.ok(distance>=size.halfHeight+size.gap-1e-8,`${zoom} ${mode}: text must clear the line`);
 }
});
test('angle labels are outside the arc and square, including long multiline labels',()=>{
 const {state,line}=fixture();line.geometry.end={x:100,y:0};
 for(const degrees of [30,90,150]){
  const radians=degrees*Math.PI/180;
  const other=model.addObject(state,model.geometryFactories.line({x:0,y:0},{x:100*Math.cos(radians),y:100*Math.sin(radians)}));
  const d=model.geometryFactories.dimension({dimensionType:'angular',dimensionKind:'variable',content:'WW angle\n90°',refs:[{featureId:line.id,anchor:'start',endAnchor:'end'},{featureId:other.id,anchor:'start',endAnchor:'end'}],placement:{x:25*Math.cos(radians/2),y:25*Math.sin(radians/2)}});
  for(const zoom of [.5,1,2]){
   state.camera.zoom=zoom;const g=dimensions.graphicsFor(d,state),size=dimensionLabelSize(d.content,state);
   const bx=Math.cos(radians/2),by=Math.sin(radians/2);
   const nearText=g.textFrame.x*bx+g.textFrame.y*by-size.halfWidth*Math.abs(bx)-size.halfHeight*Math.abs(by);
   const farMarker=Math.max(...g.arc.map(p=>p.x*bx+p.y*by));
   assert.ok(nearText>=farMarker+size.gap/2-1e-8,`${degrees}° at ${zoom}: label overlaps marker`);
   assert.equal(g.textFrame.angle,0);
  }
 }
});
test('export uses the offset label for aligned dimensions',()=>{
 const {state,d}=fixture();
 const source=require(modulePath('annotations.js')).annotationSourceWriter(d,{state});
 const g=dimensions.graphicsFor(d,state);
 assert.ok(source.includes('\\node'),source);
 assert.notEqual(g.textFrame.y,(g.line[0].y+g.line[1].y)/2);
});

test('zooming in preserves enough physical space for exported labels',()=>{
 const canonical=dimensionLabelSize('90°',{camera:{zoom:1}});
 const zoomed=dimensionLabelSize('90°',{camera:{zoom:8}});
 assert.ok(zoomed.halfWidth>=canonical.halfWidth);
 assert.ok(zoomed.halfHeight>=canonical.halfHeight);
 assert.ok(zoomed.gap>=canonical.gap);
});
