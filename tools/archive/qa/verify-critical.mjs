export default async function run(page, ui) {
  await page.goto("http://localhost:8099/", { waitUntil: "load" });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = `
    (function(){
      const M=window.enggMeasurement, A=window.enggAnnotationModel, S=window.enggSmartDimension, D=window.enggDimensionModel;
      const R={};

      // ---- 1. Feature-specific measurement capability (semantic, not flattened)
      const feats={
        line:{id:'l1',type:'line',geometry:{x1:0,y1:0,x2:100,y2:0}},
        circle:{id:'c1',type:'circle',geometry:{cx:0,cy:0,r:25}},
        arc:{id:'a1',type:'arc',geometry:{cx:0,cy:0,r:25,startAngle:0,endAngle:1.5707963267948966}},
        rect:{id:'r1',type:'rectangle',geometry:{x1:0,y1:0,x2:80,y2:40}},
        beam:{id:'b1',type:'beam',geometry:{x1:0,y1:0,x2:400,y2:0,depth:20}},
        shaft:{id:'s1',type:'shaft',geometry:{x1:0,y1:0,x2:200,y2:0,r:12}},
        pf:{id:'pf1',type:'point-force',geometry:{x:10,y:20,angle:30,magnitude:250,unit:'N'}},
        moment:{id:'m1',type:'applied-moment',geometry:{x:50,y:10,magnitude:500,unit:'N.m',direction:'ccw'}},
        truss:{id:'t1',type:'truss',geometry:{nodes:[{x:0,y:0},{x:100,y:80}],members:[[0,1]]}},
        cable:{id:'cb1',type:'cable',geometry:{points:[{x:0,y:0},{x:100,y:-30},{x:200,y:0}]}}
      };
      R.measureWhat={}; for(const k in feats){try{R.measureWhat[k]=M.dimensionCandidates(feats[k]);}catch(e){R.measureWhat[k]='ERR '+e.message}}
      R.labelWhat={};   for(const k in feats){try{R.labelWhat[k]=M.annotationCandidates(feats[k]);}catch(e){R.labelWhat[k]='ERR '+e.message}}

      // ---- 2. ASSOCIATIVE DIMENSION: geometry moves -> value follows
      const state={scale:{mmPerUnit:1,unit:'mm'}};
      function docWith(x2){
        const o={id:'l1',type:'line',geometry:{x1:0,y1:0,x2:x2,y2:0}};
        return {getObjects:()=>[o]};
      }
      try{
        const dim={id:'d1',dimensionType:'linear',sourceRefs:[{featureId:'l1',anchor:'line.start'},{featureId:'l1',anchor:'line.end'}]};
        R.dimAt100=D.measurementFor(dim,docWith(100),state);
        R.dimAt140=D.measurementFor(dim,docWith(140),state);
        R.dimTracks=JSON.stringify(R.dimAt100)!==JSON.stringify(R.dimAt140);
      }catch(e){R.dim='ERR '+e.message}

      // ---- 3. ASSOCIATIVE ANNOTATION from a Point Force
      try{
        const pf={id:'pf1',type:'point-force',geometry:{x:10,y:20,angle:30,magnitude:250,unit:'N'}};
        const doc={getObjects:()=>[pf]};
        const ann=A.createAnnotation({annotationKind:'force-magnitude',sourceFeatureId:'pf1'});
        R.annTextAt250=A.textFor(ann,doc);
        // change ONLY the magnitude
        pf.geometry.magnitude=300;
        R.annTextAt300=A.textFor(ann,doc);
        R.annFollowsSource=R.annTextAt250!==R.annTextAt300;
        // move the annotation far away: source must NOT move, link must survive
        const srcBefore={x:pf.geometry.x,y:pf.geometry.y};
        A.moveAnnotation(ann,450,100);
        R.annAfterMove={placement:ann.placement,placementMode:ann.placementMode,sourceStillLinked:ann.sourceFeatureId==='pf1'};
        R.sourceUnmoved=pf.geometry.x===srcBefore.x && pf.geometry.y===srcBefore.y;
        R.annTextAfterMove=A.textFor(ann,doc);
        // moving source must not overwrite the manual position
        pf.geometry.x=99;
        R.annTextAfterSourceMove=A.textFor(ann,doc);
        R.placementPreserved=JSON.stringify(ann.placement)===JSON.stringify(R.annAfterMove.placement);
      }catch(e){R.ann='ERR '+e.message}

      // ---- 4. Smart dimension picks a sensible measurement
      try{
        R.smartForLine=S.candidatesFor(feats.line);
        R.smartForCircle=S.candidatesFor(feats.circle);
        R.smartPair=S.pairCandidates(feats.line,{id:'l2',type:'line',geometry:{x1:0,y1:80,x2:100,y2:80}});
      }catch(e){R.smart='ERR '+e.message}

      document.documentElement.setAttribute('data-res', JSON.stringify(R));
    })();`;
    document.body.appendChild(s);
  });
  await page.waitForTimeout(500);
  return JSON.parse(await page.getAttribute("html", "data-res"));
}
