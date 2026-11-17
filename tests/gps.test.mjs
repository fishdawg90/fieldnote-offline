import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const journal=await readFile(new URL('../src/journal.js',import.meta.url),'utf8');
const code=journal.slice(journal.indexOf('let gpsWatchEpoch=0;'),journal.indexOf("$('#areas').onclick"));
function setup(){
 const state={gps:null,watch:null,gpsEnabled:false,gpsError:'GPS off'},nodes=new Map(),handlers={},watchers=[],cleared=[],saved=[];
 const $=selector=>{if(!nodes.has(selector))nodes.set(selector,{textContent:'',title:'',attrs:{},classList:{toggle(){}},setAttribute(key,value){this.attrs[key]=value}});return nodes.get(selector)};
 const document={hidden:false,addEventListener(name,fn){handlers[name]=fn}},window={addEventListener(name,fn){handlers[name]=fn}};
 const navigator={geolocation:{watchPosition(ok,error,options){watchers.push({ok,error,options});return watchers.length-1},clearWatch(id){cleared.push(id)}}};
 const api=new Function('state','navigator','document','window','$','put','fail','setInterval','updateGISPosition','updateGPSAreaButton',code+';return {startGPS,stopGPS,refreshGPSWatch,snapshotGPS};')(state,navigator,document,window,$,async(store,value)=>saved.push(value),()=>{},()=>{},()=>{},()=>{});
 return {state,$,document,handlers,watchers,cleared,saved,...api};
}
const position=()=>({coords:{latitude:51.3,longitude:-.1,accuracy:7,altitude:100},timestamp:Date.now()});
test('GPS toggle starts one high accuracy watch, stops watch ID zero and ignores delayed fixes',()=>{
 const app=setup();app.$('#gpsToggle').onclick();assert.equal(app.state.gpsEnabled,true);assert.equal(app.watchers.length,1);assert.equal(app.watchers[0].options.enableHighAccuracy,true);
 app.watchers[0].ok(position());assert.equal(app.$('#gpsToggle').textContent,'GPS on');assert.equal(app.snapshotGPS().accuracy,7);
 app.$('#gpsToggle').onclick();assert.equal(app.state.gpsEnabled,false);assert.equal(app.state.watch,null);assert.deepEqual(app.cleared,[0]);
 app.watchers[0].ok(position());assert.equal(app.state.gps,null);assert.equal(app.saved.at(-1).enabled,false);
});
test('Hiding pauses GPS, resuming requests a new fix, and a pre-lock callback cannot restore stale data',()=>{
 const app=setup();app.startGPS();app.watchers[0].ok(position());app.document.hidden=true;app.handlers.visibilitychange();
 assert.equal(app.state.watch,null);assert.equal(app.state.gps,null);assert.equal(app.state.gpsEnabled,true);assert.equal(app.$('#gpsToggle').textContent,'GPS paused');
 app.document.hidden=false;app.handlers.visibilitychange();assert.equal(app.watchers.length,2);assert.equal(app.state.gps,null);
 app.watchers[0].ok(position());assert.equal(app.state.gps,null);
 app.watchers[1].ok(position());assert.equal(app.snapshotGPS().latitude,51.3);assert.equal(app.$('#gpsToggle').textContent,'GPS on');
});
test('Permission denial turns the toggle off, and old fixes are rejected',()=>{
 const app=setup();app.startGPS();app.watchers[0].ok({...position(),timestamp:Date.now()-61000});assert.equal(app.snapshotGPS(),null);
 app.watchers[0].error({code:1});assert.equal(app.state.gpsEnabled,false);assert.equal(app.state.watch,null);assert.equal(app.state.gpsError,'Location permission denied');
 app.watchers[0].ok(position());assert.equal(app.state.gps,null);
});
