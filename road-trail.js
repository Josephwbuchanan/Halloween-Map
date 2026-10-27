import {meters} from './trail-geometry.js';
const key=p=>p[0].toFixed(7)+','+p[1].toFixed(7);
function streetLines(features){
 return features.filter(f=>!f.properties?.class||['minor','service','tertiary','secondary','primary','trunk','motorway'].includes(f.properties.class))
 .filter(f=>!['driveway','parking_aisle'].includes(f.properties?.subclass))
 .flatMap(f=>f.geometry?.type==='LineString'?[f.geometry.coordinates]:f.geometry?.type==='MultiLineString'?f.geometry.coordinates:[]);
}
export function buildRoadGraph(features){
 const nodes=new Map(),edges=[],seen=new Set();
 for(const line of streetLines(features))for(let i=1;i<line.length;i++){
  const a=line[i-1],b=line[i],ka=key(a),kb=key(b);if(ka===kb)continue;
  const edgeKey=[ka,kb].sort().join('|');if(seen.has(edgeKey))continue;seen.add(edgeKey);
  const length=meters({lat:a[1],lng:a[0]},{lat:b[1],lng:b[0]});
  if(!nodes.has(ka))nodes.set(ka,{coord:a,neighbors:[]});if(!nodes.has(kb))nodes.set(kb,{coord:b,neighbors:[]});
  nodes.get(ka).neighbors.push({id:kb,length});nodes.get(kb).neighbors.push({id:ka,length});edges.push({a,b,ka,kb,length,key:edgeKey});
 }
 return {nodes,edges};
}
export function nearestRoad(graph,lat,lng,maxMeters=25){
 const xs=111320*Math.cos(lat*Math.PI/180),ys=111320;let best=null,distance=maxMeters;
 for(const e of graph.edges){
  const a=[(e.a[0]-lng)*xs,(e.a[1]-lat)*ys],b=[(e.b[0]-lng)*xs,(e.b[1]-lat)*ys],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/den)):0,x=a[0]+t*dx,y=a[1]+t*dy,d=Math.hypot(x,y);
  if(d<distance){distance=d;best={lat:lat+y/ys,lng:lng+x/xs,t,edge:e};}
 }
 return best;
}
export function snapToRoad(features,lat,lng,maxMeters=25){const p=nearestRoad(buildRoadGraph(features),lat,lng,maxMeters);return p?{lat:p.lat,lng:p.lng}:null;}
export function traceRoad(graph,from,to){
 const start=nearestRoad(graph,from.lat,from.lng),end=nearestRoad(graph,to.lat,to.lng);if(!start||!end)return null;
 const first=[start.lat,start.lng],last=[end.lat,end.lng];
 if(start.edge.key===end.edge.key)return [first,last];
 const budget=Math.min(140,Math.max(60,meters(start,end)*2.5+30)),dist=new Map(),previous=new Map(),open=new Set();
 for(const [id,cost] of [[start.edge.ka,start.t*start.edge.length],[start.edge.kb,(1-start.t)*start.edge.length]]){dist.set(id,cost);previous.set(id,null);open.add(id);}
 const targets=new Map([[end.edge.ka,end.t*end.edge.length],[end.edge.kb,(1-end.t)*end.edge.length]]);let winning=null,best=budget;
 while(open.size){let current=null,cost=Infinity;for(const id of open)if(dist.get(id)<cost){cost=dist.get(id);current=id;}if(cost>best||current===null)break;open.delete(current);
  if(targets.has(current)&&cost+targets.get(current)<=best){winning=current;best=cost+targets.get(current);}
  for(const n of graph.nodes.get(current).neighbors){const next=cost+n.length;if(next<best&&next<(dist.get(n.id)??Infinity)){dist.set(n.id,next);previous.set(n.id,current);open.add(n.id);}}
 }
 if(winning===null)return null;
 const middle=[];for(let id=winning;id!==null;id=previous.get(id)){const p=graph.nodes.get(id).coord;middle.push([p[1],p[0]]);}middle.reverse();
 return [first,...middle,last].filter((p,i,arr)=>!i||p[0]!==arr[i-1][0]||p[1]!==arr[i-1][1]);
}
export function roadSample(features){
 const roads=features.filter(f=>String(f.properties?.['name:en']||f.properties?.name).toLowerCase()==='stoneleigh place');
 const candidates=streetLines(roads).sort((a,b)=>b.length-a.length);if(!candidates.length)return null;
 const line=candidates[0],result=[];
 for(let i=1;i<line.length;i++){
  const a={lat:line[i-1][1],lng:line[i-1][0]},b={lat:line[i][1],lng:line[i][0]},count=Math.max(1,Math.ceil(meters(a,b)/10));
  for(let j=0;j<count;j++)result.push([a.lat+(b.lat-a.lat)*j/count,a.lng+(b.lng-a.lng)*j/count]);
 }
 const end=line.at(-1);result.push([end[1],end[0]]);return result.slice(0,100);
}
