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
          active_scopes: Json | null
          milestone_schedules: Json | null
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
          active_scopes?: Json | null
          milestone_schedules?: Json | null
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
          active_scopes?: Json | null
          milestone_schedules?: Json | null
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
          deleted_at: string | null
          deleted_by: string | null
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
          deleted_at?: string | null
          deleted_by?: string | null
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
          deleted_at?: string | null
          deleted_by?: string | null
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
          icon_offset_x: number | null
          icon_offset_y: number | null
          walk_sequence: number | null
          assigned_to: string | null
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
          icon_offset_x?: number | null
          icon_offset_y?: number | null
          walk_sequence?: number | null
          assigned_to?: string | null
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
          icon_offset_x?: number | null
          icon_offset_y?: number | null
          walk_sequence?: number | null
          assigned_to?: string | null
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
      project_milestones: {
        Row: {
          id: string
          project_id: string | null
          sequence_order: number | null
          name: string
          color: string
          track: string
          applies_to_unit_types: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          project_id?: string | null
          sequence_order?: number | null
          name: string
          color: string
          track?: string
          applies_to_unit_types?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          project_id?: string | null
          sequence_order?: number | null
          name?: string
          color?: string
          track?: string
          applies_to_unit_types?: Json | null
          created_at?: string | null
        }
        Relationships: []
      }
      milestone_applicability_overrides: {
        Row: {
          id: string
          milestone_id: string
          unit_id: string
          is_applicable: boolean
          created_by: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          milestone_id: string
          unit_id: string
          is_applicable: boolean
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          milestone_id?: string
          unit_id?: string
          is_applicable?: boolean
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "milestone_applicability_overrides_milestone_id_fkey"
            columns: ["milestone_id"]
            referencedRelation: "project_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_applicability_overrides_unit_id_fkey"
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
          milestone: string
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
          milestone: string
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
          milestone?: string
          status_color?: string
          temporal_state?: string
          track?: string
          planned_start_date?: string | null
          planned_end_date?: string | null
          logged_date?: string | null
          client_timestamp?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      status_audit_log: {
        Row: {
          id: string
          unit_id: string | null
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
        Relationships: []
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
