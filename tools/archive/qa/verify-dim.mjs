export default async function run(page, ui) {
  await page.goto("http://localhost:8099/", { waitUntil: "load" });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = `
    (function(){
      const D=window.enggDimensionModel, S=window.enggSmartDimension, Sc=window.enggDimensions;
      const R={};
      const st=(...o)=>({scale:{mmPerUnit:1,unit:'mm'},objects:o});

      const line={id:'l1',type:'line',name:'Line',style:{},metadata:{},
                  geometry:{x1:0,y1:0,x2:100,y2:0}};
      const s1=st(line);
      const dim=D.createDimension({dimensionType:'linear',
        refs:[{featureId:'l1',anchor:'start'},{featureId:'l1',anchor:'end'}],
        placement:{x:50,y:-20}});

      R.refs=dim.sourceRefs;
      R.holdsNoStoredValue=('value' in dim);
      R.resolved=D.isResolved(dim,s1);
      R.pts100=D.measurePoints(dim,s1);
      R.txt100=D.formatMeasurement(dim,s1);
      R.graphicsKeys=Object.keys(D.graphicsFor(dim,s1)||{});

      // criterion 5: move the endpoint
      line.geometry.x2=140;
      R.pts140=D.measurePoints(dim,s1);
      R.txt140=D.formatMeasurement(dim,s1);
      R.crit5_dimensionFollowsGeometry=(R.txt100!==R.txt140);

      // criterion 16/17: calibration is document-wide, zoom-independent
      const eng=Sc.fromEngineering(125,'mm');
      R.scale={before:Sc.readScale({}),calibrate:Object.keys(eng||{}),
               measured:Sc.measure(50,{scale:eng})};

      // criterion 14: smart dimension avoids redundancy
      R.smartLine=S.candidatesFor(line);
      R.smartPropose=[...(S.propose([line],s1)||[])];
      const circle={id:'c1',type:'circle',name:'C',style:{},metadata:{},geometry:{center:{x:0,y:0},radius:25}};
      R.smartCircle=S.candidatesFor(circle);
      R.smartProposeCircle=[...(S.propose([circle],st(circle))||[])];

      document.documentElement.setAttribute('data-res',JSON.stringify(R));
    })();`;
    document.body.appendChild(s);
  });
  await page.waitForTimeout(500);
  return JSON.parse(await page.getAttribute("html", "data-res"));
}
