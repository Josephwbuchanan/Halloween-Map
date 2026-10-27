export function meters(a,b){const r=Math.PI/180,x=(b.lng-a.lng)*r*Math.cos((a.lat+b.lat)*r/2),y=(b.lat-a.lat)*r;return Math.hypot(x,y)*6371000;}
export function trailSegments(points){
 const runs=new Map();
 for(const p of points){if(!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||p.accuracy>40)continue;const k=p.created_by+':'+p.run_id;if(!runs.has(k))runs.set(k,[]);runs.get(k).push(p);}
 const segments=[];
 for(const run of runs.values()){
  run.sort((a,b)=>Date.parse(a.captured_at)-Date.parse(b.captured_at));let segment=[];
  for(const p of run){const last=segment.at(-1);if(last){const seconds=(Date.parse(p.captured_at)-Date.parse(last.captured_at))/1000,distance=meters(last,p);if(seconds<0||!Number.isFinite(seconds))continue;if(seconds>90||distance>45||(seconds>0&&distance/seconds>5)){if(segment.length>1)segments.push(segment);segment=[];}}
   segment.push(p);
  }
  if(segment.length>1)segments.push(segment);
 }
 return segments;
}
