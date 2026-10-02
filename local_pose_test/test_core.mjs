import test from 'node:test';
import assert from 'node:assert/strict';
import {angle,angleSeries,mirrorPoints,normalize,resample,difference,sampleTimes,toCsv,progress,angle3D,normalizeWorld,mirrorWorld,resamplePoses,clipBounds} from './core.mjs';
import {rotate3D} from './pose-view3d.mjs';
const pose=()=>Array.from({length:33},()=>[0,0,1]);
test('known angles, aspect-correct pixels, and degenerate limbs',()=>{
  assert.equal(angle([0,1],[0,0],[1,0]),90);
  assert.equal(angle([0,0],[1,0],[2,0]),180);
  assert.ok(Number.isNaN(angle([0,0],[0,0],[2,0])));
  const p=pose();p[23]=[0,0,1];p[25]=[1,0,1];p[27]=[2,0,0];
  assert.ok(Number.isNaN(angleSeries([p],.5)['左膝内角'][0]));
});
test('mirroring reflects pixels, swaps anatomy, and is reversible',()=>{
  const p=pose();p[11]=[10,20,.8];p[12]=[80,30,.9];
  const [m]=mirrorPoints([p],100);assert.deepEqual(m[11],[19,30,.9]);
  assert.deepEqual(mirrorPoints([m],100),[p]);
});
test('fixed torso units are translation/scale invariant, preserve optional displacement',()=>{
  const p=pose();p[11]=[0,0,1];p[12]=[2,0,1];p[23]=[0,2,1];p[24]=[2,2,1];p[16]=[3,1,1];
  const moved=p.map(([x,y,c])=>[x+4,y+6,c]);
  const scaled=p.map(([x,y,c])=>[x*3+100,y*3+200,c]);
  assert.deepEqual(normalize([p],.5),normalize([scaled],.5));
  assert.deepEqual(normalize([p,moved],.5)[0],normalize([p,moved],.5)[1]);
  assert.equal(normalize([p,moved],.5,'first_pelvis')[1][16][0],3);
  p[23][2]=0;assert.ok(normalize([p],.5)[0].every(x=>x.every(Number.isNaN)));
});
test('progress alignment interpolates usable neighbours but retains detection gaps',()=>{
  assert.deepEqual(resample([4,5,6],[0,10,20],[0,.25,.5,.75,1]),[0,5,10,15,20]);
  const gap=resample([0,1,2,3,4],[0,NaN,NaN,NaN,40],[0,.5,1]);
  assert.equal(gap[0],0);assert.ok(Number.isNaN(gap[1]));assert.equal(gap[2],40);
  assert.throws(()=>progress([0,0]));assert.throws(()=>resample([0,1],[2]));
});
test('difference excludes missing values, reports coverage and absence',()=>{
  assert.deepEqual(difference([10,NaN,30],[20,10,32]),{mean:6,coverage:2/3});
  assert.deepEqual(difference([NaN],[10]),{mean:null,coverage:0});
});
test('sampling enforces per-clip bounds, supported rate, and never requests end frame',()=>{
  assert.equal(sampleTimes(0,20,8,20).length,160);
  assert.equal(sampleTimes(0,20,8,20).at(-1),19.875);
  for(const args of [[0,21,8,30],[-1,2,4,3],[0,4,4,3],[0,1,30,2],[0,.3,2,2]])assert.throws(()=>sampleTimes(...args));
});
test('CSV has BOM, escaped columns, and empty missing-value cells',()=>{
  assert.equal(toCsv({'a"b':[1,NaN],c:[2,3]}),'\uFEFF"a""b","c"\r\n1,2\r\n,3');
});
test('3D angles use depth and remain invariant under camera rotation',()=>{
  const p=[[1,0,1],[0,0,0],[1,0,-1]];
  assert.ok(Math.abs(angle3D(...p)-90)<1e-9);assert.equal(angle(...p),0);
  assert.ok(Math.abs(angle3D(...p.map(v=>rotate3D(v,.8,.6)))-90)<1e-9);
  assert.ok(Number.isNaN(angle3D([0,0,0],[0,0,0],[1,2,3])));
});
test('world geometry preserves Z, fixed scale, confidence masking and anatomical mirroring',()=>{
  const p=Array.from({length:33},()=>[0,0,0,.9]);p[11]=[-.2,-.5,0,.9];p[12]=[.2,-.5,0,.9];p[23]=[-.2,0,0,.9];p[24]=[.2,0,0,.9];p[16]=[.5,-.2,.25,.9];
  const moved=p.map(([x,y,z,c])=>[x*2+3,y*2-4,z*2+7,c]);
  const norm=normalizeWorld([p],.5);assert.ok(Math.abs(norm[0][16][2]+.5)<1e-9);
  const other=normalizeWorld([moved],.5);norm[0].forEach((v,j)=>v.forEach((x,k)=>assert.ok(Math.abs(x-other[0][j][k])<1e-9)));
  const [mirror]=mirrorWorld([p]);assert.deepEqual(mirror[15],[-.5,-.2,.25,.9]);assert.deepEqual(mirrorWorld([mirror]),[p]);
  const seq=resamplePoses([0,1],[norm[0],norm[0]]);assert.equal(seq[50][16].length,3);assert.equal(seq[50][16][2],-.5);
  p[16][3]=0;assert.ok(normalizeWorld([p],.5)[0][16].every(Number.isNaN));
});
test('clip handles can relocate an interval, keep order, and enforce analysis bounds',()=>{
  const shifted=clipBounds(100,10,150,'start',4);assert.equal(shifted.start,100);assert.ok(shifted.end>100);assert.equal(sampleTimes(shifted.start,shifted.end,4,150).length,2);
  assert.deepEqual(clipBounds(0,150,150,'end',4),{start:130,end:150});
  const crossed=clipBounds(10,5,50,'end',2);assert.ok(crossed.end>crossed.start);assert.equal(sampleTimes(crossed.start,crossed.end,2,50).length,2);
});
