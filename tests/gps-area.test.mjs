import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {gpsAreaIndex,gpsAreaStatus} from '../src/gps-area.js';
const now=1700000000000;
// Metre-sized synthetic polygons near the equator.
const ring=(x,y,w=100,h=100)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]].map(([x,y])=>[x/111195,y/111195]);
const feature=(name,rings)=>({type:'Feature',properties:{ANNEX_A6_LABELS:name},geometry:{type:'Polygon',coordinates:rings}});
const layers=features=>[{mode:'geographic',geojson:{type:'FeatureCollection',features}}];
const fix=(x=50,y=50,extra={})=>({latitude:y/111195,longitude:x/111195,accuracy:5,timestamp:now,...extra});
test('GPS compares grouped Annex prefixes, with green matches and red mismatches',()=>{
 const index=gpsAreaIndex(layers([feature('A6_01',[ring(0,0)]),feature('A6_02',[ring(100,0)]),feature('A7_01',[ring(200,0)])]));
 assert.deepEqual(gpsAreaStatus(index,fix(),'A6',now),{status:'match',areaName:'A6'});
 assert.deepEqual(gpsAreaStatus(index,fix(150),'A6',now),{status:'match',areaName:'A6'});
 assert.deepEqual(gpsAreaStatus(index,fix(250),'A6',now),{status:'different',areaName:'A7'});
 assert.equal(gpsAreaStatus(index,fix(400),'A6',now).status,'unknown');
});
test('Weak, expired, absent and boundary GPS fixes stay neutral, including shared-prefix seams',()=>{
 const index=gpsAreaIndex(layers([feature('A6_01',[ring(0,0)]),feature('A6_02',[ring(100,0)])]));
 for(const gps of [null,fix(50,50,{accuracy:50}),fix(50,50,{accuracy:null}),fix(50,50,{timestamp:now-15000}),fix(50,50,{timestamp:now+1}),fix(50,50,{latitude:NaN}),fix(2),fix(100)])assert.equal(gpsAreaStatus(index,gps,'A6',now).status,'unknown');
 assert.equal(gpsAreaStatus(index,fix(),null,now).status,'unknown');
});
test('Holes, overlapping reference areas, unlabelled shapes, multipolygons and XY layers are handled conservatively',()=>{
 const hole=gpsAreaIndex(layers([feature('A6_01',[ring(0,0),ring(40,40,20,20)])]));
 assert.equal(gpsAreaStatus(hole,fix(),'A6',now).status,'unknown');
 assert.equal(gpsAreaStatus(hole,fix(30,50),'A6',now).status,'match');
 for(const name of ['A7_02',null]){
  const overlap=gpsAreaIndex(layers([feature('A6_01',[ring(0,0)]),feature(name,[ring(45,45)])]));
  assert.equal(gpsAreaStatus(overlap,fix(),'A6',now).status,'unknown');
 }
 const multi={...feature('A8_02',[]),geometry:{type:'MultiPolygon',coordinates:[[ring(0,0)],[ring(200,0)]]}};
 assert.equal(gpsAreaStatus(gpsAreaIndex(layers([multi])),fix(250),'A8',now).status,'match');
 assert.equal(gpsAreaIndex([{...layers([multi])[0],mode:'local'}]).length,0);
});
test('Photo mismatch offers a switch within the current inspection, keeps the area on decline and skips uncertain fixes',async()=>{
 const source=await readFile(new URL('../src/gis.js',import.meta.url),'utf8');
 const check=source.slice(source.indexOf('function checkPhotoArea(){'),source.indexOf('\nfunction updateGISCaptureIcons(){'));
 for(const [status,accept,expected,prompts] of [['different',true,'a7',1],['different',false,'a6',1],['unknown',true,'a6',0],['match',true,'a6',0]]){
  let calls=0,renders=0;const state={selected:'a6'};
  const context={state,currentGPSArea:()=>({status,areaName:'A7'}),currentScope:()=>({areas:[{id:'a7',name:'A7'}]}),annexAreaName:x=>x.split('_')[0],confirm:()=>{calls++;return accept},areaName:()=> 'A6',render:()=>renders++,rememberInspection:async()=>{},showGISWorkingArea:async()=>{},fail:()=>{}};
  vm.runInNewContext(check+'\ncheckPhotoArea();',context);
  assert.equal(state.selected,expected);assert.equal(calls,prompts);assert.equal(renders,accept&&status==='different'?1:0);
 }
 const capture=await readFile(new URL('../src/capture.js',import.meta.url),'utf8');
 assert.match(capture,/checkPhotoArea\(\);\s+const session=\{area:state.selected/);
 assert.match(capture,/if\(!cameraSession\)checkPhotoArea\(\);/);
});
