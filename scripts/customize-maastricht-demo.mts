/** Explicitly requested fictional demo customization; run once, after a private backup. */
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { adminPool, provisionAccount } from './db-admin';
import type { Workspace, Employee } from '../src/lib/types';

const tenant = '11111111-1111-4111-8111-111111111111';
const names = ['Nicole 1','Juan','Lucía','Giulia','Anna','Achraf','Yasmijn','Osamah','Eefje','Sahara','Milica','Tim','Nicole 2','Alex','Nore','Selma'];
const qualified = new Set([1,3,4,5,6,9,10,11,12]);
const trainees = new Set([2,13,14,15]);
const journalPath = '.data/fictional-accounts.json';
const journal = JSON.parse(await readFile(journalPath,'utf8'));
const pool = await adminPool();
try {
  const exists = await pool.query('SELECT 1 FROM app.audit_events WHERE tenant_id=$1 AND id=$2',[tenant,'maastricht-demo-customization-v1']);
  if (exists.rowCount) throw new Error('Customization already applied; refusing to reset later edits.');
  // Provision the extra fictional employee before the aggregate transaction. Its
  // private journal record permits a retry without resetting credentials.
  let selma = journal.accounts.find((a: {email:string})=>a.email==='selma@maastricht.shiftflow.test');
  if (!selma) {
    selma = {...await provisionAccount(pool,{name:'Selma',email:'selma@maastricht.shiftflow.test',role:'employee',employeeId:'emp-16'}),restaurant:'Eefje · Maastricht Hawaiian'};
    journal.accounts.push(selma);
    await writeFile(journalPath+'.tmp',JSON.stringify(journal,null,2),{mode:0o600});
    await rename(journalPath+'.tmp',journalPath);
  }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const row = (await c.query('SELECT payload FROM app.workspaces WHERE tenant_id=$1 FOR UPDATE',[tenant])).rows[0];
    const w: Workspace = row.payload;
    const previous = w.employees;
    const at = new Date().toISOString();
    w.employees = names.map((name,i):Employee=>({
      ...structuredClone(previous[i] ?? previous[14]),
      id:`emp-${i+1}`,name,
      email:`${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ /g,'')}@maastricht.shiftflow.test`,
      role:i===7?'Shift leader':'Team member',
      competencies:['service',...(qualified.has(i)?['open','close','train']:[])].map(skillId=>({skillId,verifiedBy:'local-administrator:user-approved-fictional-demo',verifiedAt:at})),
      supervisionSkillId:trainees.has(i)?'train':null,
      skillsReviewedAt:at,preferredHours:trainees.has(i)?16:24,maxHours:trainees.has(i)?24:40,
      minRestHours:11,maxShiftHours:9,eligible:['Opening','Midday','Closing'],
      availability:Array.from({length:7},()=>({start:600,end:1380})),absentDates:[],availabilityOverrides:[],
    }));
    w.restaurant.name='Eefje · Maastricht Hawaiian';
    w.restaurant.location='Maastricht, Netherlands';
    w.revision++;
    const event={id:'maastricht-demo-customization-v1',at,actorId:'local-database-administrator',message:'User-requested fictional Maastricht demo: renamed restaurant and 16 profiles; explicit qualifications and trainee requirements; Eefje and Osamah manager access.',details:{fictional:true,previousRevision:w.revision-1,qualificationSource:'User instruction: all people without parenthetical notes',availability:'Fictional 10:00–23:00 daily; 11-hour rest; 9-hour shift maximum',managers:['Eefje','Osamah']}};
    w.audit.push(event);
    await c.query('UPDATE app.tenants SET name=$1 WHERE id=$2',[w.restaurant.name,tenant]);
    // Retain existing stable IDs and historical snapshots. Rename current
    // identities only; prior approval/audit labels remain historical evidence.
    for(let i=0;i<names.length;i++) {
      const e=w.employees[i];
      const record=i===15?selma:journal.accounts.find((a:{email:string})=>a.email===`emp-${i+1}@utrecht.shiftflow.test`);
      if(!record) throw new Error('Missing original private account journal entry for '+e.id);
      const role=i===7?'manager':'employee';
      await c.query('UPDATE auth."user" SET name=$1,email=$2,"updatedAt"=now() WHERE id=$3',[e.name,e.email,record.id]);
      await c.query('INSERT INTO app.memberships(id,tenant_id,user_id,role,employee_id,display_name,active) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=excluded.role,employee_id=excluded.employee_id,display_name=excluded.display_name,active=excluded.active',[randomUUID(),tenant,record.id,role,role==='employee'?e.id:null,e.name,i!==8]);
      Object.assign(record,{name:e.name,email:e.email,role,employeeId:role==='employee'?e.id:undefined,restaurant:w.restaurant.name,active:i!==8});
      await c.query('DELETE FROM auth.session WHERE "userId"=$1',[record.id]);
    }
    const manager=journal.accounts.find((a:{email:string})=>a.email==='jamie@shiftflow.test');
    if(!manager) throw new Error('Missing manager provisioning journal.');
    await c.query('UPDATE auth."user" SET name=$1,email=$2,"updatedAt"=now() WHERE id=$3',['Eefje','eefje@shiftflow.test',manager.id]);
    await c.query('UPDATE app.memberships SET display_name=$1 WHERE tenant_id=$2 AND user_id=$3',['Eefje',tenant,manager.id]);
    await c.query('DELETE FROM auth.session WHERE "userId"=$1',[manager.id]);
    Object.assign(manager,{name:'Eefje',email:'eefje@shiftflow.test',restaurant:w.restaurant.name});
    // The old cross-restaurant test manager keeps its other restaurant access.
    await c.query('UPDATE app.memberships SET active=false WHERE tenant_id=$1 AND user_id IN (SELECT id FROM auth."user" WHERE email=$2)',[tenant,'alex@shiftflow.test']);
    await c.query('UPDATE app.workspaces SET revision=$1,payload=$2 WHERE tenant_id=$3',[w.revision,JSON.stringify(w),tenant]);
    await c.query('INSERT INTO app.audit_events(tenant_id,id,at,payload) VALUES($1,$2,$3,$4)',[tenant,event.id,at,JSON.stringify(event)]);
    await c.query('COMMIT');
    journal.tenants.find((t:{id:string})=>t.id===tenant).name=w.restaurant.name;
    await writeFile(journalPath+'.tmp',JSON.stringify(journal,null,2),{mode:0o600});
    await rename(journalPath+'.tmp',journalPath);
    console.log(JSON.stringify({restaurant:w.restaurant.name,revision:w.revision,employees:w.employees.map(e=>({name:e.name,skills:e.competencies.map(q=>q.skillId),supervision:e.supervisionSkillId})),managerEmails:['eefje@shiftflow.test','osamah@maastricht.shiftflow.test'],externalSync:'not_connected'}));
  } catch(error) {await c.query('ROLLBACK');throw error;} finally {c.release();}
} finally {await pool.end();}
