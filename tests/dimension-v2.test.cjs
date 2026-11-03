const { test } = require('node:test');
const assert = require('node:assert/strict');
const { modulePath } = require('./helpers/source-path.cjs');
const model = require(modulePath('drawing-state.js')).default;
const dims = require(modulePath('dimension-model.js')).default;
const { applyDrivingValue } = require(modulePath('dimension-driving.js'));
const latex = require(modulePath('latex-document.js')).default;

function fixture() {
    const state = model.createDrawingState();
    const line = model.addObject(state, model.geometryFactories.line({x:0,y:0},{x:100,y:0}));
    const refs = [{featureId:line.id,anchor:'start'},{featureId:line.id,anchor:'end'}];
    return {state,line,refs};
}
function dimension(state, refs, options={}) {
    return model.addObject(state, model.geometryFactories.dimension({dimensionType:'linear',refs,placement:{x:30,y:20},...options}));
}

test('variable dimensions require content and never resize geometry', () => {
    const {state,line,refs} = fixture();
    assert.throws(()=>dimension(state,refs,{dimensionKind:'variable'}),/required/);
    const variable=dimension(state,refs,{dimensionKind:'variable',content:' L / 2 '});
    assert.equal(variable.content,'L / 2');
    assert.equal(dims.formatMeasurement(variable,state),'L / 2');
    assert.equal(line.geometry.end.x,100);
    line.geometry.end.x=160;
    assert.equal(dims.formatMeasurement(variable,state),'L / 2');
});

test('driven dimensions follow referenced geometry',()=>{
    const {state,line,refs}=fixture(); const d=dimension(state,refs);
    assert.equal(d.mode,'driven');
    line.geometry.end.x=145;
    assert.equal(dims.measurementFor(d,state).value,145);
    state.objects=state.objects.filter(o=>o.id!==line.id);
    assert.equal(dims.measurementFor(d,state),null);
});

test('driving values resize the reference, persist as constraints, and conflict safely',()=>{
    const {state,line,refs}=fixture(); const d=dimension(state,refs);
    assert.equal(applyDrivingValue(d,state,75).ok,true);
    assert.equal(line.geometry.end.x,75);
    assert.equal(d.drivingValue,75);
    const before=model.snapshotDrawing(state);
    line.geometry.end.x=120;
    model.commitDrawingChange(state,before);
    assert.equal(line.geometry.end.x,75);
    const redundant=dimension(state,refs);
    assert.equal(applyDrivingValue(redundant,state,90).ok,false);
    assert.equal(line.geometry.end.x,75);
    d.mode='driven';d.drivingValue=null;
    assert.equal(applyDrivingValue(redundant,state,90).ok,true);
    assert.equal(line.geometry.end.x,90);
});

test('locked or invalid driving edits do not partially change geometry',()=>{
    const {state,line,refs}=fixture();const d=dimension(state,refs);
    for(const value of [0,-10,NaN,Infinity]) assert.equal(applyDrivingValue(d,state,value).ok,false);
    line.locked=true;
    assert.equal(applyDrivingValue(d,state,45).ok,false);
    assert.equal(line.geometry.end.x,100);
});

test('radius and shared-vertex angles can drive their geometry',()=>{
    const {state,line}=fixture();
    const circle=model.addObject(state,model.geometryFactories.circle({x:10,y:10},20));
    const radius=dimension(state,[{featureId:circle.id,anchor:'east'}],{dimensionType:'radius'});
    assert.equal(applyDrivingValue(radius,state,35).ok,true);
    assert.equal(circle.geometry.radius,35);
    const leg=model.addObject(state,model.geometryFactories.line({x:0,y:0},{x:0,y:100}));
    const angle=dimension(state,[{featureId:line.id,anchor:'start'},{featureId:leg.id,anchor:'start'}],{dimensionType:'angular',placement:{x:40,y:30}});
    assert.equal(applyDrivingValue(angle,state,60).ok,true);
    assert.ok(Math.abs(dims.measurementFor(angle,state).value-60)<1e-6);
});

test('a saved .tex preserves variable content, modes, targets and geometry anchor references',()=>{
    const {state,refs}=fixture();
    const variable=dimension(state,refs,{dimensionKind:'variable',content:'θ + L/2'});
    const smart=dimension(state,refs);applyDrivingValue(smart,state,85);
    const body={...JSON.parse(model.serializeDrawing(state)),sheets:[{id:'sheet-1',name:'Dimensions',objects:state.objects}],activeSheetId:'sheet-1'};
    const text=latex.writeLatexDocument(body);
    const read=latex.readEmbeddedDocument(text);
    assert.equal(read.ok,true);
    const reopened=read.document.sheets[0].objects;
    assert.equal(reopened.find(o=>o.id===variable.id).content,'θ + L/2');
    const d=reopened.find(o=>o.id===smart.id);
    assert.equal(d.mode,'driving');assert.equal(d.drivingValue,85);
    assert.deepEqual(d.sourceRefs,smart.sourceRefs);
    assert.equal(dims.measurementFor(d,{objects:reopened}).value,85);
});
