export default async function run(page, ui) {
  await page.goto("http://localhost:8099/", { waitUntil: "load" });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const s = document.createElement("script");
    s.textContent = `
    (function(){
      const Sc=window.enggDimensions, D=window.enggDimensionModel;
      const R={};
      // correct signature: calibrate(state, measuredUnits, realValue, unit)
      const line={id:'l1',type:'line',style:{},metadata:{},geometry:{start:{x:0,y:0},end:{x:100,y:0}}};
      const st={scale:null,objects:[line]};
      R.beforeCal=Sc.measure(100,st);
      const res=Sc.calibrate(st,100,125,'mm');
      R.calibrate=res;
      const after={scale:(res&&res.scale)||st.scale,objects:[line]};
      R.afterCal=Sc.measure(100,after);          // should read 125 mm
      R.lineTxt=D.formatMeasurement(D.createDimension({dimensionType:'linear',
          refs:[{featureId:'l1',anchor:'start'},{featureId:'l1',anchor:'end'}],placement:{x:50,y:-20}}),after);
      R.unitsAvailable=Object.keys(Sc.UNITS);
      R.unitTable=Sc.UNITS;
      R.fromEngineering125mm=Sc.fromEngineering?Sc.fromEngineering(125,'mm'):null;
      document.documentElement.setAttribute('data-res',JSON.stringify(R));
    })();`;
    document.body.appendChild(s);
  });
  await page.waitForTimeout(400);
  return JSON.parse(await page.getAttribute("html", "data-res"));
}
