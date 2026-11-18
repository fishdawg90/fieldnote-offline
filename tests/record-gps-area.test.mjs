import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {gpsAreaIndex,savedRecordAreaSuggestion} from '../src/gps-area.js';
import {applyGPSAreaSuggestion,patchEntryRecord} from '../src/record-storage.js';
const areas=[{id:'a6',name:'A6',inspectionId:'i'},{id:'a7',name:'A7',inspectionId:'i'},{id:'foreign',name:'A7',inspectionId:'j'}];
const index=gpsAreaIndex([{mode:'geographic',geojson:{features:[{properties:{ANNEX_A6_LABELS:'A7_02'},geometry:{type:'Polygon',coordinates:[[[0,0],[.01,0],[.01,.01],[0,.01],[0,0]]]}}]}}]);
const gps={latitude:.005,longitude:.005,accuracy:5,timestamp:1};
test('Historical photo and voice GPS suggests only a different prefix within the record inspection',()=>{
 assert.deepEqual(savedRecordAreaSuggestion(index,{area:'a6',type:'voice',gps},areas),{areaId:'a7',areaName:'A7'});
 assert.equal(savedRecordAreaSuggestion(index,{area:'a7',type:'voice',gps},areas),null);
 assert.equal(savedRecordAreaSuggestion(index,{area:'a6',type:'voice',gps:{...gps,accuracy:80}},areas),null);
 assert.equal(savedRecordAreaSuggestion(index,{area:'a6',type:'photo'},areas),null);
 assert.equal(savedRecordAreaSuggestion(index,{area:'a6',type:'voice',gps},areas.filter(area=>area.id!=='a7')),null);
 assert.deepEqual(savedRecordAreaSuggestion(index,{area:'a6',type:'photo',exifGPS:{latitude:.005,longitude:.005},gps:{latitude:80,longitude:0,accuracy:5}},areas),{areaId:'a7',areaName:'A7'});
 assert.equal(savedRecordAreaSuggestion(index,{area:'a6',type:'photo',exifGPS:{latitude:.00001,longitude:.005}},areas),null);
});
async function fixture(){
 const db=await new Promise(resolve=>{const r=indexedDB.open(crypto.randomUUID(),1);r.onupgradeneeded=()=>{r.result.createObjectStore('areas',{keyPath:'id'});r.result.createObjectStore('entries',{keyPath:'id'})};r.onsuccess=()=>resolve(r.result)});
 await new Promise(resolve=>{const t=db.transaction(['areas','entries'],'readwrite');for(const area of areas)t.objectStore('areas').put(area);t.objectStore('entries').put({id:'record',area:'a6',inspectionId:'i',type:'voice',gps,blob:new Blob(['original']),text:'old',transcriptionState:'processing'});t.oncomplete=resolve});
 const get=()=>new Promise(resolve=>{const r=db.transaction('entries').objectStore('entries').get('record');r.onsuccess=()=>resolve(r.result)});return {db,get};
}
test('One-tap GPS correction preserves original media, saved GPS and concurrent transcription in either order',async()=>{
 for(const patchFirst of [false,true]){const {db,get}=await fixture();try{
  const move=()=>applyGPSAreaSuggestion(db,'record','a7','i',index),patch=()=>patchEntryRecord(db,'record',{text:'Finished',transcriptionState:'done'});
  await Promise.all(patchFirst?[patch(),move()]:[move(),patch()]);const entry=await get();
  assert.equal(entry.area,'a7');assert.deepEqual(entry.gps,gps);assert.equal(await entry.blob.text(),'original');assert.equal(entry.text,'Finished');assert.equal(entry.transcriptionState,'done');
 }finally{db.close()}}
});
test('Stale suggestion, missing record and cross-inspection destination cannot change a record',async()=>{
 for(const [id,area,inspection] of [['record','foreign','i'],['record','a7','j'],['missing','a7','i']]){
  const {db,get}=await fixture();try{await assert.rejects(applyGPSAreaSuggestion(db,id,area,inspection,index));assert.equal((await get()).area,'a6')}finally{db.close()}
 }
 const {db,get}=await fixture();try{await patchEntryRecord(db,'record',{gps:{...gps,latitude:60}});await assert.rejects(applyGPSAreaSuggestion(db,'record','a7','i',index));assert.equal((await get()).area,'a6')}finally{db.close()}
});
