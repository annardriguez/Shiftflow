/** Run locally once against a new dedicated Neon database. Never runs at web startup. */
import { Pool } from 'pg';
import { randomBytes,createHash } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from '../src/lib/auth';
import type { RuntimeConfig } from '../src/lib/runtime-config';

const folder='.data/cloud';
await mkdir(folder,{recursive:true,mode:0o700});
const adminUrl=process.env.SHIFTFLOW_BOOTSTRAP_DATABASE_URL;
if(!adminUrl)throw new Error('Supply the new dedicated database URL through the environment.');
const host=new URL(adminUrl);
if(!host.hostname.endsWith('.neon.tech'))throw new Error('Expected a dedicated Neon database.');
host.searchParams.set('sslmode','verify-full');
host.searchParams.delete('channel_binding');
const c=new Pool({connectionString:host.toString(),max:1,options:'-c search_path=auth,pg_catalog'});
try{
 const tables=await c.query("SELECT tablename FROM pg_tables WHERE schemaname IN ('app','auth')");
 if(tables.rowCount)throw new Error('Bootstrap refuses a database with existing ShiftFlow/identity tables.');
 const info=(await c.query('SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];
 if(!info.rolbypassrls&&!info.rolsuper)throw new Error('Database owner must support the existing audited RLS functions; no policies were weakened.');
 const url=(user:string)=>{const u=new URL(host);u.username=user;u.password=randomBytes(32).toString('hex');return u.toString();};
 const origin=process.env.SHIFTFLOW_PUBLIC_ORIGIN;
 if(!origin||new URL(origin).protocol!=='https:')throw new Error('Supply the chosen HTTPS app origin.');
 const config:RuntimeConfig={appDatabaseUrl:url('sf_app'),authDatabaseUrl:url('sf_auth'),authSecret:randomBytes(48).toString('hex'),engineToken:randomBytes(32).toString('hex'),origin};
 // Private offline config is also used by the existing credential provisioning helpers.
 await writeFile(folder+'/runtime.json',JSON.stringify(config),{mode:0o600,flag:'wx'});
 process.env.SHIFTFLOW_DATA_DIR=folder;
 process.env.SHIFTFLOW_CLOUD='1';
 Object.assign(process.env,{SHIFTFLOW_APP_DATABASE_URL:config.appDatabaseUrl,SHIFTFLOW_AUTH_DATABASE_URL:config.authDatabaseUrl,SHIFTFLOW_AUTH_SECRET:config.authSecret,SHIFTFLOW_ENGINE_TOKEN:config.engineToken});
 for(const value of [config.appDatabaseUrl,config.authDatabaseUrl]){
  const u=new URL(value);
  await c.query(`CREATE ROLE ${u.username} LOGIN PASSWORD '${u.password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
 }
 await c.query('CREATE SCHEMA auth');
 const plan=await getMigrations(authOptions(c));
 if(plan.schemaProblems.length||plan.unsafeChanges.length)throw new Error('Identity migration requires review.');
 await plan.runMigrations();
 const sql=await readFile('db/migrations/001_tenants.sql','utf8');
 await c.query('BEGIN');
 try{
  await c.query(sql);
  await c.query('ALTER TABLE app.schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
  await c.query('UPDATE app.schema_migrations SET checksum=$1 WHERE version=1',[createHash('sha256').update(sql).digest('hex')]);
  await c.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO sf_auth;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA auth TO sf_auth;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA auth TO sf_auth;
GRANT USAGE ON SCHEMA app TO sf_app;
GRANT SELECT ON app.tenants,app.memberships,app.imports TO sf_app;
GRANT SELECT,UPDATE ON app.workspaces TO sf_app;
GRANT SELECT,INSERT ON app.schedule_runs,app.audit_events,app.request_events TO sf_app;
GRANT EXECUTE ON FUNCTION app.tenant_member(uuid),app.current_tenant(),app.current_user_id() TO sf_app;
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM sf_app;
REVOKE USAGE ON SCHEMA auth FROM sf_app;`);
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}
 console.log('Dedicated cloud database migrated. Runtime credentials saved privately in .data/cloud/runtime.json; administrator credentials are not part of the deployment.');
}finally{await c.end();}
