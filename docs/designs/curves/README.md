# Appendix C curves — reader 1 (DRAFT)

**Status:** draft, reader 1 of 2 (CURVE-1). The app must not ship these numbers until a second,
independent human reading agrees with them within tolerance (±1 per deduct value, ±2 URCI).

## What is here

| File | What it is |
|---|---|
| `curves.reader1.json` | Deduct curves for 81, 82, 85, 87 (metric), 83 and 86 (unit-free), dust 84 fixed values, and URCI curves q=1..7 (Fig C-8). Each curve is a list of `[x, y]` points, starting at `[0, 0]` for deducts. |
| `validate.py` | Recomputes the TM 5-626 worked examples (FS101, FS144) from the JSON using ENG-1 rules: linear interpolation, q = count of deducts > 5.0, round once at the end. Usage: `python3 validate.py curves.reader1.json` |
| `overlays/` | Every traced point drawn on the original 300 dpi chart. Red/green/blue = H/M/L; on C-8, one colour per q. **Reader 2: check these first.** |
| `tools/` | The tracer (`trace2.py`, one JSON config per chart), the C-8 tracer (`c8q2.py`), the assembler and the overlay scripts. |

## How it was read

The PDF pages were rendered at 300 dpi and each metric chart was cropped. Grid rows and
columns (major and minor) were detected and masked, along with the title box, the H/M/L
labels and the axis numbers. Curve strokes were then clustered per column and calibrated
piecewise-linearly on the thick major grid lines.

On C-8, the curves were assigned to q by order and start point up to TDV 142. From there,
continuity tracking takes over, because the curve labels hide parts of the lines.

## Anchor check (TM worked examples)

```
FS101 81-L  18.2 -> 12.91 (13) TM 13  OK
FS101 83-M  50.0 -> 30.35 (30) TM 29  OK
FS101 84-M        ->  4          TM 4  OK
FS101 87-M  29.2 -> 17.94 (18) TM 18  OK
FS101 TDV 65.2 q 3 URCI 58.53 (59) TM 59  OK
FS144 81-M  23.5 -> 19.42 (19) TM 19  OK
FS144 82-H  46.9 -> 36.20 (36) TM 36  OK
FS144 84-L        ->  2          TM 2  OK
FS144 86-M  35.0 -> 30.32 (30) TM 31  OK
FS144 86-H  65.0 -> 45.01 (45) TM 44  OK
FS144 TDV 133.0 q 4 URCI 22.82 (23) TM 25  OK (edge of ±2)
```

## Things reader 2 must look at

1. **C-8, q=4 near TDV 120–140.** The trace gives URCI 23 at TDV 133. The TM worked example
   says 25. That is exactly at the ±2 limit. The curve-to-q assignment was checked against the
   label positions, so this looks like a hand-reading difference in the TM, but it needs an
   independent eye.
2. **83-M at 50 %** reads 30.35. The TM example uses 29. This is within ±1.
3. **86-M at 35 %** (30.3 vs 31) and **86-H at 65 %** (45.0 vs 44) are within ±1. They pull in
   opposite directions, so TDV barely moves.
4. **C-8, q=6 and q=7** share one line from TDV 41.5 until they split near TDV 143. The JSON
   repeats the shared points in both curves.
5. **The C-8 legend reads "equal to or greater than 5".** The app uses > 5.0 (§3-4b(3)). A
   deduct of exactly 5.0 changes q between the two readings, so this needs a decision before
   release.
6. **Steep starts.** 85-H below 1.5 % and every curve below about 2 % density are interpolated
   from `[0, 0]`. The tracer cannot separate the strokes there.
