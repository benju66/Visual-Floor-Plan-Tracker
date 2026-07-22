import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import type { Project, Profile, ProjectMember } from '@/types/domain';

export type MemberWithProfile = ProjectMember & { profiles: Pick<Profile, 'id' | 'email' | 'display_name'> | null };

export function useProjectMembers(projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectMembers(projectId),
    queryFn: async (): Promise<MemberWithProfile[]> => {
      if (!projectId) return [];
      const { data: members, error } = await supabase
        .from('project_members')
        .select('*')
        .eq('project_id', projectId);
      if (error) throw error;

      if (!members || members.length === 0) return [];

      const userIds = members.map(m => m.user_id as string);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, display_name')
        .in('id', userIds);

      return members.map(m => ({
        ...m,
        profiles: profiles?.find(p => p.id === m.user_id) || null
      }));
    },
    enabled: !!projectId
  });
}

export function useCurrentUserRole(projectId: string) {
  return useQuery({
    queryKey: queryKeys.currentUserRole(projectId),
    queryFn: async (): Promise<string | null> => {
      if (!projectId) return null;
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.user) return null;

      const { data, error } = await supabase
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', session.user.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data?.role || null;
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 5 // 5 minutes
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: async (): Promise<Project | null> => {
      if (!projectId) return null;
      const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).single();
      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    },
    enabled: !!projectId
  });
}

export function useUpdateProject(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Partial<Project>) => {
      const { data, error } = await supabase.from('projects').update(updates).eq('id', projectId).select().single();
      if (error) throw error;
      return data;
    },
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.project(projectId) });
      queryClient.setQueriesData<Project | null>({ queryKey: queryKeys.project(projectId) }, old => {
        if (!old) return old;
        return { ...old, ...updates };
      });
      return {};
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) })
  });
}

export function useUpdateProjectMemberRole(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string, role: string }) => {
      const { data, error } = await supabase
        .from('project_members')
        .update({ role })
        .eq('id', memberId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ memberId, role }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.projectMembers(projectId) });

      const previousMembers = queryClient.getQueryData<MemberWithProfile[]>(queryKeys.projectMembers(projectId));

      queryClient.setQueriesData<MemberWithProfile[]>({ queryKey: queryKeys.projectMembers(projectId) }, old => {
        if (!old) return old;
        return old.map(m => m.id === memberId ? { ...m, role } : m);
      });

      return { previousMembers };
    },
    onError: (err, newRole, context) => {
      if (context?.previousMembers) {
        queryClient.setQueryData(queryKeys.projectMembers(projectId), context.previousMembers);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectMembers(projectId) });
    }
  });
}
