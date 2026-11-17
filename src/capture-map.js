function coordinates(value){
 if(value?.latitude===null||value?.latitude===undefined||value?.longitude===null||value?.longitude===undefined)return null;
 if(!['number','string'].includes(typeof value.latitude)||!['number','string'].includes(typeof value.longitude))return null;
 if(String(value.latitude).trim()===''||String(value.longitude).trim()==='')return null;
 const latitude=Number(value.latitude),longitude=Number(value.longitude);
 return Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180?{latitude,longitude}:null;
}
export function captureMapPoints(entries){
 const points=[];
 for(const entry of entries){
  if(!['photo','voice'].includes(entry.type))continue;
  const position=(entry.type==='photo'?coordinates(entry.exifGPS):null)||coordinates(entry.gps);
  if(position)points.push({id:entry.id,type:entry.type,...position});
 }
 return points;
}
// Keep every capture at its own projected GPS point; never cluster or offset it.
export function captureMapIcons(points,project,width,height){
 const icons=[];
 for(const point of points){
  const {x,y}=project(point);if(!Number.isFinite(x)||!Number.isFinite(y)||x< -8||y< -8||x>width+8||y>height+8)continue;
  icons.push({id:point.id,type:point.type,x,y});
 }
 return icons;
}
