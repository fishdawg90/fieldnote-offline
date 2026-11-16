// Pure presentation rules for the airfield asset schema.
export const ASSET_FIELDS=[
 ['aosMaintainableElement','Surface'],
 ['aosLoadClassificationValue','Load class'],['aosYearofLastResurfacing','Resurfaced'],
 ['aosSurfaceTreatmentType','Treatment'],['aosSurfaceTreatmentYear','Treatment year'],
 ['aosLength','Length'],['aosWidth','Width'],['aosArea','Area (m²)'],
 ['aosFrictionYear','Friction year'],['aosFrictionValue','Friction'],['aosHighestStationBasedAircraftUsingArea','Aircraft']
];
export const ASSET_SCORES=[
 ['aosConditionRatingFriction','Friction'],['aosConditionRatingPavementLoading','Load'],
 ['aosConditionRatingAge','Age'],['aosConditionRatingFODRisk','FOD'],
 ['aosConditionRatingMaintainability','Maint.'],['aosConditionRatingProjectDate','Project'],
 ['aosMarkings','Markings'],['aosDrainage','Drainage'],['aosRotaryHydraulicArrestorGearStrip','RHAG']
];
const normalise=key=>String(key).split('.').pop().replace(/[^a-z0-9]/gi,'').toLowerCase();
export function presentAssetValue(value){
 return value!==null&&value!==undefined&&!(typeof value==='string'&&/^\s*(?:null|<null>|undefined)?\s*$/i.test(value));
}
export function assetValue(properties,key){
 if(Object.prototype.hasOwnProperty.call(properties||{},key))return properties[key];
 const found=Object.keys(properties||{}).find(k=>normalise(k)===normalise(key));
 return found===undefined?undefined:properties[found];
}
export function scoreBand(value){
 if(!presentAssetValue(value))return 'grey';
 const n=Number(value);return n===1?'red':n>=2&&n<=3?'amber':n>=4&&n<=5?'green':'grey';
}
export function overallBand(value){
 const v=String(value??'').trim().toUpperCase();return ['R','RED'].includes(v)?'red':['A','AMBER'].includes(v)?'amber':['G','GREEN'].includes(v)?'green':'grey';
}
export function assetDetails(properties={}){
 const reference=assetValue(properties,'ANNEX_A6_LABELS'),location=assetValue(properties,'aosLocationalDescriptor');
 const fields=ASSET_FIELDS.map(([key,label])=>({key,label,value:assetValue(properties,key)})).filter(x=>presentAssetValue(x.value));
 const scores=ASSET_SCORES.map(([key,label])=>{const value=assetValue(properties,key);return {key,label,value,band:scoreBand(value)}}).filter(x=>presentAssetValue(x.value));
 const overall=assetValue(properties,'aosOverallRAG');
 if(presentAssetValue(overall))scores.push({key:'aosOverallRAG',label:'Overall',value:overall,band:overallBand(overall)});
 return {reference:presentAssetValue(reference)?String(reference).trim():'',name:presentAssetValue(location)?String(location).trim():'',fields,scores,band:overallBand(overall)};
}

export function collectAnnexReferences(layers=[]){
 const seen=new Set(),references=[];
 for(const layer of layers)for(const feature of layer.geojson?.features||[]){
  const raw=assetValue(feature.properties,'ANNEX_A6_LABELS');if(!presentAssetValue(raw))continue;
  const reference=String(raw).trim().slice(0,160),key=reference.toLowerCase();
  if(!seen.has(key)){seen.add(key);references.push(reference)}
 }
 return references;
}
export function missingGISAreaNames(references,areas,inspectionId){
 const names=new Set(areas.filter(area=>area.inspectionId===inspectionId).map(area=>area.name.trim().toLowerCase()));
 return references.filter(name=>{const key=name.trim().toLowerCase();if(names.has(key))return false;names.add(key);return true});
}
