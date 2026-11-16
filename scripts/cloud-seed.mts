/** Provision only fictional Maastricht accounts into the dedicated hosted demo. */
import { Pool } from 'pg';
import { readFile,writeFile } from 'node:fs/promises';
import { seed } from '../src/lib/seed';
import { provisionAccount,provisionTenant } from './db-admin';
import type {Employee} from '../src/lib/types';
const directory='.data/cloud';
const env=Object.fromEntries((await readFile(directory+'/neon-bootstrap.env','utf8')).split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')];}));
const u=new URL(env.DATABASE_URL_UNPOOLED||env.POSTGRES_URL_NON_POOLING);u.searchParams.set('sslmode','verify-full');u.searchParams.delete('channel_binding');
const pool=new Pool({connectionString:u.toString(),max:2});
const tenant='11111111-1111-4111-8111-111111111111';
try{
 if((await pool.query('SELECT 1 FROM app.tenants')).rowCount)throw new Error('Existing tenant preserved. Seed refuses to reset any hosted data.');
 const names=['Nicole 1','Juan','Lucía','Giulia','Anna','Achraf','Yasmijn','Osamah','Eefje','Sahara','Milica','Tim','Nicole 2','Alex','Nore','Selma'];
 const qualified=new Set([1,3,4,5,6,9,10,11,12]);const trainees=new Set([2,13,14,15]);
 const w=seed(),at=new Date().toISOString();
 w.restaurant.name='Eefje · Maastricht Hawaiian';w.restaurant.location='Maastricht, Netherlands';
 w.employees=names.map((name,i):Employee=>({...structuredClone(w.employees[i]??w.employees[14]),id:`emp-${i+1}`,name,email:`${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ /g,'')}@maastricht.shiftflow.test`,role:i===7?'Shift leader':'Team member',competencies:['service',...(qualified.has(i)?['open','close','train']:[])].map(skillId=>({skillId,verifiedBy:'user-approved-fictional-demo',verifiedAt:at})),skillsReviewedAt:at,supervisionSkillId:trainees.has(i)?'train':null,preferredHours:trainees.has(i)?16:24,maxHours:trainees.has(i)?24:40,minRestHours:11,maxShiftHours:9,eligible:['Opening','Midday','Closing'],availability:Array.from({length:7},()=>({start:600,end:1380})),absentDates:[],availabilityOverrides:[]}));
 w.weeks=w.weeks.map(week=>({...week,shifts:[]}));w.audit=[{id:'hosted-demo-created',at,actorId:'offline-provisioning',message:'Separate fictional Maastricht demo created with user-specified team and qualifications. No external scheduling connection.'}];
 const accounts=[];
 // Persist each generated password before moving to the next account, without logging it.
 const save=()=>writeFile(directory+'/fictional-accounts.json',JSON.stringify({notice:'Private fictional hosted-demo credentials. Never publish.',accounts},null,2),{mode:0o600});
 for(const name of ['Eefje','Osamah']){
  accounts.push(await provisionAccount(pool,{name,email:name.toLowerCase()+'@shiftflow.test',role:'manager'}));await save();
 }
 for(const e of w.employees.filter(e=>!['Eefje','Osamah'].includes(e.name))){accounts.push(await provisionAccount(pool,{name:e.name,email:e.email,role:'employee',employeeId:e.id}));await save();}
 await provisionTenant(pool,w,w.restaurant.name,accounts,tenant);
 console.log('Fictional Maastricht tenant and 16 individual sign-ins provisioned: 2 managers, 14 employees. Credentials are private in .data/cloud/fictional-accounts.json.');
 const app=new Pool({connectionString:JSON.parse(await readFile(directory+'/runtime.json','utf8')).appDatabaseUrl,max:1});
 try{
  const flags=(await app.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(flags.rolsuper||flags.rolbypassrls)throw new Error('Runtime must not bypass RLS.');
  if((await app.query('SELECT * FROM app.workspaces')).rowCount)throw new Error('Unscoped runtime access must return no tenant rows.');
  try{await app.query('SELECT * FROM auth."user"');throw new Error('Runtime unexpectedly accessed credential identities.');}catch(e){if((e as {code?:string}).code!=='42501')throw e;}
  console.log('Verified hosted runtime has no superuser/BYPASSRLS privileges, no unscoped tenant access, and no direct identity-table access.');
 }finally{await app.end();}
}finally{await pool.end();}
