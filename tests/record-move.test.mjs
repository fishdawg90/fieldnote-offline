import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB} from 'fake-indexeddb';
import {moveRecordsToArea,patchEntryRecord} from '../src/record-storage.js';
async function fixture(){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('record-move-'+crypto.randomUUID(),1);r.onupgradeneeded=()=>{r.result.createObjectStore('areas',{keyPath:'id'});r.result.createObjectStore('entries',{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 const photo=new Blob(['original-photo'],{type:'image/jpeg'}),audio=new Blob(['original-audio'],{type:'audio/webm'});
 await new Promise((resolve,reject)=>{const t=db.transaction(['areas','entries'],'readwrite');for(const area of [{id:'a',name:'A4',inspectionId:'i'},{id:'b',name:'A5',inspectionId:'i'},{id:'other',name:'A4',inspectionId:'j'}])t.objectStore('areas').put(area);for(const entry of [{id:'photo',area:'a',inspectionId:'i',type:'photo',blob:photo,gps:{latitude:51.3,longitude:-.1},text:'Existing note'},{id:'voice',area:'a',inspectionId:'i',type:'voice',blob:audio,text:'',transcriptionState:'processing'},{id:'foreign',area:'other',inspectionId:'j',type:'photo',blob:photo}])t.objectStore('entries').put(entry);t.oncomplete=resolve;t.onerror=()=>reject(t.error)});
 const get=id=>new Promise((resolve,reject)=>{const r=db.transaction('entries').objectStore('entries').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});return {db,get};
}
test('A mixed record selection moves atomically and preserves original media, GPS and transcription state',async()=>{
 const {db,get}=await fixture();try{assert.equal(await moveRecordsToArea(db,['photo','voice','photo'],'b','i'),2);const photo=await get('photo'),voice=await get('voice');assert.equal(photo.area,'b');assert.equal(voice.inspectionId,'i');assert.equal(voice.transcriptionState,'processing');assert.equal(await photo.blob.text(),'original-photo');assert.equal(await voice.blob.text(),'original-audio');assert.equal(photo.gps.latitude,51.3);assert.equal(photo.text,'Existing note');assert.equal((await get('foreign')).area,'other')}finally{db.close()}
});
test('Transcript completion and late GPS preserve bulk moves in either transaction order',async()=>{
 for(const patchFirst of [false,true]){const {db,get}=await fixture();try{
  const move=()=>moveRecordsToArea(db,['voice'],'b','i'),patch=()=>patchEntryRecord(db,'voice',{text:'Finished transcript',transcriptionState:'done'});
  await Promise.all(patchFirst?[patch(),move()]:[move(),patch()]);await patchEntryRecord(db,'voice',current=>current.gps?null:{gps:{latitude:52},locationSource:'Late fix'});
  const entry=await get('voice');assert.equal(entry.area,'b');assert.equal(entry.text,'Finished transcript');assert.equal(entry.transcriptionState,'done');assert.equal(entry.gps.latitude,52);assert.equal(await entry.blob.text(),'original-audio');
 }finally{db.close()}}
});
test('Missing records and cross-inspection destinations abort the whole move',async()=>{
 for(const [ids,target] of [[['photo','missing'],'b'],[['photo','foreign'],'b'],[['photo'],'other'],[['photo'],'missing']]){const {db,get}=await fixture();try{await assert.rejects(moveRecordsToArea(db,ids,target,'i'));assert.equal((await get('photo')).area,'a');assert.equal((await get('foreign')).area,'other')}finally{db.close()}}
});
test('A delayed patch does not recreate a removed record',async()=>{
 const {db,get}=await fixture();try{await new Promise(resolve=>{const t=db.transaction('entries','readwrite');t.objectStore('entries').delete('voice');t.oncomplete=resolve});assert.equal(await patchEntryRecord(db,'voice',{text:'Late result'}),null);assert.equal(await get('voice'),undefined)}finally{db.close()}
});
