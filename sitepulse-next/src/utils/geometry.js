export const sqr = (x) => x * x;

export const dist2 = (v, w) => sqr(v.pctX - w.pctX) + sqr(v.pctY - w.pctY);

export const distToSegmentSquared = (p, v, w) => {
  const l2 = dist2(v, w);
  if (l2 === 0) return dist2(p, v);
  let t = ((p.pctX - v.pctX) * (w.pctX - v.pctX) + (p.pctY - v.pctY) * (w.pctY - v.pctY)) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist2(p, { pctX: v.pctX + t * (w.pctX - v.pctX), pctY: v.pctY + t * (w.pctY - v.pctY) });
};

export const distToSegment = (p, v, w) => Math.sqrt(distToSegmentSquared(p, v, w));

export const getCentroid = (points) => {
  if (!points || points.length === 0) return { pctX: 0, pctY: 0 };
  let sumX = 0, sumY = 0;
  points.forEach(p => { sumX += p.pctX; sumY += p.pctY; });
  return { 
    pctX: sumX / points.length, 
    pctY: sumY / points.length 
  };
};
