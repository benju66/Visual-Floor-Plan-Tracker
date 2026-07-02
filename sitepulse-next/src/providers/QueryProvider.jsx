"use client";

import { QueryClient, MutationCache, defaultShouldDehydrateMutation } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, useEffect } from 'react';
import { persister } from '@/utils/persister';
import { supabase } from '@/supabaseClient';

export default function QueryProvider({ children }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache(),
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 5, // 5 minutes
            gcTime: 1000 * 60 * 60 * 24, // 24 hours
            networkMode: 'offlineFirst', // Allows reading cache while offline
          },
          mutations: {
            networkMode: 'offlineFirst', // Queues mutations when offline
            retry: 3,
          }
        },
      })
  );

  useEffect(() => {
    // Listen to global status updates and surgically inject them into the caches
    const channel = supabase.channel('sitepulse-global-sync')
      .on(
        'postgres_changes', 
        // With slot-unique status_logs, most writes are UPSERTs which fire as UPDATE events.
        // Listen to all change types (INSERT, UPDATE, DELETE) to keep caches in sync.
        { event: '*', schema: 'public', table: 'status_logs' }, 
        (payload) => {
          if (payload.eventType === 'DELETE') {
            // Remove deleted log from all caches
            const oldLog = payload.old;
            const removeFromCache = (old) => {
              if (!old) return old;
              return old.filter(s => s.id !== oldLog.id);
            };
            const queries = queryClient.getQueriesData({ queryKey: ['statuses'] });
            queries.forEach(([queryKey]) => {
              queryClient.setQueryData(queryKey, removeFromCache);
            });
            queryClient.setQueriesData({ queryKey: ['all_project_statuses'] }, removeFromCache);
            return;
          }

          // INSERT or UPDATE — inject/replace the log in all caches.
          // The realtime payload is a RAW status_logs row: it keys by activity_id and has
          // NO activity name. The read hooks synthesize that name (joined from
          // activities); mirror that here so an injected row stays shape-consistent — look
          // the activity's current name up from any loaded activities cache. The slot key
          // is (unit_id, activity_id).
          const raw = payload.new;
          const activityName = queryClient
            .getQueriesData({ queryKey: ['activities'] })
            .flatMap(([, list]) => list ?? [])
            .find(a => a.id === raw.activity_id)?.name ?? '';
          const newLog = { ...raw, activityName };

          // 1. Inject into the specific sheet's cache
          const queries = queryClient.getQueriesData({ queryKey: ['statuses'] });
          queries.forEach(([queryKey, oldData]) => {
            if (!oldData) return;
            queryClient.setQueryData(queryKey, (old) => {
              if (!old) return old;
              const filtered = old.filter(s => !(s.unit_id === newLog.unit_id && s.activity_id === newLog.activity_id));
              return [...filtered, newLog];
            });
          });

          // 2. Inject into the global dashboard cache
          queryClient.setQueriesData({ queryKey: ['all_project_statuses'] }, (old) => {
            if (!old) return old;
            const filtered = old.filter(s => !(s.unit_id === newLog.unit_id && s.activity_id === newLog.activity_id));
            return [...filtered, newLog];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        // Cache-shape version. Bumped for the milestone→activity rename: rows
        // persisted before it carry the old synthesized `milestone` field, so a
        // mismatched buster discards that cache once and refetches clean.
        buster: 'activity-rename-v1',
        dehydrateOptions: {
          shouldDehydrateMutation: (mutation) => {
            return defaultShouldDehydrateMutation(mutation) || mutation.state.isPaused;
          },
        },
      }}
    >
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </PersistQueryClientProvider>
  );
}
