import {savedRecordAreaSuggestion} from './gps-area.js';
// Read and patch within one transaction, preserving concurrent area/GPS/transcript edits.
export function patchEntryRecord(db, id, patch) {
 return new Promise((resolve,reject)=>{
  const t=db.transaction(['areas','entries'],'readwrite');let updated=null,reason=null;
  t.objectStore('entries').get(id).onsuccess=event=>{
   const current=event.target.result;if(!current)return;
   const changes=typeof patch==='function'?patch(current):patch;if(!changes)return;
   updated={...current,...changes,id:current.id};
   t.objectStore('areas').get(updated.area).onsuccess=event=>{
    if(!event.target.result){reason=Error('The reference area no longer exists.');t.abort();return}
    updated.inspectionId=event.target.result.inspectionId;t.objectStore('entries').put(updated);
   };
  };
  t.oncomplete=()=>resolve(updated);t.onerror=()=>reject(reason||t.error);t.onabort=()=>reject(reason||t.error||Error('Record update cancelled'));
 });
}

export function moveRecordsToArea(db, ids, areaId, inspectionId) {
 const unique=[...new Set(ids)];if(!unique.length)return Promise.reject(Error('Select at least one record.'));
 return new Promise((resolve,reject)=>{
  const t=db.transaction(['areas','entries'],'readwrite');let areas,records=[],received=0,reason=null;
  const abort=message=>{reason=Error(message);t.abort()};
  const ready=()=>{
   if(++received!==unique.length+1)return;
   const byId=new Map(areas.map(area=>[area.id,area])),destination=byId.get(areaId);
   if(!destination||destination.inspectionId!==inspectionId)return abort('Choose a reference area in this inspection.');
   if(records.some(entry=>!entry||byId.get(entry.area)?.inspectionId!==inspectionId))return abort('A selected record was removed or moved to another inspection. Review the selection and try again.');
   for(const entry of records)t.objectStore('entries').put({...entry,area:destination.id,inspectionId:destination.inspectionId});
  };
  t.objectStore('areas').getAll().onsuccess=event=>{areas=event.target.result;ready()};
  for(const id of unique)t.objectStore('entries').get(id).onsuccess=event=>{records.push(event.target.result);ready()};
  t.oncomplete=()=>resolve(unique.length);t.onerror=()=>reject(reason||t.error);t.onabort=()=>reject(reason||t.error||Error('Records were not moved'));
 });
}

export function applyGPSAreaSuggestion(db,id,areaId,inspectionId,index){
 return new Promise((resolve,reject)=>{
  const t=db.transaction(['areas','entries'],'readwrite');let areas,entry,received=0,result=null,reason=null;
  const ready=()=>{
   if(++received!==2)return;
   const source=areas.find(area=>area.id===entry?.area);
   const suggestion=entry&&source?.inspectionId===inspectionId?savedRecordAreaSuggestion(index,entry,areas):null;
   if(!suggestion||suggestion.areaId!==areaId){reason=Error('The GPS suggestion changed or is no longer available. Review the record again.');t.abort();return}
   t.objectStore('entries').put({...entry,area:areaId,inspectionId});result=suggestion;
  };
  t.objectStore('areas').getAll().onsuccess=event=>{areas=event.target.result;ready()};
  t.objectStore('entries').get(id).onsuccess=event=>{entry=event.target.result;ready()};
  t.oncomplete=()=>resolve(result);t.onerror=()=>reject(reason||t.error);t.onabort=()=>reject(reason||t.error||Error('The record was not moved'));
 });
}
