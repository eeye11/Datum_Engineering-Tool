export default async function run(page, ui) {
  await page.goto("http://localhost:8099/", { waitUntil: "load" });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = `
    (function(){
      const M=window.enggMeasurement, D=window.enggDimensionModel, Sc=window.enggDimensions;
      const R={};
      const line={id:'l1',type:'line',name:'Line',style:{},metadata:{},
                  geometry:{start:{x:0,y:0},end:{x:100,y:0}}};
      const s1={scale:{mmPerUnit:1,unit:'mm'},objects:[line]};
      R.anchors=M.anchorOptions(line);
      R.twoPointSpan=M.twoPointSpan(line);

      const dim=D.createDimension({dimensionType:'linear',
        refs:[{featureId:'l1',anchor:'start'},{featureId:'l1',anchor:'end'}],
        placement:{x:50,y:-20}});
      R.resolved=D.isResolved(dim,s1);
      R.pts100=D.measurePoints(dim,s1);
      R.txt100=D.formatMeasurement(dim,s1);
      R.measured100=D.measurementFor(dim,s1);

      line.geometry.end={x:140,y:0};
      R.pts140=D.measurePoints(dim,s1);
      R.txt140=D.formatMeasurement(dim,s1);
      R.measured140=D.measurementFor(dim,s1);
      R.CRIT5_dimensionFollowsGeometry=(R.txt100!==R.txt140);

      // graphics: extension lines / arrowheads, not floating text
      const g=D.graphicsFor(dim,s1);
      R.graphicsKeys=Object.keys(g||{});
      R.hasArrowheads=!!(g&&((g.arrowheads&&g.arrowheads.length)||(g.heads&&g.heads.length)));
      R.hasExtensionLines=!!(g&&((g.extensionLines&&g.extensionLines.length)||(g.witnessLines&&g.witnessLines.length)));

      // scale is document-wide and zoom-independent
      R.uncalibrated=Sc.measure(50,{scale:null});
      const cal=Sc.calibrate?Sc.calibrate({scale:null},125,'mm'):null;
      R.calibrateResult=cal;
      R.measureAfterCal=cal?Sc.measure(50,{scale:cal.scale||cal}):null;
      R.units=Object.keys(Sc.UNITS||{});

      document.documentElement.setAttribute('data-res',JSON.stringify(R));
    })();`;
    document.body.appendChild(s);
  });
  await page.waitForTimeout(400);
  return JSON.parse(await page.getAttribute("html", "data-res"));
}
