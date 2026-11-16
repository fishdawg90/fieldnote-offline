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
  $('#gisSourceName').textContent=record.sourceName;gisDiagnostics();await drawGIS(true);
  try{await put('gis',record);gisStatus('Loaded '+record.layers.length+' layers · '+record.featureCount.toLocaleString()+' features. Saved on this phone.'+(offline?'':' GIS reader needs internet for another import until offline tools are prepared.'))}catch(error){gisStatus('Layout displayed but not saved: '+error.message+'. Keep the ZIP to reimport.')}
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
async function drawGIS(fit=false){
 await gisLibrariesReady();
 if(gisMap){gisMap.remove();gisMap=null}gisLayers=[];gisGPS=null;
 const L=window.L,geo=gisMode==='geographic';
 gisMap=L.map('gisMap',{crs:geo?L.CRS.EPSG3857:L.CRS.Simple,preferCanvas:true,minZoom:geo?1:-25,maxZoom:geo?24:15,attributionControl:true,zoomControl:true});
 gisMap.attributionControl.setPrefix('Leaflet · local GIS');
 L.control.scale({imperial:false}).addTo(gisMap);
 const layers=gisRecord?.layers||[];
 $('#gisViewMode').value=gisMode;$('#gisLocate').disabled=!geo||!layers.length;
 $('#gisLayerList').innerHTML=layers.map((layer,i)=>`<label class="gis-layer"><input type="checkbox" data-layer="${i}" ${layer.visible!==false?'checked':''} ${layer.mode!==gisMode?'disabled':''}><span class="gis-swatch" style="background:${GIS_COLOURS[i%GIS_COLOURS.length]}"></span><span>${esc(layer.name)}<small>${layer.features.toLocaleString()} features${layer.mode!==gisMode?' · other coordinate view':''}</small></span></label>`).join('');
 $('#gisLayerCount').textContent='Layers ('+layers.length+')';
 for(let i=0;i<layers.length;i++){
  const item=layers[i];if(item.mode!==gisMode){gisLayers[i]=null;continue}
  const colour=GIS_COLOURS[i%GIS_COLOURS.length];
  const group=L.geoJSON(item.geojson,{style:{color:colour,weight:2,fillColor:colour,fillOpacity:.18},pointToLayer:(_,latlng)=>L.circleMarker(latlng,{radius:5,color:colour,fillOpacity:.8,weight:1}),onEachFeature:(feature,layer)=>layer.bindPopup(()=>gisPopup(feature,item.name))});
  gisLayers[i]=group;if(item.visible!==false)group.addTo(gisMap);
 }
 gisMap.setView([0,0],geo?2:0);if(fit)fitGIS();
 $('#gisMapNote').textContent=geo?'GIS geometry only · no online basemap':'Local XY coordinates · GPS alignment unavailable';
 $('#gisMap').classList.toggle('gis-local',!geo);setTimeout(()=>gisMap?.invalidateSize(),0);
}
function fitGIS(){
 if(!gisMap)return;const L=window.L,bounds=L.latLngBounds([]);
 for(const layer of gisLayers)if(layer&&gisMap.hasLayer(layer)&&layer.getBounds().isValid())bounds.extend(layer.getBounds());
 if(bounds.isValid())gisMap.fitBounds(bounds,{padding:[20,20],maxZoom:gisMode==='geographic'?20:10});
}
async function locateGIS(){
 if(gisMode!=='geographic')return;
 const gps=await fix();if(!gps)return toast('GPS unavailable. Allow location and try again outdoors.');
 const L=window.L;if(gisGPS)gisMap.removeLayer(gisGPS);
 gisGPS=L.circle([gps.latitude,gps.longitude],{radius:Math.max(2,gps.accuracy),color:'#1473cf',weight:2,fillOpacity:.15}).addTo(gisMap).bindPopup('Device position · accuracy ±'+Math.round(gps.accuracy)+' m');
 gisMap.panTo([gps.latitude,gps.longitude]);gisGPS.openPopup();
}
async function showAppView(view){
 $('#journalPanel').hidden=view!=='journal';$('#gisPanel').hidden=view!=='gis';
 document.querySelectorAll('[data-app-view]').forEach(b=>{const active=b.dataset.appView===view;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active)});
 if(view==='gis'){
  try{
   if(!gisRecord){gisRecord=await tx('gis','readonly',store=>store.get('layout'));if(gisRecord){gisMode=gisRecord.viewMode||'geographic';$('#gisSourceName').textContent=gisRecord.sourceName;$('#gisWarnings').textContent=(gisRecord.warnings||[]).join('\n');$('#gisWarnings').hidden=!gisRecord.warnings?.length;gisDiagnostics()}}
   if(!gisMap){await drawGIS(!!gisRecord);if(gisRecord)gisStatus('Saved layout · '+gisRecord.layers.length+' layers · '+gisRecord.featureCount.toLocaleString()+' features.')}
   gisMap.invalidateSize();
  }catch(error){gisStatus(error.message)}
 }
}
function initGIS(){
 document.querySelectorAll('[data-app-view]').forEach(b=>b.onclick=()=>showAppView(b.dataset.appView));
 $('#gisLoad').onclick=()=>$('#gisFile').click();$('#gisFile').onchange=async()=>{const file=$('#gisFile').files[0];if(file)await scanGIS(file);$('#gisFile').value=''};
 $('#gisDemo').onclick=async()=>{try{const response=await fetch(new URL('./gis-demo.gdb.zip',appBase));if(!response.ok)throw Error('Demo unavailable; reopen online.');await scanGIS(new File([await response.blob()],'Synthetic-airfield.gdb.zip',{type:'application/zip'}))}catch(error){gisStatus(error.message)}};
 $('#gisPrepare').onclick=async()=>{gisSetBusy(true);try{await prepareGIS(false)}catch(error){gisStatus(error.message)}finally{gisSetBusy(false)}};
 $('#gisOpenDataset').onclick=async()=>{if(!gisFile)return;gisSetBusy(true);try{const key=$('#gisDataset').value;const bytes=await gisFile.arrayBuffer();await gisCall('scan',{bytes},[bytes]);$('#gisDataset').value=key;await loadGISDataset()}catch(error){gisStatus(error.message)}finally{gisSetBusy(false)}};
 $('#gisCancel').onclick=()=>{resetGISWorker();gisSetBusy(false);gisStatus('Import cancelled. The previous saved layout is unchanged.')};
 $('#gisFit').onclick=fitGIS;$('#gisLocate').onclick=locateGIS;
 $('#gisViewMode').onchange=async()=>{gisMode=$('#gisViewMode').value;await drawGIS(true)};
 $('#gisLayerList').onchange=e=>{const index=Number(e.target.dataset.layer);if(!Number.isInteger(index)||!gisLayers[index])return;gisRecord.layers[index].visible=e.target.checked;if(e.target.checked)gisLayers[index].addTo(gisMap);else gisMap.removeLayer(gisLayers[index]);void put('gis',gisRecord).catch(()=>{})};
 $('#gisReport').onclick=()=>download(new Blob([$('#gisDiagnostics').textContent],{type:'application/json'}),'Fieldnote-GIS-diagnostic.json');
}
