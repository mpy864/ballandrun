-- 029_user_profiles_email.sql
--
-- The approvals screen listed people as "ecb007f4".
--
-- user_profiles had no email, and auth.users is not readable from the browser, so the
-- page fell back to the first eight characters of a uuid. That is not a simplification —
-- it asks an admin to approve a stranger by hash, which is the one thing the screen
-- exists to prevent.
--
-- The email lives on user_profiles now. It is not new exposure: the row is already
-- readable only by its owner (own_profile_select) and by an admin (admin_profile_select),
-- and both of those may see it. Verified after applying — admin reads 9 rows, a pending
-- account and an athlete each read exactly their own.

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email text;

UPDATE user_profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.id AND p.email IS DISTINCT FROM u.email;

-- The trigger already runs as SECURITY DEFINER on auth.users, so it can read the email
-- off the row that fired it. Without this, every new signup would arrive as a hash again
-- and the backfill above would be a one-off patch rather than a fix.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  insert into public.user_profiles (id, role, email)
  values (new.id, 'pending', new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

-- A trigger function is not an endpoint. CREATE OR REPLACE resets the grants, so the
-- revoke from migration 028 has to be repeated here.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
