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

export const getSnappedCoordinate = (cursorPctX, cursorPctY, rBushTree, aspect, drawW, stageScale, strength = 15) => {
  if (!rBushTree) return { pctX: cursorPctX, pctY: cursorPctY, snapped: false };

  // Dynamic snap radius based on physical canvas width, zoom level, and user strength setting
  const snapRadiusX = strength / (drawW * stageScale);
  const snapRadiusY = strength / ((drawW / aspect) * stageScale);

  const nearbyLines = rBushTree.search({
    minX: cursorPctX - snapRadiusX,
    minY: cursorPctY - snapRadiusY,
    maxX: cursorPctX + snapRadiusX,
    maxY: cursorPctY + snapRadiusY
  });

  if (nearbyLines.length === 0) return { pctX: cursorPctX, pctY: cursorPctY, snapped: false };

  let closestDist = Infinity;
  let bestPoint = { pctX: cursorPctX, pctY: cursorPctY };
  
  let closestVertexDist = Infinity;
  let bestVertex = null;

  nearbyLines.forEach(({ lineData }) => {
    const { start, end } = lineData;
    
    // Check vertices (corners) for priority snapping
    const dStart = Math.sqrt(sqr(cursorPctX - start.pctX) + sqr((cursorPctY - start.pctY) / aspect));
    if (dStart < closestVertexDist) {
       closestVertexDist = dStart;
       bestVertex = start;
    }
    
    const dEnd = Math.sqrt(sqr(cursorPctX - end.pctX) + sqr((cursorPctY - end.pctY) / aspect));
    if (dEnd < closestVertexDist) {
       closestVertexDist = dEnd;
       bestVertex = end;
    }
    
    // Account for aspect ratio distortion in standard pct space calculations
    const l2 = sqr(start.pctX - end.pctX) + sqr((start.pctY - end.pctY) / aspect);
    if (l2 === 0) return;

    let t = ((cursorPctX - start.pctX) * (end.pctX - start.pctX) + 
            ((cursorPctY - start.pctY) / aspect) * ((end.pctY - start.pctY) / aspect)) / l2;
    t = Math.max(0, Math.min(1, t));

    const projX = start.pctX + t * (end.pctX - start.pctX);
    const projY = start.pctY + t * (end.pctY - start.pctY);

    const dist = Math.sqrt(sqr(cursorPctX - projX) + sqr((cursorPctY - projY) / aspect));

    if (dist < closestDist) {
      closestDist = dist;
      bestPoint = { pctX: projX, pctY: projY };
    }
  });

  // Corner gravity: if a vertex is within the snap radius, strictly prefer it over a straight edge projection
  if (closestVertexDist < snapRadiusX) {
    return { pctX: bestVertex.pctX, pctY: bestVertex.pctY, snapped: true };
  }

  // Since closestDist uses aspect-corrected distance, it is in the scale of pctX.
  if (closestDist < snapRadiusX) {
    return { ...bestPoint, snapped: true };
  }

  return { pctX: cursorPctX, pctY: cursorPctY, snapped: false };
};
