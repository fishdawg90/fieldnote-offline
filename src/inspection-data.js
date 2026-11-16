// Pure data migration: preserve capture IDs and media; only discard the untouched starter pair.
export function groupLegacyAreas(areas,entries,inspections,makeId,now=Date.now()){
 const untouched=inspections.length===0&&entries.length===0&&areas.length===2&&new Set(areas.map(a=>a.name)).size===2&&areas.some(a=>a.name==='A4')&&areas.some(a=>a.name==='A5')&&areas.every(a=>!a.inspectionId);
 if(untouched)return{inspections:[],areas:[],removedAreaIds:areas.map(a=>a.id)};
 const grouped=inspections.map(x=>({...x})),known=new Set(grouped.map(x=>x.id));
 let previous=grouped.find(x=>x.legacy);
 const output=areas.map(area=>{
  if(known.has(area.inspectionId))return{...area};
  if(!previous){previous={id:makeId(),name:'Previous inspection',created:now,legacy:true};grouped.push(previous);known.add(previous.id)}
  return{...area,inspectionId:previous.id};
 });
 return{inspections:grouped,areas:output,removedAreaIds:[]};
}
export function inspectionForEntry(entry,areas){return areas.find(a=>a.id===entry.area)?.inspectionId||entry.inspectionId||null}
export function inspectionScope(inspectionId,areas,entries){
 const selected=areas.filter(a=>a.inspectionId===inspectionId),ids=new Set(selected.map(a=>a.id));
 return{areas:selected,entries:entries.filter(e=>ids.has(e.area))};
}
export function prepareInspectionRestore(backup,currentAreas,makeId,now=Date.now()){
 if(backup.version===2)return{inspections:backup.inspections,areas:backup.areas};
 let restored=null;const areas=backup.areas.map(a=>{
  const existing=currentAreas.find(x=>x.id===a.id);
  if(existing?.inspectionId)return{...a,inspectionId:existing.inspectionId};
  restored??={id:makeId(),name:'Restored inspection',created:now};
  return{...a,inspectionId:restored.id};
 });
 return{inspections:restored?[restored]:[],areas};
}
