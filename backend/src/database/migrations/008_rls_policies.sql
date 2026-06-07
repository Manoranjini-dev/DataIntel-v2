-- ============================================================================
-- Migration: 008_rls_policies.sql
-- Description: Implement Row-Level Security (RLS) on all tenant-scoped tables
-- ============================================================================

BEGIN;

-- 1. Create a function to safely get the current org id from the context
-- It returns NULL if not set, which means RLS will deny access unless bypassed.
CREATE OR REPLACE FUNCTION current_org_id() RETURNS uuid AS $$
BEGIN
    RETURN current_setting('app.current_org_id', true)::uuid;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- 2. Dynamically apply RLS to all tables that have an org_id column
DO $$
DECLARE
    t_name text;
    has_org_id boolean;
BEGIN
    FOR t_name IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
    LOOP
        -- Check if table has org_id
        SELECT EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = t_name 
              AND column_name = 'org_id'
        ) INTO has_org_id;

        IF has_org_id THEN
            -- Enable RLS
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t_name);
            
            -- Drop existing policy if it exists to be safe
            EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON public.%I', t_name);
            
            -- Create the policy: Users can only see/modify rows where org_id matches current context
            -- Note: BYPASSRLS role (e.g. superuser/background worker) bypasses this automatically
            EXECUTE format('CREATE POLICY tenant_isolation_policy ON public.%I 
                            FOR ALL 
                            USING (org_id = current_org_id()) 
                            WITH CHECK (org_id = current_org_id())', t_name);
                            
            -- Force RLS even for table owners (standard practice for multi-tenant safety)
            EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t_name);
        END IF;
    END LOOP;
END
$$;

-- 3. The `organizations` table uses `id` instead of `org_id`, so we handle it explicitly
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON public.organizations;
CREATE POLICY tenant_isolation_policy ON public.organizations 
    FOR ALL 
    USING (id = current_org_id() OR current_org_id() IS NULL) -- Allow listing if context not set (e.g. login)
    WITH CHECK (id = current_org_id());
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;

-- Note: Accounts, roles, and global lookups don't have org_id and are exempt from RLS

COMMIT;
