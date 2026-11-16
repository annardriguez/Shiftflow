/** Verify the authorized fictional hosted demo through its real HTTPS API. */
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {toShifts,type PlanningRun} from '../src/lib/planning-types';
import type {Workspace} from '../src/lib/types';
const config=JSON.parse(await readFile('.data/cloud/runtime.json','utf8'));
const accounts=JSON.parse(await readFile('.data/cloud/fictional-accounts.json','utf8')).accounts;
const origin=config.origin,week='2026-11-16';
class Client{
 cookies=new Map<string,string>();tenant='';actor:any;
 async request(path:string,body?:unknown,overrideOrigin=origin){
  const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:overrideOrigin,Cookie:[...this.cookies].map(([k,v])=>k+'='+v).join('; '),...(this.tenant?{'x-shiftflow-tenant':this.tenant}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});
  for(const cookie of r.headers.getSetCookie()){const pair=cookie.split(';')[0],at=pair.indexOf('=');this.cookies.set(pair.slice(0,at),pair.slice(at+1));}
  return r;
 }
 async call(path:string,body?:unknown){const r=await this.request(path,body);const data=await r.json();assert.equal(r.status,200,JSON.stringify({path,status:r.status,data}));return data;}
 async login(account:any){await this.call('/api/auth/sign-in/email',{email:account.email,password:account.password});const s=await this.call('/api/session');this.actor=s.actor;this.tenant=s.actor.tenantId;return this;}
 async action(body:any){const f=await this.call('/api/workforce');return this.call('/api/workforce',{revision:f.revision,note:'Fictional hosted-demo verification.',...body});}
 async logout(){await this.call('/api/auth/sign-out',{});}
}
const evidence:any={origin,fictional:true,externalSync:'not_connected',at:new Date().toISOString(),checks:[]};
const manager=await new Client().login(accounts.find((a:any)=>a.email==='eefje@shiftflow.test'));
let w:Workspace=await manager.call('/api/workspace');assert.equal(w.employees.length,16);assert.equal(w.restaurant.name,'Eefje · Maastricht Hawaiian');
evidence.checks.push('Manager sign-in and personalized tenant');
assert.equal((await fetch(origin+'/api/workspace')).status,401);
assert.equal((await manager.request('/api/workspace',{type:'budgets',week,budgets:[32,32,34,36,44,48,40],revision:w.revision},'https://untrusted.example')).status,403);
evidence.checks.push('Anonymous and foreign-origin mutations rejected');
if(!w.weeks.find(r=>r.start===week)?.provenance){
 const run:PlanningRun=await manager.call('/api/planning',{action:'generate',week,revision:w.revision,seconds:8});
 assert.equal(run.alternatives.length,3);const valid=run.alternatives.filter(a=>a.validation?.valid);assert.ok(valid.length);
 const best=valid.find(a=>a.strategy==='coverage-first')??valid[0];
 const shifts=toShifts(best.assignments);
 const report=await manager.call('/api/planning',{action:'validate',id:run.id,strategy:best.strategy,shifts});assert.equal(report.valid,true);
 await manager.call('/api/planning',{action:'save',id:run.id,strategy:best.strategy,shifts});
 evidence.alternatives=run.alternatives.map(a=>({strategy:a.strategy,status:a.status,valid:a.validation?.valid,hours:a.metrics?.total_paid_hours,coverage:a.metrics?.target_coverage_percent}));
 evidence.checks.push('Live three-strategy OR-Tools generation, independent validation and atomic save');
 w=await manager.call('/api/workspace');
}
const shifts=w.weeks.find(r=>r.start===week)!.shifts;
let chosen:any;
for(const shift of shifts.filter(s=>s.kind==='Closing')){
 const owner=accounts.find((a:any)=>a.role==='employee'&&a.employeeId===shift.employeeId);if(!owner)continue;
 const c=await new Client().login(owner);
 assert.equal((await c.request('/api/workspace')).status,403);
 const p=await c.call('/api/workforce');assert.ok(p.weeks.every((r:any)=>r.shifts.every((s:any)=>s.employeeId===owner.employeeId)));
 const result=await c.call(`/api/workforce?view=candidates&week=${week}&shiftId=${encodeURIComponent(shift.id)}`);
 const replacement=result.options.find((o:any)=>o.eligible&&accounts.some((a:any)=>a.role==='employee'&&a.employeeId===o.employeeId));
 if(replacement){chosen={shift,owner,client:c,replacement};break;}await c.logout();
}
assert.ok(chosen,'No eligible employee-to-employee closing cover found');
evidence.checks.push('Employee portal isolation and qualification-aware replacement candidates');
const owner:Client=chosen.client;
await owner.action({action:'create-shift',kind:'cover',week,shiftId:chosen.shift.id,targetEmployeeId:chosen.replacement.employeeId});
let request=(await owner.call('/api/workforce')).requests.find((r:any)=>r.shiftId===chosen.shift.id||r.offeredShift?.id===chosen.shift.id);
if(!request)request=(await owner.call('/api/workforce')).requests[0];assert.equal(request.status,'pending-colleague');
const target=await new Client().login(accounts.find((a:any)=>a.role==='employee'&&a.employeeId===chosen.replacement.employeeId));
await target.action({action:'accept',id:request.id,version:request.version});
request=(await manager.call('/api/workforce')).requests.find((r:any)=>r.id===request.id);assert.equal(request.status,'pending-manager');
const before:Workspace=await manager.call('/api/workspace');assert.equal(before.weeks.find(r=>r.start===week)!.shifts.find(s=>s.id===chosen.shift.id)!.employeeId,chosen.owner.employeeId);
await manager.action({action:'approve',id:request.id,version:request.version});
const after:Workspace=await manager.call('/api/workspace');const applied:any=after.requests!.find(r=>r.id===request.id);
assert.equal(applied.status,'applied');assert.equal(applied.approvedBy,manager.actor.id);assert.ok(applied.approvedAt);
assert.equal(after.weeks.find(r=>r.start===week)!.shifts.find(s=>s.id===chosen.shift.id)!.employeeId,chosen.replacement.employeeId);
assert.ok(after.audit.some(a=>a.details?.requestId===request.id&&a.details?.before&&a.details?.after));
evidence.checks.push('Employee cover request, colleague acceptance, fresh manager approval, exact roster change and attributed audit history');
evidence.appliedDemoCover={requestId:request.id,from:chosen.owner.name,to:chosen.replacement.name,approvedBy:'Eefje',approvedAt:applied.approvedAt};
const repeat=await manager.request('/api/workforce',{action:'approve',id:request.id,version:request.version,revision:after.revision,note:'Duplicate verification approval'});assert.equal(repeat.status,409);
evidence.checks.push('Duplicate/stale approval rejected');
for(const c of [owner,target,manager])await c.logout();
await writeFile('artifacts/hosted-verification.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
