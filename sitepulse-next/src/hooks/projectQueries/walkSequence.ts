import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/supabaseClient';
import { queryKeys } from '@/types/queryKeys';
import type { Unit } from '@/types/domain';

export function useUpdateWalkSequence(sheetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sequenceUpdates: { id: string, walk_sequence: number | null }[]) => {
      const CHUNK_SIZE = 800;
      for (let i = 0; i < sequenceUpdates.length; i += CHUNK_SIZE) {
        const chunk = sequenceUpdates.slice(i, i + CHUNK_SIZE);
        for (const update of chunk) {
          const { error } = await supabase
            .from('units')
            .update({ walk_sequence: update.walk_sequence })
            .eq('id', update.id);
          if (error) throw error;
        }
      }
    },
    onMutate: async (sequenceUpdates) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.setQueriesData<Unit[]>({ queryKey: queryKeys.units(sheetId) }, old => {
        if (!old) return old;
        const updateMap = new Map(sequenceUpdates.map(u => [u.id, u.walk_sequence]));
        return old.map(u =>
          updateMap.has(u.id) ? { ...u, walk_sequence: updateMap.get(u.id) } as unknown as Unit : u
        );
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.units(sheetId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.allProjectUnitsAll() });
    }
  });
}
