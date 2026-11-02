# Reader-1 curve tracer v2: masks all grid rows/cols (major+minor), clusters curve strokes per column,
# calibrates piecewise-linearly on the thick major grid lines.
import sys, json
from PIL import Image
def groups(idx):
    g=[]
    for v in idx:
        if g and v-g[-1][-1]<=2: g[-1].append(v)
        else: g.append([v])
    return g
def load(path):
    im=Image.open(path).convert('L'); w,h=im.size; p=im.load()
    d=[[p[x,y]<128 for x in range(w)] for y in range(h)]
    return w,h,d
def lines(w,h,d,axis,frac):
    if axis=='h': f=[sum(d[y])/w for y in range(h)]; n=h
    else: f=[sum(d[y][x] for y in range(h))/h for x in range(w)]; n=w
    return groups([i for i in range(n) if f[i]>frac])
def run(cfg):
    w,h,d=load(cfg['img'])
    mf=cfg.get('minor',0.25)
    hg=lines(w,h,d,'h',mf); vg=lines(w,h,d,'v',mf)
    hmask=set(y for g in hg for y in range(g[0]-1,g[-1]+2))
    vmask=set(x for g in vg for x in range(g[0]-2,g[-1]+3))
    def interp(cal,p):
        cal=sorted(cal)
        if p<=cal[0][0]: (p0,v0),(p1,v1)=cal[0],cal[1]
        elif p>=cal[-1][0]: (p0,v0),(p1,v1)=cal[-2],cal[-1]
        else:
            for (p0,v0),(p1,v1) in zip(cal,cal[1:]):
                if p0<=p<=p1: break
        return v0+(p-p0)*(v1-v0)/(p1-p0)
    xcal=cfg['xcal']; ycal=cfg['ycal']
    inv=[(v,p) for p,v in xcal]
    masks=cfg.get('masks',[])
    n=cfg['n']; res={}
    for xv in cfg['xs']:
        x0=int(round(interp(inv,xv)))
        cand=[]
        for x in range(x0-6,x0+7):
            if x in vmask or x<0 or x>=w: continue
            ys=[y for y in range(h) if d[y][x] and y not in hmask and not any(m[0]<=x<=m[2] and m[1]<=y<=m[3] for m in masks)]
            cl=[c for c in groups2(ys) if c[-1]-c[0]>=1 or len(c)>=2]
            if len(cl)==n: cand.append((abs(x-x0),x,[(c[0]+c[-1])/2 for c in cl]))
        if cand:
            cand.sort(); _,x,ys=cand[0]
            xr=interp(xcal,x)
            res[xv]=(round(xr,2),[round(interp(ycal,y),2) for y in ys])
        else: res[xv]=None
    return hg,vg,res
def groups2(ys):
    g=[]
    for y in ys:
        if g and y-g[-1][-1]<=6: g[-1].append(y)
        else: g.append([y])
    return g
if __name__=='__main__':
    cfg=json.load(open(sys.argv[1]))
    hg,vg,res=run(cfg)
    if cfg.get('show_grid'):
        print('thick h',[ (g[0]+g[-1])/2 for g in hg if len(g)>=4]); print('thick v',[(g[0]+g[-1])/2 for g in vg if len(g)>=4])
    print(json.dumps({str(k):v for k,v in res.items()}))
