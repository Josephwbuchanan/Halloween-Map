import { buildRoadGraph, nearestRoad, roadSample } from './road-trail.js';
import { setupNight } from './night-trail.js';
import { displayCategory } from './display-category.js';
import { findHome, homeKey, homeCenter } from './home-shapes.js';
import { pickStopName } from './stop-names.js';
import { lookupAddress } from './address-lookup.js';
const $ = (s) => document.querySelector(s);
const config = window.HALLOWEEN_CONFIG;
const demo = new URLSearchParams(location.search).get('demo') === '1';
const categories = {
  candy: { label: 'Kids’ candy', icon: '🍬', color: '#e97632', glyph: '●' },
  adult: { label: 'Adult treats', icon: '🥤', color: '#a275df', glyph: '◆' },
  decor: { label: 'Decorations', icon: '👻', color: '#43ae87', glyph: '★' }
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const demoStops = [
  {id:'demo-1',title:'The pumpkin porch',address:'Sample stop · ArrowBrooke Ave',lat:33.2473,lng:-96.9017,categories:['candy'],starts:'18:00',ends:'21:00',notes:'Sample: candy for the little monsters and a porch full of pumpkins.'},
  {id:'demo-2',title:'Boo & brews',address:'Sample stop · Tomahawk Trail',lat:33.2474,lng:-96.8973,categories:['adult','candy'],starts:'18:30',ends:'21:30',notes:'Sample: a little something for the grown-ups, plus treats for the kids.'},
  {id:'demo-3',title:'The haunted garden',address:'Sample stop · Pleasant Knoll Trail',lat:33.2491,lng:-96.9027,categories:['decor'],starts:'18:00',ends:'22:00',notes:'Sample: skeletons, spiderwebs, and a spooky light show.'},
  {id:'demo-4',title:'Candy corner',address:'Sample stop · Starlight Avenue',lat:33.246,lng:-96.9078,categories:['candy','decor'],starts:'17:30',ends:'21:00',notes:'Sample: an extra sweet stop with plenty of Halloween spirit.'},
  {id:'demo-5',title:'The witching hour',address:'Sample stop · Berry Ridge Trail',lat:33.2502,lng:-96.9005,categories:['adult'],starts:'19:00',ends:'22:00',notes:'Sample: grown-up treats and a friendly neighborhood hello.'}
];
let night=null, roadGraphCache=null;
let stops = [], selectedId = null, filter = new Set(), visitedOnly = false, db = null, chosenLocation = null, userMarker = null;
let visited = new Set();
const visitKey = `arrowbrooke-visits-${config.eventDate}${demo ? '-demo' : ''}`;
try { const stored = JSON.parse((demo && localStorage.getItem(visitKey)) || '[]'); if (Array.isArray(stored)) visited = new Set(stored); } catch {}
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').hidden = true, 5000); }
function status(message, live = false) { $('#connection').textContent = message; $('#connection').classList.toggle('live', live); }
const map = L.map('map', { zoomControl:false }).setView(config.center, config.zoom);
let tileWarning = false, streetMap = null;
const mapWarning = () => { if(!tileWarning){tileWarning=true;toast('Street map could not load. Check your internet connection.');} };
try{
  const vectorTiles=L.maplibreGL({style:new URL('map-style.json',location.href).href,attribution:'<a href="https://openfreemap.org/">OpenFreeMap</a> · © <a href="https://openmaptiles.org/">OpenMapTiles</a> · Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  streetMap=vectorTiles.getMaplibreMap();streetMap.on('error',mapWarning);
}catch{
  // Older phones without WebGL retain a usable street map.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,className:'fallback-tiles',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map).on('tileerror',mapWarning);
}
const markers = L.layerGroup().addTo(map);
const houseLayers = L.layerGroup().addTo(map);
const houseCache = new Map();
const homeRenderer = L.svg({padding:.5});
let shapeRefreshTimer;
function scheduleHomes(){clearTimeout(shapeRefreshTimer);shapeRefreshTimer=setTimeout(()=>{drawMapStops();night?.refreshRoads();},100);}
if(streetMap){streetMap.on('idle',scheduleHomes);streetMap.on('sourcedata',e=>{if(e.sourceId==='openmaptiles'){roadGraphCache=null;scheduleHomes();}});}
map.on('moveend',scheduleHomes);
function mapDot(stop){
  const colors=[displayCategory(stop)].map(k=>categories[k].color);
  const gradient=colors.map((c,i)=>c+' '+i/colors.length*100+'% '+(i+1)/colors.length*100+'%').join(',');
  return L.divIcon({className:'pin-shell',iconSize:[28,28],iconAnchor:[14,14],html:'<span class="overview-dot '+(visited.has(stop.id)?'visited':'')+'" style="background:conic-gradient('+gradient+')"></span>'});
}
function drawMapStops(){
  markers.clearLayers();houseLayers.clearLayers();
  const visible=visibleStops(), used=new Set();let buildings=[];
  if(streetMap&&map.getZoom()>=16){try{buildings=streetMap.querySourceFeatures('openmaptiles',{sourceLayer:'building'});}catch{}}
  for(const stop of visible){
    let home=houseCache.get(stop.id);
    if(!home&&buildings.length){
      // Demo coordinates are approximate: associate their samples with a nearby home.
      home=findHome(buildings,stop.lng,stop.lat,demo?65:18,used);
      if(home)houseCache.set(stop.id,home);
    }
    if(home)used.add(homeKey(home));
    if(map.getZoom()<17){
      const at=home?homeCenter(home):[stop.lat,stop.lng];L.marker(at,{icon:mapDot(stop),title:stop.title,alt:stop.title}).addTo(markers).on('click',()=>showDetail(stop.id));continue;
    }
    if(!home){L.marker([stop.lat,stop.lng],{icon:pinIcon(stop),title:stop.title,alt:stop.title}).addTo(markers).on('click',()=>showDetail(stop.id));continue;}
    const done=visited.has(stop.id), offerings=[displayCategory(stop)], color=categories[offerings[0]].color;
    const feature={type:'Feature',properties:{},geometry:home};
    // A quiet lantern glow belongs only to participating houses.
    L.geoJSON(feature,{renderer:homeRenderer,interactive:false,style:{fill:false,color,weight:done?4:7,opacity:done?.06:.18,lineJoin:'round'}}).addTo(houseLayers);
    const layer=L.geoJSON(feature,{renderer:homeRenderer,bubblingMouseEvents:false,style:{color,weight:selectedId===stop.id?2.5:1.3,opacity:done?.45:.9,fillColor:color,fillOpacity:done?.25:.78,className:'haunted-home'}}).addTo(houseLayers);
    layer.eachLayer(shape=>{
      const path=shape.getElement();if(!path)return;
      path.setAttribute('data-stop-id',stop.id);path.setAttribute('role','button');path.setAttribute('tabindex','0');path.setAttribute('aria-label',stop.title+(done?' · visited':''));
      path.style.filter='drop-shadow(0 0 '+(done?'1':'3')+'px '+color+'88)';
      path.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showDetail(stop.id);}});
      shape.on('click',()=>showDetail(stop.id));
    });
    // A transparent extra hit area makes small houses easier to tap on a phone.
    L.geoJSON(feature,{renderer:homeRenderer,bubblingMouseEvents:false,style:{color,weight:14,opacity:0,fillOpacity:0,className:'house-hit-area'}}).addTo(houseLayers).on('click',()=>showDetail(stop.id));
    layer.bringToFront();
    if(done){const center=homeCenter(home);L.marker(center,{interactive:false,keyboard:false,icon:L.divIcon({className:'house-visited-badge',iconSize:[12,12],iconAnchor:[6,6],html:'✓'})}).addTo(markers);}
  }
}

function visibleStops() {
  const q = $('#search').value.trim().toLowerCase();
  return stops.filter(s => (!filter.size||s.categories.some(k=>filter.has(k))) && (!visitedOnly||visited.has(s.id)) && (visitedOnly||!$('#hide-visited').checked||!visited.has(s.id)) && `${s.title} ${s.address} ${s.notes}`.toLowerCase().includes(q));
}
let pinSequence = 0;
function pinIcon(stop) {
  const zoom=map.getZoom();
  const [width,height]=zoom<=14?[11,20]:zoom<=15?[15,27]:zoom<=16?[20,36]:[24,43];
  // Use one map color: adult treats, then decorations, then candy.
  const offerings=[displayCategory(stop)];
  const clipId='coffin-pin-'+(++pinSequence);
  const outline='M7 1H19L25 11L20 33L13 43L6 33L1 11Z';
  const bands=offerings.map((k,i)=>'<rect x="'+(i*26/offerings.length)+'" y="0" width="'+(26/offerings.length+.1)+'" height="44" fill="'+categories[k].color+'"/>').join('');
  const face=visited.has(stop.id)?'<path d="m7 15 4 4 8-9" fill="none" stroke="#fff5dc" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>':zoom>=16?'<path d="m6 10 5 1-4 4zm14 0-5 1 4 4zM7 19l3 1 3-2 3 2 3-1-2 5H9Z" fill="#29182e"/>':'';
  const svg='<svg viewBox="0 0 26 44" aria-hidden="true"><defs><clipPath id="'+clipId+'"><path d="'+outline+'"/></clipPath></defs><g clip-path="url(#'+clipId+')">'+bands+'</g><path d="'+outline+'" fill="none" stroke="#f5d5ae" stroke-opacity=".8" stroke-width="1.1"/>'+face+'</svg>';
  return L.divIcon({className:'pin-shell',iconSize:[36,46],iconAnchor:[18,46],html:'<div class="haunt-pin '+(visited.has(stop.id)?'visited ':'')+(selectedId===stop.id?'selected':'')+'" style="--marker-width:'+width+'px;--marker-height:'+height+'px">'+svg+'</div>'});
}
function render() {
  const visible = visibleStops(); drawMapStops();
  const totalVisited = stops.filter(s => visited.has(s.id)).length;
  $('#progress').textContent = `${totalVisited} of ${stops.length} stops visited`;
  $('#progress-fill').style.width = `${stops.length?totalVisited/stops.length*100:0}%`;
  $('#count').textContent = `${visible.length} stop${visible.length===1?'':'s'}`;
  $('#list-title').textContent = visitedOnly ? 'Our visited stops' : 'Explore our stops';
  $('#hide-visited').disabled = visitedOnly;
  $('#stop-list').innerHTML = visible.length ? visible.map(s => {
    const category=displayCategory(s),c=categories[category];
    return `<button class="stop-row" data-stop="${escapeHtml(s.id)}"><span class="stop-icon ${category}">${c.icon}</span><span class="stop-text"><span class="stop-title">${escapeHtml(s.title)}</span><span class="stop-address">${escapeHtml(s.address)}</span><span class="stop-badge">${s.categories.map(k=>categories[k].label).join(' · ')}</span></span>${visited.has(s.id)?'<span class="visit-tick" aria-label="Visited">✓</span>':''}</button>`;
  }).join('') : `<div class="empty"><span class="empty-icon">${visitedOnly?'👣':'🎃'}</span><strong>${visitedOnly?'Our night starts here':stops.length?'No matching stops':'Be the first on the block'}</strong>${visitedOnly?'Tap a colored house and mark it visited as you explore.':stops.length?'Try another filter or search.':'Save a house as your crew explores ArrowBrooke.'}</div>`;
  $('#stop-list').querySelectorAll('[data-stop]').forEach(b => b.onclick = () => showDetail(b.dataset.stop));
  if (selectedId && !visible.some(s=>s.id===selectedId)) closeDetail();
}
function closeDetail() { selectedId = null; $('#detail').hidden = true; }
function showDetail(id, pan = true) {
  if(document.body.classList.contains('picking'))return;
  const s = stops.find(s => s.id === id); if (!s) return;
  selectedId = id;
  drawMapStops();
  if(typeof setSheet === 'function' && innerWidth<=700)setSheet(false);
  const checked = visited.has(id);
  $('#detail').innerHTML = `<button class="icon-button close-detail" aria-label="Close details">×</button><div class="eyebrow">${demo?'SAMPLE STOP · ':''}HALLOWEEN NIGHT</div><h2>${escapeHtml(s.title)}</h2><div class="detail-tags">${s.categories.map(k=>`<span class="tag">${categories[k].icon} ${categories[k].label}</span>`).join('')}</div><p>⌖ ${escapeHtml(s.address)}</p>${s.notes?`<p>${escapeHtml(s.notes)}</p>`:''}<div class="detail-actions"><a class="secondary" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=walking" target="_blank" rel="noopener noreferrer">↗ Directions</a><button class="primary" id="toggle-visited">${checked?'✓ Visited':'Mark visited'}</button></div><button class="secondary" id="share-stop" style="width:100%;margin-top:10px">Share this stop</button>${db&&s.created_by===currentUserId?'<button class="secondary" id="remove-stop" style="width:100%;margin-top:10px">Remove my stop</button>':''}`;
  $('#detail').hidden = false;
  $('.close-detail').onclick = () => {closeDetail();render();};
  $('#toggle-visited').onclick = async () => {
    const nextVisited=!visited.has(id);
    if(demo){
      if(nextVisited)visited.add(id);else visited.delete(id);
      try{localStorage.setItem(visitKey,JSON.stringify([...visited]));}catch{}
      render();if(selectedId)showDetail(id,false);return;
    }
    if(!db){toast('Finish connecting our shared map to sync visits.');return;}
    $('#toggle-visited').disabled=true;
    try{
      await ensureVisitorSession();
      const {data,error}=await db.from('stops').update({visited:nextVisited}).eq('id',id).select('id,visited').single();
      if(error)throw error;
      if(data.visited)visited.add(id);else visited.delete(id);
      render();if(selectedId)showDetail(id,false);
      toast(nextVisited?'Checked off for the whole crew.':'Stop marked unvisited for the crew.');
    }catch{toast('Could not sync this visit. Check your connection and try again.');if($('#toggle-visited'))$('#toggle-visited').disabled=false;}
  };
  $('#share-stop').onclick = () => share(id);
  if ($('#remove-stop')) $('#remove-stop').onclick = async () => {
    if (!confirm('Remove your stop from the neighborhood map?')) return;
    $('#remove-stop').disabled = true;
    const {error} = await db.from('stops').delete().eq('id',id);
    if (error) {toast('Could not remove the stop. Please try again.');$('#remove-stop').disabled=false;return;}
    closeDetail();await loadStops();toast('Your stop was removed.');
  };
  if (pan) {map.setView(houseCache.has(id)?homeCenter(houseCache.get(id)):[s.lat,s.lng],Math.max(map.getZoom(),17),{animate:false});map.panBy(innerWidth>700?[-175,0]:[0,100],{animate:false});}
}
async function share(id) {
  const url = new URL(location.href); url.hash=''; url.search=''; if(demo)url.searchParams.set('demo','1'); if(id)url.searchParams.set('stop',id);
  try { if(navigator.share) await navigator.share({title:'ArrowBrooke After Dark',url:url.href}); else {await navigator.clipboard.writeText(url.href);toast('Map link copied.');} } catch(e) {if(e.name!=='AbortError')toast('Copy the map link from your browser’s address bar to share it.');}
}
let currentUserId = null;
async function ensureVisitorSession(){
  const {data,error}=await db.auth.getSession();if(error)throw error;
  let session=data.session;
  if(!session){const result=await db.auth.signInAnonymously();if(result.error)throw result.error;session=result.data.session;}
  currentUserId=session.user.id;
  // Use the visitor's JWT for Realtime; a publishable project key is not a JWT.
  await db.realtime.setAuth(session.access_token);
}
function streetNearPin(lat,lng){
  if(!streetMap)return null;
  try{
    const xScale=111320*Math.cos(lat*Math.PI/180),yScale=111320;
    let best=null,distance=80;
    for(const feature of streetMap.querySourceFeatures('openmaptiles',{sourceLayer:'transportation_name'})){
      const name=feature.properties?.['name:en']||feature.properties?.name;if(!name)continue;
      const lines=feature.geometry.type==='LineString'?[feature.geometry.coordinates]:feature.geometry.type==='MultiLineString'?feature.geometry.coordinates:[];
      for(const line of lines)for(let i=1;i<line.length;i++){
        const a=[(line[i-1][0]-lng)*xScale,(line[i-1][1]-lat)*yScale],b=[(line[i][0]-lng)*xScale,(line[i][1]-lat)*yScale];
        const dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;
        const t=den?Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/den)):0;
        const d=Math.hypot(a[0]+t*dx,a[1]+t*dy);
        if(d<distance){distance=d;best={text:name,hasNumber:false};}
      }
    }
    return best;
  }catch{return null;}
}
let addressRequest=0, lastSuggestedAddress='';
async function fillAddressFromPin(lat,lng){
  const request=++addressRequest;
  const input=document.querySelector('[name="address"]');
  const startingValue=input.value;
  if(startingValue.trim()&&startingValue!==lastSuggestedAddress){$('#address-help').textContent='Your entered address was kept. Check it matches the new pin.';return;}
  $('#address-help').textContent='Looking up this spot’s address…';
  try{
    let result;try{result=await lookupAddress(lat,lng,config.reverseGeocodeUrl);}catch{}
    result=result||streetNearPin(lat,lng);
    if(request!==addressRequest||input.value!==startingValue)return;
    if(!result){$('#address-help').textContent='No address found here. Please type the house number and street.';return;}
    input.value=result.text;lastSuggestedAddress=result.text;
    $('#address-help').textContent=result.hasNumber?'Suggested address—please check the house number before saving.':'Street found—please add the house number before saving.';
  }catch{if(request===addressRequest)$('#address-help').textContent='Address lookup is unavailable. You can still type the address.';}
}
const dialog = $('#add-dialog');
function openAdd() {closeDetail();$('#form-error').textContent='';dialog.showModal();}
$('#add').onclick = openAdd; $('#add-tab').onclick = openAdd;
$('.close-dialog').onclick = () => dialog.close();
$('#pick-location').onclick = () => {
  dialog.close();document.body.classList.add('picking');
  for (const id of ['place-hint','crosshair','confirm-location']) $('#'+id).hidden=false;
  if(chosenLocation)map.setView(chosenLocation,18);
};
function endPicking() {document.body.classList.remove('picking');for(const id of ['place-hint','crosshair','confirm-location'])$('#'+id).hidden=true;dialog.showModal();}
$('#confirm-location').onclick = () => {
  const point = map.getCenter();
  if(!inNeighborhood(point.lat,point.lng)){toast('Please choose a spot in ArrowBrooke.');return;}
  chosenLocation=[point.lat,point.lng];$('#location-label').textContent='✓ Location selected. Tap above to adjust it.';endPicking();fillAddressFromPin(point.lat,point.lng);
};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('picking'))endPicking();});
function inNeighborhood(lat,lng) {return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=33.23&&lat<=33.27&&lng>=-96.925&&lng<=-96.88;}
$('#stop-form').onsubmit = async e => {
  e.preventDefault(); const form = new FormData(e.target), errorEl=$('#form-error');errorEl.textContent='';
  const cats = form.getAll('categories');
  if(!cats.length){errorEl.textContent='Choose at least one kind of treat or decoration.';return;}
  if(!chosenLocation){errorEl.textContent='Choose your stop’s location on the map first.';return;}
  const title=form.get('title').trim()||pickStopName(stops.map(s=>s.title)), address=form.get('address').trim();
  if(!address){errorEl.textContent='Enter the house number and street address.';return;}
  if(address===lastSuggestedAddress && $('#address-help').textContent.startsWith('Street found')){errorEl.textContent='Please add the house number to the suggested street address.';return;}
  if(!db&&!demo){errorEl.textContent='Our shared map isn’t connected yet. Finish setup to save stops for the crew.';return;}
  const stop={title,address,categories:cats,notes:form.get('notes').trim(),lat:chosenLocation[0],lng:chosenLocation[1],event_date:config.eventDate};
  $('#save-stop').disabled=true;
  try {
    let id;
    if(demo){id=crypto.randomUUID();stops.push({...stop,id});}
    else {
      await ensureVisitorSession();
      const {data,error}=await db.from('stops').insert(stop).select().single();if(error)throw error;id=data.id;await loadStops();
    }
    dialog.close();e.target.reset();chosenLocation=null;addressRequest++;lastSuggestedAddress='';$('#address-help').textContent='Choose a spot on the map, or type the address yourself.';$('#location-label').textContent='Pick the house first; we’ll suggest its address.';filter.clear();visitedOnly=false;$('#search').value='';$('#hide-visited').checked=false;syncFilters();render();showDetail(id);toast(demo?'Sample stop added for this preview session.':'Stop saved for our crew!');
  } catch {errorEl.textContent='Could not save your stop. Check your connection and try again. If this continues, ask the organizer to check database setup.';}
  finally{$('#save-stop').disabled=false;}
};
function syncFilters(){document.querySelectorAll('[data-category]').forEach(b=>{const active=b.dataset.category==='all'?!filter.size:filter.has(b.dataset.category);b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});$('#explore-tab').classList.toggle('nav-active',!visitedOnly);$('#visited-tab').classList.toggle('nav-active',visitedOnly);}
$('.filters').onclick=e=>{const b=e.target.closest('[data-category]');if(!b)return;const category=b.dataset.category;if(category==='all')filter.clear();else if(filter.has(category))filter.delete(category);else filter.add(category);syncFilters();closeDetail();render();};
$('#search').oninput = () => {closeDetail();render();};$('#hide-visited').onchange=()=>{closeDetail();render();};
$('#explore-tab').onclick=()=>{visitedOnly=false;syncFilters();closeDetail();render();};$('#visited-tab').onclick=()=>{visitedOnly=true;syncFilters();closeDetail();render();};
$('#home').onclick=()=>map.setView(config.center,config.zoom);$('#zoom-in').onclick=()=>map.zoomIn();$('#zoom-out').onclick=()=>map.zoomOut();$('#share').onclick=()=>share();
$('#locate').onclick=()=>{
  if(!navigator.geolocation){toast('Your browser does not support location.');return;}
  $('#locate').disabled=true;
  navigator.geolocation.getCurrentPosition(p=>{const latlng=[p.coords.latitude,p.coords.longitude];if(userMarker)userMarker.remove();userMarker=L.circleMarker(latlng,{radius:8,color:'#fff',weight:3,fillColor:'#1a73e8',fillOpacity:1}).addTo(map).bindTooltip('You are here');map.setView(latlng,17);$('#locate').disabled=false;},()=>{toast('Location is unavailable. You can still explore the map or use the home button.');$('#locate').disabled=false;},{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
};
window.addEventListener('storage',e=>{if(demo&&e.key===visitKey){try{visited=new Set(JSON.parse(e.newValue||'[]'));render();}catch{}}});
async function loadStops() {
  const {data,error}=await db.from('stops').select('*').eq('event_date',config.eventDate).order('created_at');
  if(error)throw error;
  stops=data.filter(s=>Array.isArray(s.categories)&&s.categories.length&&s.categories.every(k=>categories[k])&&inNeighborhood(s.lat,s.lng));visited=new Set(stops.filter(s=>s.visited).map(s=>s.id));render();
  if(selectedId&&stops.some(s=>s.id===selectedId))showDetail(selectedId,false);
}
async function initialize(){
  if(demo){stops=demoStops;status('Preview · Sample stops. Shared sync needs setup.');render();return;}
  if(!config.supabaseUrl||!config.supabaseKey){status('Group setup in progress · Shared stops and visits aren’t connected yet.');render();return;}
  try{
    db=window.supabase.createClient(config.supabaseUrl,config.supabaseKey);
    db.auth.onAuthStateChange((event,session)=>{if(session?.access_token)setTimeout(()=>db.realtime.setAuth(session.access_token),0);});
    await ensureVisitorSession();
    await loadStops();
    await night.ready();
    db.channel('halloween-stops').on('postgres_changes',{event:'*',schema:'public',table:'stops'},()=>loadStops().catch(()=>status('Reconnecting · New stops may be delayed.'))).subscribe(s=>{
      if(s==='SUBSCRIBED'){status('● Crew map is live · Stops and visits sync automatically.',true);loadStops().catch(()=>status('Could not refresh stops. Check your connection.'));}
      else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(s))status('Reconnecting · New stops may be delayed.');
    });
    setInterval(()=>loadStops().catch(()=>status('Offline · Showing the last loaded stops.')),30000);
    const requested=new URLSearchParams(location.search).get('stop');if(requested)showDetail(requested);
  }catch{status('Could not connect to the neighborhood. Please try reloading.');render();}
}
map.on('zoomend',()=>render());
let lastTrailData='',lastTrailPaint='';
function paintStreetTrail(paths,paint){

 if(!streetMap?.getLayer('road_minor'))return;
 const data={type:'FeatureCollection',features:paths.map(path=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:path.map(p=>[p[1],p[0]])}}))};
 const encoded=JSON.stringify(data),paintKey=paint.color+':'+paint.width;
 if(!streetMap.getSource('our-haunted-trail')){
  streetMap.addSource('our-haunted-trail',{type:'geojson',data});
  const label=streetMap.getStyle().layers.find(l=>l.type==='symbol'&&l['source-layer']==='transportation_name')?.id;
  streetMap.addLayer({id:'our-trail-glow',type:'line',source:'our-haunted-trail',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#b73638','line-width':paint.width+8,'line-opacity':.13,'line-blur':3}},label);
  streetMap.addLayer({id:'our-trail-ink',type:'line',source:'our-haunted-trail',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':paint.color,'line-width':paint.width+1,'line-opacity':1}},label);
  lastTrailData=encoded;lastTrailPaint=paintKey;return;
 }
 if(lastTrailData!==encoded){streetMap.getSource('our-haunted-trail').setData(data);lastTrailData=encoded;}
 if(lastTrailPaint!==paintKey){streetMap.setPaintProperty('our-trail-glow','line-width',paint.width+8);streetMap.setPaintProperty('our-trail-ink','line-width',paint.width+1);streetMap.setPaintProperty('our-trail-ink','line-color',paint.color);lastTrailPaint=paintKey;}
}
function getRoadGraph(){if(!roadGraphCache){try{roadGraphCache=buildRoadGraph(streetMap?streetMap.querySourceFeatures('openmaptiles',{sourceLayer:'transportation'}):[]);}catch{return buildRoadGraph([]);}}return roadGraphCache;}
night=setupNight({L,map,getDb:()=>db,ensureSession:ensureVisitorSession,inNeighborhood,demo,toast,
 roadGraph:getRoadGraph,paintTrail:paintStreetTrail,
 snapPoint:(lat,lng)=>{const p=nearestRoad(getRoadGraph(),lat,lng);return p?{lat:p.lat,lng:p.lng}:null;},
 demoPath:()=>{try{return streetMap?roadSample(streetMap.querySourceFeatures('openmaptiles',{sourceLayer:'transportation_name'})):null;}catch{return null;}}
});
initialize();



// A compact map-first sheet on phones, expandable by tap or swipe.
let sheetState=1; // 0: map strip, 1: night controls, 2: stop list
function setSheet(state){
  sheetState=state;
  document.body.classList.toggle('sheet-expanded',state===2);
  document.body.classList.toggle('sheet-minimized',state===0);
  document.body.classList.remove('sheet-dragging');
  document.body.style.removeProperty('--sheet-height');
  $('#sheet-toggle').setAttribute('aria-expanded',String(state===2));
  $('#sheet-toggle').setAttribute('aria-label',state===0?'Open stop list':state===2?'Minimize stop list':'Expand or swipe down to minimize stop list');
  document.querySelector('.explore').scrollTop=0;
}
let sheetSwiped=false;
$('#sheet-toggle').onclick=()=>{if(sheetSwiped){sheetSwiped=false;return;}setSheet(sheetState===2?0:sheetState+1);};
for(const grip of document.querySelectorAll('.sheet-handle,.explore>.eyebrow,.explore>.title-row')){
  let swipeStart=null,startHeight=0;
  grip.addEventListener('pointerdown',e=>{
    if(!matchMedia('(max-width:700px)').matches)return;
    sheetSwiped=false;swipeStart=e.clientY;
    startHeight=document.querySelector('.explore').getBoundingClientRect().height;
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove',e=>{
    if(swipeStart===null||Math.abs(e.clientY-swipeStart)<6)return;
    document.body.classList.add('sheet-dragging');
    document.body.style.setProperty('--sheet-height',`${Math.max(64,Math.min(innerHeight*.67,startHeight+swipeStart-e.clientY))}px`);
  });
  grip.addEventListener('pointerup',e=>{
    if(swipeStart===null)return;
    const distance=e.clientY-swipeStart;
    if(Math.abs(distance)>25){sheetSwiped=true;setSheet(Math.max(0,Math.min(2,sheetState+(distance>0?-1:1))));e.preventDefault();}
    else setSheet(sheetState);
    swipeStart=null;
  });
  grip.addEventListener('pointercancel',()=>{swipeStart=null;setSheet(sheetState);});
}
$('#explore-tab').addEventListener('click',()=>setSheet(2));
$('#visited-tab').addEventListener('click',()=>setSheet(2));

