import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const journal=await readFile(new URL('../src/journal.js',import.meta.url),'utf8');
const removeSource=journal.slice(journal.indexOf('function commitWorkingAreaDeletion'),journal.indexOf('async function openAreaActions'));
const putSource=journal.slice(journal.indexOf('function put(store,value)'),journal.indexOf('async function reload()'));
function database(){
 const data={areas:new Map([['a',{id:'a',inspectionId:'i'}],['b',{id:'b',inspectionId:'i'}],['c',{id:'c',inspectionId:'other'}]]),entries:new Map([['p',{id:'p',area:'a',type:'photo'}],['v',{id:'v',area:'a',type:'voice'}],['keep',{id:'keep',area:'b'}],['other',{id:'other',area:'c'}]])};
 return {data,transaction(stores,mode){
  assert.equal(mode,'readwrite');assert.ok(stores.includes('areas'));assert.ok(stores.includes('entries'));
  const staged=Object.fromEntries(stores.map(name=>[name,new Map(data[name])])),t={error:null},queue=[];let scheduled=false,aborted=false;
  const run=()=>{
   scheduled=false;if(aborted)return;
   while(queue.length&&!aborted){const {request,operation}=queue.shift();request.result=operation();request.onsuccess?.({target:request})}
   if(!aborted){for(const name of stores)data[name]=staged[name];t.oncomplete?.()}
  };
  const request=operation=>{const request={};queue.push({request,operation});if(!scheduled){scheduled=true;queueMicrotask(run)}return request};
  t.objectStore=name=>({get:id=>request(()=>staged[name].get(id)),getAll:()=>request(()=>[...staged[name].values()]),delete:id=>request(()=>staged[name].delete(id)),put:value=>request(()=>{staged[name].set(value.id,value);return value.id})});
  t.abort=()=>{aborted=true;queueMicrotask(()=>t.onabort?.())};return t;
 }};
}
function api(db){return new Function('db',removeSource+'\n'+putSource+';return {remove:commitWorkingAreaDeletion,put};')(db)}
test('Area deletion removes its photos and voice notes atomically without touching other areas or inspections',async()=>{
 const db=database();await api(db).remove('a','i',['p','v']);
 assert.equal(db.data.areas.has('a'),false);assert.deepEqual([...db.data.entries.keys()],['keep','other']);assert.equal(db.data.areas.has('b'),true);assert.equal(db.data.areas.has('c'),true);
});
test('A different inspection or changed content aborts the complete area deletion',async()=>{
 for(const [inspection,expected] of [['other',['p','v']],['i',['p']]]){
  const db=database();await assert.rejects(api(db).remove('a',inspection,expected));assert.equal(db.data.areas.size,3);assert.equal(db.data.entries.size,4);
 }
});
test('Late GPS and transcription writes cannot recreate entries after their working area is deleted',async()=>{
 const db=database(),storage=api(db);await storage.remove('a','i',['p','v']);
 await assert.rejects(storage.put('entries',{id:'p',area:'a',text:'Late result'}),/deleted/);
 assert.equal(db.data.entries.has('p'),false);assert.equal(db.data.entries.size,2);
 await storage.put('entries',{id:'new',area:'b',text:'Valid capture'});assert.equal(db.data.entries.get('new').text,'Valid capture');
});
