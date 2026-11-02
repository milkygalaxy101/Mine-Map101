import json, subprocess, sys
def run(cfg):
    o=subprocess.run([sys.executable,'-W','ignore','trace2.py',cfg],capture_output=True,text=True).stdout
    return json.loads(o.strip().splitlines()[-1])
def clean(pts):
    # pts: list of (x,y); drop points that break monotonic non-decreasing y or deviate from neighbours
    pts=sorted(pts); out=[]
    for i,(x,y) in enumerate(pts):
        if 0<i<len(pts)-1:
            (x0,y0),(x1,y1)=pts[i-1],pts[i+1]
            yi=y0+(x-x0)*(y1-y0)/(x1-x0)
            if abs(y-yi)>1.2: continue
        out.append((x,y))
    return out
charts={'81':('c81m.json','C-1 (metric)'),'82':('c82m.json','C-2 (metric)'),'83':('c83.json','C-3'),
        '85':('c85m.json','C-5 (metric)'),'86':('c86.json','C-6'),'87':('c87m.json','C-7 (metric)')}
skip={'85':lambda x:x<1.4,'83':lambda x:x<1.5}
deduct={}
for k,(cfg,fig) in charts.items():
    res=run(cfg); sev={'H':[],'M':[],'L':[]}
    for _,v in res.items():
        if not v: continue
        x,ys=v
        if k in skip and skip[k](x): continue
        for s,y in zip('HML',ys): sev[s].append((x,y))
    deduct[k]={'figure':fig,'unit':'metric' if 'metric' in fig else 'any',
               'severity':{s:[[0,0]]+[[round(a,2),round(b,2)] for a,b in clean(p)] for s,p in sev.items()}}
# URCI curves
raw=json.load(open('c8q.out.json'))
start={2:13,3:20,4:25,5:28,6:41.5,7:41.5}
q={n:[] for n in range(2,8)}
for t,(x,vals) in raw.items():
    S=[n for n in range(2,8) if start[n]<=x+0.5]
    if not S: continue
    if x<=142:
        present=[n for n in S if n!=7]
        if len(vals)!=len(present): continue
        for n,v in zip(present,vals):
            q[n].append((x,v))
            if n==6: q[7].append((x,v))
    else:
        # continuity tracking: match each value to the curve whose extrapolated value is nearest
        used=set()
        for v in vals:
            best=None
            for n in range(2,8):
                p=q[n]
                if len(p)<2 or n in used: continue
                (x0,y0),(x1,y1)=p[-2],p[-1]
                pred=y1+(x-x1)*(y1-y0)/(x1-x0) if x1!=x0 else y1
                if n==7 and x<150: pred+=1.0   # 6/7 split: 7 is the lower (higher URCI) branch
                dlt=abs(v-pred)
                if dlt<3.0 and (best is None or dlt<best[0]): best=(dlt,n)
            if best and v>=0:
                used.add(best[1]); q[best[1]].append((x,v))
def cleandec(p):
    p=sorted(p); out=[]
    for i,(x,y) in enumerate(p):
        if 0<i<len(p)-1:
            (x0,y0),(x1,y1)=p[i-1],p[i+1]
            if abs(y-(y0+(x-x0)*(y1-y0)/(x1-x0)))>1.2: continue
        out.append((x,y))
    return out
urci={'1':{'note':'q=0 or 1: URCI = 100 - TDV (straight line, not traced)','points':[[0,100],[100,0]]}}
for n,p in q.items(): urci[str(n)]={'points':[[round(a,2),round(b,2)] for a,b in cleandec(p)]}
urci['6']['note']=urci['7']['note']='q=6 and q=7 share one line from TDV 41.5 until they split near TDV 143'
doc={'_status':'DRAFT reader-1 (CURVE-1). Not for production until reader-2 agrees within tolerance.',
     '_source':'TM 5-626 Appendix C, Figs C-1..C-8, rendered at 300 dpi; traced with grid removal + per-column stroke clustering',
     '_reader':'reader-1: automated trace (Claude), reviewed against overlay plots',
     'dust84':{'L':2,'M':4,'H':15},'deduct':deduct,'urci':urci}
json.dump(doc,open('curves.reader1.json','w'),indent=1)
for k,v in deduct.items(): print(k,{s:len(p) for s,p in v['severity'].items()})
for n,v in urci.items(): print('q',n,len(v['points']),v['points'][:2],v['points'][-2:])
