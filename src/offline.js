import { MODEL_ID,MODEL_REVISION,MODEL_CACHE,MODEL_FILES,modelURL,downloadURL } from './offline-config.js';
const appBase=new URL('./',location.href);
let transcriptionBusy=null,setupBusy=false,offlineFilesReady=false,whisperWorker=null,workerCall=null,installPrompt=null;
const modelBytes=MODEL_FILES.reduce((s,f)=>s+f.size,0);
const mb=n=>(n/1e6).toFixed(1)+' MB';
const status=t=>{$('#setupStatus').textContent=t};
async function ensureServiceWorker(){
 if(!isSecureContext||!('serviceWorker'in navigator))throw Error('Open the HTTPS website in Chrome, not a downloaded file or preview.');
 const registration=await navigator.serviceWorker.register(new URL('./sw.js',appBase),{scope:appBase.pathname,updateViaCache:'none'});
 const installing=registration.installing;
 if(installing)installing.addEventListener('statechange',()=>{if(installing.state==='redundant')status('Offline worker installation failed. Retry setup; the browser may block storage or a file download.');});
 await Promise.race([navigator.serviceWorker.ready,new Promise((_,r)=>setTimeout(()=>r(Error('Offline worker did not become ready. Try reopening the HTTPS link.')),90000))]);
 if(!navigator.serviceWorker.controller)await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Reopen this page to finish offline setup.')),15000);
  navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve()},{once:true});
 });
}
async function readiness(){
 const manifest=await (await fetch(new URL('./offline-assets.json',appBase))).json();
 const shell=await caches.open(manifest.cacheName),model=await caches.open(MODEL_CACHE);
 const missing=[];
 for(const file of manifest.files)if(!await shell.match(new URL(file,appBase).href))missing.push(file);
 for(const f of MODEL_FILES){const r=await model.match(modelURL(appBase,f.path));if(!r||r.headers.get('x-fieldnote-size')!==String(f.size)||r.headers.get('x-fieldnote-revision')!==MODEL_REVISION)missing.push(f.path)}
 offlineFilesReady=missing.length===0;
 $('#verifyOffline').disabled=!offlineFilesReady||setupBusy||!!transcriptionBusy;
 return{ready:offlineFilesReady,missing,manifest};
}
function connection(){const online=navigator.onLine;$('#connectionStatus').textContent=online?'Network available':'Offline';$('#connectionStatus').style.background=online?'#fff':'#d4ec9c'}
function updateControls(){
 $('#prepareOffline').disabled=setupBusy||!!transcriptionBusy;
 $('#verifyOffline').disabled=setupBusy||!!transcriptionBusy||!offlineFilesReady;
 $('#takeVoice').disabled=!state.selected||setupBusy||!!transcriptionBusy;
 $('#nativeRecord').disabled=!state.selected||setupBusy||!!transcriptionBusy;
 $('#transcribeEntry').disabled=!!transcriptionBusy||setupBusy;
}
async function prepareOffline(){
 if(setupBusy||transcriptionBusy||state.recording)return toast('Finish the current recording or transcription first.');
 setupBusy=true;updateControls();$('#setupProgress').hidden=false;
 try{
  await ensureServiceWorker();
  const cache=await caches.open(MODEL_CACHE);let done=0;
  for(const file of MODEL_FILES){
   const key=modelURL(appBase,file.path),old=await cache.match(key);
   if(old&&old.headers.get('x-fieldnote-size')===String(file.size)&&old.headers.get('x-fieldnote-revision')===MODEL_REVISION){done+=file.size;continue}
   status('Downloading Whisper · '+mb(done)+' / '+mb(modelBytes)+' · '+file.path.split('/').pop());
   const response=await fetch(downloadURL(file.path),{credentials:'omit',referrerPolicy:'no-referrer'});
   if(!response.ok)throw Error('Model download failed ('+response.status+'). Check internet access to huggingface.co and retry.');
   const reader=response.body?.getReader();let bytes;
   if(reader){const chunks=[];let received=0;while(true){const {done:finished,value}=await reader.read();if(finished)break;chunks.push(value);received+=value.length;$('#setupProgress').value=(done+received)/modelBytes*100;status('Downloading Whisper · '+mb(done+received)+' / '+mb(modelBytes))}bytes=new Uint8Array(received);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}}
   else bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length!==file.size)throw Error('Incomplete download for '+file.path+'. Retry setup.');
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(file.sha256&&digest!==file.sha256)throw Error('Integrity check failed for '+file.path+'. Retry setup.');
   await cache.put(key,new Response(bytes,{headers:{'Content-Type':file.path.endsWith('.json')?'application/json':'application/octet-stream','x-fieldnote-size':String(file.size),'x-fieldnote-revision':MODEL_REVISION,'x-fieldnote-sha256':digest}}));
   done+=file.size;$('#setupProgress').value=done/modelBytes*100;
  }
  const check=await readiness();if(!check.ready)throw Error('Some offline files are missing: '+check.missing.join(', '));
  status('All offline files downloaded. Loading Whisper locally to check compatibility…');
  await askWorker('load');
  status('Offline files ready. Run the local sample test, then repeat it in airplane mode.');
  const persistent=await navigator.storage?.persist?.().catch(()=>false);
  toast(persistent?'Offline files saved with persistent storage.':'Offline files saved. Keep backups; the browser may reclaim storage.');
 }catch(e){status('Setup incomplete: '+e.message);toast('Setup incomplete — completed downloads are kept for retry.');}
 finally{setupBusy=false;await readiness().catch(()=>{});updateControls();}
}
function resetWorker(){whisperWorker?.terminate();whisperWorker=null;workerCall=null}
function askWorker(type,audio){
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
  whisperWorker.postMessage({id,type,audio},audio?[audio.buffer]:[]);
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
 if(transcriptionBusy||setupBusy)return toast('Wait for the current setup or transcription to finish.');
 const entry=state.entries.find(e=>e.id===id);if(!entry||entry.type!=='voice')return;
 if(entry.text?.trim()&&!confirm('Replace this observation’s existing transcript / notes with a new Whisper transcript?'))return;
 transcriptionBusy=id;updateControls();
 if(state.detail?.id===id){$('#detailText').readOnly=true;$('#transcriptStatus').textContent='Preparing offline Whisper…'}
 const began=performance.now();
 try{
  const ready=await readiness();if(!ready.ready)throw Error('Download offline files with Prepare for offline use first. The original audio is saved.');
  const samples=await audioSamples(entry.blob);let energy=0;for(const x of samples)energy+=x*x;
  if(!samples.length||Math.sqrt(energy/samples.length)<0.001)throw Error('The clip is silent or too quiet to transcribe. Check playback and microphone access.');
  const result=await askWorker('transcribe',samples),elapsed=(performance.now()-began)/1000;
  const current=(await all('entries')).find(e=>e.id===id);if(!current)throw Error('The observation was deleted while transcribing.');
  const updated={...current,text:result.text,transcriptionStatus:'Whisper Tiny English · processed entirely on this phone in '+elapsed.toFixed(1)+' seconds. Review technical terms, names and numbers.',transcriptionModel:MODEL_ID,transcriptionRevision:MODEL_REVISION,transcribedAt:Date.now(),transcriptionSeconds:elapsed};
  await put('entries',updated);await reload();
  if($('#detail').open&&state.detail?.id===id){state.detail=updated;$('#detailText').value=updated.text;$('#transcriptStatus').textContent=updated.transcriptionStatus}
  status('Local transcription finished in '+elapsed.toFixed(1)+' seconds. Original audio retained.');toast('Transcript saved on this phone');
 }catch(e){
  const message='Transcription did not finish: '+e.message;
  status(message);if($('#detail').open&&state.detail?.id===id)$('#transcriptStatus').textContent=message;toast('Original audio is safe. See the transcription status for details.');
 }finally{transcriptionBusy=null;$('#detailText').readOnly=false;updateControls()}
}
async function localSampleTest(){
 if(transcriptionBusy||setupBusy||state.recording)return toast('Finish the current recording or transcription first.');
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
 $('#transcribeEntry').onclick=async()=>{
  const e=state.detail;if(!e)return;
  // Save manual edits before a potentially long transcription.
  try{const latest={...e,area:$('#detailArea').value,text:$('#detailText').value};await put('entries',latest);await reload();state.detail=latest;await transcribeSaved(e.id)}catch(e){fail(e)}
 };
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#installApp').hidden=false});
 $('#installApp').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('#installApp').hidden=true}};
 $('#deviceDiagnostics').textContent='Secure page: '+(isSecureContext?'yes':'no')+' · Browser microphone API: '+(navigator.mediaDevices?.getUserMedia?'available':'unavailable')+' · Model: Whisper Tiny English, 8-bit · Runtime: WebAssembly, one thread';
 try{await ensureServiceWorker();const check=await readiness();status(check.ready?'Offline files are present. Run the local sample test to check this phone.':'One-time setup needed: '+mb(modelBytes)+' speech files plus about 22 MB of app/runtime files. Use Wi-Fi.')}catch(e){status('Offline setup unavailable: '+e.message)}
 updateControls();
}
