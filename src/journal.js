import {compressExportPhoto,exportZip,exportYield} from './export-media.js';
import {canonicalAreaName,mergeAreaGroups} from './area-groups.js';
import {patchEntryRecord,moveRecordsToArea} from './record-storage.js';
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
const all=s=>tx(s,'readonly',o=>o.getAll());
function put(store,value){
 if(store!=='entries')return tx(store,'readwrite',o=>o.put(value));
 // A late GPS/transcription callback must not recreate records in a deleted area.
 return new Promise((resolve,reject)=>{
  const t=db.transaction(['areas','entries'],'readwrite');let missing=false;
  t.objectStore('areas').get(value.area).onsuccess=event=>{
   if(!event.target.result){missing=true;t.abort();return}
   t.objectStore('entries').put(value);
  };
  t.oncomplete=()=>resolve(value.id);t.onerror=()=>reject(t.error);t.onabort=()=>reject(missing?Error('This working area was deleted; the record was not saved.'):t.error||Error('Record save cancelled'));
 });
}
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
$('#inspectionPicker').onchange=async()=>{try{state.inspection=$('#inspectionPicker').value||null;state.selected=currentScope().areas[0]?.id||null;$('#search').value='';await rememberInspection();render();void syncGISAreas().then(()=>showGISWorkingArea(state.selected)).catch(fail)}catch(error){fail(error)}};
$('#inspectionForm').onsubmit=async event=>{
 event.preventDefault();const name=$('#inspectionName').value.trim();if(!name)return;
 try{
  const old=state.inspections.find(x=>x.id===state.inspection),inspection=editingInspection?{...old,name}:{id:uid(),name,created:Date.now()};
  await put('inspections',inspection);state.inspection=inspection.id;if(!editingInspection)state.selected=null;
  $('#inspectionDialog').close();await reload();await rememberInspection();await syncGISAreas();await showGISWorkingArea(state.selected);
 }catch(error){fail(error)}
};

function areaName(id){return state.areas.find(a=>a.id===id)?.name||'Unknown area'}
function stamp(t){return new Date(t).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}
function render(){renderInspectionPicker();const {areas,entries}=currentScope();areas.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));for(const u of state.urls)URL.revokeObjectURL(u);state.urls=[];const n=entries.length;$('#totals').textContent=`${areas.length} areas · ${n} records`;$('#areas').innerHTML=`<button class="area ${state.selected===null?'active':''}" data-area="all"><b>All areas</b><small>${n} records</small></button>`+areas.map(a=>`<button class="area ${state.selected===a.id?'active':''}" data-area="${esc(a.id)}"><b>${esc(a.name)}</b><small>${entries.filter(e=>e.area===a.id).length} records</small></button>`).join('')+`<button class="area" data-area="add" aria-label="Add area" ${state.inspection?'':'disabled'}>＋ New area</button>`;$('#captureTitle').textContent=state.selected?areaName(state.selected):!state.inspection?'Create an inspection':areas.length?'Select an area':'Add an area';$('#takePhoto').disabled=$('#takeVoice').disabled=$('#importPhoto').disabled=$('#importAudio').disabled=$('#nativeRecord').disabled=!state.selected;$('#rename').hidden=!state.selected;$('#entriesTitle').textContent=state.selected?areaName(state.selected)+' journal':'All observations';renderRecords();renderGPS();updateControls();renderCaptureDock()}
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
 updateGPSAreaButton();
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
$('#areas').onclick=e=>{let b=e.target.closest('[data-area]');if(!b)return;if(b.dataset.area==='add'){areaEdit(false);return}state.selected=b.dataset.area==='all'?null:b.dataset.area;render();void rememberInspection().catch(fail);void showGISWorkingArea(state.selected).catch(fail)};let editingArea=false;
function areaEdit(edit){if(!state.inspection)return editInspection();editingArea=edit;$('#areaHeading').textContent=edit?'Edit area':'Add an area';$('#areaName').value=edit?areaName(state.selected):'';$('#deleteArea').classList.toggle('hidden',!edit);$('#areaDialog').showModal();$('#areaName').focus()}
$('#rename').onclick=()=>areaEdit(true);$('#areaForm').onsubmit=async e=>{e.preventDefault();try{const name=canonicalAreaName($('#areaName').value);if(!name)return;if(state.areas.some(a=>a.inspectionId===state.inspection&&a.name.toLowerCase()===name.toLowerCase()&&(!editingArea||a.id!==state.selected)))return toast('An area with this title already exists');const a={...(editingArea?state.areas.find(x=>x.id===state.selected):{}),id:editingArea?state.selected:uid(),name,inspectionId:state.inspection};await put('areas',a);state.selected=a.id;$('#areaDialog').close();await reload();await rememberInspection();await showGISWorkingArea(state.selected)}catch(e){fail(e)}};$('#deleteArea').onclick=()=>{const id=state.selected;$('#areaDialog').close();void openAreaActions(id)};

$('#filters').onclick=e=>{let b=e.target.closest('[data-filter]');if(!b)return;state.filter=b.dataset.filter;$('#filters').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));render()};$('#search').oninput=render;
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
let photoContext=null;$('#importPhoto').onclick=()=>{photoContext={area:state.selected,kind:'import'};$('#settings').close();$('#gallery').click()};
async function photos(input){const ctx=photoContext;if(!ctx||!input.files.length)return;const files=Array.from(input.files);input.disabled=true;try{let gps=ctx.kind==='camera'?(await ctx.pendingGPS||ctx.gps):null;for(const file of files){if(!file.type.startsWith('image/'))continue;const exifGPS=await readPhotoGPS(file);const item={id:uid(),area:ctx.area,type:'photo',created:Date.now(),blob:file,name:file.name,mime:file.type,text:'',gps,exifGPS,locationSource:gps?'Device fix around camera capture (not shutter-synchronised)':null,originalModified:file.lastModified};await saveCapture(item)}await reload();toast('Photo saved'+(gps?' with device GPS':'. '+(ctx.kind==='import'?'Existing photo GPS retained if present.':'No device GPS fix — check photo details.')))}catch(e){fail(e)}finally{input.disabled=false;input.value=''}}
$('#camera').onchange=()=>photos($('#camera'));$('#gallery').onchange=()=>photos($('#gallery'));
let detailURL=null;
function showDetail(id){const e=state.entries.find(e=>e.id===id);if(!e)return;state.detail=e;$('#detailHeading').textContent=e.type==='photo'?'Photo observation':'Voice observation';renderDetailMedia(e);$('#detailDate').textContent=stamp(e.created)+(e.type==='voice'?' · '+duration(e.duration):'');const g=e.exifGPS||e.gps;$('#detailLocation').innerHTML=g?`<b>${e.exifGPS?'Original photo GPS':'Device location'}</b><br>${Number(g.latitude).toFixed(6)}, ${Number(g.longitude).toFixed(6)}${g.accuracy?' · Accuracy ±'+Math.round(g.accuracy)+' m':''}<br>${g.timestamp?esc(stamp(g.timestamp))+'<br>':''}<a href="https://www.google.com/maps?q=${g.latitude},${g.longitude}" target="_blank" rel="noopener">View on map ↗</a>${e.gps&&e.exifGPS?'<br>Separate capture device fix also saved.':''}${e.locationSource?'<br>'+esc(e.locationSource):''}`:'No GPS was available for this record. Original photo metadata is preserved.';$('#detailArea').innerHTML=state.inspections.map(i=>`<optgroup label="${esc(i.name)}">${state.areas.filter(a=>a.inspectionId===i.id).map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</optgroup>`).join('');$('#detailArea').value=e.area;$('#detailLabel').textContent=e.type==='voice'?'Transcript / notes (editable)':'Photo note';$('#detailText').value=e.text||'';$('#transcriptStatus').classList.toggle('hidden',e.type!=='voice');$('#transcriptStatus').textContent=e.transcriptionStatus||'Check the transcript against the recording.';$('#transcribeEntry').hidden=e.type!=='voice';$('#detail').showModal();updateControls()}
$('#entries').onclick=e=>{const b=e.target.closest('[data-entry]');if(b){if(recordSelecting)toggleRecordSelection(b.dataset.entry);else showDetail(b.dataset.entry)}};$('#detail').addEventListener('close',releaseDetailMedia);$('#detailForm').onsubmit=async e=>{e.preventDefault();try{const current=(await all('entries')).find(x=>x.id===state.detail.id);if(!current)return;await put('entries',{...current,area:$('#detailArea').value,inspectionId:state.areas.find(a=>a.id===$('#detailArea').value)?.inspectionId,text:$('#detailText').readOnly?current.text:$('#detailText').value});$('#detail').close();await reload();toast('Changes saved')}catch(e){fail(e)}};$('#deleteEntry').onclick=async()=>{if(!confirm('Delete this observation and its media from this device?'))return;try{await tx('entries','readwrite',o=>o.delete(state.detail.id));$('#detail').close();await reload()}catch(e){fail(e)}};
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
function metadata(e){const {blob,...m}=e;return{...m,inspectionId:inspectionForEntry(e,state.areas),inspectionTitle:inspectionName(inspectionForEntry(e,state.areas)),areaTitle:areaName(e.area),filename:mediaName(e)}}
function csvCell(x){let s=String(x??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}
async function busy(button,fn){button.disabled=true;const label=button.textContent;button.textContent='Preparing…';try{await fn()}catch(e){fail(e)}finally{button.disabled=false;button.textContent=label}}
function exportProgress(percent,message){
 $('#exportProgressBox').hidden=false;$('#exportProgress').value=percent;
 $('#exportProgressText').textContent=Math.floor(percent)+'% · '+message;
}
$('#exportZip').onclick=()=>busy($('#exportZip'),async()=>{
 if(!state.inspection)return toast('Choose an inspection first.');
 const inspectionId=state.inspection,inspectionTitle=inspectionName(),scope=currentScope(),areaTitles=new Map(scope.areas.map(area=>[area.id,area.name]));
 const files=[],rows=[['Inspection','Area','Type','Captured (UTC)','Filename','Transcript / note','Latitude','Longitude','Accuracy (m)','Location source','GPS timestamp (UTC)']];
 let fallback=0,originalBytes=0,exportBytes=0;
 exportProgress(0,'Preparing '+scope.entries.length+' records…');$('#exportProgressBox').setAttribute('aria-busy','true');
 try{
  await exportYield();
  for(let i=0;i<scope.entries.length;i++){
   const e=scope.entries[i],originalName=mediaName(e),folder=safe(areaTitles.get(e.area)||'Area')+'/';
   exportProgress(80*i/Math.max(1,scope.entries.length),(e.type==='photo'?'Compressing photo':'Preparing voice note')+' · '+(i+1)+' / '+scope.entries.length);
   await exportYield();let blob=e.blob,name=originalName,compressed=false,compressionError=false;
   if(e.type==='photo'){
    try{const result=await compressExportPhoto(e.blob);blob=result.blob;compressed=result.compressed;if(compressed)name=originalName.replace(/\.[^.]+$/,'.jpg')}catch{fallback++;compressionError=true}
    const gps=e.exifGPS||e.gps;
    if(gps)try{blob=await geotagJPEG(blob,gps)||blob}catch{/* GPS remains in the sidecar. */}
    originalBytes+=e.blob.size;exportBytes+=blob.size;
   }
   const info={...metadata(e),filename:name,exportMime:blob.type,exportBytes:blob.size,originalBytes:e.blob.size,originalFilename:originalName,photoCompressed:compressed,...(compressionError?{exportWarning:'Photo compression unavailable; original included.'}:{})};
   files.push({name:folder+name,blob},{name:folder+name+'.gps.json',blob:new Blob([JSON.stringify(info,null,2)])});
   if(e.text)files.push({name:folder+name+'.txt',blob:new Blob([e.text])});
   const g=e.exifGPS||e.gps;
   rows.push([inspectionTitle,areaTitles.get(e.area),e.type,new Date(e.created).toISOString(),folder+name,e.text,g?.latitude,g?.longitude,g?.accuracy,e.exifGPS?'Original EXIF':e.locationSource,g?.timestamp?new Date(g.timestamp).toISOString():'']);
  }
  files.push({name:'inspection.json',blob:new Blob([JSON.stringify({inspection:state.inspections.find(x=>x.id===inspectionId),areas:scope.areas},null,2)])},{name:'index.csv',blob:new Blob(['\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')])},{name:'README.txt',blob:new Blob(['Fieldnote export\nPhotos are JPEG copies at up to 2048 pixels on the long edge and 82% quality when smaller than the original. Unsupported photos are included unchanged. One photo per record; no duplicate geotagged copies. Originals on the phone and Full backup are unchanged. GPS is embedded in exported JPEGs where possible, with original EXIF coordinates preferred over device GPS; GPS JSON sidecars retain both sources, timestamps and accuracy. Other original image metadata may not be in compressed copies. Audio is unchanged. Capture location is approximate. Transcription may be incomplete. This ZIP is for review; use Full backup for app restore.'])});
  const archive=await exportZip(files,fraction=>exportProgress(80+fraction*19,'Building ZIP…'));
  exportProgress(99,'Preparing download…');await exportYield();
  download(archive,'Fieldnote-'+safe(inspectionTitle)+'-'+new Date().toISOString().slice(0,10)+'.zip');
  const savings=originalBytes?Math.max(0,Math.round((1-exportBytes/originalBytes)*100)):0;
  exportProgress(100,'ZIP ready'+(originalBytes?' · photos '+savings+'% smaller':'')+(fallback?' · '+fallback+' original photo(s) kept':'')+'. Check your downloads.');toast('Export prepared');
 }catch(error){$('#exportProgressText').textContent='Export failed: '+error.message;throw error}
 finally{$('#exportProgressBox').setAttribute('aria-busy','false')}
});
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
  await mergeReferenceAreas();await reload();await rememberInspection();void restoreQueue();toast('Backup restored');
 }catch(error){fail(error)}finally{$('#restoreFile').value=''}
};
async function init(){
 try{
  await openDB();await initialiseInspections();await mergeReferenceAreas();const settings=await all('settings');const p=settings.find(x=>x.id==='preferences');
  if(p){$('#language').value=p.language;$('#transcribe').checked=p.transcribe}
  state.gpsEnabled=settings.find(x=>x.id==='gps-tracking')?.enabled===true;
  const nav=settings.find(x=>x.id==='inspection-navigation');
  state.inspection=state.inspections.some(x=>x.id===nav?.inspection)?nav.inspection:state.inspections[0]?.id||null;
  state.selected=currentScope().areas.some(a=>a.id===nav?.area)?nav.area:currentScope().areas[0]?.id||null;
  await reload();if(state.gpsEnabled)refreshGPSWatch();if(navigator.storage?.estimate){const x=await navigator.storage.estimate();$('#storageInfo').textContent=`Device storage used: ${(x.usage/1024/1024).toFixed(1)} MB`}
 }catch(e){fail(e);$('#captureTitle').textContent='Device storage unavailable';$('#takePhoto').disabled=$('#takeVoice').disabled=true}
}


let areaActionTarget=null,deletingWorkingArea=false;
function areaRemovalBusy(){
 return !!(state.recording||recordOpening||cameraSession||pendingSaves||captureDrafts.size||queueRunning||transcriptionBusy);
}
function commitWorkingAreaDeletion(areaId,inspectionId,expectedEntryIds){
 return new Promise((resolve,reject)=>{
  const t=db.transaction(['areas','entries'],'readwrite');let area,entries,received=0,reason=null;
  const abort=message=>{reason=Error(message);t.abort()};
  const ready=()=>{
   if(++received!==2)return;
   if(!area||area.inspectionId!==inspectionId)return abort('This area is no longer in the selected inspection.');
   const records=entries.filter(entry=>entry.area===areaId),expected=new Set(expectedEntryIds);
   if(records.length!==expected.size||records.some(entry=>!expected.has(entry.id)))return abort('The records changed. Review the area and try deleting again.');
   for(const entry of records)t.objectStore('entries').delete(entry.id);
   t.objectStore('areas').delete(areaId);
  };
  t.objectStore('areas').get(areaId).onsuccess=event=>{area=event.target.result;ready()};
  t.objectStore('entries').getAll().onsuccess=event=>{entries=event.target.result;ready()};
  t.oncomplete=()=>resolve();t.onerror=()=>reject(reason||t.error);t.onabort=()=>reject(reason||t.error||Error('Area deletion cancelled'));
 });
}
async function openAreaActions(id){
 const area=state.areas.find(a=>a.id===id&&a.inspectionId===state.inspection);if(!area)return;
 areaActionTarget={id:area.id,inspectionId:area.inspectionId};
 $('#areaActionName').textContent=area.name;
 const entries=(await all('entries')).filter(e=>e.area===id),photos=entries.filter(e=>e.type==='photo').length,voice=entries.filter(e=>e.type==='voice').length;
 $('#areaActionSummary').textContent=entries.length?photos+' photos · '+voice+' voice notes. Deleting this area also deletes its saved records.':'Empty area.';
 if($('#areaPicker').open)$('#areaPicker').close();
 $('#areaActions').showModal();
}
async function deleteWorkingArea(){
 const target=areaActionTarget;if(!target||deletingWorkingArea)return;
 if(areaRemovalBusy())return toast('Finish the current capture, save or transcription before deleting an area.');
 deletingWorkingArea=true;$('#confirmAreaDelete').disabled=true;
 try{
  const area=state.areas.find(a=>a.id===target.id&&a.inspectionId===target.inspectionId);if(!area)return;
  const records=(await all('entries')).filter(e=>e.area===target.id);
  if(records.length&&!confirm('Permanently delete “'+area.name+'” and its '+records.filter(e=>e.type==='photo').length+' photos and '+records.filter(e=>e.type==='voice').length+' voice notes? This cannot be undone. Export first if you need a copy.'))return;
  if(areaRemovalBusy())return toast('A capture or transcription started. Try deleting again when it finishes.');
  await commitWorkingAreaDeletion(target.id,target.inspectionId,records.map(e=>e.id));
  if(state.selected===target.id)state.selected=null;
  $('#areaActions').close();areaActionTarget=null;await reload();await rememberInspection();toast('Working area deleted');
 }catch(error){fail(error)}finally{deletingWorkingArea=false;$('#confirmAreaDelete').disabled=false}
}
function initAreaActions(){
 const picker=$('#areas');let timer=null,press=null,suppressUntil=0;
 const clear=()=>{clearTimeout(timer);timer=null;press=null};
 const open=id=>{suppressUntil=Date.now()+1000;void openAreaActions(id).catch(fail)};
 picker.addEventListener('pointerdown',event=>{
  clear();if(event.button!==0)return;const button=event.target.closest('[data-area]');
  if(!button||['all','add'].includes(button.dataset.area))return;
  press={id:button.dataset.area,x:event.clientX,y:event.clientY};
  timer=setTimeout(()=>{const id=press?.id;clear();if(id)open(id)},550);
 });
 picker.addEventListener('pointermove',event=>{if(press&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>10)clear()});
 for(const event of ['pointerup','pointercancel','pointerleave','scroll'])picker.addEventListener(event,clear);
 picker.addEventListener('click',event=>{if(Date.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation()}},true);
 picker.addEventListener('contextmenu',event=>{
  const button=event.target.closest('[data-area]');if(!button||['all','add'].includes(button.dataset.area))return;
  event.preventDefault();clear();if(!$('#areaActions').open)open(button.dataset.area);
 });
 $('#confirmAreaDelete').onclick=deleteWorkingArea;
}


let recordLimit=12,recordSignature='',lastRecordMediaBusy=null;
function recordMediaBusy(){return !!(transcriptionBusy||queueRunning||state.entries.some(e=>e.transcriptionState==='processing'))}
function releaseRecordCards(){
 $('#entries').querySelectorAll('img').forEach(image=>image.removeAttribute('src'));
 $('#entries').replaceChildren();
 for(const url of state.urls)URL.revokeObjectURL(url);state.urls=[];
}
function renderRecords(){
 releaseRecordCards();
 $('#recordsMore').hidden=true;
 if($('#recordsPanel').hidden)return;
 if(!recordMediaBusy())resetWorker();
 const {areas,entries}=currentScope();
 const q=$('#search').value.toLowerCase();const signature=JSON.stringify([state.inspection,state.selected,state.filter,q]);if(signature!==recordSignature){recordSignature=signature;recordLimit=12;clearRecordSelection()}const list=entries.filter(e=>(!state.selected||e.area===state.selected)&&(state.filter==='all'||e.type===state.filter)&&(!q||(areaName(e.area)+' '+e.text).toLowerCase().includes(q))).sort((a,b)=>b.created-a.created);$('#recordsMore').hidden=list.length<=recordLimit;$('#entries').innerHTML=list.slice(0,recordLimit).map(e=>{let art;if(e.type==='photo'&&!recordMediaBusy()){const u=URL.createObjectURL(e.blob);state.urls.push(u);art=`<img src="${u}" alt="Photo in ${esc(areaName(e.area))}" loading="lazy">`}else if(e.type==='photo')art='<div class="photo-placeholder">Photo · preview after transcription</div>';else art='<div class="audioart" aria-hidden="true">'+[15,25,40,22,50,35,60,32,45,20,35,16].map(h=>`<i style="height:${h}px"></i>`).join('')+'</div>';return `<button class="card" data-entry="${esc(e.id)}"><span class="selection-check" aria-hidden="true"></span>${art}<div class="cardbody"><div class="cardhead"><b>${esc(areaName(e.area))}</b><span class="badge">${e.type==='photo'?'Photo':duration(e.duration)}</span></div><p class="${['queued','processing'].includes(e.transcriptionState)?'processing-label':''}">${esc(e.text||(e.type==='voice'?(e.transcriptionState==='queued'?'Queued…':e.transcriptionState==='processing'?'Transcribing…':e.transcriptionState==='failed'?'Tap to retry transcription':'Tap to listen'):'Photo'))}</p><small>${stamp(e.created)}</small><div style="margin-top:7px"><small>${e.gps?'● GPS saved · '+Math.round(e.gps.accuracy||0)+' m':e.exifGPS?'● Photo GPS retained':'○ No GPS saved'}</small></div></div></button>`}).join('')||'<div class="empty"><svg viewBox="0 0 24 24"><path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h3"/></svg><h3>'+ (q?'No matches':'Nothing here yet')+'</h3><p>'+(!state.inspection?'Name an inspection to get started.':!areas.length?'Add your first area.':'Add a photo or voice note.')+'</p></div>';
 renderRecordSelection();
}
function releaseDetailMedia(){
 const audio=$('#media audio');if(audio){audio.pause();audio.removeAttribute('src');audio.load()}
 $('#media').querySelectorAll('img').forEach(image=>image.removeAttribute('src'));
 $('#media').replaceChildren();
 if(detailURL)URL.revokeObjectURL(detailURL);detailURL=null;
}
function deferredDetailMedia(){
 releaseDetailMedia();const note=document.createElement('p');note.className='notice';note.textContent=recordMediaBusy()?'Photo and audio previews pause while transcription runs. You can still read this record.':'Media is ready to view.';
 const button=document.createElement('button');button.id='loadDetailMedia';button.type='button';button.textContent='Load media preview';button.disabled=recordMediaBusy();button.onclick=()=>{if(!recordMediaBusy()&&state.detail)renderDetailMedia(state.detail)};
 $('#media').append(note,button);
}
function renderDetailMedia(entry){
 releaseDetailMedia();
 if(recordMediaBusy()){deferredDetailMedia();return}
 resetWorker();detailURL=URL.createObjectURL(entry.blob);
 $('#media').innerHTML=entry.type==='photo'?'<img src="'+detailURL+'" alt="Original captured photo">':'<audio src="'+detailURL+'" controls preload="none"></audio>';
}
function syncRecordMediaPolicy(){
 const busy=recordMediaBusy();
 if(busy!==lastRecordMediaBusy){lastRecordMediaBusy=busy;if(busy&&$('#detail').open)deferredDetailMedia();renderRecords()}
 const preview=$('#loadDetailMedia');if(preview)preview.disabled=busy;
}
async function prepareRecordMemory(){
 syncRecordMediaPolicy();
 // Yield after clearing decoded images/audio before allocating inference buffers.
 await new Promise(resolve=>setTimeout(resolve,0));
}
$('#recordsMore').onclick=()=>{recordLimit+=12;renderRecords()};

let recordSelecting=false,recordMoveBusy=false,recordMoveContext=null;
const selectedRecordIds=new Set();
function clearRecordSelection(){recordSelecting=false;selectedRecordIds.clear();renderRecordSelection()}
function renderRecordSelection(){
 const scopeIds=new Set(currentScope().entries.map(entry=>entry.id));
 for(const id of selectedRecordIds)if(!scopeIds.has(id))selectedRecordIds.delete(id);
 $('#recordSelectionToolbar').hidden=!recordSelecting;
 $('#recordSelectionCount').textContent=selectedRecordIds.size+' selected';
 $('#moveSelectedRecords').disabled=!selectedRecordIds.size||recordMoveBusy;
 $('#selectRecords').textContent=recordSelecting?'Done':'Select';
 $('#selectRecords').setAttribute('aria-pressed',String(recordSelecting));
 $('#entries').classList.toggle('is-selecting',recordSelecting);
 for(const card of $('#entries').querySelectorAll('[data-entry]')){
  const selected=selectedRecordIds.has(card.dataset.entry);
  card.classList.toggle('record-selected',selected);
  if(recordSelecting)card.setAttribute('aria-pressed',String(selected));else card.removeAttribute('aria-pressed');
  const mark=card.querySelector('.selection-check');if(mark)mark.textContent=selected?'✓':'';
 }
}
function toggleRecordSelection(id){
 if(recordMoveBusy)return;
 recordSelecting=true;if(selectedRecordIds.has(id))selectedRecordIds.delete(id);else selectedRecordIds.add(id);
 renderRecordSelection();
}
function openRecordsMove(){
 if(!selectedRecordIds.size||recordMoveBusy)return;
 const areas=currentScope().areas.slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
 if(!areas.length)return toast('Create a reference area first.');
 recordMoveContext={ids:[...selectedRecordIds],inspectionId:state.inspection};
 $('#moveRecordsSummary').textContent='Move '+recordMoveContext.ids.length+' selected records. Photos, recordings, GPS and transcripts are retained.';
 $('#moveRecordsArea').innerHTML='<option value="">Choose reference area</option>'+areas.map(area=>'<option value="'+esc(area.id)+'">'+esc(area.name)+'</option>').join('');
 $('#moveRecordsError').hidden=true;$('#moveRecordsDialog').showModal();$('#moveRecordsArea').focus();
}
async function commitRecordsMove(event){
 event.preventDefault();const context=recordMoveContext,areaId=$('#moveRecordsArea').value;
 if(!context||!areaId||recordMoveBusy)return;
 recordMoveBusy=true;$('#commitRecordsMove').disabled=true;$('#cancelRecordsMove').disabled=true;renderRecordSelection();
 try{
  const count=await moveRecordsToArea(db,context.ids,areaId,context.inspectionId);
  $('#moveRecordsDialog').close();recordMoveContext=null;clearRecordSelection();await reload();
  toast(count+' records moved to '+areaName(areaId));
 }catch(error){$('#moveRecordsError').hidden=false;$('#moveRecordsError').textContent=error.message||'The records could not be moved.'}
 finally{recordMoveBusy=false;$('#commitRecordsMove').disabled=false;$('#cancelRecordsMove').disabled=false;renderRecordSelection()}
}
function initRecordSelection(){
 const entries=$('#entries');let press=null,timer=null,suppressClick=false;
 const clear=()=>{clearTimeout(timer);timer=null;press=null};
 const select=id=>{suppressClick=true;recordSelecting=true;selectedRecordIds.add(id);renderRecordSelection()};
 entries.addEventListener('pointerdown',event=>{
  clear();suppressClick=false;if(event.button!==0||recordMoveBusy)return;
  const card=event.target.closest('[data-entry]');if(!card)return;
  press={id:card.dataset.entry,x:event.clientX,y:event.clientY};
  timer=setTimeout(()=>{const id=press?.id;clear();if(id)select(id)},550);
 });
 entries.addEventListener('pointermove',event=>{if(press&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>10)clear()});
 for(const type of ['pointerup','pointercancel','pointerleave'])entries.addEventListener(type,clear);
 $('#recordsPanel').addEventListener('scroll',clear,{passive:true});
 entries.addEventListener('click',event=>{if(suppressClick){suppressClick=false;event.preventDefault();event.stopImmediatePropagation()}},true);
 entries.addEventListener('contextmenu',event=>{const card=event.target.closest('[data-entry]');if(!card)return;event.preventDefault();clear();select(card.dataset.entry)});
 $('#selectRecords').onclick=()=>{if(recordSelecting)clearRecordSelection();else{recordSelecting=true;renderRecordSelection()}};
 $('#selectShownRecords').onclick=()=>{for(const card of entries.querySelectorAll('[data-entry]'))selectedRecordIds.add(card.dataset.entry);renderRecordSelection()};
 $('#moveSelectedRecords').onclick=openRecordsMove;$('#moveRecordsForm').onsubmit=commitRecordsMove;
 $('#moveRecordsDialog').addEventListener('cancel',event=>{if(recordMoveBusy)event.preventDefault()});
}

async function mergeReferenceAreas(){
 const plan=await mergeAreaGroups(db);
 if(state.selected&&plan.aliases[state.selected])state.selected=plan.aliases[state.selected];
 return plan;
}
