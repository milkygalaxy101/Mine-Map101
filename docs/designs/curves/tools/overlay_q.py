import json
from PIL import Image, ImageDraw
doc=json.load(open('curves.reader1.json'))
def li(c,p):
    c=sorted(c)
    if p<=c[0][0]: a,b=c[0],c[1]
    elif p>=c[-1][0]: a,b=c[-2],c[-1]
    else: a,b=next((a,b) for a,b in zip(c,c[1:]) if a[0]<=p<=b[0])
    return a[1]+(p-a[0])*(b[1]-a[1])/(b[0]-a[0])
xc=[(15,0),(166,20),(316,40),(466,60),(616,80),(765,100),(914,120),(1064,140),(1212,160),(1362,180),(1512,200)]
yc=[(39,0),(187,20),(335,40),(483,60),(630,80),(777,100)]
xi=[(v,p) for p,v in xc]; yi=[(v,p) for p,v in yc]
im=Image.open('c8q.png').convert('RGB'); dr=ImageDraw.Draw(im)
cols=[(0,0,0),(0,0,0),(220,0,0),(0,150,0),(0,0,230),(200,120,0),(160,0,160),(0,160,160)]
for n,v in doc['urci'].items():
    n=int(n); P=[(li(xi,x),li(yi,y)) for x,y in v['points']]
    dr.line(P,fill=cols[n],width=2)
    for x,y in P: dr.ellipse((x-5,y-5,x+5,y+5),outline=cols[n],width=3)
im.save('c8q.overlay.png')
