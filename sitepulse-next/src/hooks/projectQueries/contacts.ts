import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import type { ProjectContact, ProjectContactInsert } from '@/types/domain';

// ==== Project Contacts ====
// A shared project-level contact directory (one row per person, grouped by
// company). Managed in the Settings menu; READ = any member, WRITE = privileged
// roles (enforced by RLS — see 20260623_project_contacts.sql). Mutations mirror
// the activity-hook conventions: optimistic cache update + invalidate.

// The editable fields a Settings form provides. id / project_id / created_by /
// timestamps are set by the hook or the DB, never by the caller.
export type ProjectContactFields = Omit<
  ProjectContactInsert,
  'id' | 'project_id' | 'created_by' | 'created_at' | 'updated_at'
>;

export function useProjectContacts(projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectContacts(projectId),
    queryFn: async (): Promise<ProjectContact[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase.from('project_contacts')
        .select('*')
        .eq('project_id', projectId)
        .order('company', { ascending: true })
        .order('last_name', { ascending: true, nullsFirst: false })
        .order('first_name', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId
  });
}

export function useCreateProjectContact(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (fields: ProjectContactFields): Promise<ProjectContact> => {
      const { data, error } = await supabase.from('project_contacts')
        .insert({ ...fields, project_id: projectId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async (fields) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.projectContacts(projectId) });
      const now = new Date().toISOString();
      const optimistic: ProjectContact = {
        id: `temp_${Date.now()}`,
        project_id: projectId,
        company: fields.company,
        first_name: fields.first_name ?? null,
        last_name: fields.last_name ?? null,
        job_title: fields.job_title ?? null,
        mobile_phone: fields.mobile_phone ?? null,
        email: fields.email ?? null,
        procore_id: fields.procore_id ?? null,
        created_by: null,
        created_at: now,
        updated_at: now
      };
      queryClient.setQueriesData<ProjectContact[]>({ queryKey: queryKeys.projectContacts(projectId) }, old =>
        old ? [...old, optimistic] : [optimistic]);
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.projectContacts(projectId) })
  });
}

export function useUpdateProjectContact(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string, updates: Partial<ProjectContactFields> }): Promise<ProjectContact> => {
      const { data, error } = await supabase.from('project_contacts')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.projectContacts(projectId) });
      queryClient.setQueriesData<ProjectContact[]>({ queryKey: queryKeys.projectContacts(projectId) }, old => {
        if (!old) return old;
        return old.map(c => c.id === id ? { ...c, ...updates } as ProjectContact : c);
      });
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.projectContacts(projectId) })
  });
}

export function useDeleteProjectContact(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_contacts').delete().eq('id', id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.projectContacts(projectId) });
      queryClient.setQueriesData<ProjectContact[]>({ queryKey: queryKeys.projectContacts(projectId) }, old =>
        old ? old.filter(c => c.id !== id) : old);
      return {};
    },
    onError: () => {},
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.projectContacts(projectId) })
  });
}

// Bulk-import contacts (Phase 2 — Procore CSV). Upserts on the table's
// UNIQUE(project_id, email) so re-importing the same file UPDATES people with an
// email instead of duplicating them. NULL emails are distinct under that key, so
// blank-email rows each insert as their own row (by design — see the plan).
//
// De-dupe within the payload first: a single `INSERT … ON CONFLICT` command
// cannot touch the same (project_id, email) twice ("cannot affect row a second
// time"), so two rows sharing a non-null email in one file are collapsed to the
// last occurrence (the same end state the UNIQUE key would force anyway). The
// chunked upsert mirrors the 800-row bulk-status pattern.
export function useImportProjectContacts(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contacts: ProjectContactFields[]): Promise<number> => {
      // Collapse duplicate non-null emails (keep last); keep every null-email row.
      const byEmail = new Map<string, ProjectContactFields>();
      const noEmail: ProjectContactFields[] = [];
      for (const c of contacts) {
        const email = c.email?.trim();
        if (email) byEmail.set(email.toLowerCase(), c);
        else noEmail.push(c);
      }
      const deduped = [...byEmail.values(), ...noEmail];

      const rows = deduped.map(c => ({ ...c, project_id: projectId }));
      const CHUNK_SIZE = 800;
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const { error } = await supabase
          .from('project_contacts')
          .upsert(rows.slice(i, i + CHUNK_SIZE), { onConflict: 'project_id,email' });
        if (error) throw error;
      }
      return rows.length;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.projectContacts(projectId) })
  });
}
