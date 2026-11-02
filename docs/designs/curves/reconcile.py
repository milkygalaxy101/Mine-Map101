# CURVE-1 reconciliation -> curves.reconciled.json
#  Deduct charts (81-87): reader-1 trace kept; reader 2 confirms it (all points within ±1, mean diff ~0).
#  Fig C-8: midpoint of both readers. For each q, the reader-2 minus reader-1 difference is interpolated
#  along TDV between compared points and half of it is added to every reader-1 point (smooth shift, no
#  single-point kinks). Result clamped to 0..100 and kept non-increasing.
import csv, json
r1 = json.load(open('curves.reader1.json'))
cmp = [r for r in csv.DictReader(open('reader2/comparison.csv')) if r['diff'] != '']
out = json.loads(json.dumps(r1))
def interp(pts, x):
    if x <= pts[0][0]: return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1: return y0 + (x - x0) * (y1 - y0) / (x1 - x0)
    return pts[-1][1]
shifts = {}
for q, curve in r1['urci'].items():
    if q == '1': continue
    d = sorted((float(r['x']), float(r['diff'])) for r in cmp if r['chart'] == 'URCI' and r['severity_or_q'] == f'q={q}')
    if not d: continue
    pts, prev = [], 101.0
    for x, y in curve['points']:
        ny = min(100.0, max(0.0, y + interp(d, x) / 2))
        ny = min(ny, prev)  # keep non-increasing
        pts.append([x, round(ny, 2)]); prev = ny
    out['urci'][q]['points'] = pts
    shifts[q] = [round(v / 2, 2) for _, v in d]
out['_status'] = 'RECONCILED (CURVE-1): reader 1 trace + reader 2 hand reading, 2026-11-02'
out['_reconciliation'] = {
    'deduct': 'reader-1 trace kept; reader 2 within ±1 at all 204 points (max 0.9, mean diff -0.04..+0.10)',
    'urci': 'midpoint of readers 1 and 2 along each q-curve; 52/57 points within ±1 before averaging, the rest 1.0-1.5',
    'files': ['reader2/reader2-final.csv', 'reader2/comparison.csv', 'compare.py', 'reconcile.py'],
}
json.dump(out, open('curves.reconciled.json', 'w'), indent=1)
for q, s in shifts.items(): print(f'q={q} half-diffs applied: min {min(s):+.2f} max {max(s):+.2f}')
