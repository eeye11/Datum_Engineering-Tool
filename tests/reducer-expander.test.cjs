const test = require('node:test');
const assert = require('node:assert/strict');
const { bootApp, whenReady } = require('./helpers/boot-app.cjs');
const { locate } = require('./helpers/source-path.cjs');
test.after(() => setImmediate(() => process.exit(process.exitCode || 0)));
let m;
async function ready() {
  if (!m) {
    const page = bootApp();
    if (page.error) throw page.error;
    await whenReady();
    m = {
      state: require(locate('editor-state.js')).drawingState,
      ds: require(locate('drawing-state.js')).default,
      pipe: require(locate('model/fluids/pipe-duct.js')).default,
      reducer: require(locate('model/fluids/reducer-expander.js')).default,
      inline: require(locate('inline-insertion.js')),
      tool: require(locate('fluids-schematic-tool.js')),
      preview: require(locate('features/workspace/geometry/preview.js')),
      renderer: require(locate('renderer.js')).default,
      drag: require(locate('drag.js')),
      schema: require(locate('feature-schema.js')),
      editor: require(locate('features-editor.js')),
      transforms: require(locate('transform-session.js')),
      handles: require(locate('handles.js')),
      sync: require(locate('source-synchronization.js')),
      apply: require(locate('source-model-apply.js')),
      connections: require(locate('pipe-duct-tool.js')),
    };
  }
  m.state.objects = [];
  m.state.selection.selectedObjectIds = [];
  m.state.history.past = [];
  m.state.history.future = [];
  m.state.camera.zoom = 1;
  return m;
}
function pipe(from, to, width = 8, style = {}) {
  const created = m.ds.createGeometryObject('pipe-duct', { start: {x:from,y:0}, end: {x:to,y:0} },
    { engineering: { schematicWidth: width }, style });
  m.ds.addObject(m.state, created);
  return m.state.objects.find(object => object.id === created.id);
}
function insert(mode = 'reduce') {
  const host = pipe(0, 100, 8, {stroke:'#123456',lineType:'dashed'});
  const target = m.inline.findReducerTarget({x:50,y:0});
  const plan = m.inline.planInsertion('reducer-expander', target, {mode, transitionLength:12});
  const result = m.inline.insertInline('reducer-expander', plan);
  assert.ok(result?.symbol);
  return {host, fitting:result.symbol, plan};
}
function widths(fitting) {
  const value = m.reducer.endWidthsOf(fitting, m.state.objects);
  return [value.start,value.end];
}
function seated(fitting) {
  const walls = m.reducer.wallsOf(fitting, m.state.objects);
  const runs = m.reducer.connectedRunsOf(fitting, m.state.objects);
  const ports = m.reducer.portsOf(fitting);
  for (const side of ['start','end']) {
    if (!runs[side]) continue;
    assert.deepEqual(runs[side].geometry[ports[side]], walls[side].centre);
    assert.deepEqual(runs[side].geometry.span[ports[side]], walls[side].centre);
  }
}
function sourceEdit(fitting, edit) {
  const block = m.sync.sourceForObject(fitting);
  return m.apply.applyParsedSourceToDrawing({model:m.ds,state:m.state,
    source:'\\begin{tikzpicture}[x=1mm,y=1mm]\n'+edit(block)+'\n\\end{tikzpicture}'});
}

function renderedPreview() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  m.renderer.renderDrawing(m.state,svg);
  return svg.querySelector('[data-feature-id="inline-preview-reducer"]');
}

test('armed reducer previews on hover, commits the previewed taper, and selects the fitting', async () => {
  await ready();
  pipe(0,100,8);
  m.tool.beginInlineToolSession('reducer-expander');
  const before = JSON.stringify(m.state.objects);
  m.preview.updatePreview({rawPointerPoint:{x:50,y:0}});
  const preview = m.state.interaction.preview;
  assert.equal(preview.type,'reducer-expander');
  assert.deepEqual(widths(preview),[8,6]);
  const ghost = renderedPreview();
  assert.ok(ghost,'the hover preview is rendered on the canvas');
  assert.equal(ghost.querySelectorAll('line').length,2);
  assert.equal(JSON.stringify(m.state.objects),before);
  const fitting = m.tool.commitInlineAt('reducer-expander',{x:50,y:0}).symbol;
  assert.deepEqual(m.reducer.wallsOf(fitting).start.centre,m.reducer.wallsOf(preview).start.centre);
  assert.deepEqual(widths(fitting),widths(preview));
  assert.deepEqual(m.state.selection.selectedObjectIds,[fitting.id]);
  seated(fitting);
});

test('hover shows invalid placement and standalone expander preview matches its commit', async () => {
  await ready();
  pipe(0,12);
  m.tool.beginInlineToolSession('reducer-expander');
  m.state.interaction.inlineTransitionLength=30;
  m.preview.updatePreview({rawPointerPoint:{x:6,y:0}});
  assert.equal(m.state.interaction.preview.invalid,true);
  const ghost = renderedPreview();
  assert.ok(ghost);
  assert.ok([...ghost.querySelectorAll('line')].every(line=>line.getAttribute('stroke')==='#dc2626'));
  assert.equal(m.tool.commitInlineAt('reducer-expander',{x:6,y:0}),null);
  m.state.interaction.inlineMode='expand';
  m.state.interaction.inlineTransitionLength=null;
  m.preview.updatePreview({rawPointerPoint:{x:100,y:100}});
  const preview=m.state.interaction.preview;
  const fitting=m.tool.commitInlineAt('reducer-expander',{x:100,y:100}).symbol;
  assert.deepEqual(widths(preview),[15,20]);
  assert.deepEqual(widths(fitting),widths(preview));
  assert.equal(m.reducer.transitionLengthOf(fitting),m.reducer.transitionLengthOf(preview));
  assert.deepEqual(m.state.selection.selectedObjectIds,[fitting.id]);
});

for (const mode of ['reduce','expand']) test(`${mode}: split uses 75%, stable identity, independent style and accurate preview`, async () => {
  await ready();
  const {host,fitting,plan} = insert(mode);
  assert.deepEqual(widths(fitting), mode === 'reduce' ? [8,6] : [6,8]);
  const runs = m.reducer.connectedRunsOf(fitting,m.state.objects);
  assert.equal(runs.start.id,host.id);
  assert.notEqual(runs.start.id,runs.end.id);
  assert.deepEqual(runs.start.style,runs.end.style);
  assert.notEqual(runs.start.style,runs.end.style);
  const preview = m.inline.symbolPreviewFor('reducer-expander',plan,{mode});
  assert.deepEqual(widths(preview),widths(fitting));
  seated(fitting);
  assert.equal(m.state.objects.length,3);
  m.ds.undo(m.state);
  assert.equal(m.state.objects.length,1);
  assert.equal(m.state.objects[0].id,host.id);
});

test('gap insertion matches both widths, creates no pipes, and refuses duplicate insertion', async () => {
  await ready();
  const first=pipe(0,40,12,{stroke:'#aa0000'}),second=pipe(60,100,6,{stroke:'#0000aa'});
  const before=JSON.stringify(m.state.objects);
  const target=m.inline.findReducerTarget({x:50,y:0});
  assert.equal(target.gap,true);
  const plan=m.inline.planInsertion('reducer-expander',target);
  assert.equal(JSON.stringify(m.state.objects),before,'preview is read-only');
  const fitting=m.inline.insertInline('reducer-expander',plan).symbol;
  assert.equal(m.state.objects.length,3);
  assert.deepEqual(widths(fitting),[12,6]);
  assert.equal(first.style.stroke,'#aa0000');assert.equal(second.style.stroke,'#0000aa');
  assert.equal(m.inline.insertInline('reducer-expander',plan),null);
  seated(fitting);
});

for (const mode of ['reduce','expand']) test(`gap insertion respects ${mode} while preserving both existing pipe widths`,async()=>{
  await ready();const first=pipe(0,40,6),second=pipe(60,100,12);
  const plan=m.inline.planInsertion('reducer-expander',m.inline.findReducerTarget({x:50,y:0}),{mode});
  const fitting=m.inline.insertInline('reducer-expander',plan).symbol;
  assert.equal(m.reducer.modeOf(fitting),mode);
  assert.equal(m.pipe.boundarySeparation(first.engineering),6);
  assert.equal(m.pipe.boundarySeparation(second.engineering),12);
  assert.equal(m.state.objects.length,3);seated(fitting);
});

test('type switches exchange widths and preserve axis, IDs, length and appearance', async () => {
  await ready();const {fitting}=insert();
  const geometry=JSON.stringify(fitting.geometry),ids=m.reducer.connectedPipeIds(fitting);
  const styles=m.state.objects.map(object=>JSON.stringify(object.style));
  assert.equal(m.schema.writeField(fitting,'reducerMode','expand'),true);
  assert.deepEqual(widths(fitting),[6,8]);
  assert.equal(JSON.stringify(fitting.geometry),geometry);
  assert.deepEqual(m.reducer.connectedPipeIds(fitting),ids);
  assert.equal(m.reducer.transitionLengthOf(fitting),12);
  assert.deepEqual(m.state.objects.map(object=>JSON.stringify(object.style)),styles);
  m.schema.writeField(fitting,'reducerMode','reduce');assert.deepEqual(widths(fitting),[8,6]);seated(fitting);
});

test('width handles use the perpendicular projection and preserve the opposite end',async()=>{
  await ready();const {fitting}=insert();
  m.drag.applyManipulationFrame({object:fitting,kind:'width-start'}, {x:70,y:7});
  assert.deepEqual(widths(fitting),[14,6]);
  m.drag.applyManipulationFrame({object:fitting,kind:'width-end'}, {x:30,y:5});
  assert.deepEqual(widths(fitting),[14,10]);
  const end=m.reducer.connectedRunsOf(fitting,m.state.objects).end;
  m.schema.writeField(end,'pipeWidth',2);assert.deepEqual(widths(fitting),[14,m.pipe.DEFAULT_SCHEMATIC_SEPARATION+2]);seated(fitting);
});

test('length handles preserve the opposite end, project on-axis and reject overlap',async()=>{
  await ready();const {fitting}=insert();
  const old=m.reducer.wallsOf(fitting);
  m.drag.applyManipulationFrame({object:fitting,kind:'reducer-length-start'},{x:34,y:20});
  assert.equal(m.reducer.transitionLengthOf(fitting),22);
  assert.deepEqual(m.reducer.wallsOf(fitting).end.centre,old.end.centre);seated(fitting);
  m.drag.applyManipulationFrame({object:fitting,kind:'reducer-length-end'},{x:66,y:10});
  assert.deepEqual(m.reducer.wallsOf(fitting).start.centre,{x:34,y:0});seated(fitting);
  const before=JSON.stringify(m.state.objects);
  assert.equal(m.reducer.resizeEndTo(fitting,'end',{x:120,y:0}),false);
  assert.equal(JSON.stringify(m.state.objects),before);
});

test('body drag and shared shifts preserve route connections; connected rotation is blocked',async()=>{
  await ready();const {fitting}=insert();
  m.drag.applyManipulationFrame({object:fitting,kind:'body',start:{x:50,y:0}},{x:65,y:30});
  assert.deepEqual(fitting.geometry.position,{x:65,y:0});seated(fitting);
  m.state.selection.selectedObjectIds=[fitting.id];
  m.transforms.shiftSelection(5,10);assert.deepEqual(fitting.geometry.position,{x:70,y:0});seated(fitting);
  assert.equal(m.transforms.rotateSelection(45),0);
  const html=m.editor.featuresMarkupForSelection([fitting]);
  assert.equal((html.match(/data-feature-group="transform"/g)||[]).length,1);
  assert.doesNotMatch(html,/data-transform-input="rotate"|End A Width|End B Width|Transition Length|Pipe Width/);
  const group=m.schema.groupsFor(fitting).find(g=>g.id==='object');
  assert.deepEqual(group.fields.map(f=>f.key),['name','reducerMode','fixed']);
});

test('Fix blocks fitting transforms and handles',async()=>{
  await ready();const {fitting}=insert();fitting.locked=true;
  const before=JSON.stringify(m.state.objects);
  m.drag.applyManipulationFrame({object:fitting,kind:'width-start'},{x:44,y:15});
  assert.equal(m.reducer.slideReducerTo(fitting,{x:60,y:0}),false);
  assert.equal(m.reducer.setMode(fitting,'expand'),false);
  assert.equal(JSON.stringify(m.state.objects),before);
  assert.deepEqual(m.handles.editableHandlesFor(fitting),[]);
});

test('source mode, length and fill round-trip; invalid edits preserve last valid drawing',async()=>{
  await ready();const {fitting}=insert();
  sourceEdit(fitting,source=>source.replace('mode=reduce','mode=expand'));
  assert.deepEqual(widths(fitting),[6,8]);seated(fitting);
  sourceEdit(fitting,source=>source.replace('length=12','length=20'));
  assert.equal(m.reducer.transitionLengthOf(fitting),20);seated(fitting);
  fitting.style.fillMode='solid';fitting.style.fill='#123456';
  sourceEdit(fitting,source=>source);assert.deepEqual(widths(fitting),[6,8]);seated(fitting);
  const before=JSON.stringify(m.state.objects);
  const report=sourceEdit(fitting,source=>source.replace('length=20','length=-5'));
  assert.equal(JSON.stringify(m.state.objects),before);
  assert.ok(report.invalid.length);
  assert.equal(m.state.objects.length,3);
});

test('invalid placement shows a preview without mutation',async()=>{
  await ready();pipe(0,12);
  m.state.interaction.inlineTransitionLength=30;
  const before=JSON.stringify(m.state.objects);
  assert.equal(m.tool.inlinePreviewAt('reducer-expander',{x:6,y:0}).invalid,true);
  assert.equal(m.tool.commitInlineAt('reducer-expander',{x:6,y:0}),null);
  assert.equal(JSON.stringify(m.state.objects),before);
});

for (const type of ['elbow','junction','pump']) test(`reducer respects the ${type}'s recorded terminal and transfers it when splitting upstream`, async()=>{
  await ready();
  const host=pipe(0,100,8);
  // The fitting's centre is deliberately away from its held terminal.
  const attached={id:`attached-${type}`,type,visible:false,
    geometry:{position:{x:125,y:0},branches:[{connected:host.id,connectedPort:'end'}]},
    engineering:type==='elbow'
      ? {connections:[host.id],ports:{[host.id]:'end'}}
      : type==='pump'
        ? {placement:'inline',pipeIds:[host.id],connections:[host.id],ports:{a:'end',b:null}}
        : {connections:[host.id]}};
  m.state.objects.push(attached);
  assert.equal(m.inline.portOccupied(host,'end'),true);
  assert.equal(m.inline.portOccupied(host,'start'),false);
  const before=JSON.stringify(m.state.objects);
  assert.equal(m.tool.inlinePreviewAt('reducer-expander',{x:100,y:0}).invalid,true);
  assert.equal(m.tool.commitInlineAt('reducer-expander',{x:100,y:0}),null);
  assert.equal(JSON.stringify(m.state.objects),before);

  const plan=m.inline.planInsertion('reducer-expander',m.inline.findReducerTarget({x:50,y:0}),{transitionLength:12});
  const fitting=m.inline.insertInline('reducer-expander',plan).symbol;
  const second=m.reducer.connectedRunsOf(fitting,m.state.objects).end;
  const updated=m.state.objects.find(object=>object.id===attached.id);
  assert.deepEqual(updated.engineering.connections,[second.id]);
  if(type==='elbow') assert.deepEqual(updated.engineering.ports,{[second.id]:'end'});
  if(type==='pump') assert.deepEqual(updated.engineering.pipeIds,[second.id]);
  if(type==='junction') assert.equal(updated.geometry.branches[0].connected,second.id);
  assert.equal(m.inline.portOccupied(second,'end'),true);
  seated(fitting);
});

test('hidden pipes are excluded from reducer insertion and gap targets',async()=>{
  await ready();
  const hidden=pipe(0,100,8);
  hidden.visible=false;
  assert.equal(m.inline.findReducerTarget({x:50,y:0}),null);
  assert.equal(m.inline.findReducerTarget({x:100,y:0}),null);
  const before=JSON.stringify(hidden);
  const fitting=m.tool.commitInlineAt('reducer-expander',{x:50,y:0}).symbol;
  assert.deepEqual(m.reducer.connectedPipeIds(fitting),[null,null]);
  assert.equal(JSON.stringify(hidden),before);
  m.state.objects=[hidden];
  pipe(120,160,4);
  assert.equal(m.inline.findReducerTarget({x:110,y:0}),null);
});

test('standalone fitting moves and connects later through the shared pipe reconciler',async()=>{
  await ready();const fitting=m.inline.insertStandalone('reducer-expander',{x:50,y:0},{transitionLength:12}).symbol;
  assert.deepEqual(widths(fitting),[20,15]);
  const first=pipe(0,44,10),second=pipe(56,100,6);
  m.connections.reconcileFluidConnections(first,m.state.objects);
  m.connections.reconcileFluidConnections(second,m.state.objects);
  assert.deepEqual(widths(fitting),[10,6]);seated(fitting);
  m.ds.removeObjectsAndDescendants(m.state,[first.id]);
  assert.equal(m.state.objects.some(object=>object.id===fitting.id),false);
  assert.equal(m.state.objects.some(object=>object.id===second.id),true);
});

test('width changes propagate along the adjoining run and stop at junctions and other reducers',async()=>{
  await ready();const {fitting}=insert();
  const continuation=pipe(100,140,6,{stroke:'#cc0000'});
  const branch=pipe(140,180,6);
  m.state.objects.push({id:'junction-boundary',type:'junction',geometry:{position:{x:140,y:0},branches:[
    {connected:continuation.id,connectedPort:'end'}, {connected:branch.id,connectedPort:'start'}
  ]},engineering:{}});
  m.reducer.setEndWidth(fitting,'end',10,m.state.objects);
  assert.equal(m.pipe.boundarySeparation(continuation.engineering),10);
  assert.equal(m.pipe.boundarySeparation(branch.engineering),6);
  assert.equal(continuation.style.stroke,'#cc0000');
  assert.deepEqual(widths(fitting),[8,10]);
  m.state.objects=m.state.objects.filter(object=>object.id!=='junction-boundary');
  const nextPlan=m.inline.planInsertion('reducer-expander',m.inline.findReducerTarget({x:120,y:0}),{transitionLength:10});
  const next=m.inline.insertInline('reducer-expander',nextPlan).symbol;
  m.reducer.setEndWidth(fitting,'end',16,m.state.objects);
  assert.deepEqual(widths(next),[16,7.5]);
  assert.equal(m.pipe.boundarySeparation(branch.engineering),7.5);
  seated(fitting);seated(next);
});

test('connected endpoint edits resize the taper and preserve the opposite terminal',async()=>{
  await ready();const {fitting}=insert();
  const runs=m.reducer.connectedRunsOf(fitting,m.state.objects),old=m.reducer.wallsOf(fitting);
  runs.start.geometry.end={x:38,y:0};
  m.connections.reconcileFluidConnections(runs.start,m.state.objects);
  assert.deepEqual(m.reducer.wallsOf(fitting).end.centre,old.end.centre);
  assert.equal(m.reducer.transitionLengthOf(fitting),18);seated(fitting);
  runs.end.geometry.end={x:110,y:15};
  m.connections.reconcileFluidConnections(runs.end,m.state.objects);
  assert.deepEqual(runs.end.geometry.end,{x:110,y:0});seated(fitting);
});

test('standalone fitting rotates through the shared transform and exposes a rotation handle',async()=>{
  await ready();const fitting=m.inline.insertStandalone('reducer-expander',{x:50,y:0}).symbol;
  m.state.selection.selectedObjectIds=[fitting.id];
  assert.equal(m.transforms.rotateSelection(90),1);
  assert.ok(Math.abs(fitting.geometry.direction.x)<1e-8);
  assert.ok(Math.abs(fitting.geometry.direction.y-1)<1e-8);
  assert.ok(m.handles.editableHandlesFor(fitting).some(handle=>handle.kind==='rotate'));
});

test('splitting a pipe again transfers the far fitting connection to the new stable ID',async()=>{
  await ready();const {fitting}=insert();
  const plan=m.inline.planInsertion('reducer-expander',m.inline.findReducerTarget({x:20,y:0}),{transitionLength:8});
  const added=m.inline.insertInline('reducer-expander',plan).symbol;
  assert.equal(fitting.engineering.startPipeId,added.engineering.endPipeId);
  seated(added);seated(fitting);
});

test('source terminal edits update pipes and canonical source reparses without drift',async()=>{
  await ready();const {fitting}=insert();
  sourceEdit(fitting,source=>source.replaceAll('(44,4)','(44,5)').replaceAll('(44,-4)','(44,-5)'));
  assert.deepEqual(widths(fitting),[10,6]);
  sourceEdit(fitting,source=>source.replace('mode=reduce','mode=expand'));
  const canonical=m.sync.sourceForObject(fitting);
  const before=JSON.stringify(m.state.objects);
  for(let i=0;i<3;i++) sourceEdit(fitting,()=>canonical);
  assert.equal(JSON.stringify(m.state.objects),before);
  assert.deepEqual(widths(fitting),[6,10]);
});

test('a complete source drawing recreates both pipes and the fitting with their stable IDs',async()=>{
  await ready();const {fitting}=insert();
  const ids=m.state.objects.map(object=>object.id);
  const source='\\begin{tikzpicture}[x=1mm,y=1mm]\n'+m.state.objects.map(object=>m.sync.sourceForObject(object)).join('\n')+'\n\\end{tikzpicture}';
  m.state.objects=[];
  const report=m.apply.applyParsedSourceToDrawing({model:m.ds,state:m.state,source});
  assert.equal(report.invalid.length,0);
  assert.deepEqual(m.state.objects.map(object=>object.id),ids, JSON.stringify({report,source}));
  const restored=m.state.objects.find(object=>object.id===fitting.id);
  assert.deepEqual(widths(restored),[8,6]);seated(restored);
  assert.equal(m.state.objects[0].style.stroke,'#123456');
  assert.equal(m.state.objects[0].style.lineType,'dashed');
});

test('drag snapshots include connected pipes so undo and cancellation can restore the whole edit',async()=>{
  await ready();const {fitting}=insert();
  const before=JSON.stringify(m.state.objects);
  const drag={object:fitting,kind:'width-start'};
  m.drag.applyManipulationFrame(drag,{x:44,y:12});
  const original=m.state.objects.map(object=>drag.originals[object.id]||object);
  assert.equal(JSON.stringify(original),before);
});

test('diagonal placement and source round-trip preserve collinear terminal geometry',async()=>{
  await ready();
  const host=pipe(0,100,8);
  host.geometry.end={x:80,y:60};
  const plan=m.inline.planInsertion('reducer-expander',m.inline.findReducerTarget({x:40,y:30}),{transitionLength:12});
  const fitting=m.inline.insertInline('reducer-expander',plan).symbol;
  assert.deepEqual(widths(fitting),[8,6]);seated(fitting);
  const report=sourceEdit(fitting,source=>source);
  assert.equal(report.invalid.length,0);seated(fitting);
  assert.ok(Math.abs(fitting.geometry.direction.x-0.8)<0.001);
});

test('editing a styled connected pipe in complete source updates only its fitting end',async()=>{
  await ready();const {fitting}=insert();
  const blocks=m.state.objects.map(object=>m.sync.sourceForObject(object));
  blocks[0]=blocks[0].replaceAll(',4)',',6)').replaceAll(',-4)',',-6)');
  const report=m.apply.applyParsedSourceToDrawing({model:m.ds,state:m.state,
    source:'\\begin{tikzpicture}[x=1mm,y=1mm]\n'+blocks.join('\n')+'\n\\end{tikzpicture}'});
  assert.equal(report.invalid.length,0);
  assert.deepEqual(widths(fitting),[12,6],JSON.stringify(blocks[0]));seated(fitting);
  assert.ok(report.reducerSyncIds.includes(fitting.id));
});

test('typing a pipe width in the Source tab rewrites the connected taper and remains stable',async()=>{
  await ready();const {fitting}=insert();
  const doc=globalThis.document, win=doc.defaultView;
  globalThis.fetch=win.fetch=async()=>({ok:true,status:200,json:async()=>({success:true,svg:'<svg xmlns="http://www.w3.org/2000/svg"/>'})});
  const {activeSourceManager}=require(locate('drawing-source-manager.js'));
  const manager=activeSourceManager();
  const source='\\begin{tikzpicture}[x=1mm,y=1mm]\n'+m.state.objects.map(object=>m.sync.sourceForObject(object)).join('\n')+'\n\\end{tikzpicture}';
  manager.setSource(source,{origin:'object'});
  require(locate('panel-tabs.js')).setActivePanelTab('source');
  require(locate('source-tab.js')).renderSourceTab();
  const editor=doc.querySelector('#drawingSourceEditor textarea');
  assert.ok(editor);
  editor.value=editor.value.replaceAll(',4)',',6)').replaceAll(',-4)',',-6)');
  editor.dispatchEvent(new win.Event('input',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.deepEqual(widths(fitting),[12,6],JSON.stringify({visible:editor.value,source:manager.getSource(),diagnostics:manager.diagnostics()}));seated(fitting);
  assert.match(manager.getSource(),/\(44,6\) -- \(56,3\)/);
  const before=JSON.stringify(m.state.objects);
  m.apply.applyParsedSourceToDrawing({model:m.ds,state:m.state,source:manager.getSource()});
  assert.equal(JSON.stringify(m.state.objects),before);
});
