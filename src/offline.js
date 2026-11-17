import { MODELS,modelURL,downloadURL } from './offline-config.js';
const appBase=new URL('./',location.href);
let transcriptionBusy=null,setupBusy=false,offlineFilesReady=false,whisperWorker=null,workerCall=null,installPrompt=null;
let selectedModelKey='tiny',queueRunning=false;
const activeModel=()=>MODELS[selectedModelKey];
const mb=n=>(n/1e6).toFixed(1)+' MB';
const status=t=>{$('#setupStatus').textContent=t};
async function ensureServiceWorker(){
 if(!isSecureContext||!('serviceWorker'in navigator))throw Error('Open the HTTPS website in Chrome, not a downloaded file or preview.');
 const registration=await navigator.serviceWorker.register(new URL('./sw.js',appBase),{scope:appBase.pathname,updateViaCache:'none'});
 void registration.update().catch(()=>{});
 const installing=registration.installing;
 if(installing)installing.addEventListener('statechange',()=>{if(installing.state==='redundant')status('Offline worker installation failed. Retry setup; the browser may block storage or a file download.');});
 await Promise.race([navigator.serviceWorker.ready,new Promise((_,r)=>setTimeout(()=>r(Error('Offline worker did not become ready. Try reopening the HTTPS link.')),90000))]);
 if(!navigator.serviceWorker.controller)await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Reopen this page to finish offline setup.')),15000);
  navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve()},{once:true});
 });
}
async function readiness(modelKey=selectedModelKey){
 const modelConfig=MODELS[modelKey];
 const manifest=await (await fetch(new URL('./offline-assets.json',appBase))).json();
 const shell=await caches.open(manifest.cacheName),runtime=await caches.open(manifest.runtimeCache||manifest.cacheName),model=await caches.open(modelConfig.cache);
 const missing=[];
 for(const file of manifest.files)if(!await (file.startsWith('vendor/')?runtime:shell).match(new URL(file,appBase).href))missing.push(file);
 for(const f of modelConfig.files){const key=modelURL(appBase,f.path,modelConfig),r=await model.match(key);if(!r||r.headers.get('x-fieldnote-size')!==String(f.size)||r.headers.get('x-fieldnote-revision')!==modelConfig.revision){missing.push(f.path);continue}const chunks=Number(r.headers.get('x-fieldnote-chunks')||0);for(let i=0;i<chunks;i++)if(!await model.match(key+'?chunk='+i)){missing.push(f.path+' chunk '+i);break}}
 if(modelKey===selectedModelKey)offlineFilesReady=missing.length===0;
 updateControls();
 return{ready:missing.length===0,missing,manifest};
}
function connection(){const online=navigator.onLine;$('#connectionStatus').textContent=online?'Network available':'Offline';$('#connectionStatus').style.background=online?'#fff':'#d4ec9c'}
function updateActivity(){
 const queued=state.entries.filter(e=>e.transcriptionState==='queued').length;
 const failed=state.entries.filter(e=>e.transcriptionState==='failed').length;
 $('#activity').textContent=transcriptionBusy?(queued?'Transcribing · '+queued+' queued':'Transcribing…'):queued?queued+' queued':failed?failed+' need review':'All saved';
 $('#setupHint').classList.toggle('hidden',offlineFilesReady||setupBusy);
}
function updateControls(){
 $('#exportZip').disabled=!state.inspection;
 const pending=state.entries.some(e=>['queued','processing'].includes(e.transcriptionState));
 $('#prepareOffline').disabled=setupBusy||!!transcriptionBusy||!!state.recording;
 $('#verifyOffline').disabled=setupBusy||!!transcriptionBusy||pending||!offlineFilesReady||!!state.recording;
 $('#modelChoice').disabled=setupBusy||!!transcriptionBusy||!!state.recording;
 $('#removeModel').disabled=setupBusy||!!transcriptionBusy||!!state.recording;
 $('#takeVoice').disabled=!state.selected||!!state.recording||recordOpening;
 $('#nativeRecord').disabled=!state.selected||!!state.recording;
 const entry=state.entries.find(e=>e.id===state.detail?.id),locked=entry&&['queued','processing'].includes(entry.transcriptionState);
 $('#transcribeEntry').disabled=!!locked||setupBusy;
 $('#detailText').readOnly=!!locked;
 updateActivity();
 $('#recordsMemoryNote').hidden=!recordMediaBusy();syncRecordMediaPolicy();
}
function settingsTab(name){
 $('#settings').querySelectorAll('[data-settings]').forEach(b=>{const yes=b.dataset.settings===name;b.classList.toggle('active',yes);b.setAttribute('aria-pressed',yes)});
 $('#settings').querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==name);
}
function openSettings(name='general'){settingsTab(name);if(!$('#settings').open)$('#settings').showModal()}
async function prepareOffline(){
 if(setupBusy||transcriptionBusy||state.recording)return toast('Finish the current recording or transcription first.');
 setupBusy=true;updateControls();$('#setupProgress').hidden=false;
 let prepared=false;
 const model=activeModel(),modelBytes=model.bytes,MODEL_REVISION=model.revision,MODEL_FILES=model.files,MODEL_CACHE=model.cache;
 try{
  await ensureServiceWorker();
  await navigator.storage?.persist?.().catch(()=>false);
  const cache=await caches.open(MODEL_CACHE);let done=0;
  for(const file of MODEL_FILES){
   const key=modelURL(appBase,file.path,model),old=await cache.match(key);
   let complete=old&&old.headers.get('x-fieldnote-size')===String(file.size)&&old.headers.get('x-fieldnote-revision')===MODEL_REVISION;
   if(complete)for(let i=0;i<Number(old.headers.get('x-fieldnote-chunks')||0);i++)if(!await cache.match(key+'?chunk='+i)){complete=false;break}
   if(complete){done+=file.size;continue}
   status('Downloading Whisper · '+mb(done)+' / '+mb(modelBytes)+' · '+file.path.split('/').pop());
   const response=await fetch(downloadURL(file.path,model),{credentials:'omit',referrerPolicy:'no-referrer'});
   if(!response.ok)throw Error('Model download failed ('+response.status+'). Check internet access to huggingface.co and retry.');
   const reader=response.body?.getReader();let bytes;
   if(reader){const chunks=[];let received=0;while(true){const {done:finished,value}=await reader.read();if(finished)break;chunks.push(value);received+=value.length;$('#setupProgress').value=(done+received)/modelBytes*100;status('Downloading Whisper · '+mb(done+received)+' / '+mb(modelBytes))}bytes=new Uint8Array(received);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}}
   else bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length!==file.size)throw Error('Incomplete download for '+file.path+'. Retry setup.');
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(file.sha256&&digest!==file.sha256)throw Error('Integrity check failed for '+file.path+'. Retry setup.');
   const headers={'Content-Type':file.path.endsWith('.json')?'application/json':'application/octet-stream','x-fieldnote-size':String(file.size),'x-fieldnote-revision':MODEL_REVISION,'x-fieldnote-sha256':digest};
   const chunkSize=4*1024*1024;
   if(bytes.length>chunkSize){
    const chunks=Math.ceil(bytes.length/chunkSize);
    for(let i=0;i<chunks;i++)await cache.put(key+'?chunk='+i,new Response(bytes.slice(i*chunkSize,(i+1)*chunkSize)));
    headers['x-fieldnote-chunks']=String(chunks);
    await cache.put(key,new Response('',{headers}));
   }else await cache.put(key,new Response(bytes,{headers}));
   done+=file.size;$('#setupProgress').value=done/modelBytes*100;
  }
  const check=await readiness();if(!check.ready)throw Error('Some offline files are missing: '+check.missing.join(', '));
  status('All offline files downloaded. Loading Whisper locally to check compatibility…');
  await askWorker('load');
  prepared=true;status('Offline files ready. Run the local sample test, then repeat it in airplane mode.');
  const persistent=await navigator.storage?.persist?.().catch(()=>false);
  toast(persistent?'Offline files saved with persistent storage.':'Offline files saved. Keep backups; the browser may reclaim storage.');
 }catch(e){console.error('Offline preparation:',e);const estimate=await navigator.storage?.estimate?.().catch(()=>null);status('Setup incomplete: '+e.message+(estimate?' · Storage used '+mb(estimate.usage)+' of '+mb(estimate.quota)+' allowed by this browser.':''));toast(e.name==='QuotaExceededError'?'Browser storage limit reached. Remove an unused model download in Settings, or use Tiny.':'Setup incomplete — completed downloads are kept for retry.');}
 finally{setupBusy=false;await readiness().catch(()=>{});updateControls();if(prepared)void drainQueue();}
}
function resetWorker(){whisperWorker?.terminate();whisperWorker=null;workerCall=null}
function askWorker(type,audio,modelKey=selectedModelKey){
 if(workerCall)return Promise.reject(Error('Another transcription is running.'));
 if(!whisperWorker){
  whisperWorker=new Worker(new URL('./whisper-worker.js',appBase),{type:'module'});
  whisperWorker.onmessage=({data})=>{
   if(data.type==='status'){status(data.text);if(transcriptionBusy&&state.detail?.id===transcriptionBusy)$('#transcriptStatus').textContent=data.text;return}
   if(!workerCall||data.id!==workerCall.id)return;
   const call=workerCall;clearTimeout(call.timer);workerCall=null;
   if(data.type==='error'){resetWorker();call.reject(Error(data.message))}else call.resolve(data);
  };
  whisperWorker.onerror=e=>{const call=workerCall;if(call){clearTimeout(call.timer);resetWorker();call.reject(Error(e.message||'Whisper worker failed. Memory or browser policies may be preventing it.'))}};
 }
 return new Promise((resolve,reject)=>{
  const id=uid(),timer=setTimeout(()=>{resetWorker();reject(Error('Whisper timed out after 5 minutes. Original audio is saved; retry with a shorter clip.'))},300000);
  workerCall={id,resolve,reject,timer};
  whisperWorker.postMessage({id,type,audio,modelKey},audio?[audio.buffer]:[]);
 });
}
async function audioSamples(blob){
 const context=new AudioContext();let decoded;
 try{decoded=await context.decodeAudioData(await blob.arrayBuffer())}finally{await context.close()}
 if(decoded.duration>120.5)throw Error('This proof of concept transcribes clips up to two minutes. The original audio is still saved.');
 const offline=new OfflineAudioContext(1,Math.max(1,Math.ceil(decoded.duration*16000)),16000),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
 const rendered=await offline.startRendering();return new Float32Array(rendered.getChannelData(0));
}
async function transcribeSaved(id){
 const entry=(await all('entries')).find(e=>e.id===id);if(!entry||entry.type!=='voice')return;
 if(['queued','processing'].includes(entry.transcriptionState))return;
 if(entry.text?.trim()&&!confirm('Replace this observation’s existing transcript / notes with a new Whisper transcript?'))return;
 await patchEntryRecord(db,entry.id,{transcriptionState:'queued',transcriptionModelKey:selectedModelKey,transcriptionInterruptions:0,transcriptionStatus:'Queued for on-device transcription.'});
 await reload();void drainQueue();
}
async function drainQueue(){
 if(queueRunning||setupBusy||transcriptionBusy||state.recording)return;
 queueRunning=true;updateControls();
 try{
  while(!setupBusy&&!state.recording){
   const entry=state.entries.filter(e=>e.transcriptionState==='queued').sort((a,b)=>a.created-b.created)[0];if(!entry)break;
   const key=entry.transcriptionModelKey||'tiny',model=MODELS[key]||MODELS.tiny;
   const check=await readiness(model.key);
   if(!check.ready){status('Queued audio is saved. Download '+model.name+' to transcribe it.');break}
   transcriptionBusy=entry.id;updateControls();
   await patchEntryRecord(db,entry.id,{transcriptionState:'processing',transcriptionStatus:'Transcribing on this phone…'});await reload();
   const began=performance.now();
   try{
    await prepareRecordMemory();
    const samples=await audioSamples(entry.blob);let energy=0;for(const x of samples)energy+=x*x;
    if(!samples.length||Math.sqrt(energy/samples.length)<0.001)throw Error('Silent or too quiet. Check audio playback.');
    const result=await askWorker('transcribe',samples,model.key),elapsed=(performance.now()-began)/1000;
    const current=(await all('entries')).find(e=>e.id===entry.id);
    if(current){
     const updated={...current,text:result.text,transcriptionState:'done',transcriptionStatus:model.name+' · '+elapsed.toFixed(1)+' s · processed on this phone. Review technical terms, names and numbers.',transcriptionModel:model.id,transcriptionRevision:model.revision,transcribedAt:Date.now(),transcriptionSeconds:elapsed};
     const saved=await patchEntryRecord(db,entry.id,{text:updated.text,transcriptionState:updated.transcriptionState,transcriptionStatus:updated.transcriptionStatus,...(updated.transcriptionState==='done'?{transcriptionModel:updated.transcriptionModel,transcriptionRevision:updated.transcriptionRevision,transcribedAt:updated.transcribedAt,transcriptionSeconds:updated.transcriptionSeconds}:{})});if(saved)syncOpenDetail(saved);
    }
    status(model.name+' finished in '+elapsed.toFixed(1)+' seconds.');
   }catch(error){
    const current=(await all('entries')).find(e=>e.id===entry.id);
    if(current){const updated={...current,transcriptionState:'failed',transcriptionStatus:'Audio saved. Transcription failed: '+error.message};const saved=await patchEntryRecord(db,entry.id,{transcriptionState:updated.transcriptionState,transcriptionStatus:updated.transcriptionStatus});if(saved)syncOpenDetail(saved)}
    status('Transcription needs review: '+error.message);
   }finally{transcriptionBusy=null;await reload();updateControls()}
  }
 }catch(error){console.error('Transcription queue:',error);status('Queue paused: '+error.message)}
 finally{queueRunning=false;if(!$('#recordsPanel').hidden)resetWorker();updateControls()}
}
function syncOpenDetail(entry){
 if($('#detail').open&&state.detail?.id===entry.id){state.detail=entry;$('#detailText').value=entry.text||'';$('#transcriptStatus').textContent=entry.transcriptionStatus}
}
async function restoreQueue(){
 for(const e of state.entries)if(e.transcriptionState==='processing'){const interruptions=(e.transcriptionInterruptions||0)+1;await patchEntryRecord(db,e.id,{transcriptionInterruptions:interruptions,transcriptionState:interruptions<=1?'queued':'failed',transcriptionStatus:interruptions<=1?'Audio saved. Resuming interrupted on-device transcription.':'Audio saved. Transcription was interrupted repeatedly; tap Transcribe again to retry. Try Tiny English on this phone.'})}
 await reload();void drainQueue();
}
async function localSampleTest(){
 if(transcriptionBusy||setupBusy||state.recording||state.entries.some(e=>e.transcriptionState==='queued'))return toast('Finish queued recordings before running the sample test.');
 transcriptionBusy='sample';updateControls();
 const began=performance.now();
 try{
  const ready=await readiness();if(!ready.ready)throw Error('Offline files are missing. Run setup first.');
  // A fresh worker proves that we can initialise from stored assets, not just memory.
  resetWorker();status('Testing a fresh Whisper session with the built-in speech sample…');
  const sample=await fetch(new URL('./sample.wav',appBase));if(!sample.ok)throw Error('Speech sample is missing.');
  const audio=await audioSamples(await sample.blob()),result=await askWorker('transcribe',audio);
  if(!/americans/i.test(result.text))throw Error('Sample transcription was unexpected: '+result.text);
  const elapsed=((performance.now()-began)/1000).toFixed(1);
  status((navigator.onLine?'Local sample passed':'Airplane-mode / offline sample passed')+' in '+elapsed+' s: “'+result.text+'”');
  await put('settings',{id:'offline-test',date:Date.now(),networkReportedOnline:navigator.onLine,text:result.text,seconds:Number(elapsed)});
  toast('Local Whisper sample test passed');
 }catch(e){status('Local sample test failed: '+e.message)}finally{transcriptionBusy=null;updateControls()}
}
async function initOffline(){
 navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='shell-progress')status(e.data.text);if(e.data?.type==='shell-error')status('Offline file download failed: '+e.data.text)});
 connection();window.addEventListener('online',connection);window.addEventListener('offline',connection);
 $('#prepareOffline').onclick=prepareOffline;$('#verifyOffline').onclick=localSampleTest;
 $('#removeModel').onclick=async()=>{const model=activeModel();if(!confirm('Remove downloaded '+model.name+' files? Your photos, voice notes and transcripts will stay. The model can be downloaded again.'))return;resetWorker();await caches.delete(model.cache);await readiness();status(model.name+' download removed.');updateControls()};
 $('#openSetup').onclick=()=>openSettings('offline');
 $('#settings').querySelectorAll('[data-settings]').forEach(b=>b.onclick=()=>settingsTab(b.dataset.settings));
 $('#modelChoice').onchange=async()=>{
  selectedModelKey=$('#modelChoice').value;resetWorker();await put('settings',{id:'speech-model',key:selectedModelKey});
  for(const entry of state.entries)if(entry.transcriptionState==='queued')await put('entries',{...entry,transcriptionModelKey:selectedModelKey});await reload();
  $('#modelDescription').textContent=selectedModelKey==='base'?'Base: about 79 MB of model files (~91 MB with the app). Better recognition is expected, with slower processing.':'Tiny: about 43 MB of model files (~55 MB with the app). Faster processing.';
  await readiness();status(offlineFilesReady?activeModel().name+' is ready on this phone.':'Download '+activeModel().name+' for offline use.');updateControls();void drainQueue();
 };
 $('#transcribeEntry').onclick=async()=>{
  const e=state.detail;if(!e)return;
  // Save manual edits before a potentially long transcription.
  try{const latest={...e,area:$('#detailArea').value,text:$('#detailText').value};await put('entries',latest);await reload();state.detail=latest;await transcribeSaved(e.id)}catch(e){fail(e)}
 };
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#installApp').hidden=false});
 $('#installApp').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('#installApp').hidden=true}};
 const preferences=await all('settings');selectedModelKey=preferences.find(x=>x.id==='speech-model')?.key||'tiny';if(!MODELS[selectedModelKey])selectedModelKey='tiny';$('#modelChoice').value=selectedModelKey;$('#modelDescription').textContent=selectedModelKey==='base'?'Base: about 79 MB of model files (~91 MB with the app). Better recognition is expected, with slower processing.':'Tiny: about 43 MB of model files (~55 MB with the app). Faster processing.';
 $('#deviceDiagnostics').textContent='Secure page: '+(isSecureContext?'yes':'no')+' · Browser microphone API: '+(navigator.mediaDevices?.getUserMedia?'available':'unavailable')+' · Models: Whisper English, 8-bit · Runtime: WebAssembly, one thread';
 try{const storage=await navigator.storage?.estimate?.();if(storage)$('#deviceDiagnostics').textContent+=' · Browser storage allowance: '+mb(storage.quota)+' · Used: '+mb(storage.usage);await ensureServiceWorker();const check=await readiness();status(check.ready?'Offline files are present. Run the local sample test to check this phone.':'One-time setup needed: '+mb(activeModel().bytes)+' speech files plus about 12 MB of app/runtime files. Use Wi-Fi.')}catch(e){status('Offline setup unavailable: '+e.message)}
 updateControls();await restoreQueue();
}
