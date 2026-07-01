export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string
          name: string
          kind: string
          unit_types: Json | null
          procore_project_id: string | null
          procore_company_id: string | null
          project_type: string | null
          ai_training_enabled: boolean
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          kind?: string
          unit_types?: Json | null
          procore_project_id?: string | null
          procore_company_id?: string | null
          project_type?: string | null
          ai_training_enabled?: boolean
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          kind?: string
          unit_types?: Json | null
          procore_project_id?: string | null
          procore_company_id?: string | null
          project_type?: string | null
          ai_training_enabled?: boolean
          created_at?: string | null
        }
        Relationships: []
      }
      lookahead_plans: {
        Row: {
          id: string
          project_id: string
          doc: Json
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          doc: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          doc?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lookahead_plans_project_id_fkey"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          }
        ]
      }
      project_contacts: {
        Row: {
          id: string
          project_id: string
          company: string
          first_name: string | null
          last_name: string | null
          job_title: string | null
          mobile_phone: string | null
          email: string | null
          procore_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          company: string
          first_name?: string | null
          last_name?: string | null
          job_title?: string | null
          mobile_phone?: string | null
          email?: string | null
          procore_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          company?: string
          first_name?: string | null
          last_name?: string | null
          job_title?: string | null
          mobile_phone?: string | null
          email?: string | null
          procore_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_contacts_project_id_fkey"
            columns: ["project_id"]
            referencedRelation: "projects"
            referencedColumns: ["id"]
          }
        ]
      }
      sheets: {
        Row: {
          id: string
          project_id: string | null
          sequence_order: number | null
          sheet_name: string
          base_image_url: string | null
          tile_manifest_url: string | null
          tile_image_width: number | null
          tile_image_height: number | null
          scale_ratio: number | null
          scale_preset: string | null
          scale_units_per_px: number | null
          scale_unit: string | null
          scale_calibration: Json | null
          active_scopes: Json | null
          activity_schedules: Json | null
          created_at: string | null
          pdf_version: string | null
        }
        Insert: {
          id?: string
          project_id?: string | null
          sequence_order?: number | null
          sheet_name: string
          base_image_url?: string | null
          tile_manifest_url?: string | null
          tile_image_width?: number | null
          tile_image_height?: number | null
          scale_ratio?: number | null
          scale_preset?: string | null
          scale_units_per_px?: number | null
          scale_unit?: string | null
          scale_calibration?: Json | null
          active_scopes?: Json | null
          activity_schedules?: Json | null
          created_at?: string | null
          pdf_version?: string | null
        }
        Update: {
          id?: string
          project_id?: string | null
          sequence_order?: number | null
          sheet_name?: string
          base_image_url?: string | null
          tile_manifest_url?: string | null
          tile_image_width?: number | null
          tile_image_height?: number | null
          scale_ratio?: number | null
          scale_preset?: string | null
          scale_units_per_px?: number | null
          scale_unit?: string | null
          scale_calibration?: Json | null
          active_scopes?: Json | null
          activity_schedules?: Json | null
          created_at?: string | null
          pdf_version?: string | null
        }
        Relationships: []
      }
      workbench_sheets: {
        Row: {
          sheet_id: string
          sheet_project_type: string | null
          level_label: string | null
          source_sheet_number: string | null
          vector_quality: string | null
          is_partial: boolean
          review_state: string
          reviewed_by: string | null
          reviewed_at: string | null
          fully_traced: boolean
          deleted_at: string | null
          deleted_by: string | null
          source_building: string | null
          created_at: string | null
        }
        Insert: {
          sheet_id: string
          sheet_project_type?: string | null
          level_label?: string | null
          source_sheet_number?: string | null
          vector_quality?: string | null
          is_partial?: boolean
          review_state?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          fully_traced?: boolean
          deleted_at?: string | null
          deleted_by?: string | null
          source_building?: string | null
          created_at?: string | null
        }
        Update: {
          sheet_id?: string
          sheet_project_type?: string | null
          level_label?: string | null
          source_sheet_number?: string | null
          vector_quality?: string | null
          is_partial?: boolean
          review_state?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          fully_traced?: boolean
          deleted_at?: string | null
          deleted_by?: string | null
          source_building?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workbench_sheets_sheet_id_fkey"
            columns: ["sheet_id"]
            referencedRelation: "sheets"
            referencedColumns: ["id"]
          }
        ]
      }
      units: {
        Row: {
          id: string
          sheet_id: string | null
          unit_number: string
          unit_type: string | null
          top_level_role: string | null
          subtype_id: string | null
          computed_area: number | null
          spans_levels: boolean | null
          level_note: string | null
          has_void: boolean | null
          polygon_coordinates: Json
          opening_edges: Json
          icon_offset_x: number | null
          icon_offset_y: number | null
          walk_sequence: number | null
          assigned_to: string | null
          method: string | null
          source: string | null
          model_version: string | null
          suggested_polygon: Json | null
          suggested_label: Json | null
          review_status: string | null
          spec_version: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          sheet_id?: string | null
          unit_number: string
          unit_type?: string | null
          top_level_role?: string | null
          subtype_id?: string | null
          computed_area?: number | null
          spans_levels?: boolean | null
          level_note?: string | null
          has_void?: boolean | null
          polygon_coordinates: Json
          opening_edges?: Json
          icon_offset_x?: number | null
          icon_offset_y?: number | null
          walk_sequence?: number | null
          assigned_to?: string | null
          method?: string | null
          source?: string | null
          model_version?: string | null
          suggested_polygon?: Json | null
          suggested_label?: Json | null
          review_status?: string | null
          spec_version?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          sheet_id?: string | null
          unit_number?: string
          unit_type?: string | null
          top_level_role?: string | null
          subtype_id?: string | null
          computed_area?: number | null
          spans_levels?: boolean | null
          level_note?: string | null
          has_void?: boolean | null
          polygon_coordinates?: Json
          opening_edges?: Json
          icon_offset_x?: number | null
          icon_offset_y?: number | null
          walk_sequence?: number | null
          assigned_to?: string | null
          method?: string | null
          source?: string | null
          model_version?: string | null
          suggested_polygon?: Json | null
          suggested_label?: Json | null
          review_status?: string | null
          spec_version?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "units_subtype_id_fkey"
            columns: ["subtype_id"]
            referencedRelation: "subtypes"
            referencedColumns: ["id"]
          }
        ]
      }
      trace_events: {
        Row: {
          id: string
          sheet_id: string
          unit_id: string | null
          event_type: string
          method: string | null
          source: string | null
          before_polygon: Json | null
          after_polygon: Json | null
          before_label: Json | null
          after_label: Json | null
          model_version: string | null
          duration_ms: number | null
          group_key: string | null
          spec_version: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          sheet_id: string
          unit_id?: string | null
          event_type: string
          method?: string | null
          source?: string | null
          before_polygon?: Json | null
          after_polygon?: Json | null
          before_label?: Json | null
          after_label?: Json | null
          model_version?: string | null
          duration_ms?: number | null
          group_key?: string | null
          spec_version?: string
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          sheet_id?: string
          unit_id?: string | null
          event_type?: string
          method?: string | null
          source?: string | null
          before_polygon?: Json | null
          after_polygon?: Json | null
          before_label?: Json | null
          after_label?: Json | null
          model_version?: string | null
          duration_ms?: number | null
          group_key?: string | null
          spec_version?: string
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trace_events_sheet_id_fkey"
            columns: ["sheet_id"]
            referencedRelation: "sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trace_events_unit_id_fkey"
            columns: ["unit_id"]
            referencedRelation: "units"
            referencedColumns: ["id"]
          }
        ]
      }
      subtypes: {
        Row: {
          id: string
          name: string
          top_level_role: string
          status: string
          aliases: Json
          default_project_types: Json
          proposed_note: string | null
          created_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          top_level_role: string
          status?: string
          aliases?: Json
          default_project_types?: Json
          proposed_note?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          top_level_role?: string
          status?: string
          aliases?: Json
          default_project_types?: Json
          proposed_note?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      activities: {
        Row: {
          id: string
          project_id: string | null
          sequence_order: number | null
          name: string
          color: string
          track: string
          type: string
          applies_to_unit_types: Json | null
          dictionary_id: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          project_id?: string | null
          sequence_order?: number | null
          name: string
          color: string
          track?: string
          type?: string
          applies_to_unit_types?: Json | null
          dictionary_id?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          project_id?: string | null
          sequence_order?: number | null
          name?: string
          color?: string
          track?: string
          type?: string
          applies_to_unit_types?: Json | null
          dictionary_id?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      activity_dictionary: {
        Row: {
          id: string
          name: string
          track: string | null
          type: string
          status: string
          aliases: Json
          default_project_types: Json
          cost_code_id: string | null
          proposed_note: string | null
          created_by: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          name: string
          track?: string | null
          type?: string
          status?: string
          aliases?: Json
          default_project_types?: Json
          cost_code_id?: string | null
          proposed_note?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          track?: string | null
          type?: string
          status?: string
          aliases?: Json
          default_project_types?: Json
          cost_code_id?: string | null
          proposed_note?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      activity_applicability_overrides: {
        Row: {
          id: string
          activity_id: string
          unit_id: string
          is_applicable: boolean
          created_by: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          activity_id: string
          unit_id: string
          is_applicable: boolean
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          activity_id?: string
          unit_id?: string
          is_applicable?: boolean
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_applicability_overrides_activity_id_fkey"
            columns: ["activity_id"]
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_applicability_overrides_unit_id_fkey"
            columns: ["unit_id"]
            referencedRelation: "units"
            referencedColumns: ["id"]
          }
        ]
      }
      status_logs: {
        Row: {
          id: string
          unit_id: string | null
          activity_id: string
          status_color: string
          temporal_state: string
          track: string
          planned_start_date: string | null
          planned_end_date: string | null
          logged_date: string | null
          client_timestamp: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          unit_id?: string | null
          activity_id: string
          status_color: string
          temporal_state?: string
          track?: string
          planned_start_date?: string | null
          planned_end_date?: string | null
          logged_date?: string | null
          client_timestamp?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          unit_id?: string | null
          activity_id?: string
          status_color?: string
          temporal_state?: string
          track?: string
          planned_start_date?: string | null
          planned_end_date?: string | null
          logged_date?: string | null
          client_timestamp?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "status_logs_activity_id_fkey"
            columns: ["activity_id"]
            referencedRelation: "activities"
            referencedColumns: ["id"]
          }
        ]
      }
      status_audit_log: {
        Row: {
          id: string
          unit_id: string | null
          activity_id: string | null
          milestone: string
          status_color: string
          temporal_state: string
          track: string
          planned_start_date: string | null
          planned_end_date: string | null
          logged_date: string | null
          client_timestamp: string | null
          user_id: string | null
          changed_at: string | null
        }
        Insert: {
          id?: string
          unit_id?: string | null
          activity_id?: string | null
          milestone: string
          status_color?: string
          temporal_state?: string
          track?: string
          planned_start_date?: string | null
          planned_end_date?: string | null
          logged_date?: string | null
          client_timestamp?: string | null
          user_id?: string | null
          changed_at?: string | null
        }
        Update: {
          id?: string
          unit_id?: string | null
          activity_id?: string | null
          milestone?: string
          status_color?: string
          temporal_state?: string
          track?: string
          planned_start_date?: string | null
          planned_end_date?: string | null
          logged_date?: string | null
          client_timestamp?: string | null
          user_id?: string | null
          changed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "status_audit_log_activity_id_fkey"
            columns: ["activity_id"]
            referencedRelation: "activities"
            referencedColumns: ["id"]
          }
        ]
      }
      profiles: {
        Row: {
          id: string
          display_name: string | null
          email: string
          avatar_url: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          display_name?: string | null
          email: string
          avatar_url?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          display_name?: string | null
          email?: string
          avatar_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      project_members: {
        Row: {
          id: string
          project_id: string | null
          user_id: string | null
          user_email: string | null
          role: string
          created_at: string | null
        }
        Insert: {
          id?: string
          project_id?: string | null
          user_id?: string | null
          user_email?: string | null
          role: string
          created_at?: string | null
        }
        Update: {
          id?: string
          project_id?: string | null
          user_id?: string | null
          user_email?: string | null
          role?: string
          created_at?: string | null
        }
        Relationships: []
      }
      sheet_text: {
        Row: {
          sheet_id: string
          text: Json
          created_at: string
        }
        Insert: {
          sheet_id: string
          text?: Json
          created_at?: string
        }
        Update: {
          sheet_id?: string
          text?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_text_sheet_id_fkey"
            columns: ["sheet_id"]
            referencedRelation: "sheets"
            referencedColumns: ["id"]
          }
        ]
      }
      sheet_vectors: {
        Row: {
          sheet_id: string
          vectors: Json
          created_at: string | null
        }
        Insert: {
          sheet_id: string
          vectors: Json
          created_at?: string | null
        }
        Update: {
          sheet_id?: string
          vectors?: Json
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sheet_vectors_sheet_id_fkey"
            columns: ["sheet_id"]
            referencedRelation: "sheets"
            referencedColumns: ["id"]
          }
        ]
      }
      sheet_metadata: {
        Row: {
          sheet_id: string
          sheet_number: string | null
          sheet_name: string | null
          architect_firm: string | null
          title_block_bbox: Json | null
          source: string | null
          model_version: string | null
          suggested_fields: Json | null
          review_status: string | null
          spec_version: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          sheet_id: string
          sheet_number?: string | null
          sheet_name?: string | null
          architect_firm?: string | null
          title_block_bbox?: Json | null
          source?: string | null
          model_version?: string | null
          suggested_fields?: Json | null
          review_status?: string | null
          spec_version?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          sheet_id?: string
          sheet_number?: string | null
          sheet_name?: string | null
          architect_firm?: string | null
          title_block_bbox?: Json | null
          source?: string | null
          model_version?: string | null
          suggested_fields?: Json | null
          review_status?: string | null
          spec_version?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_metadata_sheet_id_fkey"
            columns: ["sheet_id"]
            referencedRelation: "sheets"
            referencedColumns: ["id"]
          }
        ]
      }
      sheet_gridlines: {
        Row: {
          sheet_id: string
          gridlines: Json
          source: string | null
          model_version: string | null
          suggested_gridlines: Json | null
          review_status: string | null
          spec_version: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          sheet_id: string
          gridlines?: Json
          source?: string | null
          model_version?: string | null
          suggested_gridlines?: Json | null
          review_status?: string | null
          spec_version?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          sheet_id?: string
          gridlines?: Json
          source?: string | null
          model_version?: string | null
          suggested_gridlines?: Json | null
          review_status?: string | null
          spec_version?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sheet_gridlines_sheet_id_fkey"
            columns: ["sheet_id"]
            referencedRelation: "sheets"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      upsert_status_log: {
        Args: { log_data: Json }
        Returns: Database['public']['Tables']['status_logs']['Row']
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
