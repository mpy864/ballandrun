-- 023_pending_signups_and_approval_helper.sql
--
-- New signups land as 'pending', and one function decides who is let through.
-- Before this, the trigger handed every new account the 'athlete' role and every data
-- policy let any signed-in user read everything, so "sign up" and "get access" were the
-- same act.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
begin
  insert into public.user_profiles (id, role) values (new.id, 'pending')
  on conflict (id) do nothing;
  return new;
end;
$$;

-- The single gate every data policy calls.
--
-- SECURITY DEFINER because user_profiles is itself behind RLS: a policy evaluated as a
-- pending user must read the role without depending on the very policy it is enforcing.
-- STABLE so Postgres evaluates it once per statement rather than once per row.
CREATE OR REPLACE FUNCTION public.is_approved()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_profiles
                 WHERE id = auth.uid() AND role <> 'pending');
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_profiles
                 WHERE id = auth.uid() AND role = 'admin');
$$;

GRANT EXECUTE ON FUNCTION public.is_approved() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin()    TO anon, authenticated;

-- The admin reads and changes every profile; everyone else still reads only their own,
-- which own_profile_select already covers.
DROP POLICY IF EXISTS admin_profile_select ON user_profiles;
CREATE POLICY admin_profile_select ON user_profiles FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS admin_profile_update ON user_profiles;
CREATE POLICY admin_profile_update ON user_profiles
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
