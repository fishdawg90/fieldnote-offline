import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {annexAreaName,canonicalAreaName,planAreaGroups,mergeAreaGroups} from '../src/area-groups.js';
const areas=[{id:'one',name:'A6_01',inspectionId:'i'},{id:'two',name:'A6_02',inspectionId:'i'},{id:'base',name:'A6',inspectionId:'i'},{id:'other',name:'A6_03',inspectionId:'j'},{id:'manual',name:'North_apron',inspectionId:'i'}];
const entries=[{id:'p',area:'one',inspectionId:'i',type:'photo',text:'Photo note',gps:{latitude:51.3}},{id:'v',area:'two',inspectionId:'i',type:'voice',text:'Transcript',transcriptionState:'done'},{id:'other-record',area:'other',inspectionId:'j'}];
test('Reference grouping uses the prefix and leaves descriptive manual area names intact',()=>{
 assert.equal(annexAreaName(' A6_01 '),'A6');assert.equal(annexAreaName('a6_02'),'A6');assert.equal(annexAreaName(null),'');assert.equal(annexAreaName('NULL'),'');assert.equal(canonicalAreaName('North_apron'),'North_apron');
});
test('Existing base areas win, record references and navigation remap within each inspection, and migration is idempotent',()=>{
 const plan=planAreaGroups(areas,entries,[{id:'inspection-navigation',inspection:'i',area:'two'}]);
 assert.equal(plan.aliases.one,'base');assert.equal(plan.aliases.two,'base');assert.equal(plan.aliases.other,'other');assert.deepEqual(plan.removed,['one','two']);
 assert.equal(plan.entryUpdates.find(e=>e.id==='p').area,'base');assert.deepEqual(plan.entryUpdates.find(e=>e.id==='p').previousAreaReferences,['A6_01']);assert.equal(plan.entryUpdates.find(e=>e.id==='v').text,'Transcript');assert.equal(plan.entryUpdates.find(e=>e.id==='other-record').inspectionId,'j');assert.equal(plan.settingUpdates[0].area,'base');
 const mergedAreas=areas.filter(a=>!plan.removed.includes(a.id)).map(a=>plan.updates.find(x=>x.id===a.id)||a),mergedEntries=entries.map(e=>plan.entryUpdates.find(x=>x.id===e.id)||e),again=planAreaGroups(mergedAreas,mergedEntries,plan.settingUpdates);
 assert.equal(again.updates.length,0);assert.equal(again.removed.length,0);assert.equal(again.entryUpdates.length,0);assert.equal(again.settingUpdates.length,0);
});
test('Atomic stored merge preserves photo/audio bytes, GPS and transcripts and remains patchable during transcription',async()=>{
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('area-group-'+crypto.randomUUID(),1);r.onupgradeneeded=()=>{for(const store of ['areas','entries','settings'])r.result.createObjectStore(store,{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 try{
  await new Promise(resolve=>{const t=db.transaction(['areas','entries','settings'],'readwrite');for(const a of areas)t.objectStore('areas').put(a);for(const e of entries)t.objectStore('entries').put({...e,blob:new Blob([e.id])});t.objectStore('settings').put({id:'inspection-navigation',area:'one'});t.oncomplete=resolve});
  await mergeAreaGroups(db);
  const get=(store,id)=>new Promise(resolve=>{const r=db.transaction(store).objectStore(store).get(id);r.onsuccess=()=>resolve(r.result)});
  assert.equal(await get('areas','one'),undefined);assert.equal((await get('areas','base')).name,'A6');assert.equal((await get('areas','other')).name,'A6');assert.equal((await get('areas','manual')).name,'North_apron');
  const photo=await get('entries','p'),voice=await get('entries','v');assert.equal(await photo.blob.text(),'p');assert.equal(await voice.blob.text(),'v');assert.equal(photo.gps.latitude,51.3);assert.equal(voice.text,'Transcript');assert.equal(voice.transcriptionState,'done');assert.equal((await get('settings','inspection-navigation')).area,'base');
  assert.equal((await mergeAreaGroups(db)).removed.length,0);
 }finally{db.close()}
});
