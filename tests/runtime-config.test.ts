import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const complete={SHIFTFLOW_CLOUD:'1',SHIFTFLOW_APP_DATABASE_URL:'postgresql://sf_app:fictional@ep-example.neon.tech/demo?sslmode=verify-full',SHIFTFLOW_AUTH_DATABASE_URL:'postgresql://sf_auth:fictional@ep-example.neon.tech/demo?sslmode=verify-full',SHIFTFLOW_AUTH_SECRET:'s'.repeat(48),SHIFTFLOW_ENGINE_TOKEN:'t'.repeat(48),SHIFTFLOW_PUBLIC_ORIGIN:'https://fictional-shiftflow.example'};
function run(overrides:Record<string,string>={}){
 return spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',"import {runtimeConfig} from './src/lib/runtime-config.ts'; console.log(runtimeConfig().origin)"],{encoding:'utf8',env:{...process.env,...complete,...overrides}});
}
test('cloud configuration accepts explicit verified-TLS Neon settings',()=>{const r=run();assert.equal(r.status,0);assert.equal(r.stdout.trim(),complete.SHIFTFLOW_PUBLIC_ORIGIN);});
test('cloud configuration refuses a missing database instead of falling back to local data',()=>{const r=run({SHIFTFLOW_APP_DATABASE_URL:''});assert.notEqual(r.status,0);});
test('cloud database requires certificate and hostname verification',()=>{const r=run({SHIFTFLOW_APP_DATABASE_URL:complete.SHIFTFLOW_APP_DATABASE_URL.replace('verify-full','require')});assert.notEqual(r.status,0);assert.match(r.stderr,/verified TLS/);});
test('cloud mode does not permit an arbitrary remote or loopback database',()=>{for(const host of ['127.0.0.1','database.example']){const r=run({SHIFTFLOW_APP_DATABASE_URL:complete.SHIFTFLOW_APP_DATABASE_URL.replace('ep-example.neon.tech',host)});assert.notEqual(r.status,0);}});
test('cloud public origin requires HTTPS',()=>{const r=run({SHIFTFLOW_PUBLIC_ORIGIN:'http://fictional-shiftflow.example'});assert.notEqual(r.status,0);assert.match(r.stderr,/https/);});
test('cloud authentication and engine secrets cannot be absent',()=>{for(const key of ['SHIFTFLOW_AUTH_SECRET','SHIFTFLOW_ENGINE_TOKEN']){const r=run({[key]:''});assert.notEqual(r.status,0);assert.match(r.stderr,/secrets/);}});
