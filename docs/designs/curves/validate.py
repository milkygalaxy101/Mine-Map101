import json,sys
doc=json.load(open(sys.argv[1]))
def interp(pts,x):
    if x<=pts[0][0]: return pts[0][1]
    for (x0,y0),(x1,y1) in zip(pts,pts[1:]):
        if x0<=x<=x1: return y0+(x-x0)*(y1-y0)/(x1-x0)
    return pts[-1][1]
def deduct(code,sev,dens):
    if code=='84': return doc['dust84'][sev]
    return interp(doc['deduct'][code]['severity'][sev],dens)
def urci(dvs):
    tdv=sum(dvs); q=sum(1 for d in dvs if d>5.0)
    if q<=1: return tdv,q,max(0,100-tdv)
    return tdv,q,max(0,min(100,interp(doc['urci'][str(min(q,7))]['points'],tdv)))
ok=True
for name,items,exp_dv,exp_u in [
  ('FS101',[('81','L',18.2),('83','M',50.0),('84','M',0),('87','M',29.2)],[13,29,4,18],59),
  ('FS144',[('81','M',23.5),('82','H',46.9),('84','L',0),('86','M',35.0),('86','H',65.0)],[19,36,2,31,44],25)]:
    raw=[deduct(*i) for i in items]; dv=[round(r) for r in raw]
    for i,r,d,e in zip(items,raw,dv,exp_dv):
        flag='OK' if abs(d-e)<=1 else 'FAIL'; ok&=flag=='OK'
        print(f'{name} {i[0]}-{i[1]} {i[2]:>5} -> {r:5.2f} ({d}) TM {e}  {flag}')
    tdv,q,u=urci(raw)
    flag='OK' if abs(round(u)-exp_u)<=2 else 'FAIL'; ok&=flag=='OK'
    print(f'{name} TDV {tdv:.1f} q {q} URCI {u:.2f} ({round(u)}) TM {exp_u}  {flag}\n')
print('ALL ANCHORS PASS' if ok else 'ANCHOR FAILURE')
