import test from 'node:test';
import assert from 'node:assert/strict';
import {collectAnnexReferences,missingGISAreaNames} from '../src/asset-data.js';
import {readFile} from 'node:fs/promises';
test('GIS import gathers unique valid Annex labels across layers and normalises blank values',()=>{
 const layers=[{geojson:{features:[{properties:{ANNEX_A6_LABELS:' A8_06 '}},{properties:{ANNEX_A6_LABELS:'a8_06'}},{properties:{ANNEX_A6_LABELS:null}},{properties:{ANNEX_A6_LABELS:'NULL'}}]}},{geojson:{features:[{properties:{'schema.ANNEX_A6_LABELS':'A4'}},{properties:{ANNEX_A6_LABELS:''}}]}}];
 assert.deepEqual(collectAnnexReferences(layers),['A8_06','A4']);
});
test('GIS areas reuse existing names in the current inspection and remain independent of other inspections',()=>{
 const areas=[{id:'one',name:'A4',inspectionId:'i'},{id:'other',name:'A8_06',inspectionId:'other'}];
 assert.deepEqual(missingGISAreaNames(['a4','A8_06','A8_06'],areas,'i'),['A8_06']);
 assert.deepEqual(missingGISAreaNames(['A4','A8_06'],areas,'other'),['A4']);
});
test('Choosing an area displays its matching feature without a recursive area selection',async()=>{
 const source=await readFile(new URL('../src/gis.js',import.meta.url),'utf8'),fn=source.slice(source.indexOf('async function showGISWorkingArea('));
 const state={inspection:'i',areas:[{id:'a',name:'A8_06',inspectionId:'i'}]},feature={properties:{ANNEX_A6_LABELS:'a8_06'}},calls=[];
 const shape={feature,getLatLng:()=>[1,2]},gisMap={panTo:value=>calls.push(['pan',value])};
 const focus=new Function('state','gisMap','gisRecord','gisLayers','assetValue','presentAssetValue','selectGISAsset','clearGISAsset',fn+';return showGISWorkingArea;')(state,gisMap,{layers:[{name:'Pavements'}]},[{getLayers:()=>[shape]}],(props,key)=>props[key],value=>!!value,(...args)=>calls.push(['select',args[3]]),()=>calls.push(['clear']));
 await focus('a');assert.deepEqual(calls,[['select',false],['pan',[1,2]]]);
 calls.length=0;await focus('unknown');assert.deepEqual(calls,[['clear']]);
});
