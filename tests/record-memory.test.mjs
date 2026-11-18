import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const journal=await readFile(new URL('../src/journal.js',import.meta.url),'utf8');
const source=journal.slice(journal.indexOf('let recordLimit=12,'),journal.indexOf('function releaseDetailMedia()'));
function records({busy=false,hidden=false}={}){
 const rows=Array.from({length:30},(_,i)=>({id:String(i),area:'a',type:'photo',blob:{},created:i,text:''}));
 const state={entries:rows,urls:[],selected:'a',filter:'all',inspection:'i'},nodes={'#recordsPanel':{hidden},'#entries':{innerHTML:'',querySelectorAll:()=>[],replaceChildren(){this.innerHTML=''}},'#recordsMore':{},'#search':{value:''}};
 const created=[],revoked=[];let resets=0;
 const api=new Function('state','$','URL','transcriptionBusy','queueRunning','currentScope','resetWorker','esc','areaName','duration','stamp','clearRecordSelection','renderRecordSelection','savedRecordAreaSuggestion','gisGPSAreaIndex',source+';return {renderRecords,releaseRecordCards,setBusy(value){transcriptionBusy=value}};')(state,key=>nodes[key],{createObjectURL(blob){created.push(blob);return 'blob:'+created.length},revokeObjectURL(url){revoked.push(url)}},busy?'voice':null,false,()=>({areas:[{id:'a'}],entries:rows}),()=>resets++,String,()=> 'Area',()=>'',()=> 'Today',()=>{},()=>{},()=>null,[]);
 return {state,nodes,created,revoked,api,resets:()=>resets};
}
test('Records can be read during transcription without creating any image object URLs',()=>{
 const app=records({busy:true});app.api.renderRecords();
 assert.equal(app.created.length,0);assert.ok(!app.nodes['#entries'].innerHTML.includes('<img'));
 assert.equal((app.nodes['#entries'].innerHTML.match(/data-entry=/g)||[]).length,12);
 assert.ok(app.nodes['#entries'].innerHTML.includes('preview after transcription'));assert.equal(app.nodes['#recordsMore'].hidden,false);
});
test('Closed records retain no gallery media, while idle visible records load a bounded batch',()=>{
 const hidden=records({hidden:true});hidden.api.renderRecords();assert.equal(hidden.created.length,0);assert.equal(hidden.nodes['#entries'].innerHTML,'');
 const visible=records();visible.api.renderRecords();assert.equal(visible.created.length,12);assert.equal(visible.resets(),1);
 visible.api.setBusy(true);visible.api.renderRecords();assert.equal(visible.revoked.length,12);assert.equal(visible.created.length,12);assert.ok(!visible.nodes['#entries'].innerHTML.includes('<img'));
});
test('A repeatedly interrupted transcription keeps its original recording and stops automatic reload loops',async()=>{
 const offline=await readFile(new URL('../src/offline.js',import.meta.url),'utf8'),fn=offline.slice(offline.indexOf('async function restoreQueue()'),offline.indexOf('async function localSampleTest()'));
 for(const [previous,expected] of [[0,'queued'],[1,'failed']]){
  const blob={original:true},state={entries:[{id:'voice',blob,transcriptionState:'processing',transcriptionInterruptions:previous}]},saved=[];
  const restore=new Function('state','put','reload','drainQueue','patchEntryRecord','db',fn+';return restoreQueue;')(state,async(_,record)=>saved.push(record),async()=>{},()=>{},async(_,id,patch)=>saved.push({...state.entries.find(entry=>entry.id===id),...patch}),{});
  await restore();assert.equal(saved[0].transcriptionState,expected);assert.equal(saved[0].blob,blob);assert.equal(saved[0].transcriptionInterruptions,previous+1);
 }
});

test('An emptied working-area journal renders after its last records are moved',()=>{
 const app=records();app.state.entries.length=0;app.api.renderRecords();assert.ok(app.nodes['#entries'].innerHTML.includes('Nothing here yet'));
});
