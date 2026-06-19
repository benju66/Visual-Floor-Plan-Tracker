-- 20260619_project_member_invites.sql
-- Make email-based project invitations actually work.
--
-- Background: the Settings -> Team "Invite" form wrote a `user_email` value into
-- project_members, but that column never existed in the live database, so every
-- invite silently failed. database.types.ts already declares the column; this
-- migration reconciles the live schema with the types and the app code.
--
-- Two additive, idempotent changes:
--   1. Add `user_email` so a membership row can exist BEFORE the invited person
--      has an account (user_id stays NULL until they accept the invite).
--   2. Teach handle_new_user() to claim any pending invitations addressed to a
--      new user's email by stamping their fresh user_id onto the matching
--      project_members rows -- this is what links an emailed invite to the real
--      account once they sign up / accept.

-- 1. Pending-invite column -------------------------------------------------
ALTER TABLE public.project_members
  ADD COLUMN IF NOT EXISTS user_email text;

-- Case-folded lookup for both the signup-linking UPDATE below and the invite
-- route's duplicate check. Tiny table today, but keeps the email match indexed.
CREATE INDEX IF NOT EXISTS project_members_user_email_idx
  ON public.project_members (lower(user_email));

-- 2. Link invites to the account on signup ---------------------------------
-- Extends the existing trigger function (preserves the profiles insert).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (new.id, split_part(new.email, '@', 1), new.email);

  -- Claim any project invitations addressed to this email address. The invite
  -- route inserts a project_members row carrying user_email (user_id NULL)
  -- before the invite email goes out; this fills in the real id on accept.
  UPDATE public.project_members
  SET user_id = new.id
  WHERE user_id IS NULL
    AND lower(user_email) = lower(new.email);

  RETURN new;
END;
$function$;
