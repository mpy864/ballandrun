-- 022_add_pending_role_and_admin.sql
--
-- Signup is open by decision; access is not. This adds a role for someone who has signed
-- up but not been let in, and an admin who can let them in.
--
-- 'pending' has to be added in its own migration: Postgres allows ALTER TYPE ... ADD
-- VALUE inside a transaction but will not let the new value be USED in that same
-- transaction, so the trigger and the policies that reference it come next.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'pending';

-- Named explicitly rather than "the first user", so re-running this cannot promote
-- somebody else.
UPDATE user_profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'mohitprakashyadav.tops.sai@gmail.com');
