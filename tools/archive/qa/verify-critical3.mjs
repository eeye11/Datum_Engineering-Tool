export default async function run(page, ui) {
  await page.goto("http://localhost:8099/", { waitUntil: "load" });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = `
    (function(){
      const A=window.enggAnnotationModel, D=window.enggDimensionModel, S=window.enggSmartDimension;
      const R={};
      const state=(...o)=>({scale:{mmPerUnit:1,unit:'mm'},objects:o});

      // ---- Criterion 24: Point Force magnitude/direction are ANNOTATIONS
      const f={id:'force-1',name:'Point Force',type:'force',style:{},metadata:{},
        geometry:{start:{x:0,y:0},end:{x:0,y:-30},position:{x:0,y:0},
                 magnitude:250,angle:-90,unit:'N'}};
      const doc=state(f);
      const fa=A.createAnnotation({kind:'force-value',sourceFeatureId:'force-1',
                                   position:{x:5,y:-35},leader:{enabled:true}});
      R.forceText_250=A.textFor(fa,doc);
      R.isGeneratedText=(fa.textMode==='auto' && fa.text==='');

      // 8. move the text box far away
      const geoBefore=JSON.stringify(f.geometry);
      A.moveAnnotation(fa,{x:300,y:150});
      R.crit8_sourceNotMoved=(JSON.stringify(f.geometry)===geoBefore);
      R.crit9_linkIntact=(fa.sourceFeatureId==='force-1');
      R.crit10_placement=fa.placement;

      // 7. still updates from the source even though manually moved
      f.geometry.magnitude=275;
      R.crit7_textAfterMagnitudeChange=A.textFor(fa,doc);
      R.crit11_placementPreserved=(fa.placement.x===300&&fa.placement.y===150);

      // 61. moving the source keeps the manual position
      f.geometry.end={x:120,y:40};
      R.crit_afterSourceMove={text:A.textFor(fa,doc),placement:fa.placement};

      // 62. source deleted
      const orphan=A.createAnnotation({kind:'force-value',sourceFeatureId:'force-1'});
      const manualNote=A.createAnnotation({kind:'free-text',text:'keep me'});
      R.onDeletedGenerated=A.onSourceDeleted(orphan);
      R.onDeletedManual=A.onSourceDeleted(manualNote);

      // ---- Criteria 3,5: associative DIMENSION on real geometry
      const line={id:'l1',type:'line',name:'Line',style:{},metadata:{},
                  geometry:{x1:0,y1:0,x2:100,y2:0}};
      const ds=state(line);
      const dim=D.createDimension({dimensionType:'linear',label:'span',
        sourceRefs:[{featureId:'l1',anchor:'line.start'},{featureId:'l1',anchor:'line.end'}]});
      R.dimRefs=JSON.stringify(dim.sourceRefs);
      R.pts100=D.measurePoints(dim,ds);
      R.val100=D.measurementFor(dim,ds);
      R.txt100=D.formatMeasurement(dim,ds);
      line.geometry.x2=140;
      R.pts140=D.measurePoints(dim,ds);
      R.val140=D.measurementFor(dim,ds);
      R.txt140=D.formatMeasurement(dim,ds);
      R.dimFollowsGeometry=(R.txt100!==R.txt140);
      R.dimStillLinked=(D.isResolved(dim,ds));

      // ---- Criterion 14: redundancy avoidance
      R.smartPropose=S.propose([line],{dimensions:[dim]});
      R.smartDescriptor=S.descriptorFor(line,ds);

      document.documentElement.setAttribute('data-res',JSON.stringify(R));
    })();`;
    document.body.appendChild(s);
  });
  await page.waitForTimeout(500);
  return JSON.parse(await page.getAttribute("html", "data-res"));
}
