import {groupLegacyAreas,inspectionForEntry,inspectionScope,prepareInspectionRestore} from './inspection-data.js';

'use strict';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={inspections:[],inspection:null,areas:[],entries:[],selected:null,filter:'all',gps:null,gpsError:'GPS off',watch:null,gpsEnabled:false,recording:null,urls:[],detail:null};
let db,toastTimer,recordOpening=false;
function toast(t){$('#toast').textContent=t;$('#toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.add('hidden'),5000)}
function fail(e){console.error(e);toast('Could not complete: '+(e?.message||e)+'. Your existing saved records are unchanged.');}
const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2);
async function openDB(){db=await new Promise((resolve,reject)=>{let r=indexedDB.open('fieldnote-area-journal',3);r.onupgradeneeded=()=>{for(const name of ['areas','entries','settings','inspections','gis'])if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name,{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.onversionchange=()=>db.close()}
function tx(store,mode,fn){return new Promise((res,rej)=>{const t=db.transaction(store,mode);let r=fn(t.objectStore(store));t.oncomplete=()=>res(r?.result);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||Error('Storage write cancelled'))})}
const all=s=>tx(s,'readonly',o=>o.getAll()), put=(s,v)=>tx(s,'readwrite',o=>o.put(v));
async function reload(){
 [state.areas,state.entries,state.inspections]=await Promise.all([all('areas'),all('entries'),all('inspections')]);
 if(!state.inspections.some(x=>x.id===state.inspection))state.inspection=state.inspections[0]?.id||null;
 const areas=currentScope().areas;if(state.selected!==null&&!areas.some(a=>a.id===state.selected))state.selected=areas[0]?.id||null;
 render();
}
function inspectionName(id=state.inspection){return state.inspections.find(x=>x.id===id)?.name||'Inspection'}
function currentScope(){return inspectionScope(state.inspection,state.areas,state.entries)}
async function writeInspectionData(inspections,areas,removedAreaIds=[]){
 await new Promise((resolve,reject)=>{const t=db.transaction(['inspections','areas'],'readwrite');for(const x of inspections)t.objectStore('inspections').put(x);for(const x of areas)t.objectStore('areas').put(x);for(const id of removedAreaIds)t.objectStore('areas').delete(id);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)});
}
async function initialiseInspections(){
 const [areas,entries,inspections]=await Promise.all([all('areas'),all('entries'),all('inspections')]);
 const result=groupLegacyAreas(areas,entries,inspections,uid);
 if(result.removedAreaIds.length||JSON.stringify(result.areas)!==JSON.stringify(areas)||result.inspections.length!==inspections.length)await writeInspectionData(result.inspections,result.areas,result.removedAreaIds);
 state.inspections=result.inspections;state.areas=result.areas;state.entries=entries;
}
async function rememberInspection(){await put('settings',{id:'inspection-navigation',inspection:state.inspection,area:state.selected})}
function renderInspectionPicker(){
 $('#inspectionPicker').innerHTML=(state.inspections.length?'':'<option value="">Choose inspection</option>')+state.inspections.slice().sort((a,b)=>(b.created||0)-(a.created||0)).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
 $('#inspectionPicker').value=state.inspection||'';$('#renameInspection').hidden=!state.inspection;
}
let editingInspection=false;
function editInspection(edit=false){editingInspection=edit;$('#inspectionHeading').textContent=edit?'Rename inspection':'New inspection';$('#inspectionName').value=edit?inspectionName():'';$('#inspectionDialog').showModal();$('#inspectionName').focus()}
$('#newInspection').onclick=()=>editInspection();$('#renameInspection').onclick=()=>editInspection(true);
$('#inspectionPicker').onchange=async()=>{try{state.inspection=$('#inspectionPicker').value||null;state.selected=currentScope().areas[0]?.id||null;$('#search').value='';await rememberInspection();render()}catch(error){fail(error)}};
$('#inspectionForm').onsubmit=async event=>{
 event.preventDefault();const name=$('#inspectionName').value.trim();if(!name)return;
 try{
  const old=state.inspections.find(x=>x.id===state.inspection),inspection=editingInspection?{...old,name}:{id:uid(),name,created:Date.now()};
  await put('inspections',inspection);state.inspection=inspection.id;if(!editingInspection)state.selected=null;
  $('#inspectionDialog').close();await reload();await rememberInspection();
 }catch(error){fail(error)}
};

function areaName(id){return state.areas.find(a=>a.id===id)?.name||'Unknown area'}
function stamp(t){return new Date(t).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}
function render(){renderInspectionPicker();const {areas,entries}=currentScope();areas.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));for(const u of state.urls)URL.revokeObjectURL(u);state.urls=[];const n=entries.length;$('#totals').textContent=`${areas.length} areas · ${n} records`;$('#areas').innerHTML=`<button class="area ${state.selected===null?'active':''}" data-area="all"><b>All areas</b><small>${n} records</small></button>`+areas.map(a=>`<button class="area ${state.selected===a.id?'active':''}" data-area="${esc(a.id)}"><b>${esc(a.name)}</b><small>${entries.filter(e=>e.area===a.id).length} records</small></button>`).join('')+`<button class="area" data-area="add" aria-label="Add area" ${state.inspection?'':'disabled'}>＋ New area</button>`;$('#captureTitle').textContent=state.selected?areaName(state.selected):!state.inspection?'Create an inspection':areas.length?'Select an area':'Add an area';$('#takePhoto').disabled=$('#takeVoice').disabled=$('#importPhoto').disabled=$('#importAudio').disabled=$('#nativeRecord').disabled=!state.selected;$('#rename').hidden=!state.selected;$('#entriesTitle').textContent=state.selected?areaName(state.selected)+' journal':'All observations';const q=$('#search').value.toLowerCase();const list=entries.filter(e=>(!state.selected||e.area===state.selected)&&(state.filter==='all'||e.type===state.filter)&&(!q||(areaName(e.area)+' '+e.text).toLowerCase().includes(q))).sort((a,b)=>b.created-a.created);$('#entries').innerHTML=list.map(e=>{let art;if(e.type==='photo'){const u=URL.createObjectURL(e.blob);state.urls.push(u);art=`<img src="${u}" alt="Photo in ${esc(areaName(e.area))}" loading="lazy">`}else art='<div class="audioart" aria-hidden="true">'+[15,25,40,22,50,35,60,32,45,20,35,16].map(h=>`<i style="height:${h}px"></i>`).join('')+'</div>';return `<button class="card" data-entry="${esc(e.id)}">${art}<div class="cardbody"><div class="cardhead"><b>${esc(areaName(e.area))}</b><span class="badge">${e.type==='photo'?'Photo':duration(e.duration)}</span></div><p class="${['queued','processing'].includes(e.transcriptionState)?'processing-label':''}">${esc(e.text||(e.type==='voice'?(e.transcriptionState==='queued'?'Queued…':e.transcriptionState==='processing'?'Transcribing…':e.transcriptionState==='failed'?'Tap to retry transcription':'Tap to listen'):'Photo'))}</p><small>${stamp(e.created)}</small><div style="margin-top:7px"><small>${e.gps?'● GPS saved · '+Math.round(e.gps.accuracy||0)+' m':e.exifGPS?'● Photo GPS retained':'○ No GPS saved'}</small></div></div></button>`}).join('')||'<div class="empty"><svg viewBox="0 0 24 24"><path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h3"/></svg><h3>'+ (q?'No matches':'Nothing here yet')+'</h3><p>'+(!state.inspection?'Name an inspection to get started.':!areas.length?'Add your first area.':'Add a photo or voice note.')+'</p></div>';renderGPS();updateControls();renderCaptureDock()}
function duration(s=0){return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0')}
let gpsWatchEpoch=0;
function renderGPS(){
 const g=state.gps,fresh=g&&Math.abs(Date.now()-g.timestamp)<60000;
 $('#gpsDot').classList.toggle('good',!!fresh);
 $('#gpsStatus').textContent=fresh?'GPS ±'+Math.round(g.accuracy)+' m':g?'GPS fix expired':state.gpsError;
 $('#getGPS').textContent=state.gpsEnabled?'Refresh':'Enable';
 const button=$('#gpsToggle');
 button.setAttribute('aria-pressed',String(state.gpsEnabled));
 button.classList.toggle('active',state.gpsEnabled);button.classList.toggle('gps-ready',!!fresh&&state.gpsEnabled);
 button.textContent=!state.gpsEnabled?'GPS off':document.hidden?'GPS paused':fresh?'GPS on':'GPS…';
 button.title=state.gpsEnabled?(fresh?'Continuous GPS · accuracy ±'+Math.round(g.accuracy)+' m. ':'Waiting for GPS. ')+'Locking the phone can pause updates; refreshes when you return. Tap to turn off.':'Keep GPS connected while this app is visible. Captures can still request a single fix when off.';
 updateGISPosition(fresh?g:null);
}
function saveGPSPreference(){void put('settings',{id:'gps-tracking',enabled:state.gpsEnabled}).catch(fail)}
function clearGPSWatch(){
 gpsWatchEpoch++;if(state.watch!==null)navigator.geolocation?.clearWatch(state.watch);state.watch=null;
}
function refreshGPSWatch(){
 clearGPSWatch();state.gps=null;
 if(!state.gpsEnabled){renderGPS();return}
 if(!navigator.geolocation){state.gpsEnabled=false;state.gpsError='Location unavailable in this browser';saveGPSPreference();renderGPS();return}
 if(document.hidden){state.gpsError='GPS paused while app is hidden';renderGPS();return}
 const epoch=gpsWatchEpoch;state.gpsError='Finding location…';renderGPS();
 try{
  state.watch=navigator.geolocation.watchPosition(position=>{
   if(epoch!==gpsWatchEpoch||!state.gpsEnabled||document.hidden)return;
   if(Math.abs(Date.now()-position.timestamp)>=60000)return;
   state.gps={latitude:position.coords.latitude,longitude:position.coords.longitude,altitude:position.coords.altitude,accuracy:position.coords.accuracy,timestamp:position.timestamp};
   renderGPS();
  },error=>{
   if(epoch!==gpsWatchEpoch||!state.gpsEnabled)return;
   state.gps=null;state.gpsError=error.code===1?'Location permission denied':error.code===3?'GPS timed out — try outdoors':'Location unavailable';
   if(error.code===1){clearGPSWatch();state.gpsEnabled=false;saveGPSPreference()}
   renderGPS();
  },{enableHighAccuracy:true,maximumAge:0,timeout:20000});
 }catch(error){clearGPSWatch();state.gpsEnabled=false;state.gpsError='Location unavailable';saveGPSPreference();renderGPS()}
}
function startGPS(){state.gpsEnabled=true;saveGPSPreference();refreshGPSWatch()}
function stopGPS(){state.gpsEnabled=false;clearGPSWatch();state.gps=null;state.gpsError='GPS off';saveGPSPreference();renderGPS()}
function snapshotGPS(){return state.gps&&Math.abs(Date.now()-state.gps.timestamp)<60000?{...state.gps}:null}
async function fix(){
 if(snapshotGPS())return snapshotGPS();if(!navigator.geolocation)return null;
 return new Promise(resolve=>navigator.geolocation.getCurrentPosition(position=>{
  if(Math.abs(Date.now()-position.timestamp)>=60000)return resolve(null);
  state.gps={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,altitude:position.coords.altitude,timestamp:position.timestamp};
  renderGPS();resolve({...state.gps});
 },()=>resolve(null),{enableHighAccuracy:true,maximumAge:0,timeout:12000}));
}
$('#gpsToggle').onclick=()=>state.gpsEnabled?stopGPS():startGPS();
$('#getGPS').onclick=startGPS;setInterval(renderGPS,10000);
function resumeGPS(){if(state.gpsEnabled)refreshGPSWatch();else renderGPS()}
document.addEventListener('visibilitychange',resumeGPS);
window.addEventListener('pageshow',resumeGPS);
window.addEventListener('pagehide',()=>{clearGPSWatch();state.gps=null});
$('#areas').onclick=e=>{let b=e.target.closest('[data-area]');if(!b)return;if(b.dataset.area==='add'){areaEdit(false);return}state.selected=b.dataset.area==='all'?null:b.dataset.area;render();void rememberInspection().catch(fail)};let editingArea=false;
function areaEdit(edit){if(!state.inspection)return editInspection();editingArea=edit;$('#areaHeading').textContent=edit?'Edit area':'Add an area';$('#areaName').value=edit?areaName(state.selected):'';$('#deleteArea').classList.toggle('hidden',!edit||state.entries.some(e=>e.area===state.selected));$('#areaDialog').showModal();$('#areaName').focus()}
$('#rename').onclick=()=>areaEdit(true);$('#areaForm').onsubmit=async e=>{e.preventDefault();try{const name=$('#areaName').value.trim();if(!name)return;if(state.areas.some(a=>a.inspectionId===state.inspection&&a.name.toLowerCase()===name.toLowerCase()&&(!editingArea||a.id!==state.selected)))return toast('An area with this title already exists');const a={...(editingArea?state.areas.find(x=>x.id===state.selected):{}),id:editingArea?state.selected:uid(),name,inspectionId:state.inspection};await put('areas',a);state.selected=a.id;$('#areaDialog').close();await reload();await rememberInspection()}catch(e){fail(e)}};$('#deleteArea').onclick=async()=>{try{if(state.entries.some(e=>e.area===state.selected))return;await tx('areas','readwrite',o=>o.delete(state.selected));state.selected=null;$('#areaDialog').close();await reload()}catch(e){fail(e)}};
$('#filters').onclick=e=>{let b=e.target.closest('[data-filter]');if(!b)return;state.filter=b.dataset.filter;$('#filters').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));render()};$('#search').oninput=render;
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
let photoContext=null;$('#importPhoto').onclick=()=>{photoContext={area:state.selected,kind:'import'};$('#settings').close();$('#gallery').click()};
async function photos(input){const ctx=photoContext;if(!ctx||!input.files.length)return;const files=Array.from(input.files);input.disabled=true;try{let gps=ctx.kind==='camera'?(await ctx.pendingGPS||ctx.gps):null;for(const file of files){if(!file.type.startsWith('image/'))continue;const exifGPS=await readPhotoGPS(file);const item={id:uid(),area:ctx.area,type:'photo',created:Date.now(),blob:file,name:file.name,mime:file.type,text:'',gps,exifGPS,locationSource:gps?'Device fix around camera capture (not shutter-synchronised)':null,originalModified:file.lastModified};await saveCapture(item)}await reload();toast('Photo saved'+(gps?' with device GPS':'. '+(ctx.kind==='import'?'Existing photo GPS retained if present.':'No device GPS fix — check photo details.')))}catch(e){fail(e)}finally{input.disabled=false;input.value=''}}
$('#camera').onchange=()=>photos($('#camera'));$('#gallery').onchange=()=>photos($('#gallery'));
let detailURL=null;
function showDetail(id){const e=state.entries.find(e=>e.id===id);if(!e)return;state.detail=e;if(detailURL)URL.revokeObjectURL(detailURL);detailURL=URL.createObjectURL(e.blob);$('#detailHeading').textContent=e.type==='photo'?'Photo observation':'Voice observation';$('#media').innerHTML=e.type==='photo'?`<img src="${detailURL}" alt="Original captured photo">`:`<audio src="${detailURL}" controls></audio>`;$('#detailDate').textContent=stamp(e.created)+(e.type==='voice'?' · '+duration(e.duration):'');const g=e.exifGPS||e.gps;$('#detailLocation').innerHTML=g?`<b>${e.exifGPS?'Original photo GPS':'Device location'}</b><br>${Number(g.latitude).toFixed(6)}, ${Number(g.longitude).toFixed(6)}${g.accuracy?' · Accuracy ±'+Math.round(g.accuracy)+' m':''}<br>${g.timestamp?esc(stamp(g.timestamp))+'<br>':''}<a href="https://www.google.com/maps?q=${g.latitude},${g.longitude}" target="_blank" rel="noopener">View on map ↗</a>${e.gps&&e.exifGPS?'<br>Separate capture device fix also saved.':''}${e.locationSource?'<br>'+esc(e.locationSource):''}`:'No GPS was available for this record. Original photo metadata is preserved.';$('#detailArea').innerHTML=state.inspections.map(i=>`<optgroup label="${esc(i.name)}">${state.areas.filter(a=>a.inspectionId===i.id).map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</optgroup>`).join('');$('#detailArea').value=e.area;$('#detailLabel').textContent=e.type==='voice'?'Transcript / notes (editable)':'Photo note';$('#detailText').value=e.text||'';$('#transcriptStatus').classList.toggle('hidden',e.type!=='voice');$('#transcriptStatus').textContent=e.transcriptionStatus||'Check the transcript against the recording.';$('#transcribeEntry').hidden=e.type!=='voice';$('#detail').showModal();updateControls()}
$('#entries').onclick=e=>{const b=e.target.closest('[data-entry]');if(b)showDetail(b.dataset.entry)};$('#detail').addEventListener('close',()=>{const a=$('#media audio');if(a)a.pause();if(detailURL)URL.revokeObjectURL(detailURL);detailURL=null});$('#detailForm').onsubmit=async e=>{e.preventDefault();try{const current=(await all('entries')).find(x=>x.id===state.detail.id);if(!current)return;await put('entries',{...current,area:$('#detailArea').value,inspectionId:state.areas.find(a=>a.id===$('#detailArea').value)?.inspectionId,text:$('#detailText').readOnly?current.text:$('#detailText').value});$('#detail').close();await reload();toast('Changes saved')}catch(e){fail(e)}};$('#deleteEntry').onclick=async()=>{if(!confirm('Delete this observation and its media from this device?'))return;try{await tx('entries','readwrite',o=>o.delete(state.detail.id));$('#detail').close();await reload()}catch(e){fail(e)}};
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000)}
function safe(s){return String(s).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100)||'area'}
function mediaName(e){const ext=e.type==='photo'?(e.name?.split('.').pop()||'jpg'):(e.name?.split('.').pop()||(e.mime?.includes('mp4')?'m4a':e.mime?.includes('ogg')?'ogg':'webm'));return safe(areaName(e.area))+'_'+new Date(e.created).toISOString().replace(/[:.]/g,'-')+'_'+e.id.slice(0,8)+'.'+safe(ext)}
$('#downloadMedia').onclick=()=>download(state.detail.blob,mediaName(state.detail));
async function record(){
 if(state.recording||recordOpening)return;
 recordOpening=true;updateControls();
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){recordOpening=false;updateControls();return $('#micHelp').showModal()}
 let stream;
 try{
  const area=state.selected, gpsPromise=fix();
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,channelCount:1}});
  const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(x=>MediaRecorder.isTypeSupported(x));
  const mr=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
  const r={area,mr,stream,modelKey:selectedModelKey,chunks:[],start:Date.now(),gps:snapshotGPS(),ending:false,timer:null,stoppedAt:null};
  state.recording=r;
  gpsPromise.then(g=>{if(g){r.gps=g;if(state.recording===r)$('#recGPS').textContent='GPS saved · ±'+Math.round(g.accuracy)+' m'}});
  $('#recArea').textContent='Recording in '+areaName(area);
  $('#recGPS').textContent=r.gps?'GPS saved · ±'+Math.round(r.gps.accuracy)+' m':'Acquiring GPS…';
  $('#liveText').textContent='';
  $('#timer').textContent='00:00';$('#stopRecording').disabled=false;$('#stopRecording').textContent='■ Stop';$('#stopRecording').onclick=stopRecord;
  $('#recStatus').textContent='Recording';$('#recDialog').showModal();
  r.timer=setInterval(()=>{const seconds=(Date.now()-r.start)/1000;$('#timer').textContent=duration(seconds);if(seconds>=120)stopRecord()},500);
  mr.ondataavailable=e=>{if(e.data.size)r.chunks.push(e.data)};
  mr.onerror=()=>{toast('Recorder error — preserving any captured audio');stopRecord()};
  mr.onstop=async()=>{
   r.ending=true;r.stoppedAt??=Date.now();clearInterval(r.timer);r.stream.getTracks().forEach(t=>t.stop());
   const blob=new Blob(r.chunks,{type:mr.mimeType||mime||'audio/webm'});
   const entry={id:uid(),area:r.area,type:'voice',created:r.start,duration:(r.stoppedAt-r.start)/1000,blob,mime:blob.type,text:'',gps:r.gps,locationSource:r.gps?'Device location near start of recording':null,transcriptionModelKey:r.modelKey,transcriptionStatus:'Audio saved. Offline Whisper transcription has not run yet.'};
   if(state.recording===r){state.recording=null;if($('#recDialog').open)$('#recDialog').close()}
   await saveCapture(entry);attachLateGPS(entry.id,gpsPromise,r.start,'Device fix near recording start');
  };
  mr.start(1000);
 }catch(e){stream?.getTracks().forEach(t=>t.stop());state.recording=null;if($('#recDialog').open)$('#recDialog').close();if(['NotAllowedError','SecurityError','PermissionDeniedError'].includes(e.name))$('#micHelp').showModal();else fail(e)}finally{recordOpening=false;updateControls()}
}
function stopRecord(){const r=state.recording;if(!r||r.ending)return;r.ending=true;r.stoppedAt=Date.now();$('#recDialog').close();if(r.mr.state!=='inactive')r.mr.stop();r.stream.getTracks().forEach(t=>t.stop());if(state.recording===r)state.recording=null;updateControls()}
$('#takeVoice').onclick=record;
let nativeContext=null;
function nativeRecord(){if(!state.selected)return;if($('#settings').open)$('#settings').close();nativeContext={area:state.selected,created:Date.now(),gps:snapshotGPS()};const c=nativeContext;fix().then(g=>{if(g)c.gps=g});$('#nativeAudio').click()}
$('#nativeRecord').onclick=nativeRecord;
$('#helpNative').onclick=()=>{$('#micHelp').close();nativeRecord()};
$('#nativeAudio').onchange=async()=>{const input=$('#nativeAudio'),file=input.files[0],c=nativeContext;if(!file||!c)return;try{const item={id:uid(),area:c.area,type:'voice',created:Date.now(),blob:file,name:file.name,mime:file.type||'audio/mp4',text:'',gps:c.gps,locationSource:c.gps?'Device fix when phone recorder was opened; not synchronised with audio start. If an existing file was selected, this is its attachment location.':null,transcriptionStatus:'Phone recorder audio saved. Tap Transcribe on this phone for offline Whisper. Timestamp is attachment time.',recorderOpened:c.created};await saveCapture(item);input.value=''}catch(e){fail(e)}};
let audioArea=null;
$('#importAudio').onclick=()=>{audioArea=state.selected;$('#settings').close();$('#audioImport').click()};
$('#audioImport').onchange=async()=>{const input=$('#audioImport'),file=input.files[0];if(!file)return;try{if(!file.type.startsWith('audio/')&&!/\.(m4a|mp3|wav|ogg|webm|aac|3gp)$/i.test(file.name))throw Error('Please select an audio file');const item={id:uid(),area:audioArea,type:'voice',created:Date.now(),blob:file,name:file.name,mime:file.type||'audio/mp4',text:'',gps:null,transcriptionStatus:'Imported audio saved. Tap Transcribe on this phone for offline Whisper. Capture GPS is unknown; timestamp is import time.'};await saveCapture(item);input.value=''}catch(e){fail(e)}};
$('#recDialog').addEventListener('cancel',e=>e.preventDefault());window.addEventListener('beforeunload',e=>{if(state.recording){e.preventDefault();e.returnValue='Recording is not saved yet'}});
$('#backupMenu').onclick=()=>openSettings();$('#language').onchange=$('#transcribe').onchange=()=>put('settings',{id:'preferences',language:$('#language').value,transcribe:$('#transcribe').checked}).catch(fail);$('#persist').onclick=async()=>{try{const ok=await navigator.storage?.persist?.();$('#storageInfo').textContent=ok?'Persistent storage granted. Keep regular backups.':'Browser has not granted persistent storage. Backups are recommended.'}catch(e){fail(e)}};
// Read original EXIF GPS without decoding or rewriting the photo.
function exifSegment(bytes){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(v.byteLength<4||v.getUint16(0)!==0xffd8)return null;let p=2;while(p+4<v.byteLength){if(v.getUint8(p)!==255)return null;const marker=v.getUint8(p+1);if(marker===218||marker===217)break;const len=v.getUint16(p+2);if(len<2||p+2+len>v.byteLength)return null;if(marker===225&&len>8&&String.fromCharCode(...bytes.slice(p+4,p+10))==='Exif\0\0')return{start:p,end:p+len+2,tiff:p+10};p+=len+2}return null}
function parseGPS(bytes){try{const seg=exifSegment(bytes);if(!seg)return null;const v=new DataView(bytes.buffer,bytes.byteOffset+seg.tiff,seg.end-seg.tiff),le=v.getUint16(0)===0x4949;if(v.getUint16(2,le)!==42)return null;const ifd=v.getUint32(4,le),n=v.getUint16(ifd,le);let gp;for(let i=0;i<n;i++){const p=ifd+2+i*12;if(v.getUint16(p,le)===0x8825)gp=v.getUint32(p+8,le)}if(!gp)return null;const m={};for(let i=0;i<v.getUint16(gp,le);i++){const p=gp+2+i*12,tag=v.getUint16(p,le);if(tag===1||tag===3)m[tag]=String.fromCharCode(v.getUint8(p+8));if(tag===2||tag===4){let o=v.getUint32(p+8,le),d=[];for(let j=0;j<3;j++)d.push(v.getUint32(o+j*8,le)/v.getUint32(o+j*8+4,le));m[tag]=d[0]+d[1]/60+d[2]/3600}}if(!Number.isFinite(m[2])||!Number.isFinite(m[4]))return null;return{latitude:m[2]*(m[1]==='S'?-1:1),longitude:m[4]*(m[3]==='W'?-1:1)}}catch{return null}}
async function readPhotoGPS(blob){return parseGPS(new Uint8Array(await blob.arrayBuffer()))}
// Add GPS to an exported JPEG copy; retain existing TIFF entries and all image bytes.
async function geotagJPEG(blob,g){let b=new Uint8Array(await blob.arrayBuffer());if(b[0]!==255||b[1]!==216||parseGPS(b))return null;const seg=exifSegment(b);let orig=seg?b.slice(seg.tiff,seg.end):new Uint8Array([73,73,42,0,8,0,0,0,0,0,0,0,0,0]);const ov=new DataView(orig.buffer),le=ov.getUint16(0)===0x4949;if(ov.getUint16(2,le)!==42)return null;const old=ov.getUint32(4,le),count=ov.getUint16(old,le);if(old+2+count*12+4>orig.length)return null;const entries=[];for(let i=0;i<count;i++){let p=old+2+i*12;if(ov.getUint16(p,le)!==0x8825)entries.push(orig.slice(p,p+12))}const root=(orig.length+1)&~1,rootLen=2+(entries.length+1)*12+4,gp=root+rootLen,gplen=2+5*12+4,rat=gp+gplen;const t=new Uint8Array(rat+48),v=new DataView(t.buffer);t.set(orig);v.setUint32(4,root,le);v.setUint16(root,entries.length+1,le);entries.forEach((e,i)=>t.set(e,root+2+i*12));let p=root+2+entries.length*12;v.setUint16(p,0x8825,le);v.setUint16(p+2,4,le);v.setUint32(p+4,1,le);v.setUint32(p+8,gp,le);v.setUint32(root+2+(entries.length+1)*12,ov.getUint32(old+2+count*12,le),le);v.setUint16(gp,5,le);function tag(i,id,type,n,val){const p=gp+2+i*12;v.setUint16(p,id,le);v.setUint16(p+2,type,le);v.setUint32(p+4,n,le);v.setUint32(p+8,val,le);return p+8}let ver=tag(0,0,1,4,0);t.set([2,3,0,0],ver);let lat=tag(1,1,2,2,0);t[lat]=(g.latitude<0?'S':'N').charCodeAt(0);tag(2,2,5,3,rat);let lon=tag(3,3,2,2,0);t[lon]=(g.longitude<0?'W':'E').charCodeAt(0);tag(4,4,5,3,rat+24);[g.latitude,g.longitude].forEach((x,i)=>{x=Math.abs(x);const deg=Math.floor(x),min=Math.floor((x-deg)*60),sec=((x-deg)*60-min)*60;[deg,min,Math.round(sec*1000000)].forEach((n,j)=>{let o=rat+i*24+j*8;v.setUint32(o,n,le);v.setUint32(o+4,j===2?1000000:1,le)})});const len=t.length+8;if(len>65535)return null;const app=new Uint8Array(t.length+10);app.set([255,225,len>>8,len&255,69,120,105,102,0,0]);app.set(t,10);return new Blob([b.slice(0,seg?seg.start:2),app,b.slice(seg?seg.end:2)],{type:'image/jpeg'})}
// Dependency-free ZIP (stored entries), including originals and GPS sidecars.
const encoder=new TextEncoder();const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});function crc(b){let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0}
async function zip(files){const chunks=[],central=[];let off=0;for(const f of files){const name=encoder.encode(f.name),data=new Uint8Array(await f.blob.arrayBuffer()),sum=crc(data);const h=new Uint8Array(30+name.length),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,sum,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);h.set(name,30);chunks.push(h,data);const c=new Uint8Array(46+name.length),w=new DataView(c.buffer);w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint32(16,sum,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);w.setUint16(28,name.length,true);w.setUint32(42,off,true);c.set(name,46);central.push(c);off+=h.length+data.length}const size=central.reduce((s,b)=>s+b.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,size,true);v.setUint32(16,off,true);return new Blob([...chunks,...central,end],{type:'application/zip'})}
function metadata(e){const {blob,...m}=e;return{...m,inspectionId:inspectionForEntry(e,state.areas),inspectionTitle:inspectionName(inspectionForEntry(e,state.areas)),areaTitle:areaName(e.area),filename:mediaName(e)}}
function csvCell(x){let s=String(x??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}
async function busy(button,fn){button.disabled=true;const label=button.textContent;button.textContent='Preparing…';try{await fn()}catch(e){fail(e)}finally{button.disabled=false;button.textContent=label}}
$('#exportZip').onclick=()=>busy($('#exportZip'),async()=>{if(!state.inspection)return toast('Choose an inspection first.');const scope=currentScope();const files=[],rows=[['Inspection','Area','Type','Captured (UTC)','Filename','Transcript / note','Latitude','Longitude','Accuracy (m)','Location source','GPS timestamp (UTC)']];for(const e of scope.entries){const name=mediaName(e),folder=safe(areaName(e.area))+'/';files.push({name:folder+name,blob:e.blob},{name:folder+name+'.gps.json',blob:new Blob([JSON.stringify(metadata(e),null,2)])});if(e.type==='photo'&&e.gps&&!e.exifGPS){try{const tagged=await geotagJPEG(e.blob,e.gps);if(tagged)files.push({name:folder+'geotagged_'+name,blob:tagged})}catch{}}if(e.text)files.push({name:folder+name+'.txt',blob:new Blob([e.text])});const g=e.exifGPS||e.gps;rows.push([inspectionName(),areaName(e.area),e.type,new Date(e.created).toISOString(),folder+name,e.text,g?.latitude,g?.longitude,g?.accuracy,e.exifGPS?'Original EXIF':e.locationSource,g?.timestamp?new Date(g.timestamp).toISOString():''])}files.push({name:'inspection.json',blob:new Blob([JSON.stringify({inspection:state.inspections.find(x=>x.id===state.inspection),areas:scope.areas},null,2)])},{name:'index.csv',blob:new Blob(['\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')])},{name:'README.txt',blob:new Blob(['Fieldnote export\nOriginal media is unchanged. GPS JSON sidecars contain separate device coordinates and accuracy. Imported photos are not assigned the current device location. geotagged_ JPEG copies contain device GPS when the original has no GPS; originals are retained. Capture location is approximate, not shutter-synchronised. Audio transcription may be incomplete. This ZIP is for review; use Full backup for app restore.'])});download(await zip(files),'Fieldnote-'+safe(inspectionName())+'-'+new Date().toISOString().slice(0,10)+'.zip');toast('Export prepared')});
const toDataURL=b=>new Promise((res,rej)=>{const f=new FileReader();f.onload=()=>res(f.result);f.onerror=()=>rej(f.error);f.readAsDataURL(b)});
$('#exportBackup').onclick=()=>busy($('#exportBackup'),async()=>{const entries=[];for(const e of state.entries)entries.push({...metadata(e),data:await toDataURL(e.blob)});download(new Blob([JSON.stringify({app:'fieldnote',version:2,exported:new Date().toISOString(),inspections:state.inspections,areas:state.areas,entries})],{type:'application/json'}),'Fieldnote-backup-'+new Date().toISOString().slice(0,10)+'.json');toast('Backup prepared — keep the downloaded file')});
$('#restore').onclick=()=>$('#restoreFile').click();
$('#restoreFile').onchange=async()=>{
 try{
  const file=$('#restoreFile').files[0];if(!file)return;const backup=JSON.parse(await file.text());
  if(backup.app!=='fieldnote'||![1,2].includes(backup.version)||!Array.isArray(backup.areas)||!Array.isArray(backup.entries))throw Error('Not a Fieldnote backup');
  const areaIds=new Set(backup.areas.map(a=>a.id));if(areaIds.size!==backup.areas.length)throw Error('Duplicate areas in backup');
  for(const area of backup.areas)if(typeof area.id!=='string'||typeof area.name!=='string'||!area.name.trim())throw Error('Invalid area');
  if(backup.version===2){
   if(!Array.isArray(backup.inspections))throw Error('Missing inspections');
   const ids=new Set(backup.inspections.map(x=>x.id));if(ids.size!==backup.inspections.length)throw Error('Duplicate inspections');
   for(const i of backup.inspections)if(typeof i.id!=='string'||typeof i.name!=='string'||!i.name.trim())throw Error('Invalid inspection');
   for(const area of backup.areas)if(!ids.has(area.inspectionId))throw Error('An area has no inspection');
  }
  const grouped=prepareInspectionRestore(backup,state.areas,uid),areaMap=new Map(grouped.areas.map(a=>[a.id,a]));
  const decoded=[];
  for(const entry of backup.entries){
   if(typeof entry.id!=='string'||!areaIds.has(entry.area)||!['photo','voice'].includes(entry.type)||!Number.isFinite(entry.created)||typeof entry.text!=='string'||typeof entry.data!=='string'||!/^data:(image\/|audio\/)/.test(entry.data))throw Error('Invalid observation');
   const {data,...rest}=entry,response=await fetch(data);decoded.push({...rest,inspectionId:areaMap.get(entry.area).inspectionId,blob:await response.blob()});
  }
  if(!confirm(`Restore ${grouped.areas.length} areas and ${decoded.length} observations, including their inspection grouping? Matching IDs will be updated.`))return;
  await new Promise((resolve,reject)=>{
   const t=db.transaction(['inspections','areas','entries'],'readwrite');
   for(const i of grouped.inspections)t.objectStore('inspections').put(i);
   for(const area of grouped.areas)t.objectStore('areas').put(area);
   for(const entry of decoded)t.objectStore('entries').put(entry);
   t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);
  });
  if(grouped.areas[0]){state.inspection=grouped.areas[0].inspectionId;state.selected=grouped.areas[0].id}
  await reload();await rememberInspection();void restoreQueue();toast('Backup restored');
 }catch(error){fail(error)}finally{$('#restoreFile').value=''}
};
async function init(){
 try{
  await openDB();await initialiseInspections();const settings=await all('settings');const p=settings.find(x=>x.id==='preferences');
  if(p){$('#language').value=p.language;$('#transcribe').checked=p.transcribe}
  state.gpsEnabled=settings.find(x=>x.id==='gps-tracking')?.enabled===true;
  const nav=settings.find(x=>x.id==='inspection-navigation');
  state.inspection=state.inspections.some(x=>x.id===nav?.inspection)?nav.inspection:state.inspections[0]?.id||null;
  state.selected=currentScope().areas.some(a=>a.id===nav?.area)?nav.area:currentScope().areas[0]?.id||null;
  await reload();if(state.gpsEnabled)refreshGPSWatch();if(navigator.storage?.estimate){const x=await navigator.storage.estimate();$('#storageInfo').textContent=`Device storage used: ${(x.usage/1024/1024).toFixed(1)} MB`}
 }catch(e){fail(e);$('#captureTitle').textContent='Device storage unavailable';$('#takePhoto').disabled=$('#takeVoice').disabled=true}
}
