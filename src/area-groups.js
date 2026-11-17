// GIS references use their first component; manual descriptive names stay intact.
export function annexAreaName(value){
 const text=String(value??'').trim();
 if(!text||/^(?:null|<null>|undefined)$/i.test(text))return '';
 return text.split('_')[0].trim().toUpperCase().slice(0,160);
}
export function canonicalAreaName(value){
 const text=String(value??'').trim();
 return /^[a-z]+\d+(?:_[a-z0-9-]+)*$/i.test(text)?annexAreaName(text):text;
}
export function planAreaGroups(areas,entries,settings=[]){
 const groups=new Map(),aliases=Object.create(null),updates=[],removed=[],entryUpdates=[],settingUpdates=[];
 for(const area of areas){
  const name=canonicalAreaName(area.name),isCode=/^[a-z]+\d+(?:_[a-z0-9-]+)*$/i.test(area.name.trim());
  const key=JSON.stringify([area.inspectionId,isCode?name.toLowerCase():area.id]);
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(area);
 }
 for(const group of groups.values()){
  const name=canonicalAreaName(group[0].name);
  const survivor=group.find(area=>area.name.trim()===name)||group.find(area=>area.name.trim().toLowerCase()===name.toLowerCase())||group[0];
  if(survivor.name!==name)updates.push({...survivor,name});
  for(const area of group){aliases[area.id]=survivor.id;if(area.id!==survivor.id)removed.push(area.id)}
 }
 const byId=new Map(areas.map(area=>[area.id,area]));
 for(const entry of entries){
  const source=byId.get(entry.area);if(!source)continue;
  const destination=aliases[entry.area],renamed=source.name!==canonicalAreaName(source.name);
  if(destination===entry.area&&!renamed)continue;
  const previous=renamed?[...new Set([...(entry.previousAreaReferences||[]),source.name])]:entry.previousAreaReferences;
  entryUpdates.push({...entry,area:destination,inspectionId:source.inspectionId,...(previous?{previousAreaReferences:previous}:{})});
 }
 for(const setting of settings)if(setting.id==='inspection-navigation'&&aliases[setting.area]&&aliases[setting.area]!==setting.area)settingUpdates.push({...setting,area:aliases[setting.area]});
 return {aliases,updates,removed,entryUpdates,settingUpdates};
}
export function mergeAreaGroups(db){
 return new Promise((resolve,reject)=>{
  const t=db.transaction(['areas','entries','settings'],'readwrite');let areas,entries,settings,received=0,plan;
  const ready=()=>{
   if(++received!==3)return;
   plan=planAreaGroups(areas,entries,settings);
   for(const area of plan.updates)t.objectStore('areas').put(area);
   for(const entry of plan.entryUpdates)t.objectStore('entries').put(entry);
   for(const id of plan.removed)t.objectStore('areas').delete(id);
   for(const setting of plan.settingUpdates)t.objectStore('settings').put(setting);
  };
  t.objectStore('areas').getAll().onsuccess=e=>{areas=e.target.result;ready()};
  t.objectStore('entries').getAll().onsuccess=e=>{entries=e.target.result;ready()};
  t.objectStore('settings').getAll().onsuccess=e=>{settings=e.target.result;ready()};
  t.oncomplete=()=>resolve(plan);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('Area grouping cancelled'));
 });
}
