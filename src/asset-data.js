// Pure presentation rules for the airfield asset schema.
export const ASSET_FIELDS=[
 ['aosLevel2AssetName','Asset'],['aosLocationalDescriptor','Location'],['aosMaintainableElement','Surface'],
 ['aosLoadClassificationValue','Load class'],['aosYearofLastResurfacing','Resurfaced'],
 ['aosSurfaceTreatmentType','Treatment'],['aosSurfaceTreatmentYear','Treatment year'],
 ['aosLength','Length'],['aosWidth','Width'],['aosArea','Area'],
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
 const reference=assetValue(properties,'ANNEX_A6_LABELS');
 const fields=ASSET_FIELDS.map(([key,label])=>({key,label,value:assetValue(properties,key)})).filter(x=>presentAssetValue(x.value));
 const scores=ASSET_SCORES.map(([key,label])=>{const value=assetValue(properties,key);return {key,label,value,band:scoreBand(value)}}).filter(x=>presentAssetValue(x.value));
 const overall=assetValue(properties,'aosOverallRAG');
 if(presentAssetValue(overall))scores.push({key:'aosOverallRAG',label:'Overall',value:overall,band:overallBand(overall)});
 return {reference:presentAssetValue(reference)?String(reference):'',fields,scores,band:overallBand(overall)};
}
