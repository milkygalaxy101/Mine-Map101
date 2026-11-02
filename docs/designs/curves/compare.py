# CURVE-1 reconciliation: compare reader-2 hand readings with the reader-1 trace.
#  - deduct x up to 1 unit past reader-1's last traced point: last segment extended (chart edge)
#  - URCI: same rule as the engine (extend last segment, clamp 0..100)
#  - URCI x before a q-curve starts: reader 2 should leave blank -> flagged BLANK, not compared
# Writes reader2/comparison.csv and reader2/reread-list.csv (no reader-1 values, to keep re-reads independent).
import csv, json, sys
r1 = json.load(open('curves.reader1.json'))
TOL = 1.0
def seg(pts, x, extend):
    if x < pts[0][0]: return None
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1: return y0 + (x - x0) * (y1 - y0) / (x1 - x0)
    (x0, y0), (x1, y1) = pts[-2], pts[-1]
    if x - x1 > extend: return None
    return y0 + (x - x0) * (y1 - y0) / (x1 - x0)
rows = list(csv.reader(open(sys.argv[1]), delimiter=';'))[1:]
out, reread = [], []
for chart, fig, page, sev, x, y in rows:
    if not y.strip(): continue
    x = float(x); y = float(y.replace(',', '.'))
    if chart == 'URCI':
        q = sev.split('=')[1]; pts = r1['urci'][q]['points']
        if x < pts[0][0] - 1:
            out.append((chart, sev, x, y, '', '', f'BLANK (q={q} line starts at TDV {pts[0][0]:.0f})')); continue
        v = seg(pts, x, 1e9); v = max(0.0, min(100.0, v))
    else:
        v = seg(r1['deduct'][chart]['severity'][sev], x, 1.0)
        if v is None:
            out.append((chart, sev, x, y, '', '', 'NOT COMPARED')); continue
    d = y - v
    flag = 'RE-READ' if abs(d) > TOL else ''
    out.append((chart, sev, x, y, round(v, 1), round(d, 1), flag))
    if flag: reread.append((chart, fig, page, sev, x))
with open('reader2/comparison.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['chart', 'severity_or_q', 'x', 'reader2', 'reader1', 'diff', 'flag']); w.writerows(out)
with open('reader2/reread-list.csv', 'w', newline='') as f:
    w = csv.writer(f, delimiter=';'); w.writerow(['chart', 'figure', 'pdf_page_label', 'severity_or_q', 'x', 'y RE-READ - FILL IN']); w.writerows([r + ('',) for r in reread])
cmp = [r for r in out if r[5] != '']
print(f"compared {len(cmp)}, agree within ±{TOL}: {sum(1 for r in cmp if not r[6])}, re-read: {len(reread)}, blank-expected: {sum(1 for r in out if r[6].startswith('BLANK'))}")
for k in ['81', '82', '83', '85', '86', '87', 'URCI']:
    c = [r for r in cmp if r[0] == k]
    print(f"  {k}: {sum(1 for r in c if r[6])}/{len(c)} re-read, max |diff| {max(abs(r[5]) for r in c):.1f}, mean diff {sum(r[5] for r in c)/len(c):+.2f}")
