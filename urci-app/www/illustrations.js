// Simple field diagrams for each distress (inline SVG, no network). Built from TM 5-626 App. B descriptions:
// corrugations = ridges ACROSS the road (perpendicular to traffic); ruts = depressions ALONG the wheel paths.
// illustration(code, L) -> <svg>; L holds the localized labels (content.illus).
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const C = { ink: '#14171A', muted: '#4A5260', soil: '#E9DEC8', soilDark: '#B9A27A', water: '#9DB6E0', waterEdge: '#1D3B6E', grass: '#3F6212', mark: '#B42318' };

  function s(tag, attrs = {}, ...kids) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    for (const k of kids) n.append(typeof k === 'string' ? document.createTextNode(k) : k);
    return n;
  }
  const text = (x, y, str, o = {}) => s('text', { x, y, 'font-family': 'Barlow, sans-serif', 'font-size': (o.size || 11) + 2, fill: o.fill || C.muted, 'text-anchor': o.anchor || 'start', 'font-weight': o.weight || 500 }, str);
  const line = (x1, y1, x2, y2, o = {}) => s('line', { x1, y1, x2, y2, stroke: o.stroke || C.ink, 'stroke-width': o.w || 2, 'stroke-linecap': 'round', 'stroke-dasharray': o.dash || 'none' });
  const path = (d, o = {}) => s('path', { d, fill: o.fill || 'none', stroke: o.stroke || C.ink, 'stroke-width': o.w || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
  function arrow(x1, y, x2, label) {
    const g = s('g');
    g.append(line(x1, y, x2, y, { w: 1.5, stroke: C.muted }), path(`M${x2 - 6} ${y - 4} L${x2} ${y} L${x2 - 6} ${y + 4}`, { stroke: C.muted, w: 1.5 }));
    if (label) g.append(text((x1 + x2) / 2, y - 4, label, { anchor: 'middle', size: 10 }));
    return g;
  }
  // straightedge (thick bar) + ruler (ticked) measuring from the bar down to y2
  function gauge(x1, x2, y, rx, y2, L) {
    const g = s('g');
    g.append(s('rect', { x: x1, y: y - 3, width: x2 - x1, height: 4, fill: C.ink, rx: 1 }));
    g.append(line(rx, y + 1, rx, y2, { stroke: C.mark, w: 2 }));
    for (let k = y + 4; k < y2; k += 4) g.append(line(rx - 2, k, rx + 2, k, { stroke: C.mark, w: 1 }));
    g.append(text(rx + 4, y - 7, L.depth, { fill: C.mark, size: 10 }));
    return g;
  }
  function road(x, y, w, h) {
    return s('rect', { x, y, width: w, height: h, fill: C.soil, stroke: C.soilDark, 'stroke-width': 1.5, rx: 2 });
  }
  function frame(L, leftTitle, rightTitle) {
    const svg = s('svg', { viewBox: '0 0 320 150', width: '100%', class: 'illus', role: 'img' });
    svg.append(text(4, 12, leftTitle, { weight: 600, fill: C.ink }), text(170, 12, rightTitle, { weight: 600, fill: C.ink }));
    svg.append(line(162, 4, 162, 146, { stroke: '#C9CED6', w: 1 }));
    return svg;
  }

  const DRAW = {
    // 81: crowned road drains to the sides (good) vs flat/bowl road with ponding (distress)
    81(L) {
      const svg = frame(L, L.good, L.bad);
      svg.append(path('M8 110 L30 92 Q80 70 130 92 L152 110 Z', { fill: C.soil, stroke: C.soilDark, w: 1.5 }));
      // water runs off the crown to both edges
      svg.append(path('M66 74 Q48 78 34 86', { stroke: C.waterEdge, w: 2 }), path('M34 86 l7 -1 M34 86 l3 -6', { stroke: C.waterEdge, w: 2 }));
      svg.append(path('M94 74 Q112 78 126 86', { stroke: C.waterEdge, w: 2 }), path('M126 86 l-7 -1 M126 86 l-3 -6', { stroke: C.waterEdge, w: 2 }));
      svg.append(text(80, 132, L.crown, { anchor: 'middle', size: 10 }));
      svg.append(path('M176 110 L196 92 Q246 106 296 92 L316 110 Z', { fill: C.soil, stroke: C.soilDark, w: 1.5 }));
      svg.append(path('M222 99 Q246 106 270 99 Z', { fill: C.water, stroke: C.waterEdge, w: 1 }));
      svg.append(text(246, 132, L.ponding, { anchor: 'middle', size: 10 }));
      return svg;
    },
    // 82: clear side ditch vs blocked ditch with ponding and erosion
    82(L) {
      const svg = frame(L, L.good, L.bad);
      const roadSec = (ox) => path(`M${ox} 80 L${ox + 22} 80 L${ox + 30} 100 L${ox + 40} 100 L${ox + 48} 82 Q${ox + 80} 74 ${ox + 112} 82 L${ox + 120} 100 L${ox + 130} 100 L${ox + 138} 80 L${ox + 152} 80 L${ox + 152} 120 L${ox} 120 Z`, { fill: C.soil, stroke: C.soilDark, w: 1.5 });
      svg.append(roadSec(4), roadSec(168));
      svg.append(path('M34 97 L36 97', { stroke: C.waterEdge, w: 3 }), path('M124 97 L126 97', { stroke: C.waterEdge, w: 3 }));
      svg.append(text(80, 140, L.ditchClear, { anchor: 'middle', size: 10 }));
      svg.append(path('M196 86 L218 86 L214 96 L200 96 Z', { fill: C.water, stroke: C.waterEdge, w: 1 }));
      for (const gx of [202, 207, 212, 290, 295, 300]) svg.append(path(`M${gx} 100 l-2 -9 M${gx} 100 l2 -8`, { stroke: C.grass, w: 1.5 }));
      svg.append(path('M286 92 L300 92 L296 100 L290 100 Z', { fill: C.water, stroke: C.waterEdge, w: 1 }));
      svg.append(text(246, 140, L.ditchBlocked, { anchor: 'middle', size: 10 }));
      return svg;
    },
    // 83: plan view - ridges ACROSS the road; long section - waves measured with straightedge + ruler
    83(L) {
      const svg = frame(L, L.plan, L.alongSection);
      svg.append(road(6, 34, 150, 80), arrow(30, 28, 130, L.traffic));
      for (let x = 16; x <= 146; x += 9) svg.append(line(x, 38, x, 110, { stroke: C.soilDark, w: 3 }));
      svg.append(text(80, 132, L.acrossRoad, { anchor: 'middle', size: 10, fill: C.ink }));
      let d = 'M172 96';
      for (let x = 172; x <= 316; x += 2) d += ` L${x} ${96 + 7 * Math.sin((x - 172) / 18 * Math.PI)}`;
      svg.append(path(d + ' L316 120 L172 120 Z', { fill: C.soil, stroke: C.soilDark, w: 1.5 }));
      svg.append(gauge(176, 312, 88, 217, 103, L));
      svg.append(arrow(190, 30, 290, L.traffic));
      return svg;
    },
    // 84: vehicle with a dust cloud behind it
    84(L) {
      const svg = s('svg', { viewBox: '0 0 320 150', width: '100%', class: 'illus', role: 'img' });
      svg.append(road(0, 104, 320, 26));
      for (const [cx, cy, r, o] of [[70, 82, 26, 0.55], [110, 74, 30, 0.6], [40, 90, 18, 0.45], [150, 80, 22, 0.55], [92, 98, 18, 0.5]]) svg.append(s('circle', { cx, cy, r, fill: C.soilDark, 'fill-opacity': o }));
      svg.append(s('rect', { x: 170, y: 70, width: 70, height: 34, fill: '#1D3B6E', rx: 3 }), s('rect', { x: 240, y: 80, width: 30, height: 24, fill: '#1D3B6E', rx: 3 }));
      svg.append(s('rect', { x: 248, y: 84, width: 14, height: 9, fill: '#EEF2F8', rx: 1 }));
      for (const cx of [186, 224, 258]) svg.append(s('circle', { cx, cy: 106, r: 8, fill: C.ink }));
      svg.append(arrow(200, 56, 290, L.drive40));
      svg.append(text(90, 140, L.dustCloud, { anchor: 'middle', size: 10, fill: C.ink }));
      return svg;
    },
    // 85: plan with bowl-shaped holes; section with diameter and depth
    85(L) {
      const svg = frame(L, L.plan, L.acrossSection);
      svg.append(road(6, 30, 150, 86));
      for (const [cx, cy, rx, ry] of [[44, 56, 12, 9], [104, 88, 20, 14], [70, 96, 7, 5]]) svg.append(s('ellipse', { cx, cy, rx, ry, fill: '#8C7A5B', stroke: C.ink, 'stroke-width': 1 }));
      svg.append(line(84, 70, 124, 70, { stroke: C.mark, w: 1.5 }), text(104, 66, L.diameter, { anchor: 'middle', size: 10, fill: C.mark }));
      svg.append(path('M172 88 L218 88 Q244 124 270 88 L316 88 L316 120 L172 120 Z', { fill: C.soil, stroke: C.soilDark, w: 1.5 }));
      svg.append(gauge(206, 282, 84, 244, 105, L));
      svg.append(line(218, 132, 270, 132, { stroke: C.mark, w: 1.5 }), text(244, 145, L.diameter, { anchor: 'middle', size: 10, fill: C.mark }));
      return svg;
    },
    // 86: plan - long grooves ALONG the wheel paths; cross-section - two dips under the wheels
    86(L) {
      const svg = frame(L, L.plan, L.acrossSection);
      svg.append(road(6, 34, 150, 80), arrow(30, 28, 130, L.traffic));
      for (const y of [56, 92]) svg.append(s('rect', { x: 8, y: y - 6, width: 146, height: 12, fill: '#8C7A5B', rx: 6 }));
      svg.append(text(80, 132, L.alongWheels, { anchor: 'middle', size: 10, fill: C.ink }));
      svg.append(path('M172 90 L196 90 Q210 106 224 90 L264 90 Q278 106 292 90 L316 90 L316 120 L172 120 Z', { fill: C.soil, stroke: C.soilDark, w: 1.5 }));
      svg.append(gauge(180, 308, 86, 210, 99, L));
      svg.append(text(244, 132, L.wheelPath, { anchor: 'middle', size: 10 }));
      return svg;
    },
    // 87: berms of loose gravel at the edges and centre; berm thickness with ruler
    87(L) {
      const svg = frame(L, L.plan, L.acrossSection);
      svg.append(road(6, 34, 150, 80), arrow(30, 28, 130, L.traffic));
      for (const y of [40, 74, 108]) for (let x = 12; x < 152; x += 6) svg.append(s('circle', { cx: x + ((y / 2) % 3), cy: y + ((x * 7) % 5) - 2, r: 1.8, fill: '#7A6648' }));
      svg.append(text(80, 132, L.berms, { anchor: 'middle', size: 10, fill: C.ink }));
      svg.append(path('M172 100 L316 100 L316 120 L172 120 Z', { fill: C.soil, stroke: C.soilDark, w: 1.5 }));
      for (const [bx, w] of [[176, 26], [231, 26], [286, 26]]) {
        svg.append(path(`M${bx} 100 Q${bx + w / 2} ${82} ${bx + w} 100 Z`, { fill: '#C9B48E', stroke: '#7A6648', w: 1 }));
        for (let k = 0; k < 7; k++) svg.append(s('circle', { cx: bx + 5 + k * 2.6, cy: 96 - (k % 3) * 3, r: 1.5, fill: '#7A6648' }));
      }
      svg.append(line(259, 100, 259, 86, { stroke: C.mark, w: 2 }), text(263, 82, L.bermHeight, { fill: C.mark, size: 10 }));
      return svg;
    },
  };

  root.illustration = function illustration(code, L, label) {
    const svg = DRAW[code](L);
    svg.setAttribute('aria-label', label || '');
    return svg;
  };
})(typeof self !== 'undefined' ? self : this);
