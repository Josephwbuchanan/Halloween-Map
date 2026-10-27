import {traceRoad} from './road-trail.js';
import {meters,trailSegments} from './trail-geometry.js';
export function setupNight({L,map,getDb,ensureSession,inNeighborhood,demo,toast,snapPoint,demoPath,roadGraph,paintTrail}){
 const $=s=>document.querySelector(s),points=new Map();
 let crew=null,watch=null,channel=null,runId=null,lastFix=null,queue=[],uploading=false,demoTimer=null,demoIndex=0,lastUpload=0,finished=false,demoTick=null,demoLength=0;
 const stateKey='arrowbrooke-night-v1';
 const note=(text)=>$('#night-status').textContent=text;
 function setButtons(active){$('#night-start').hidden=Boolean(crew)&&!finished;$('#night-start').textContent=finished?'Start a new night':'Start our night';$('#night-join').hidden=Boolean(crew);$('#night-pause').hidden=!crew||finished;$('#night-finish').hidden=!crew||finished;$('#night-share').hidden=!crew||demo;$('#night-pause').textContent=active?'Pause':'Resume';$('#night-floating-pause').hidden=!crew||finished;$('#night-floating-pause').textContent=active?'Ⅱ Pause trail':'▶ Resume trail';}
 function persist(){if(!crew||demo)return;try{localStorage.setItem(stateKey,JSON.stringify({crew,queue}));}catch{note('Phone storage is full. Keep the map open while syncing.');}}
 let trailColor='black';try{trailColor=localStorage.getItem('arrowbrooke-trail-color')||'black';}catch{}
 let tracedGraph=null,traceCache=new Map();
 function draw(){
  const graph=roadGraph(),paths=[];
  if(graph!==tracedGraph){traceCache.clear();tracedGraph=graph;}
  if(graph.edges.length)for(const segment of trailSegments([...points.values()])){
   let current=[];
   for(let i=1;i<segment.length;i++){
    const a=segment[i-1],b=segment[i],key=(a.id||a.created_by+':'+a.run_id+':'+a.captured_at)+'/'+(b.id||b.created_by+':'+b.run_id+':'+b.captured_at);
    if(!traceCache.has(key))traceCache.set(key,traceRoad(graph,a,b));const path=traceCache.get(key);
    if(!path||path.length<2){if(current.length>1)paths.push(current);current=[];continue;}
    const last=current.at(-1),first=path[0];
    if(last&&Math.abs(last[0]-first[0])<1e-7&&Math.abs(last[1]-first[1])<1e-7)current.push(...path.slice(1));
    else{if(current.length>1)paths.push(current);current=path.slice();}
   }
   if(current.length>1)paths.push(current);
  }
  const width=Math.max(3,Math.min(25,4*Math.pow(1.5,map.getZoom()-15)));

  paintTrail(paths,{width,color:trailColor==='black'?'#100e16':'#bd2440'});
 }
 function updateColor(){$('#night-color').textContent=trailColor==='black'?'● Ink black':'● Crimson';$('#night-color').setAttribute('aria-label',trailColor==='black'?'Trail color: ink black. Switch to crimson.':'Trail color: crimson. Switch to ink black.');}
 $('#night-color').onclick=()=>{trailColor=trailColor==='black'?'crimson':'black';try{localStorage.setItem('arrowbrooke-trail-color',trailColor);}catch{}updateColor();draw();};updateColor();
 map.on('zoomend',draw);
 function stopWatch(){if(watch!==null){navigator.geolocation.clearWatch(watch);watch=null;}if(demoTimer){clearInterval(demoTimer);demoTimer=null;}lastFix=null;setButtons(false);}
 async function flush(){
  const db=getDb();if(demo||!db||!crew||uploading||!queue.length||!navigator.onLine)return;
  uploading=true;
  try{while(queue.length){const batch=queue.slice(0,50);const {error}=await db.from('trail_points').upsert(batch,{onConflict:'id',ignoreDuplicates:true});if(error)throw error;queue.splice(0,batch.length);persist();}lastUpload=Date.now();if(watch!==null)note('Live · Your steps are joining the crew’s trail.');}
  catch{note('Not synced yet · Your trail is saved on this phone.');}finally{uploading=false;}
 }
 function takeFix(position){
  if(watch===null)return;
  const {latitude:lat,longitude:lng,accuracy}=position.coords;
  if(!inNeighborhood(lat,lng)){note('Outside ArrowBrooke · No location is being saved.');return;}
  if(!Number.isFinite(accuracy)||accuracy>40){note('Waiting for a clearer GPS signal…');return;}
  const snapped=snapPoint?.(lat,lng);if(!snapped){note('Waiting for a mapped street · No off-street trail is being saved.');return;}
  const now=new Date(position.timestamp||Date.now()).toISOString(),candidate={...snapped,accuracy,captured_at:now};
  if(lastFix&&meters(lastFix,candidate)<4&&(Date.parse(now)-Date.parse(lastFix.captured_at))<15000)return;
  const p={...candidate,id:crypto.randomUUID(),crew_id:crew.id,run_id:runId};
  lastFix=p;points.set(p.id,{...p,created_by:crew.userId});queue.push(p);
  if(queue.length>2000){stopWatch();note('Sync is unavailable and the phone buffer is full. Reconnect before resuming.');return;}
  persist();draw();note('Tracking · '+(queue.length?'Syncing your steps…':'The crew’s trail is live.'));flush();
 }
 function startWatch(){
  if(!navigator.geolocation){toast('This browser cannot share location.');return;}
  if(crew?.ended_at||finished){toast('This night has finished. Start a new night to track again.');return;}
  runId=crypto.randomUUID();lastFix=null;note('Allow location to add your steps. Keep the map open.');
  watch=navigator.geolocation.watchPosition(takeFix,e=>{
   if(e.code===1){stopWatch();note('Location wasn’t allowed. You can still view the crew’s trail.');}
   else note('GPS interrupted · Short gaps will join when the signal returns.');
  },{enableHighAccuracy:true,maximumAge:5000,timeout:20000});setButtons(true);
 }
 async function loadPoints(){
  const db=getDb();if(!db||!crew)return;
  for(let offset=0;offset<30000;offset+=1000){const {data,error}=await db.from('trail_points').select('*').eq('crew_id',crew.id).order('captured_at').order('id').range(offset,offset+999);if(error)throw error;data.forEach(p=>points.set(p.id,p));if(data.length<1000)break;}draw();
 }
 async function connectCrew(){
  const db=getDb();if(channel)await db.removeChannel(channel);
  channel=db.channel('crew-trail-'+crew.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'trail_points',filter:'crew_id=eq.'+crew.id},({new:p})=>{points.set(p.id,p);draw();})
   .on('postgres_changes',{event:'UPDATE',schema:'public',table:'trail_crews',filter:'id=eq.'+crew.id},({new:c})=>{if(c.ended_at){crew.ended_at=c.ended_at;finished=true;stopWatch();persist();flush();note('Our night has finished · The trail is saved.');}})
   .subscribe(status=>{if(status==='SUBSCRIBED'){loadPoints().catch(()=>note('Could not refresh the trail.'));flush();}else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status))note('Reconnecting to the crew…');});
  await loadPoints();persist();
 }
 function sampleTrail(){
  crew={id:'demo',userId:'demo'};finished=false;points.clear();demoIndex=0;runId='demo-walk';setButtons(true);
  const path=demoPath?.()||[[33.24716,-96.90295],[33.24717,-96.90265],[33.24718,-96.90235],[33.24719,-96.90205],[33.24720,-96.90175],[33.24723,-96.90145],[33.24729,-96.90115],[33.24739,-96.90085],[33.24749,-96.90055],[33.24760,-96.90025],[33.24770,-96.89995],[33.24780,-96.89965]];
  demoLength=path.length;
  const tick=()=>{if(demoIndex>=path.length){clearInterval(demoTimer);demoTimer=null;setButtons(false);note('Sample trail · No GPS location was recorded.');return;}const [lat,lng]=path[demoIndex];points.set('demo-'+demoIndex,{lat,lng,accuracy:5,created_by:'demo',run_id:runId,captured_at:new Date(1793494800000+demoIndex*20000).toISOString()});demoIndex++;draw();};
  map.setView(path[Math.floor(path.length/2)],17);tick();demoTick=tick;demoTimer=setInterval(tick,400);note('Sample trail preview · No GPS location is recorded.');
 }
 $('#night-start').onclick=async()=>{
  if(demo){sampleTrail();return;}
  const db=getDb();if(!db){toast('Finish connecting the shared database to start a live night.');return;}
  $('#night-start').disabled=true;
  try{await ensureSession();const {data,error}=await db.rpc('create_trail_crew');if(error)throw error;const c=Array.isArray(data)?data[0]:data;const {data:auth}=await db.auth.getSession();crew={id:c.crew_id,code:c.invite_code,userId:auth.session.user.id};points.clear();finished=false;await connectCrew();startWatch();}
  catch{note('Could not start our night. Check the shared database setup.');}finally{$('#night-start').disabled=false;}
 };
 $('#night-join').onclick=()=>$('#night-dialog').showModal();
 $('#night-close').onclick=()=>$('#night-dialog').close();
 $('#night-join-form').onsubmit=async e=>{
  e.preventDefault();const db=getDb();if(!db){$('#night-join-error').textContent='The shared database needs to be connected first.';return;}
  const code=$('#crew-code').value.trim().toLowerCase();$('#night-join-submit').disabled=true;$('#night-join-error').textContent='';
  try{await ensureSession();const {data,error}=await db.rpc('join_trail_crew',{p_code:code});if(error)throw error;const c=Array.isArray(data)?data[0]:data;const {data:auth}=await db.auth.getSession();crew={id:c.crew_id,code,userId:auth.session.user.id,ended_at:c.ended_at};finished=Boolean(c.ended_at);points.clear();await connectCrew();$('#night-dialog').close();if(finished){setButtons(false);note('This night has finished · You can view its saved trail.');}else startWatch();}
  catch{$('#night-join-error').textContent='Could not join. Check the crew code and your connection.';}finally{$('#night-join-submit').disabled=false;}
 };
 $('#night-pause').onclick=()=>{if(demo){if(demoTimer){stopWatch();note('Sample trail paused.');}else if(demoTick&&demoIndex<demoLength){demoTimer=setInterval(demoTick,400);setButtons(true);note('Sample trail preview · No GPS location is recorded.');}else sampleTrail();return;}if(watch!==null){stopWatch();flush();note('Paused on this phone · The rest of the crew can keep tracking.');}else startWatch();};
 $('#night-floating-pause').onclick=()=>$('#night-pause').click();
 $('#night-finish').onclick=async()=>{
  if(!confirm('Finish our night for the whole crew? The trail will stay on the map.'))return;
  if(demo){finished=true;stopWatch();note('Sample night finished · No location was recorded.');return;}
  await flush();if(queue.length){note('Your last steps are not synced. Reconnect before finishing.');return;}
  const {error}=await getDb().from('trail_crews').update({ended_at:new Date().toISOString()}).eq('id',crew.id).select().single();
  if(error){toast('Only the person who started the night can finish it for everyone. You can pause your phone.');return;}
  finished=true;crew.ended_at=new Date().toISOString();stopWatch();persist();note('Our night has finished · The trail is saved.');
 };
 $('#night-share').onclick=async()=>{
  const url=new URL(location.href);url.search='';url.hash='crew='+crew.code;
  try{if(navigator.share)await navigator.share({title:'Join our Halloween crew',text:'Join our shared haunted trail',url:url.href});else{await navigator.clipboard.writeText(url.href);toast('Crew invite copied.');}}catch(e){if(e.name!=='AbortError')toast('Crew code: '+crew.code);}
 };
 function restore(){
  if(demo){setButtons(false);note('Try Start our night to preview the haunted trail.');return;}
  const code=new URLSearchParams(location.hash.slice(1)).get('crew');
  if(code){$('#crew-code').value=code;$('#night-dialog').showModal();history.replaceState(null,'',location.pathname+location.search);}
  try{const stored=JSON.parse(localStorage.getItem(stateKey)||'null');if(stored?.crew){crew=stored.crew;queue=stored.queue||[];finished=Boolean(crew.ended_at);queue.forEach(p=>points.set(p.id,{...p,created_by:crew.userId}));setButtons(false);draw();note('Your crew is saved · Resume to share your location again.');}}catch{}
 }
 async function ready(){if(!crew||demo)return;try{await ensureSession();const {data,error}=await getDb().from('trail_crews').select('ended_at').eq('id',crew.id).single();if(error)throw error;crew.ended_at=data.ended_at;finished=Boolean(data.ended_at);await connectCrew();setButtons(false);note(finished?'Our night has finished · The trail is saved.':'Crew connected · Tap Resume to share this phone’s location.');}catch{note('Could not reconnect to the saved crew. Check your connection.');}}
 window.addEventListener('online',flush);
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&watch!==null)note('Keep this map open for reliable tracking.');else if(watch!==null){flush();note('Tracking resumed · Short GPS gaps join automatically.');}});
 window.addEventListener('pagehide',()=>{persist();stopWatch();});
 setInterval(()=>{if(queue.length)flush();},10000);
 restore();return {ready,refreshRoads:draw};
}
