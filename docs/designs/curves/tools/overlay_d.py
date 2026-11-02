import json,sys
from PIL import Image, ImageDraw
doc=json.load(open('curves.reader1.json'))
def li(c,p):
    c=sorted(c)
    if p<=c[0][0]: a,b=c[0],c[1]
    elif p>=c[-1][0]: a,b=c[-2],c[-1]
    else: a,b=next((a,b) for a,b in zip(c,c[1:]) if a[0]<=p<=b[0])
    return a[1]+(p-a[0])*(b[1]-a[1])/(b[0]-a[0])
for k,f in {'81':'c81m','82':'c82m','83':'c83','85':'c85m','86':'c86','87':'c87m'}.items():
    cfg=json.load(open(f+'.json')); xi=[(v,p) for p,v in cfg['xcal']]; yi=[(v,p) for p,v in cfg['ycal']]
    im=Image.open(f+'.png').convert('RGB'); dr=ImageDraw.Draw(im)
    for s,c in zip('HML',[(220,0,0),(0,150,0),(0,0,230)]):
        P=[(li(xi,x),li(yi,y)) for x,y in doc['deduct'][k]['severity'][s]]
        dr.line(P,fill=c,width=2)
        for x,y in P: dr.ellipse((x-5,y-5,x+5,y+5),outline=c,width=3)
    im.convert('P',palette=Image.ADAPTIVE,colors=32).save(sys.argv[1]+'/'+f+'.overlay.png',optimize=True)
