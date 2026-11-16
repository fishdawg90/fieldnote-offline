import test from 'node:test';
import assert from 'node:assert/strict';
import {groupLegacyAreas,inspectionForEntry,inspectionScope,prepareInspectionRestore} from '../src/inspection-data.js';
test('A new notebook starts with no areas or inspections',()=>{
 assert.deepEqual(groupLegacyAreas([],[],[],()=>{throw Error('Must not seed a group')}),{inspections:[],areas:[],removedAreaIds:[]});
});
test('Only the untouched A4/A5 starter pair is removed',()=>{
 const areas=[{id:'a',name:'A4'},{id:'b',name:'A5'}];
 const fresh=groupLegacyAreas(areas,[],[],()=> 'previous',1);assert.deepEqual(fresh.areas,[]);assert.deepEqual(fresh.removedAreaIds,['a','b']);assert.deepEqual(fresh.inspections,[]);
 const entries=[{id:'photo',area:'a',blob:'original-media'}];
 const used=groupLegacyAreas(areas,entries,[],()=> 'previous',1);assert.equal(used.areas.length,2);assert.equal(used.inspections[0].name,'Previous inspection');assert.deepEqual(used.removedAreaIds,[]);assert.equal(entries[0].blob,'original-media');
 const custom=groupLegacyAreas([{id:'c',name:'North apron'}],[],[],()=> 'previous',1);assert.equal(custom.areas[0].inspectionId,'previous');
});
test('Migration is idempotent and preserves named empty areas within an inspection',()=>{
 const first=groupLegacyAreas([{id:'a',name:'A4'},{id:'b',name:'A5'}],[{id:'clip',area:'a'}],[],()=> 'previous',1);
 const again=groupLegacyAreas(first.areas,[],first.inspections,()=>{throw Error('No duplicate group')},2);assert.deepEqual(again,first);
});
test('Two inspections may each have A4 without leaking captures across journals or exports',()=>{
 const areas=[{id:'a',name:'A4',inspectionId:'one'},{id:'b',name:'A4',inspectionId:'two'}],entries=[{id:'photo',area:'a'},{id:'clip',area:'b'}];
 assert.deepEqual(inspectionScope('one',areas,entries),{areas:[areas[0]],entries:[entries[0]]});assert.deepEqual(inspectionScope('two',areas,entries).entries,[entries[1]]);assert.equal(inspectionForEntry(entries[1],areas),'two');assert.deepEqual(inspectionScope(null,areas,entries),{areas:[],entries:[]});
});
test('Legacy restore preserves existing inspection membership and groups new areas once',()=>{
 const current=[{id:'a',name:'A4',inspectionId:'existing'}],backup={version:1,areas:[{id:'a',name:'A4'},{id:'b',name:'B1'},{id:'c',name:'C1'}]};
 const restored=prepareInspectionRestore(backup,current,()=> 'restored',1);assert.equal(restored.areas[0].inspectionId,'existing');assert.equal(restored.areas[1].inspectionId,'restored');assert.equal(restored.areas[2].inspectionId,'restored');assert.equal(restored.inspections.length,1);
 const v2={version:2,inspections:[{id:'i',name:'Survey'}],areas:[{id:'x',name:'Zone',inspectionId:'i'}]};assert.deepEqual(prepareInspectionRestore(v2,[],()=>''),{areas:v2.areas,inspections:v2.inspections});
});
