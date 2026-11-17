import {captureMapPoints,captureMapIcons} from './capture-map.js';
import {gpsAreaIndex,gpsAreaStatus} from './gps-area.js';
import {annexAreaName} from './area-groups.js';
import {assetDetails,assetValue,presentAssetValue,overallBand,collectAnnexReferences,missingGISAreaNames} from './asset-data.js';
let gisMap=null,gisLayers=[],gisGPS=null,gisRecord=null,gisWorker=null,gisPending=null,gisFile=null,gisScan=null,gisBusy=false,gisTimer=null,gisLibraries=null,gisMode='geographic',gisRun=0;
const GIS_CACHE='fieldnote-gis-runtime-2.8.1';
const gisStatus=text=>{$('#gisStatus').textContent=text};
function gisSetBusy(value){gisBusy=value;$('#gisLoad').disabled=value;$('#gisDemo').disabled=value;$('#gisPrepare').disabled=value;$('#gisOpenDataset').disabled=value;$('#gisCancel').hidden=!value}
function gisDiagnostics(error){
 const report={app:'Fieldnote GIS test',reader:'GDAL 3 / OpenFileGDB via gdal3.js 2.8.1',source:gisFile?.name||gisRecord?.sourceName||null,archive:gisScan||gisRecord?.archive||null,driver:gisRecord?.driver||null,layers:gisRecord?.details||[],warnings:gisRecord?.warnings||[],error:error||null,log:gisRecord?.log||[]};
 $('#gisDiagnostics').textContent=JSON.stringify(report,null,2);
}
async function gisScript(path){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL(path,appBase);s.onload=resolve;s.onerror=()=>reject(Error('Map library unavailable. Reopen online to update the offline app.'));document.head.append(s)})}
async function gisLibrariesReady(){if(!gisLibraries)gisLibraries=gisScript('./gis/leaflet.js').catch(e=>{gisLibraries=null;throw e});await gisLibraries}
async function gisRuntimeReady(){
 const manifest=await (await fetch(new URL('./gis-runtime.json',appBase))).json(),cache=await caches.open(GIS_CACHE);
 for(const file of manifest.files){const key=new URL(file.path,appBase).href,response=await cache.match(key);if(!response||response.headers.get('x-fieldnote-sha256')!==file.sha256)return false;const chunks=Number(response.headers.get('x-fieldnote-chunks')||0);for(let i=0;i<chunks;i++)if(!await cache.match(key+'?chunk='+i))return false}
 return true;
}
async function prepareGIS(allowOnlineFallback=false,run=null){
 if(await gisRuntimeReady()){gisStatus('GIS tools are ready offline. Choose your ZIP.');return true}
 const manifest=await (await fetch(new URL('./gis-runtime.json',appBase))).json(),cache=await caches.open(GIS_CACHE);
 let complete=0;
 try{
  for(const file of manifest.files){
   if(run!==null&&run!==gisRun)throw Error('Import cancelled.');
   const key=new URL(file.path,appBase).href,cached=await cache.match(key);
   let completeFile=cached?.headers.get('x-fieldnote-sha256')===file.sha256;if(completeFile)for(let i=0;i<Number(cached.headers.get('x-fieldnote-chunks')||0);i++)if(!await cache.match(key+'?chunk='+i)){completeFile=false;break}if(completeFile){complete+=file.size;continue}
   gisStatus('Preparing offline GIS tools · '+mb(complete)+' / '+mb(manifest.bytes));
   const response=await fetch(key);if(!response.ok)throw Error('GIS tools could not download. Open this tab online once.');
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(run!==null&&run!==gisRun)throw Error('Import cancelled.');
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(bytes.length!==file.size||digest!==file.sha256)throw Error('GIS tool download was incomplete. Try preparing again.');
   const headers={'Content-Type':file.path.endsWith('.js')?'text/javascript':'application/octet-stream','x-fieldnote-size':String(file.size),'x-fieldnote-sha256':digest};
   const size=4*1024*1024;
   if(bytes.length>size){const count=Math.ceil(bytes.length/size);for(let i=0;i<count;i++)await cache.put(key+'?chunk='+i,new Response(bytes.slice(i*size,(i+1)*size)));headers['x-fieldnote-chunks']=String(count);await cache.put(key,new Response('',{headers}))}
   else await cache.put(key,new Response(bytes,{headers}));
   complete+=file.size;
  }
  gisStatus('GIS tools saved for offline use.');return true;
 }catch(error){
  if(error.name==='QuotaExceededError'){
   await caches.delete(GIS_CACHE);
   if(allowOnlineFallback&&navigator.onLine){gisStatus('Offline storage limit reached. The reader can run online; your GIS data stays on this phone.');return false}
   throw Error('Not enough browser storage for offline GIS tools. Free an unused speech model in Settings, then prepare GIS again.');
  }
  throw error;
 }
}
function resetGISWorker(){gisRun++;gisWorker?.terminate();gisWorker=null;clearTimeout(gisTimer);if(gisPending){gisPending.reject(Error('Import cancelled.'));gisPending=null}}
function gisCall(action,data={},transfer=[]){
 if(gisPending)return Promise.reject(Error('A GIS operation is already running.'));
 if(!gisWorker){
  gisWorker=new Worker(new URL('./gis-worker.js',appBase));
  gisWorker.onmessage=event=>{
   const result=event.data;if(result.type==='progress'){gisStatus(result.text);return}
   if(!gisPending)return;const current=gisPending;gisPending=null;clearTimeout(gisTimer);
   if(result.type==='error'){gisDiagnostics(result.message);current.reject(Error(result.message))}else current.resolve(result);
  };
  gisWorker.onerror=e=>{const current=gisPending;gisPending=null;clearTimeout(gisTimer);gisWorker?.terminate();gisWorker=null;current?.reject(Error(e.message||'GIS worker stopped. Try a smaller ZIP.'))};
 }
 return new Promise((resolve,reject)=>{gisPending={resolve,reject};gisTimer=setTimeout(()=>{resetGISWorker();gisStatus('Import timed out. Try fewer GIS layers.');gisSetBusy(false)},180000);gisWorker.postMessage({action,...data},transfer)});
}
async function scanGIS(file){
 resetGISWorker();gisFile=file;gisScan=null;gisSetBusy(true);gisStatus('Checking ZIP contents locally…');
 try{
  if(file.size>100*1024*1024)throw Error('This test accepts ZIPs up to 100 MB. Try a smaller GIS export.');
  const bytes=await file.arrayBuffer(),result=await gisCall('scan',{bytes},[bytes]);gisScan=result.diagnostics;
  $('#gisDataset').innerHTML=result.datasets.map(x=>`<option value="${esc(x.key)}">${esc(x.label)} (${x.files} files)</option>`).join('');
  $('#gisDatasetRow').hidden=false;gisDiagnostics();
  await loadGISDataset();
 }catch(error){gisStatus('Could not import: '+error.message);gisDiagnostics(error.message);gisSetBusy(false)}
}
async function loadGISDataset(){
 if(!gisFile||!gisWorker)return;const run=gisRun;gisSetBusy(true);
 try{
  const offline=await prepareGIS(true,run);if(run!==gisRun)return;const result=await gisCall('load',{key:$('#gisDataset').value,sourceCRS:$('#gisSourceCRS').value.trim()});
  if(run!==gisRun)return;
  const record={id:'layout',sourceName:gisFile.name,imported:Date.now(),archive:gisScan,...result.result};gisRecord=record;gisMode=record.viewMode;
  $('#gisSourceName').textContent=record.sourceName;gisDiagnostics();await showAppView('journal');await drawGIS(true);
  try{await put('gis',record);await syncGISAreas();gisStatus('Loaded '+record.layers.length+' layers · '+record.featureCount.toLocaleString()+' features. Saved on this phone.'+(offline?'':' GIS reader needs internet for another import until offline tools are prepared.'))}catch(error){gisStatus('Layout displayed but not saved: '+error.message+'. Keep the ZIP to reimport.')}
  $('#gisWarnings').textContent=record.warnings.join('\n');$('#gisWarnings').hidden=!record.warnings.length;
  // Release the GDAL heap after import; this does not affect the rendered map or stored geometry.
  gisWorker?.terminate();gisWorker=null;
 }catch(error){gisStatus('Could not read layout: '+error.message);gisDiagnostics(error.message)}finally{gisSetBusy(false)}
}
function gisPopup(feature,layerName){
 const box=document.createElement('div'),title=document.createElement('strong');title.textContent=layerName;box.append(title);
 const entries=Object.entries(feature.properties||{}).slice(0,50);
 for(const [key,value] of entries){const row=document.createElement('div'),label=document.createElement('b');label.textContent=key+': ';row.append(label,document.createTextNode((typeof value==='object'?JSON.stringify(value):String(value??'')).slice(0,500)));box.append(row)}
 if(!entries.length)box.append(document.createTextNode('No attributes.'));return box;
}
const GIS_COLOURS=['#27715c','#407ba9','#bd7d28','#9972aa','#ba5c55','#5a8d88','#7c8c3b','#585e9b'];
const RAG_COLOURS={grey:'#89918b',red:'#ba655f',amber:'#bc9647',green:'#679477'};
let gisSelectedShape=null,gisSelectedAsset=null,gisLabelCanvas=null,gisLabelFrame=0;
function gisShapeStyle(feature,selected=false){
 const reference=assetValue(feature.properties,'ANNEX_A6_LABELS');
 const band=presentAssetValue(reference)?overallBand(assetValue(feature.properties,'aosOverallRAG')):'grey',colour=RAG_COLOURS[band];
 return {color:colour,weight:selected?3:1.5,fillColor:colour,fillOpacity:selected?.34:.16,opacity:selected?1:.8};
}
function selectGISAsset(feature,shape,layerName,activateArea=true){
 if(gisSelectedShape)gisSelectedShape.setStyle(gisShapeStyle(gisSelectedShape.feature));
 gisSelectedShape=shape;gisSelectedAsset=assetDetails(feature.properties);shape.setStyle(gisShapeStyle(feature,true));
 const asset=gisSelectedAsset,box=$('#featurePanel');box.replaceChildren();
 const heading=document.createElement('div');heading.className='feature-heading';
 const title=document.createElement('strong');title.textContent=asset.name||asset.reference||layerName;heading.append(title);
 if(asset.reference){const use=document.createElement('button');use.className='textbtn';use.textContent='Work in '+annexAreaName(asset.reference);use.onclick=()=>useGISArea(asset.reference);heading.append(use)}
 const close=document.createElement('button');close.className='textbtn';close.textContent='✕';close.setAttribute('aria-label','Clear selected shape');close.onclick=clearGISAsset;heading.append(close);box.append(heading);
 if(asset.reference){const reference=document.createElement('small');reference.className='feature-reference';reference.textContent=asset.reference;box.append(reference)}
 const details=document.createElement('div');details.className='asset-fields';
 for(const field of asset.fields){const row=document.createElement('div'),label=document.createElement('span'),value=document.createElement('span');label.className='asset-field-label';label.textContent=field.label;value.textContent=String(field.value);row.append(label,value);details.append(row)}
 if(!asset.fields.length){const empty=document.createElement('small');empty.textContent='No listed asset details.';details.append(empty)}
 box.append(details);
 if(asset.scores.length){const scores=document.createElement('div');scores.className='asset-scores';scores.setAttribute('aria-label','Condition ratings: 0 grey, 1 red, 2 to 3 amber, 4 to 5 green');
 for(const score of asset.scores){const cell=document.createElement('div');cell.className='asset-score rag-'+score.band;cell.title=score.label+': '+score.value+' ('+score.band+')';const label=document.createElement('span'),value=document.createElement('b');label.textContent=score.label;value.textContent=String(score.value);cell.append(label,value);scores.append(cell)}box.append(scores)}
 requestAnimationFrame(()=>gisMap?.invalidateSize());
 if(activateArea&&asset.reference)void useGISArea(asset.reference);
}
function clearGISAsset(){
 if(gisSelectedShape)gisSelectedShape.setStyle(gisShapeStyle(gisSelectedShape.feature));
 gisSelectedShape=null;gisSelectedAsset=null;$('#featurePanel').innerHTML='<div class="feature-empty">Tap an airfield shape to see its details.</div>';requestAnimationFrame(()=>gisMap?.invalidateSize());
}
let gisAreaSelection=0;
async function useGISArea(name){
 const selection=++gisAreaSelection,inspectionId=state.inspection;
 if(!state.inspection){toast('Name an inspection first.');return editInspection()}
 const title=annexAreaName(name);if(!title)return;
 try{let area=currentScope().areas.find(x=>x.name.toLowerCase()===title.toLowerCase());
 if(!area){state.selected=null;render();area={id:uid(),name:title,inspectionId};await put('areas',area);state.areas.push(area)}
 if(selection!==gisAreaSelection||state.inspection!==inspectionId)return;
 state.selected=area.id;render();await rememberInspection();
 }catch(error){fail(error)}
}
function queueGISLabels(){cancelAnimationFrame(gisLabelFrame);gisLabelFrame=requestAnimationFrame(drawGISLabels)}
function drawGISLabels(){
 if(!gisMap||!gisLabelCanvas||$('#journalPanel').hidden)return;
 const size=gisMap.getSize(),dpr=Math.min(window.devicePixelRatio||1,2),canvas=gisLabelCanvas;
 canvas.width=Math.round(size.x*dpr);canvas.height=Math.round(size.y*dpr);canvas.style.width=size.x+'px';canvas.style.height=size.y+'px';
 const context=canvas.getContext('2d');context.scale(dpr,dpr);const zoom=gisMap.getZoom(),fontSize=Math.max(10,Math.min(16,10+(zoom-14)*.8));
 context.font='600 '+fontSize+'px system-ui';context.textAlign='center';context.textBaseline='middle';context.lineJoin='round';context.lineWidth=3;
 const occupied=[],view=gisMap.getBounds();let count=0;
 for(const group of gisLayers){if(!group||!gisMap.hasLayer(group))continue;
  for(const shape of group.getLayers()){
   const rawReference=assetValue(shape.feature?.properties,'ANNEX_A6_LABELS');if(!presentAssetValue(rawReference))continue;const reference=String(rawReference);
   const bounds=shape.getBounds?.(),centre=bounds?bounds.getCenter():shape.getLatLng?.();if(!centre||!view.contains(centre))continue;
   if(bounds){const a=gisMap.latLngToContainerPoint(bounds.getNorthWest()),b=gisMap.latLngToContainerPoint(bounds.getSouthEast());if(Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y))<fontSize*2)continue}
   else if(gisMode==='geographic'&&zoom<14)continue;
   const point=gisMap.latLngToContainerPoint(centre),width=context.measureText(reference.slice(0,80)).width+8,height=fontSize+7,rect={x:point.x-width/2,y:point.y-height/2,w:width,h:height};
   if(occupied.some(r=>r.x<rect.x+rect.w&&r.x+r.w>rect.x&&r.y<rect.y+rect.h&&r.y+r.h>rect.y))continue;
   occupied.push(rect);context.strokeStyle='#ffffffdd';context.fillStyle='#243c32';context.strokeText(reference.slice(0,80),point.x,point.y);context.fillText(reference.slice(0,80),point.x,point.y);
   if(++count>=400)return;
  }
 }
}
async function drawGIS(fit=false){
 await gisLibrariesReady();
 gisGPSAreaIndex=gpsAreaIndex(gisRecord?.layers);updateGPSAreaButton();
 cancelAnimationFrame(gisLabelFrame);cancelAnimationFrame(gisCaptureFrame);gisLabelCanvas?.remove();gisCaptureCanvas?.remove();gisLabelCanvas=null;gisCaptureCanvas=null;
 if(gisMap){gisMap.remove();gisMap=null}gisLayers=[];gisGPS=null;gisSelectedShape=null;gisSelectedAsset=null;
 const L=window.L,geo=gisMode==='geographic';
 gisMap=L.map('gisMap',{crs:geo?L.CRS.EPSG3857:L.CRS.Simple,preferCanvas:true,minZoom:geo?1:-25,maxZoom:geo?24:15,attributionControl:true,zoomControl:true});
 gisMap.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
 L.control.scale({imperial:false}).addTo(gisMap);
 const layers=gisRecord?.layers||[];
 $('#gisViewMode').value=gisMode;$('#gisLocate').disabled=!geo||!layers.length;
 $('#gisLayerList').innerHTML=layers.map((layer,i)=>'<label class="gis-layer"><input type="checkbox" data-layer="'+i+'" '+(layer.visible!==false?'checked':'')+' '+(layer.mode!==gisMode?'disabled':'')+'><span class="gis-swatch" style="background:'+GIS_COLOURS[i%GIS_COLOURS.length]+'"></span><span>'+esc(layer.name)+'<small>'+layer.features.toLocaleString()+' features'+(layer.mode!==gisMode?' · other coordinate view':'')+'</small></span></label>').join('');
 $('#gisLayerCount').textContent='Layers ('+layers.length+')';
 for(let i=0;i<layers.length;i++){
  const item=layers[i];if(item.mode!==gisMode){gisLayers[i]=null;continue}
  const group=L.geoJSON(item.geojson,{style:feature=>gisShapeStyle(feature),pointToLayer:(feature,latlng)=>L.circleMarker(latlng,{radius:5,...gisShapeStyle(feature)}),onEachFeature:(feature,shape)=>shape.on('click',()=>selectGISAsset(feature,shape,item.name))});
  gisLayers[i]=group;if(item.visible!==false)group.addTo(gisMap);
 }
 gisMap.setView([0,0],geo?2:0);if(fit)fitGIS();
 $('#gisMapNote').textContent=geo?(layers.length?'Tap a shape · labels appear as you zoom':'Load your airfield in the GIS tab'):'Local XY · GPS alignment unavailable';
 $('#gisMap').classList.toggle('gis-local',!geo);
 gisLabelCanvas=document.createElement('canvas');gisLabelCanvas.className='gis-labels';gisLabelCanvas.setAttribute('aria-hidden','true');gisMap.getContainer().append(gisLabelCanvas);
 gisMap.on('move zoom resize layeradd layerremove',queueGISLabels);
 gisCaptureCanvas=document.createElement('canvas');gisCaptureCanvas.className='gis-capture-icons';gisCaptureCanvas.setAttribute('aria-hidden','true');gisMap.getContainer().append(gisCaptureCanvas);
 gisMap.on('move zoom resize',queueGISCaptureIcons);updateGISCaptureIcons();
 clearGISAsset();updateGISPosition(snapshotGPS());setTimeout(()=>{gisMap?.invalidateSize();queueGISLabels()},0);
}
function fitGIS(){
 if(!gisMap)return;const L=window.L,bounds=L.latLngBounds([]);
 for(const layer of gisLayers)if(layer&&gisMap.hasLayer(layer)&&layer.getBounds().isValid())bounds.extend(layer.getBounds());
 if(bounds.isValid())gisMap.fitBounds(bounds,{padding:[20,20],maxZoom:gisMode==='geographic'?20:10});
}
function updateGISPosition(gps,pan=false){
 if(!gisMap||gisMode!=='geographic')return;
 if(!gps){if(gisGPS){gisMap.removeLayer(gisGPS);gisGPS=null}return}
 const L=window.L,point=[gps.latitude,gps.longitude],radius=Math.max(2,gps.accuracy);
 if(gisGPS)gisGPS.setLatLng(point).setRadius(radius);
 else gisGPS=L.circle(point,{radius,color:'#1473cf',weight:2,fillOpacity:.15}).addTo(gisMap);
 gisGPS.bindPopup('Device position · accuracy ±'+Math.round(gps.accuracy)+' m');
 if(pan){gisMap.panTo(point);gisGPS.openPopup()}
}
async function locateGIS(){
 if(gisMode!=='geographic')return;
 const gps=await fix();if(!gps)return toast('GPS unavailable. Allow location and try again outdoors.');
 updateGISPosition(gps,true);
}
async function showAppView(view){
 if(!$('#recordsPanel').hidden)closeRecordsView();
 $('#journalPanel').hidden=view!=='journal';$('#gisPanel').hidden=view!=='gis';
 document.querySelectorAll('[data-app-view]').forEach(button=>{const active=button.dataset.appView===view;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});
 if(view!=='journal')return;
 try{
  if(!gisRecord){gisRecord=await tx('gis','readonly',store=>store.get('layout'));if(gisRecord){gisMode=gisRecord.viewMode||'geographic';$('#gisSourceName').textContent=gisRecord.sourceName;$('#gisWarnings').textContent=(gisRecord.warnings||[]).join('\n');$('#gisWarnings').hidden=!gisRecord.warnings?.length;gisDiagnostics();gisStatus('Saved layout · '+gisRecord.layers.length+' layers · '+gisRecord.featureCount.toLocaleString()+' features.')}}
  if(!gisMap)await drawGIS(!!gisRecord);gisMap.invalidateSize();queueGISLabels();queueGISCaptureIcons();await syncGISAreas();await showGISWorkingArea(state.selected,false);
 }catch(error){gisStatus(error.message);toast(error.message)}
}
function renderCaptureDock(){
 updateGISCaptureIcons();
 const scope=currentScope(),selected=state.areas.find(x=>x.id===state.selected);
 $('#currentArea').textContent=selected?selected.name:'＋ Area';$('#currentArea').title=selected?'Working area: '+selected.name:'Choose or create a working area';
 updateGPSAreaButton();
 $('#recordsCount').textContent=scope.entries.filter(e=>!state.selected||e.area===state.selected).length;
 $('#editWorkingArea').hidden=!state.selected;
}
function showRecordsView(){
 if(!$('#recordsPanel').hidden)return;
 $('#recordsPanel').hidden=false;document.body.classList.add('records-open');render();
 history.pushState({...history.state,fieldnoteRecords:true},'');$('#closeRecords').focus();
}
function hideRecordsView(){
 clearRecordSelection();
 releaseRecordCards();
 $('#recordsPanel').hidden=true;document.body.classList.remove('records-open');gisMap?.invalidateSize();queueGISLabels();
}
function closeRecordsView(){
 if(history.state?.fieldnoteRecords)history.back();else hideRecordsView();
}
function initCaptureLayout(){
 initAreaActions();initRecordSelection();
 $('#currentArea').onclick=()=>{if(!state.inspection)return editInspection();$('#areaPicker').showModal()};
 $('#editWorkingArea').onclick=()=>{$('#areaPicker').close();areaEdit(true)};
 $('#areas').addEventListener('click',event=>{if(event.target.closest('[data-area]'))$('#areaPicker').close()});
 $('#openRecords').onclick=showRecordsView;$('#closeRecords').onclick=closeRecordsView;
 window.addEventListener('popstate',()=>{if(!history.state?.fieldnoteRecords)hideRecordsView();else{$('#recordsPanel').hidden=false;document.body.classList.add('records-open')}});
 // Track nested details so Android Back closes the detail before leaving Records.
 let detailHasHistory=false,closingFromHistory=false;
 const observer=new MutationObserver(()=>{
  if($('#detail').open&&!detailHasHistory){history.pushState({...history.state,fieldnoteDetail:true},'');detailHasHistory=true}
  else if(!$('#detail').open&&detailHasHistory){detailHasHistory=false;if(!closingFromHistory&&history.state?.fieldnoteDetail)history.back();closingFromHistory=false}
 });
 observer.observe($('#detail'),{attributes:true,attributeFilter:['open']});
 window.addEventListener('popstate',()=>{if($('#detail').open&&!history.state?.fieldnoteDetail){closingFromHistory=true;$('#detail').close()}});
 if(history.state?.fieldnoteRecords){$('#recordsPanel').hidden=false;document.body.classList.add('records-open')}
 renderCaptureDock();
}
function initGIS(){
 initCaptureLayout();
 // Remove the retired imagery credential from device settings.
 void tx('settings','readwrite',store=>store.delete('gis-imagery')).catch(fail);
 document.querySelectorAll('[data-app-view]').forEach(b=>b.onclick=()=>showAppView(b.dataset.appView));
 $('#gisLoad').onclick=()=>$('#gisFile').click();$('#gisFile').onchange=async()=>{const file=$('#gisFile').files[0];if(file)await scanGIS(file);$('#gisFile').value=''};
 $('#gisDemo').onclick=async()=>{try{const response=await fetch(new URL('./gis-demo.gdb.zip',appBase));if(!response.ok)throw Error('Demo unavailable; reopen online.');await scanGIS(new File([await response.blob()],'Synthetic-airfield.gdb.zip',{type:'application/zip'}))}catch(error){gisStatus(error.message)}};
 $('#gisPrepare').onclick=async()=>{gisSetBusy(true);try{await prepareGIS(false)}catch(error){gisStatus(error.message)}finally{gisSetBusy(false)}};
 $('#gisOpenDataset').onclick=async()=>{if(!gisFile)return;gisSetBusy(true);try{const key=$('#gisDataset').value;const bytes=await gisFile.arrayBuffer();await gisCall('scan',{bytes},[bytes]);$('#gisDataset').value=key;await loadGISDataset()}catch(error){gisStatus(error.message)}finally{gisSetBusy(false)}};
 $('#gisCancel').onclick=()=>{resetGISWorker();gisSetBusy(false);gisStatus('Import cancelled. The previous saved layout is unchanged.')};
 $('#gisFit').onclick=fitGIS;$('#gisLocate').onclick=locateGIS;
 $('#gisViewMode').onchange=async()=>{gisMode=$('#gisViewMode').value;await showAppView('journal');await drawGIS(true)};
 $('#gisLayerList').onchange=e=>{const index=Number(e.target.dataset.layer);if(!Number.isInteger(index)||!gisLayers[index])return;gisRecord.layers[index].visible=e.target.checked;if(e.target.checked)gisLayers[index].addTo(gisMap);else gisMap.removeLayer(gisLayers[index]);queueGISLabels();void put('gis',gisRecord).catch(()=>{})};
 $('#gisReport').onclick=()=>download(new Blob([$('#gisDiagnostics').textContent],{type:'application/json'}),'Fieldnote-GIS-diagnostic.json');
}


const gisAreaSyncs=new Map();
function syncGISAreas(){
 const inspectionId=state.inspection,record=gisRecord;if(!inspectionId||!record)return Promise.resolve(0);
 const key=inspectionId+':'+record.imported;if(gisAreaSyncs.has(key))return gisAreaSyncs.get(key);
 const work=(async()=>{
  const references=collectAnnexReferences(record.layers);
  const added=await new Promise((resolve,reject)=>{
   const t=db.transaction(['areas','settings'],'readwrite'),markerId='gis-area-import:'+inspectionId;let areas,marker,received=0,count=0;
   const ready=()=>{
    if(++received!==2)return;
    if(marker?.imported===record.imported&&marker?.referenceVersion===2)return;
    const names=missingGISAreaNames(references,areas,inspectionId);count=names.length;
    for(const name of names)t.objectStore('areas').put({id:uid(),name,inspectionId});
    t.objectStore('settings').put({id:markerId,imported:record.imported,referenceVersion:2});
   };
   t.objectStore('areas').getAll().onsuccess=e=>{areas=e.target.result;ready()};
   t.objectStore('settings').get(markerId).onsuccess=e=>{marker=e.target.result;ready()};
   t.oncomplete=()=>resolve(count);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('GIS areas could not be saved'));
  });
  if(added)await reload();return added;
 })().finally(()=>gisAreaSyncs.delete(key));
 gisAreaSyncs.set(key,work);return work;
}
async function showGISWorkingArea(id,pan=true){
 if(!gisMap||!gisRecord)return;
 const area=state.areas.find(area=>area.id===id&&area.inspectionId===state.inspection);
 if(!area){clearGISAsset();return}
 const reference=annexAreaName(area.name).toLowerCase(),matches=[];
 for(let i=0;i<gisLayers.length;i++){
  const group=gisLayers[i];if(!group)continue;
  for(const shape of group.getLayers()){
   const raw=assetValue(shape.feature?.properties,'ANNEX_A6_LABELS');
   if(presentAssetValue(raw)&&annexAreaName(raw).toLowerCase()===reference)matches.push({shape,name:gisRecord.layers[i].name});
  }
 }
 if(!matches.length){clearGISAsset();return}
 if(matches.length===1){
  const {shape,name}=matches[0];selectGISAsset(shape.feature,shape,name,false);
  if(pan){const bounds=shape.getBounds?.();if(bounds?.isValid())gisMap.panTo(bounds.getCenter());else if(shape.getLatLng)gisMap.panTo(shape.getLatLng())}
  return;
 }
 clearGISAsset();
 const heading=document.createElement('strong'),description=document.createElement('p');
 heading.textContent=area.name;description.className='muted';description.textContent=matches.length+' assets · Tap a shape to view its individual details.';
 $('#featurePanel').replaceChildren(heading,description);
 if(pan){const bounds=window.L.latLngBounds([]);for(const {shape} of matches){if(shape.getBounds)bounds.extend(shape.getBounds());else if(shape.getLatLng)bounds.extend(shape.getLatLng())}if(bounds.isValid())gisMap.fitBounds(bounds,{padding:[20,20],maxZoom:gisMode==='geographic'?20:10})}
 requestAnimationFrame(()=>gisMap?.invalidateSize());
}

let gisCaptureCanvas=null,gisCaptureFrame=0,gisCapturePoints=[];
let gisGPSAreaIndex=[],gisGPSAreaExpiry=null;
function currentGPSArea(){
 const selected=currentScope().areas.find(area=>area.id===state.selected);
 return gpsAreaStatus(gisMode==='geographic'&&!document.hidden?gisGPSAreaIndex:[],snapshotGPS(),selected?.name);
}
function updateGPSAreaButton(){
 const result=currentGPSArea(),button=$('#currentArea'),selected=state.areas.find(area=>area.id===state.selected);
 button.dataset.gpsState=result.status;
 const message=result.status==='match'?'GPS matches '+result.areaName:result.status==='different'?'GPS suggests '+result.areaName+' · different working area':'GPS area uncertain';
 button.title=(selected?'Working area: '+selected.name+' · ':'')+message;
 button.setAttribute('aria-description',message);
 clearTimeout(gisGPSAreaExpiry);
 if(result.status!=='unknown')gisGPSAreaExpiry=setTimeout(updateGPSAreaButton,Math.max(1,state.gps.timestamp+15000-Date.now()));
}
function checkPhotoArea(){
 const result=currentGPSArea();
 if(result.status!=='different')return;
 const area=currentScope().areas.find(area=>annexAreaName(area.name)===result.areaName);
 if(!area)return;
 if(!confirm('GPS suggests you are in '+area.name+', but your working area is '+areaName(state.selected)+'. Switch to '+area.name+' before taking the photo?\n\nCancel keeps your current working area.'))return;
 state.selected=area.id;render();void rememberInspection().catch(fail);void showGISWorkingArea(area.id,false).catch(fail);
}
function updateGISCaptureIcons(){
 gisCapturePoints=captureMapPoints(currentScope().entries);queueGISCaptureIcons();
 const legend=$('#gisRecordLegend');if(legend)legend.hidden=gisMode!=='geographic';
}
function queueGISCaptureIcons(){cancelAnimationFrame(gisCaptureFrame);gisCaptureFrame=requestAnimationFrame(drawGISCaptureIcons)}
function drawGISCaptureIcons(){
 if(!gisMap||!gisCaptureCanvas)return;
 const size=gisMap.getSize(),dpr=Math.min(window.devicePixelRatio||1,2),canvas=gisCaptureCanvas,width=Math.round(size.x*dpr),height=Math.round(size.y*dpr);
 if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;canvas.style.width=size.x+'px';canvas.style.height=size.y+'px'}
 const context=canvas.getContext('2d');context.setTransform(dpr,0,0,dpr,0,0);context.clearRect(0,0,size.x,size.y);
 if(gisMode!=='geographic'||$('#journalPanel').hidden)return;
 const icons=captureMapIcons(gisCapturePoints,point=>gisMap.latLngToContainerPoint([point.latitude,point.longitude]),size.x,size.y);
 for(const icon of icons)drawCaptureIcon(context,icon.x,icon.y,icon.type);
}
function drawCaptureIcon(context,x,y,type){
 const colour=type==='photo'?'#247bb1':'#8b57aa';
 context.save();context.translate(x,y);context.scale(.75,.75);context.fillStyle='#ffffff';context.strokeStyle=colour;context.lineWidth=1.5;context.beginPath();context.arc(0,0,8,0,Math.PI*2);context.fill();context.stroke();
 context.lineWidth=1.3;context.lineJoin='round';context.lineCap='round';
 if(type==='photo'){
  context.beginPath();context.moveTo(-5,-3);context.lineTo(-2,-3);context.lineTo(-1,-4.5);context.lineTo(2,-4.5);context.lineTo(3,-3);context.lineTo(5,-3);context.lineTo(5,4);context.lineTo(-5,4);context.closePath();context.stroke();context.beginPath();context.arc(0,.5,2.2,0,Math.PI*2);context.stroke();
 }else{
  context.beginPath();context.moveTo(-1.8,-4);context.bezierCurveTo(-1.8,-6,1.8,-6,1.8,-4);context.lineTo(1.8,0);context.bezierCurveTo(1.8,2,-1.8,2,-1.8,0);context.closePath();context.stroke();context.beginPath();context.moveTo(-4,-.5);context.bezierCurveTo(-4,5,4,5,4,-.5);context.moveTo(0,3.5);context.lineTo(0,5.5);context.moveTo(-2,5.5);context.lineTo(2,5.5);context.stroke();
 }

 context.restore();
}
