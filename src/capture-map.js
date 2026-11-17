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
// Nearby symbols share a small badge per type so simultaneous captures remain visible.
export function captureMapBadges(points,project,width,height){
 const cells=new Map();
 for(const point of points){
  const {x,y}=project(point);if(!Number.isFinite(x)||!Number.isFinite(y)||x< -24||y< -24||x>width+24||y>height+24)continue;
  const key=Math.round(x/22)+':'+Math.round(y/22);let cell=cells.get(key);
  if(!cell){cell={x:0,y:0,photos:0,voices:0,count:0};cells.set(key,cell)}
  cell.x+=x;cell.y+=y;cell.count++;if(point.type==='photo')cell.photos++;else cell.voices++;
 }
 return [...cells.values()].map(cell=>({...cell,x:cell.x/cell.count,y:cell.y/cell.count}));
}
