import * as THREE from 'three';
import { CITY, roadCoord, CITY_HALF } from '../world/city.js';

/** Nearest road-graph node to a position. */
export function nearestNode(city, p) {
  let best = null, bd = Infinity;
  for (const n of city.nodes) {
    const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2;
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

/** Dijkstra over intersections. Returns an array of nodes from a to b. */
export function nodePath(city, a, b) {
  if (a === b) return [a];
  const dist = new Map([[a.id, 0]]);
  const prev = new Map();
  const open = [a];
  const done = new Set();
  while (open.length) {
    open.sort((x, y) => dist.get(x.id) - dist.get(y.id));
    const n = open.shift();
    if (n === b) break;
    if (done.has(n.id)) continue;
    done.add(n.id);
    for (const s of n.out) {
      const m = s.to;
      const nd = dist.get(n.id) + s.length + (s.to.signal ? 8 : 0);
      if (nd < (dist.get(m.id) ?? Infinity)) {
        dist.set(m.id, nd);
        prev.set(m.id, n);
        open.push(m);
      }
    }
  }
  const path = [b];
  let cur = b;
  while (cur !== a) {
    cur = prev.get(cur.id);
    if (!cur) return [a, b];
    path.unshift(cur);
  }
  return path;
}

/** Route polyline for the GPS: follows road centre lines (right-hand lane). */
export function route(city, from, to) {
  const inCity = (p) => Math.abs(p.x) < CITY_HALF + 2 && Math.abs(p.z) < CITY_HALF + 2;
  const pts = [from.clone()];
  if (!inCity(from) && !inCity(to)) {
    pts.push(to.clone());
    return pts;
  }
  const a = nearestNode(city, inCity(from) ? from : to);
  const b = nearestNode(city, inCity(to) ? to : from);
  const nodes = nodePath(city, a, b);
  // snap the first point onto the road leading to the first node
  for (const n of nodes) pts.push(new THREE.Vector3(n.x, 0.5, n.z));
  pts.push(to.clone());
  return pts;
}

/** First road-graph segment heading from node a to node b. */
export function segmentBetween(a, b) {
  return a.out.find((s) => s.to === b) || null;
}

export { roadCoord, CITY };
