import {annexAreaName} from './area-groups.js';
import {assetValue} from './asset-data.js';

// Cache geographic polygon bounds when a layout changes, not on every GPS fix.
export function gpsAreaIndex(layers=[]){
 const index=[];
 for(const layer of layers){
  if(layer.mode!=='geographic')continue;
  for(const feature of layer.geojson?.features||[]){
   const geometry=feature.geometry;if(!geometry)continue;
   const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
   for(const rings of polygons){
    if(!rings?.[0]?.length)continue;
    let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity,valid=true;
    for(const ring of rings)for(const coordinate of ring){const [x,y]=coordinate;if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>180||Math.abs(y)>90)valid=false;west=Math.min(west,x);east=Math.max(east,x);south=Math.min(south,y);north=Math.max(north,y)}
    if(valid&&east-west<180)index.push({name:annexAreaName(assetValue(feature.properties,'ANNEX_A6_LABELS')),rings,west,east,south,north});
   }
  }
 }
 return index;
}
function inRing(x,y,ring){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const [xi,yi]=ring[i],[xj,yj]=ring[j];
  if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
 }
 return inside;
}
function edgeDistance(gps,rings,sx,sy){
 let distance=Infinity;
 for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const ax=(ring[j][0]-gps.longitude)*sx,ay=(ring[j][1]-gps.latitude)*sy,bx=(ring[i][0]-gps.longitude)*sx,by=(ring[i][1]-gps.latitude)*sy,dx=bx-ax,dy=by-ay;
  const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
  distance=Math.min(distance,Math.hypot(ax+t*dx,ay+t*dy));
 }
 return distance;
}
export function gpsAreaStatus(index,gps,selectedName,now=Date.now()){
 const unknown={status:'unknown',areaName:null};
 if(!gps||!selectedName||!Number.isFinite(gps.latitude)||!Number.isFinite(gps.longitude)||Math.abs(gps.latitude)>85||Math.abs(gps.longitude)>180||!Number.isFinite(gps.accuracy)||gps.accuracy<=0||gps.accuracy>25||!Number.isFinite(gps.timestamp)||now-gps.timestamp<0||now-gps.timestamp>=15000)return unknown;
 // Require the reported accuracy circle plus a small boundary margin to fit.
 const radius=gps.accuracy+3,sy=111195,sx=sy*Math.cos(gps.latitude*Math.PI/180),hits=new Set(),certain=new Set();
 for(const polygon of index){
  if(gps.longitude<polygon.west-radius/sx||gps.longitude>polygon.east+radius/sx||gps.latitude<polygon.south-radius/sy||gps.latitude>polygon.north+radius/sy)continue;
  const inside=inRing(gps.longitude,gps.latitude,polygon.rings[0])&&!polygon.rings.slice(1).some(ring=>inRing(gps.longitude,gps.latitude,ring));
  const distance=edgeDistance(gps,polygon.rings,sx,sy);
  if(inside||distance<=radius)hits.add(polygon.name);
  if(inside&&distance>radius&&polygon.name)certain.add(polygon.name);
 }
 if(certain.size!==1||hits.size!==1)return unknown;
 const areaName=[...certain][0];
 return {status:areaName===annexAreaName(selectedName)?'match':'different',areaName};
}
