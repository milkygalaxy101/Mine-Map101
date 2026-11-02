import trace2, json
w,h,d=trace2.load('c8q.png')
major=[(36,42),(182,190),(330,338),(478,486),(628,631),(774,778)]
hm=set(y for a,b in major for y in range(a-1,b+2))
vg=trace2.lines(w,h,d,'v',0.25); vm=set(x for g in vg for x in range(g[0]-2,g[-1]+3))
xc=[(15,0),(166,20),(316,40),(466,60),(616,80),(765,100),(914,120),(1064,140),(1212,160),(1362,180),(1512,200)]
yc=[(39,0),(187,20),(335,40),(483,60),(630,80),(777,100)]
def li(c,p):
    c=sorted(c)
    if p<=c[0][0]: a,b=c[0],c[1]
    elif p>=c[-1][0]: a,b=c[-2],c[-1]
    else: a,b=next((a,b) for a,b in zip(c,c[1:]) if a[0]<=p<=b[0])
    return a[1]+(p-a[0])*(b[1]-a[1])/(b[0]-a[0])
masks=[[880,615,1505,725],[525,70,705,93],[970,90,1010,135],[1065,100,1105,145],[1150,120,1195,165],[1225,130,1265,175],[1325,135,1370,180],[1395,180,1435,225],[0,780,1700,830],[0,0,12,830]]
def strokes(x):
    ys=[y for y in range(h) if d[y][x] and not any(m[0]<=x<=m[2] and m[1]<=y<=m[3] for m in masks)]
    runs=[]
    for y in ys:
        if runs and y-runs[-1][-1]<=1: runs[-1].append(y)
        else: runs.append([y])
    # drop runs that are pure major gridline rows; keep thick strokes
    keep=[]
    for r in runs:
        core=[y for y in r if y not in hm]
        if len(r)>=5 and (len(core)>=3 or len(r)>=9): keep.append((r[0]+r[-1])/2)
    return keep
out={}
for tdv in list(range(14,201,4)):
    x0=int(round(li([(v,p) for p,v in xc],tdv)))
    opts=[]
    for x in sorted(range(x0-5,x0+6),key=lambda x:abs(x-x0)):
        if x in vm: continue
        t=li(xc,x)
        vals=[round(li(yc,y),2) for y in strokes(x)]
        vals=[v for v in vals if abs(v-(100-t))>2.0]
        opts.append((round(t,2),vals))
    from collections import Counter
    cnt=Counter(len(o[1]) for o in opts); n=cnt.most_common(1)[0][0]
    o=next(o for o in opts if len(o[1])==n)
    out[tdv]=o; print(tdv,o)
json.dump(out,open('c8q.out.json','w'))
