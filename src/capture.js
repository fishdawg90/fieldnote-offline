let cameraSession=null,pendingSaves=0;
const captureDrafts=new Map();
function updateRecovery(){
 $('#captureRecovery').classList.toggle('hidden',!captureDrafts.size);
 $('#captureRecoveryText').textContent=captureDrafts.size+' capture'+(captureDrafts.size===1?'':'s')+' not saved yet';
}
async function saveCapture(entry){
 if(entry.type==='voice'&&$('#transcribe').checked&&!entry.transcriptionState){entry={...entry,transcriptionState:'queued',transcriptionModelKey:selectedModelKey,transcriptionStatus:'Queued for on-device transcription.'}}
 pendingSaves++;updateRecovery();
 try{
  if(!entry.blob?.size)throw Error('The capture is empty.');
  await put('entries',entry);captureDrafts.delete(entry.id);await reload();toast(entry.type==='photo'?'Photo saved':'Voice note saved');void drainQueue();
 }catch(error){captureDrafts.set(entry.id,entry);fail(error)}
 finally{pendingSaves--;updateRecovery();updateControls()}
}
$('#retryCaptures').onclick=async()=>{for(const entry of Array.from(captureDrafts.values()))await saveCapture(entry)};
function closeCamera(){
 const session=cameraSession;cameraSession=null;
 session?.stream?.getTracks().forEach(t=>t.stop());$('#cameraPreview').srcObject=null;
 if($('#cameraDialog').open)$('#cameraDialog').close();
}
async function openCamera(){
 if(!state.selected||cameraSession)return;
 if(!navigator.mediaDevices?.getUserMedia)return useSystemCamera();
 const session={area:state.selected,stream:null,opening:Date.now()};cameraSession=session;
 $('#cameraArea').textContent=areaName(session.area);$('#cameraMessage').textContent='Starting camera…';$('#shutter').disabled=true;$('#cameraDialog').showModal();
 session.gpsPromise=fix();
 try{
  const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
  if(cameraSession!==session){stream.getTracks().forEach(t=>t.stop());return}
  session.stream=stream;$('#cameraPreview').srcObject=stream;await $('#cameraPreview').play();
  if(cameraSession!==session)return;
  $('#shutter').disabled=false;$('#cameraMessage').textContent='Tap shutter to save';
 }catch(error){$('#cameraMessage').textContent='Camera unavailable. Try Phone camera.';toast('Camera access unavailable. Use Phone camera below.')}
}
async function shootPhoto(){
 const session=cameraSession;if(!session?.stream)return;
 $('#shutter').disabled=true;$('#cameraMessage').textContent='Taking photo…';
 const created=Date.now(),gps=snapshotGPS();
 try{
  const track=session.stream.getVideoTracks()[0];let blob=null,method='ImageCapture';
  if('ImageCapture'in window)try{blob=await new ImageCapture(track).takePhoto()}catch{}
  if(!blob){
   method='Video frame';const video=$('#cameraPreview');if(!video.videoWidth)throw Error('Camera is not ready.');
   const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);
   blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.95));
  }
  if(!blob?.size)throw Error('No image was captured.');
  closeCamera();
  const exifGPS=await readPhotoGPS(blob);
  const entry={id:uid(),area:session.area,type:'photo',created,blob,mime:blob.type,name:'photo.'+(blob.type==='image/png'?'png':'jpg'),text:'',gps,exifGPS,captureMethod:method,locationSource:gps?'Device fix at in-app shutter press':null};
  void saveCapture(entry).then(()=>attachLateGPS(entry.id,session.gpsPromise,created,'Device fix near in-app shutter press'));
 }catch(error){if(cameraSession===session){$('#shutter').disabled=false;$('#cameraMessage').textContent='Photo not taken. Try again.'}fail(error)}
}
function useSystemCamera(){
 const area=cameraSession?.area||state.selected;closeCamera();if(!area)return;
 if($('#settings').open)$('#settings').close();
 photoContext={area,started:Date.now(),gps:snapshotGPS(),kind:'camera',pendingGPS:fix()};$('#camera').click();
}
$('#takePhoto').onclick=openCamera;$('#shutter').onclick=shootPhoto;$('#closeCamera').onclick=closeCamera;
$('#cameraSystem').onclick=useSystemCamera;$('#systemCameraSetting').onclick=useSystemCamera;
$('#cameraDialog').addEventListener('cancel',event=>{event.preventDefault();closeCamera()});
window.addEventListener('pagehide',()=>{closeCamera();if(state.recording)stopRecord()});
window.addEventListener('beforeunload',event=>{if(state.recording||pendingSaves||captureDrafts.size){event.preventDefault();event.returnValue='A capture has not finished saving.'}});

async function attachLateGPS(id,promise,created,source){
 try{const gps=await promise;if(!gps||Math.abs(gps.timestamp-created)>15000)return;const entry=(await all('entries')).find(e=>e.id===id);if(entry&&!entry.gps){await put('entries',{...entry,gps,locationSource:source});await reload()}}catch(error){console.warn('Location attachment:',error)}
}
