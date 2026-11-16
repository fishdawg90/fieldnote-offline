import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assetDetails,assetValue,presentAssetValue,scoreBand,overallBand} from '../src/asset-data.js';
test('Asset panel omits null fields while retaining zero ratings and None treatment',()=>{
 const result=assetDetails({ANNEX_A6_LABELS:'A8_06',aosLevel2AssetName:'HELIPAD BAY 15 OFF THE SOUTHERN TAXIWAY',aosSurfaceTreatmentType:'None',aosLength:null,aosWidth:'NULL',aosArea:2620,aosFrictionValue:'<Null>',aosConditionRatingFriction:0,aosConditionRatingFODRisk:3,aosOverallRAG:'G'});
 assert.equal(result.reference,'A8_06');assert.deepEqual(result.fields.map(x=>x.label),['Asset','Treatment','Area']);
 assert.equal(result.fields[1].value,'None');assert.equal(result.scores[0].value,0);assert.equal(result.scores[0].band,'grey');assert.equal(result.scores[1].band,'amber');assert.equal(result.band,'green');
});
test('All requested score bands and Overall RAG are explicit; missing or invalid data is neutral',()=>{
 assert.deepEqual([0,1,2,3,4,5].map(scoreBand),['grey','red','amber','amber','green','green']);
 for(const value of [null,undefined,'null','',-1,6,'unknown'])assert.equal(scoreBand(value),'grey');
 assert.deepEqual(['R','A','G','red','amber','green',null,'NULL'].map(overallBand),['red','amber','green','red','amber','green','grey','grey']);
 assert.equal(presentAssetValue(0),true);assert.equal(presentAssetValue('None'),true);
});
test('ArcGIS qualified names and case variations resolve without exposing unrelated fields',()=>{
 assert.equal(assetValue({'database.ANNEX_A6_LABELS':'A4'},'ANNEX_A6_LABELS'),'A4');
 assert.equal(assetDetails({AOSOVERALLRAG:'R',aosarea:0,unrelated:'not shown'}).band,'red');
 assert.equal(assetDetails({aosarea:0}).fields[0].value,0);
 assert.deepEqual(assetDetails({unrelated:'not shown'}).fields,[]);
});
test('Map lives in Capture, capture dock stays outside tab panels, and controls have unique IDs',async()=>{
 const html=await readFile(new URL('../src/index.html',import.meta.url),'utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
 assert.equal(ids.length,new Set(ids).size);
 assert.ok(html.indexOf('id="featurePanel"')<html.indexOf('id="gisMap"'));
 assert.ok(html.indexOf('id="gisMap"')<html.indexOf('id="gisPanel"'));
 assert.ok(html.indexOf('id="takePhoto"')>html.indexOf('</main>'));
 for(const id of ['currentArea','openRecords','closeRecords','featurePanel','gisSatellite','gisImageryKey','areaPicker'])assert.ok(ids.includes(id));
});
test('Asset highlighting uses Overall RAG, and feature content is added as text',async()=>{
 const source=await readFile(new URL('../src/gis.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function gisShapeStyle'),source.indexOf('function selectGISAsset'));
 const style=new Function('assetValue','overallBand','RAG_COLOURS',fn+';return gisShapeStyle;')(assetValue,overallBand,{red:'red',green:'green',amber:'amber',grey:'grey'});
 assert.equal(style({properties:{aosOverallRAG:'G'}}).fillColor,'green');
 assert.equal(style({properties:{aosOverallRAG:null}}).fillColor,'grey');
 assert.ok(style({properties:{aosOverallRAG:'R'}}).fillOpacity<.2);
 assert.ok(style({properties:{}},true).weight>style({properties:{}}).weight);
});
