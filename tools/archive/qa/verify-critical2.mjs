export default async function run(page, ui) {
  await page.goto("http://localhost:8099/", { waitUntil: "load" });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = `
    (function(){
      const M=window.enggMeasurement, A=window.enggAnnotationModel, D=window.enggDimensionModel;
      const R={};
      const state={scale:{mmPerUnit:1,unit:'mm'},objects:[]};

      // ---------- A. ANNOTATION CRITERIA 4,6,8,9,10,11 ----------
      // Real objects, exactly as the document stores them.
      const pf={id:'pf1',type:'point-force',name:'Force F1',
                geometry:{x:10,y:20,angle:30,magnitude:250,unit:'N'}};
      state.objects=[pf];

      const ann=A.createAnnotation({kind:'force-magnitude',sourceFeatureId:'pf1',
                                    position:{x:20,y:30}});
      R.created={kind:ann.annotationKind,textMode:ann.textMode,
                 sourceFeatureId:ann.sourceFeatureId,placementMode:ann.placementMode,
                 placement:ann.placement};

      // 6. value annotation follows the force
      R.textAt250=A.textFor(ann,state);
      pf.geometry.magnitude=300;
      R.textAt300=A.textFor(ann,state);
      R.valueFollowsSource=(R.textAt250!==R.textAt300)&&/300/.test(R.textAt300);

      // 9/10. move the text box far away; source must not move, link must survive
      const srcBefore={x:pf.geometry.x,y:pf.geometry.y};
      A.moveAnnotation(ann,{x:450,y:100});
      R.movedPlacement=ann.placement;
      R.movedMode=ann.placementMode;
      R.linkSurvivesMove=(ann.sourceFeatureId==='pf1');
      R.sourceDidNotMove=(pf.geometry.x===srcBefore.x && pf.geometry.y===srcBefore.y);

      // still updates after being moved
      pf.geometry.magnitude=450;
      R.textAfterMove=A.textFor(ann,state);

      // 11. moving the source must not overwrite the manual position
      pf.geometry.x=99; pf.geometry.y=77;
      R.placementAfterSourceMove=ann.placement;
      R.manualPlacementPreserved=(ann.placement.x===450 && ann.placement.y===100);
      R.textStillFollows=A.textFor(ann,state);

      // 12. leader geometry updates with the annotation position
      ann.leader={enabled:true};
      R.leader1=A.leaderFor(ann,state);
      A.moveAnnotation(ann,{x:200,y:200});
      R.leader2=A.leaderFor(ann,state);
      R.leaderFollows=JSON.stringify(R.leader1)!==JSON.stringify(R.leader2);
      pf.geometry.x=10; pf.geometry.y=20;
      R.leader3=A.leaderFor(ann,state);
      R.leaderFollowsSource=JSON.stringify(R.leader2)!==JSON.stringify(R.leader3);

      // ---------- B. DIMENSION ASSOCIATIVITY (criteria 3,5) ----------
      const line={id:'l1',type:'line',geometry:{x1:0,y1:0,x2:100,y2:0}};
      state.objects=[line];
      const dim={id:'d1',dimensionType:'linear',label:'span',
                 sourceRefs:[{featureId:'l1',anchor:'line.start'},
                             {featureId:'l1',anchor:'line.end'}]};
      R.dimSig={m:String(D.measurementFor).slice(0,90),mp:String(D.measurePoints).slice(0,90)};
      try{R.pts100=D.measurePoints(dim,state);}catch(e){R.pts100='ERR '+e.message}
      try{R.val100=D.measurementFor(dim,state);}catch(e){R.val100='ERR '+e.message}
      line.geometry.x2=140;
      try{R.pts140=D.measurePoints(dim,state);}catch(e){R.pts140='ERR '+e.message}
      try{R.val140=D.measurementFor(dim,state);}catch(e){R.val140='ERR '+e.message}
      R.dimTracks=JSON.stringify(R.pts100)!==JSON.stringify(R.pts140);

      document.documentElement.setAttribute('data-res',JSON.stringify(R));
    })();`;
    document.body.appendChild(s);
  });
  await page.waitForTimeout(500);
  return JSON.parse(await page.getAttribute("html", "data-res"));
}
