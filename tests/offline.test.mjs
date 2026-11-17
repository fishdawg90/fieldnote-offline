import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {MODELS,MODEL_FILES,MODEL_REVISION,modelURL,downloadURL} from '../src/offline-config.js';
test('All offline model assets are pinned; large model files are hash-verified',()=>{
 assert.match(MODEL_REVISION,/^[0-9a-f]{40}$/);assert.equal(MODEL_FILES.length,7);
 for(const f of MODEL_FILES){assert.ok(f.size>0);if(f.path.endsWith('.onnx'))assert.match(f.sha256,/^[0-9a-f]{64}$/)}
 assert.ok(MODEL_FILES.reduce((s,f)=>s+f.size,0)<50e6);
});
test('Project subpath stays inside the GitHub Pages repository',()=>{
 const base='https://example.github.io/fieldnote-offline/';
 assert.equal(modelURL(base,'config.json'),base+'models/Xenova/whisper-tiny.en/config.json');
 assert.ok(downloadURL('config.json').includes('/'+MODEL_REVISION+'/config.json'));
});
test('Inference disables remote models and rejects external fetches',async()=>{
 const s=await readFile(new URL('../src/whisper-worker.js',import.meta.url),'utf8');
 assert.match(s,/env\.allowRemoteModels=false/);assert.match(s,/local_files_only:true/);assert.match(s,/url\.origin!==base\.origin/);
});
test('Stop closes the recorder immediately, before asynchronous audio saving',async()=>{
 const source=await readFile(new URL('../src/journal.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function stopRecord()'),source.indexOf("$('#takeVoice').onclick=record;"));
 const order=[],r={ending:false,mr:{state:'recording',stop(){order.push('stop')}},stream:{getTracks:()=>[{stop(){order.push('release')}}]}};
 const state={recording:r};
 const context={state,$:()=>({close(){order.push('close')}}),updateControls(){order.push('controls')},Date};
 vm.runInNewContext(fn+';stopRecord();',context);
 assert.deepEqual(order,['close','stop','release','controls']);assert.equal(state.recording,null);assert.equal(r.ending,true);
 assert.ok(!source.includes('webkitSpeechRecognition'));
});
test('Capture commits queued audio before starting background inference; capture is never opened for review',async()=>{
 const source=await readFile(new URL('../src/capture.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function saveCapture('),source.indexOf("$('#retryCaptures')"));
 const order=[],stored=[];
 const context={state:{areas:[]},inspectionForEntry:()=>null,pendingSaves:0,captureDrafts:new Map(),updateRecovery(){},updateControls(){},$:()=>({checked:true}),selectedModelKey:'tiny',async put(_,value){order.push('save');stored.push(value)},async reload(){order.push('render')},toast(){},drainQueue(){order.push('transcribe')},fail:assert.fail};
 vm.runInNewContext(fn+';this.save=saveCapture;',context);
 await context.save({id:'test',type:'voice',blob:new Blob(['audio'])});
 assert.deepEqual(order,['save','render','transcribe']);assert.equal(stored[0].transcriptionState,'queued');assert.equal(stored[0].transcriptionModelKey,'tiny');assert.ok(!fn.includes('showDetail'));
});
test('Base model fits within a 100 MB total download allowance and uses separate offline files',()=>{
 assert.ok(MODELS.base.bytes+12e6<100e6);assert.ok(MODELS.base.bytes>MODELS.tiny.bytes);
 assert.notEqual(MODELS.base.cache,MODELS.tiny.cache);
 assert.match(modelURL('https://example.github.io/app/','config.json',MODELS.base),/whisper-base.en/);
 assert.ok(downloadURL('config.json',MODELS.base).includes(MODELS.base.revision));
 for(const model of Object.values(MODELS))for(const file of model.files)if(file.path.endsWith('.onnx'))assert.match(file.sha256,/^[a-f0-9]{64}$/);
});
async function modelResponse(stored,path='models/Xenova/whisper-tiny.en/config.json'){
 const source=await readFile(new URL('../src/sw-template.js',import.meta.url),'utf8');
 const handlers={},base='https://example.github.io/fieldnote-offline/';let networkCalls=0;
 const context={URL,Response,ReadableStream,importScripts(){},self:{location:{href:base+'sw.js'},FIELDNOTE_CACHE:{CACHE:'shell',FILES:[],MODEL_CACHE:'model',MODEL_ROUTES:{'models/Xenova/whisper-tiny.en/':'model','models/Xenova/whisper-base.en/':'base-model'}},addEventListener(type,fn){handlers[type]=fn}},caches:{async open(){return{async match(key){return stored.get(typeof key==='string'?key:key.url)?.clone()}}}},fetch(){networkCalls++;throw Error('Network disabled for this test')}};
 vm.runInNewContext(source,context);
 let response;handlers.fetch({request:{url:base+path,method:'GET'},respondWith(value){response=value}});
 return {response:await response,networkCalls};
}
test('Missing model returns 404 without trying the network',async()=>{
 const {response,networkCalls}=await modelResponse(new Map());assert.equal(response.status,404);assert.equal(networkCalls,0);
});
test('Chunked model is reconstructed byte-for-byte without the network',async()=>{
 const key='https://example.github.io/fieldnote-offline/models/Xenova/whisper-tiny.en/config.json',data=Uint8Array.from({length:22000},(_,i)=>i%251);
 const store=new Map([[key,new Response('',{headers:{'x-fieldnote-chunks':'3','x-fieldnote-size':String(data.length)}})]]);
 for(let i=0;i<3;i++)store.set(key+'?chunk='+i,new Response(data.slice(i*8000,(i+1)*8000)));
 const {response,networkCalls}=await modelResponse(store);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),data);assert.equal(networkCalls,0);
 store.delete(key+'?chunk=1');const missing=await modelResponse(store);await assert.rejects(missing.response.arrayBuffer(),/chunk is missing/);
});
test('Speech fixture is a six-second mono PCM file at 16 kHz',async()=>{
 const b=await readFile(new URL('../src/sample.wav',import.meta.url));
 assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.readUInt16LE(22),1);assert.equal(b.readUInt32LE(24),16000);assert.equal(b.length,192044);
});
test('Background queue saves results, accepts another clip and never opens a detail dialog',async()=>{
 const source=await readFile(new URL('../src/offline.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('async function drainQueue()'),source.indexOf('async function localSampleTest()'));
 const store=new Map([['one',{id:'one',type:'voice',created:1,blob:new Blob(['voice']),text:'',transcriptionState:'queued',transcriptionModelKey:'tiny'}]]);
 const state={entries:[...store.values()],recording:null,detail:null};let open=false,release;const inFlight=new Promise(resolve=>release=resolve),processed=[];
 const controls={open:false,value:'',readOnly:false,textContent:''};
 const ctx={state,MODELS,db:{},async patchEntryRecord(_,id,patch){const current=store.get(id);if(!current)return null;const updated={...current,...patch};store.set(id,updated);return updated},queueRunning:false,setupBusy:false,transcriptionBusy:null,selectedModelKey:'tiny',async readiness(){return{ready:true}},updateControls(){},async put(_,e){store.set(e.id,{...e})},async all(){return[...store.values()]},async reload(){state.entries=[...store.values()]},performance,async prepareRecordMemory(){},resetWorker(){},async audioSamples(){return new Float32Array([.1,.2])},async askWorker(_,audio,key){processed.push(key);if(processed.length===1)await inFlight;return{text:'test transcript '+processed.length}},$:()=>controls,status(){},console};
 vm.runInNewContext(fn+';this.run=drainQueue;',ctx);
 const running=ctx.run();
 // Wait until the first worker call, then attach a second persisted capture.
 while(!processed.length)await new Promise(resolve=>setImmediate(resolve));
 store.set('two',{id:'two',type:'voice',created:2,blob:new Blob(['second']),text:'',transcriptionState:'queued',transcriptionModelKey:'tiny'});state.entries=[...store.values()];release();await running;
 assert.equal(store.get('one').transcriptionState,'done');assert.equal(store.get('two').transcriptionState,'done');assert.equal(processed.length,2);assert.equal(controls.open,false);assert.equal(ctx.transcriptionBusy,null);
 // A processing entry left by an interrupted session becomes queued again.
 store.get('one').transcriptionState='processing';state.entries=[...store.values()];state.recording={};await vm.runInNewContext('restoreQueue()',ctx);assert.equal(store.get('one').transcriptionState,'queued');
});
