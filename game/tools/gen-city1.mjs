// Generates src/data/city1.json (manager-owned map). Run: node tools/gen-city1.mjs
import { writeFileSync } from 'node:fs';
const xs = [100, 300, 500, 700, 900], ys = [150, 450, 800, 1150, 1450];
const id = (c, r) => `n${c}${r}`;
const nodes = [], edges = [];
xs.forEach((x, c) => ys.forEach((y, r) => nodes.push({ id: id(c, r), x, y })));
const cut = new Set(['n10-n11', 'n32-n33', 'n13-n23', 'n31-n41']); // a few missing streets -> routes matter
const add = (a, b) => { if (!cut.has(`${a}-${b}`)) edges.push({ a, b, kind: (a[1] === '2' && b[1] === '2') || (a[2] === '2' && b[2] === '2') ? 'main' : 'street' }); };
for (let c = 0; c < 5; c++) for (let r = 0; r < 5; r++) { if (c < 4) add(id(c, r), id(c + 1, r)); if (r < 4) add(id(c, r), id(c, r + 1)); }
const slots = (cx, cy, n) => Array.from({ length: n }, (_, i) => ({ x: cx - 60 + (i % 4) * 40, y: cy + 40 + Math.floor(i / 4) * 45 }));
const spots = [
  { id: 'spot-build-a', nodeId: 'n40', x: 800, y: 270, slots: slots(800, 270, 8) },
  { id: 'spot-hall-a', nodeId: 'n02', x: 200, y: 640, slots: slots(200, 640, 8) },
  { id: 'spot-build-b', nodeId: 'n33', x: 600, y: 990, slots: slots(600, 990, 8) },
];
const used = new Set(['800,300', '200,625', '600,975', '200,1300']); // block centers taken by spots + depot
const decor = [];
let k = 0;
for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
  const bx = (xs[c] + xs[c + 1]) / 2, by = (ys[r] + ys[r + 1]) / 2;
  if (used.has(`${bx},${by}`)) continue;
  decor.push({ key: `building-${(k++ % 6) + 1}`, x: bx - 30, y: by }, { key: k % 2 ? 'tree-1' : 'tree-2', x: bx + 55, y: by + 40, scale: 0.8 });
}
const map = { id: 'city1', name: 'עיר הבנייה', width: 1000, height: 1600, depotNodeId: 'n04', depot: { x: 200, y: 1300 }, nodes, edges, spots, decor };
writeFileSync(new URL('../src/data/city1.json', import.meta.url), JSON.stringify(map, null, 1));
console.log(nodes.length, 'nodes', edges.length, 'edges', decor.length, 'decor');
