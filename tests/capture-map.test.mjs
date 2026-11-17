import test from 'node:test';
import assert from 'node:assert/strict';
import {captureMapPoints,captureMapBadges} from '../src/capture-map.js';
import {inspectionScope} from '../src/inspection-data.js';
test('Capture icons prefer original photo GPS and use recording GPS without inventing positions',()=>{
 const points=captureMapPoints([{id:'photo',type:'photo',exifGPS:{latitude:51.3,longitude:-.1},gps:{latitude:52,longitude:1}},{id:'voice',type:'voice',gps:{latitude:51.4,longitude:-.2}},{id:'missing',type:'photo'},{id:'invalid',type:'voice',gps:{latitude:200,longitude:0}},{id:'zero',type:'voice',gps:{latitude:0,longitude:0}},{id:'null',type:'photo',gps:{latitude:null,longitude:0}},{id:'fallback',type:'photo',exifGPS:{latitude:'',longitude:1},gps:{latitude:'50',longitude:'-1'}},{id:'boolean',type:'voice',gps:{latitude:true,longitude:0}}]);
 assert.deepEqual(points.map(point=>point.id),['photo','voice','zero','fallback']);assert.equal(points[0].latitude,51.3);assert.equal(points[1].longitude,-.2);assert.equal(points[3].latitude,50);
});
test('Map overlay uses only records belonging to the current inspection',()=>{
 const areas=[{id:'one',inspectionId:'i'},{id:'two',inspectionId:'j'}],entries=[{id:'p',area:'one',type:'photo',gps:{latitude:1,longitude:2}},{id:'v',area:'two',type:'voice',gps:{latitude:3,longitude:4}}];
 assert.deepEqual(captureMapPoints(inspectionScope('i',areas,entries).entries).map(point=>point.id),['p']);assert.deepEqual(captureMapPoints(inspectionScope(null,areas,entries).entries),[]);
});
test('Nearby photo and voice badges both remain visible with per-type counts, and offscreen captures are skipped',()=>{
 const points=[{type:'photo',x:100,y:100},{type:'photo',x:101,y:101},{type:'voice',x:100,y:100},{type:'voice',x:500,y:500},{type:'photo',x:NaN,y:50}];
 const badges=captureMapBadges(points,point=>point,300,300);assert.equal(badges.length,1);assert.equal(badges[0].photos,2);assert.equal(badges[0].voices,1);assert.equal(badges[0].count,3);assert.ok(badges[0].x>=100&&badges[0].x<=101);assert.equal(points[0].x,100);
});
