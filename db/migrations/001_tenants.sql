CREATE SCHEMA IF NOT EXISTS app;
CREATE TABLE IF NOT EXISTS app.schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app.tenants(id uuid PRIMARY KEY, name text NOT NULL, fictional_data boolean NOT NULL DEFAULT true CHECK(fictional_data));
CREATE TABLE IF NOT EXISTS app.memberships(
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES app.tenants(id), user_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('manager','employee')), employee_id text, display_name text NOT NULL, active boolean NOT NULL DEFAULT true,
 UNIQUE(tenant_id,user_id), UNIQUE(tenant_id,employee_id), CHECK((role='employee' AND employee_id IS NOT NULL) OR(role='manager' AND employee_id IS NULL))
);
CREATE INDEX IF NOT EXISTS memberships_user_active ON app.memberships(user_id,tenant_id) WHERE active;
CREATE TABLE IF NOT EXISTS app.workspaces(tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id),revision bigint NOT NULL CHECK(revision>=0),payload jsonb NOT NULL,
 CHECK((payload->>'schemaVersion')::int=2), CHECK((payload->>'revision')::bigint=revision), CHECK(payload->>'tenantId'=tenant_id::text));
CREATE TABLE IF NOT EXISTS app.schedule_runs(tenant_id uuid NOT NULL REFERENCES app.tenants(id), id uuid NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL, PRIMARY KEY(tenant_id,id));
CREATE INDEX IF NOT EXISTS schedule_runs_recent ON app.schedule_runs(tenant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS app.audit_events(tenant_id uuid NOT NULL REFERENCES app.tenants(id),id text NOT NULL,at timestamptz NOT NULL,actor_user_id text REFERENCES auth."user"(id),payload jsonb NOT NULL,PRIMARY KEY(tenant_id,id));
CREATE INDEX IF NOT EXISTS audit_events_recent ON app.audit_events(tenant_id,at DESC);
CREATE TABLE IF NOT EXISTS app.request_events(tenant_id uuid NOT NULL REFERENCES app.tenants(id),request_id uuid NOT NULL,event_index integer NOT NULL CHECK(event_index>=0),payload jsonb NOT NULL,PRIMARY KEY(tenant_id,request_id,event_index));
CREATE TABLE IF NOT EXISTS app.imports(tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id),source_sha256 text NOT NULL,imported_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id',true),'') $$;
CREATE OR REPLACE FUNCTION app.tenant_member(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT target=app.current_tenant() AND EXISTS(SELECT 1 FROM app.memberships m WHERE m.tenant_id=target AND m.user_id=app.current_user_id() AND m.active)
$$;
REVOKE ALL ON FUNCTION app.tenant_member(uuid) FROM PUBLIC;
ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_memberships ON app.memberships;
CREATE POLICY own_memberships ON app.memberships FOR SELECT USING(user_id=app.current_user_id());
ALTER TABLE app.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_members ON app.tenants;
CREATE POLICY tenant_members ON app.tenants FOR SELECT USING(app.tenant_member(id));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['workspaces','schedule_runs','audit_events','request_events','imports'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('DROP POLICY IF EXISTS tenant_boundary ON app.%I',t);
 EXECUTE format('CREATE POLICY tenant_boundary ON app.%I USING(app.tenant_member(tenant_id)) WITH CHECK(app.tenant_member(tenant_id))',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION app.check_workspace_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.tenant_id<>OLD.tenant_id OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Invalid tenant or workspace revision' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
DROP TRIGGER IF EXISTS workspace_revision ON app.workspaces;
CREATE TRIGGER workspace_revision BEFORE UPDATE ON app.workspaces FOR EACH ROW EXECUTE FUNCTION app.check_workspace_revision();
CREATE OR REPLACE FUNCTION app.append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'History is append-only' USING ERRCODE='42501';END $$;
DROP TRIGGER IF EXISTS audit_immutable ON app.audit_events;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON app.audit_events FOR EACH ROW EXECUTE FUNCTION app.append_only();
DROP TRIGGER IF EXISTS request_history_immutable ON app.request_events;
CREATE TRIGGER request_history_immutable BEFORE UPDATE OR DELETE ON app.request_events FOR EACH ROW EXECUTE FUNCTION app.append_only();
INSERT INTO app.schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION app.tenant_manager(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT app.tenant_member(target) AND EXISTS(SELECT 1 FROM app.memberships WHERE tenant_id=target AND user_id=app.current_user_id() AND active AND role='manager') $$;
REVOKE ALL ON FUNCTION app.tenant_manager(uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION app.my_memberships() RETURNS TABLE(id uuid,tenant_id uuid,tenant_name text,role text,employee_id text,display_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT m.id,m.tenant_id,t.name,m.role,m.employee_id,m.display_name FROM app.memberships m JOIN app.tenants t ON t.id=m.tenant_id WHERE m.user_id=app.current_user_id() AND m.active ORDER BY t.name $$;
REVOKE ALL ON FUNCTION app.my_memberships() FROM PUBLIC;
CREATE OR REPLACE FUNCTION app.member_names() RETURNS TABLE(actor_id text,display_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app AS $$
 SELECT CASE WHEN m.role='employee' THEN m.employee_id ELSE m.id::text END,m.display_name FROM app.memberships m WHERE app.tenant_member(m.tenant_id) $$;
REVOKE ALL ON FUNCTION app.member_names() FROM PUBLIC;
DROP POLICY IF EXISTS tenant_boundary ON app.schedule_runs;
DROP POLICY IF EXISTS run_managers ON app.schedule_runs;
CREATE POLICY run_managers ON app.schedule_runs USING(app.tenant_manager(tenant_id)) WITH CHECK(app.tenant_manager(tenant_id));
DROP POLICY IF EXISTS tenant_boundary ON app.audit_events;
DROP POLICY IF EXISTS audit_read ON app.audit_events;
CREATE POLICY audit_read ON app.audit_events FOR SELECT USING(app.tenant_member(tenant_id) AND (app.tenant_manager(tenant_id) OR actor_user_id=app.current_user_id()));
DROP POLICY IF EXISTS audit_insert ON app.audit_events;
CREATE POLICY audit_insert ON app.audit_events FOR INSERT WITH CHECK(app.tenant_member(tenant_id) AND actor_user_id=app.current_user_id());
ALTER TABLE auth.session ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.session FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_service ON auth.session;
DROP POLICY IF EXISTS own_auth_session ON auth.session;
CREATE POLICY auth_service ON auth.session TO sf_auth USING(true) WITH CHECK(true);
CREATE POLICY own_auth_session ON auth.session FOR SELECT TO sf_app USING("userId"=app.current_user_id());
GRANT EXECUTE ON FUNCTION app.tenant_manager(uuid),app.my_memberships(),app.member_names() TO sf_app;
-- Narrow locking function: runtime cannot update memberships or read auth tokens.
CREATE OR REPLACE FUNCTION app.lock_context(member uuid, session_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app AS $$
DECLARE m record;
BEGIN
 SELECT id,role,employee_id INTO m FROM app.memberships WHERE id=member AND tenant_id=app.current_tenant() AND user_id=app.current_user_id() AND active FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM id FROM auth.session WHERE id=session_id AND "userId"=app.current_user_id() AND "expiresAt">clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Session expired or revoked' USING ERRCODE='28000';END IF;
 RETURN jsonb_build_object('id',m.id,'role',m.role,'employee_id',m.employee_id);
END $$;
REVOKE ALL ON FUNCTION app.lock_context(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lock_context(uuid,text) TO sf_app;
