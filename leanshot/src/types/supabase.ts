export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          mode: string
          model: string | null
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          mode?: string
          model?: string | null
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          mode?: string
          model?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_type: Database["public"]["Enums"]["audit_actor_type"]
          after_hash: string | null
          before_hash: string | null
          id: number
          ip_hash: string | null
          recipient_ip_family: string | null
          recipient_ua_family: string | null
          row_id: string | null
          share_id: string | null
          table_name: string
          timestamp: string
          user_id: string | null
          user_id_hash: string
        }
        Insert: {
          action: string
          actor_type?: Database["public"]["Enums"]["audit_actor_type"]
          after_hash?: string | null
          before_hash?: string | null
          id?: number
          ip_hash?: string | null
          recipient_ip_family?: string | null
          recipient_ua_family?: string | null
          row_id?: string | null
          share_id?: string | null
          table_name: string
          timestamp?: string
          user_id?: string | null
          user_id_hash: string
        }
        Update: {
          action?: string
          actor_type?: Database["public"]["Enums"]["audit_actor_type"]
          after_hash?: string | null
          before_hash?: string | null
          id?: number
          ip_hash?: string | null
          recipient_ip_family?: string | null
          recipient_ua_family?: string | null
          row_id?: string | null
          share_id?: string | null
          table_name?: string
          timestamp?: string
          user_id?: string | null
          user_id_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "shares"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
      injections: {
        Row: {
          created_at: string
          dose: string
          log_id: string
          logged_at: string
          medication: string
          notes: string
          pk_engine_version: number
          site: string | null
          unit: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dose: string
          log_id: string
          logged_at: string
          medication: string
          notes?: string
          pk_engine_version?: number
          site?: string | null
          unit: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dose?: string
          log_id?: string
          logged_at?: string
          medication?: string
          notes?: string
          pk_engine_version?: number
          site?: string | null
          unit?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "injections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
      meals: {
        Row: {
          calories: number
          created_at: string
          date: string
          fiber: number
          hunger: number | null
          meal_id: string
          name: string
          protein: number
          satisfaction: number | null
          ts: number
          updated_at: string
          user_id: string
        }
        Insert: {
          calories: number
          created_at?: string
          date: string
          fiber: number
          hunger?: number | null
          meal_id: string
          name: string
          protein: number
          satisfaction?: number | null
          ts: number
          updated_at?: string
          user_id: string
        }
        Update: {
          calories?: number
          created_at?: string
          date?: string
          fiber?: number
          hunger?: number | null
          meal_id?: string
          name?: string
          protein?: number
          satisfaction?: number | null
          ts?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
      mood: {
        Row: {
          created_at: string
          date: string
          energy: number | null
          mood: number
          mood_id: string
          notes: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          energy?: number | null
          mood: number
          mood_id: string
          notes?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          energy?: number | null
          mood?: number
          mood_id?: string
          notes?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mood_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
      pending_account_deletions: {
        Row: {
          finalize_attempts: number
          initiated_at: string
          photos_moved_at: string | null
          user_id: string
        }
        Insert: {
          finalize_attempts?: number
          initiated_at?: string
          photos_moved_at?: string | null
          user_id: string
        }
        Update: {
          finalize_attempts?: number
          initiated_at?: string
          photos_moved_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_account_deletions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
      photos: {
        Row: {
          created_at: string
          date: string
          mime_type: string
          photo_id: string
          size_bytes: number | null
          storage_path: string
          updated_at: string
          user_id: string
          weight: number | null
        }
        Insert: {
          created_at?: string
          date: string
          mime_type?: string
          photo_id: string
          size_bytes?: number | null
          storage_path: string
          updated_at?: string
          user_id: string
          weight?: number | null
        }
        Update: {
          created_at?: string
          date?: string
          mime_type?: string
          photo_id?: string
          size_bytes?: number | null
          storage_path?: string
          updated_at?: string
          user_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "photos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
      rate_limit_counters: {
        Row: {
          bucket_start: string
          hits: number
          user_id: string
          window: string
        }
        Insert: {
          bucket_start: string
          hits?: number
          user_id: string
          window: string
        }
        Update: {
          bucket_start?: string
          hits?: number
          user_id?: string
          window?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limit_counters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          payload: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          payload?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          payload?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
      shares: {
        Row: {
          access_code_hash: string
          code_consumed_at: string | null
          created_at: string
          expires_at: string
          failed_attempts_count: number
          id: string
          label: string
          last_attempt_at: string | null
          recipient_session_hash: string | null
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          access_code_hash: string
          code_consumed_at?: string | null
          created_at?: string
          expires_at: string
          failed_attempts_count?: number
          id?: string
          label: string
          last_attempt_at?: string | null
          recipient_session_hash?: string | null
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          access_code_hash?: string
          code_consumed_at?: string | null
          created_at?: string
          expires_at?: string
          failed_attempts_count?: number
          id?: string
          label?: string
          last_attempt_at?: string | null
          recipient_session_hash?: string | null
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shares_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
      sleep: {
        Row: {
          created_at: string
          date: string
          hours: number
          notes: string
          quality: number | null
          sleep_id: string
          updated_at: string
          user_id: string
          wakings: number
        }
        Insert: {
          created_at?: string
          date: string
          hours: number
          notes?: string
          quality?: number | null
          sleep_id: string
          updated_at?: string
          user_id: string
          wakings: number
        }
        Update: {
          created_at?: string
          date?: string
          hours?: number
          notes?: string
          quality?: number | null
          sleep_id?: string
          updated_at?: string
          user_id?: string
          wakings?: number
        }
        Relationships: [
          {
            foreignKeyName: "sleep_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
      supplements: {
        Row: {
          created_at: string
          date: string
          supplement_name: string
          taken: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          supplement_name: string
          taken?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          supplement_name?: string
          taken?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
      symptoms: {
        Row: {
          created_at: string
          date: string
          notes: string
          severity: number
          symptom: string
          symptom_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          notes?: string
          severity: number
          symptom: string
          symptom_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          notes?: string
          severity?: number
          symptom?: string
          symptom_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "symptoms_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
      vials: {
        Row: {
          created_at: string
          doses_per_vial: number
          doses_used: number
          expiration_date: string
          name: string
          start_date: string
          updated_at: string
          user_id: string
          vial_id: string
        }
        Insert: {
          created_at?: string
          doses_per_vial: number
          doses_used: number
          expiration_date: string
          name: string
          start_date: string
          updated_at?: string
          user_id: string
          vial_id: string
        }
        Update: {
          created_at?: string
          doses_per_vial?: number
          doses_used?: number
          expiration_date?: string
          name?: string
          start_date?: string
          updated_at?: string
          user_id?: string
          vial_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vials_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
      weights: {
        Row: {
          body_fat: number | null
          created_at: string
          date: string
          ts: number
          updated_at: string
          user_id: string
          weight: number
          weight_id: string
        }
        Insert: {
          body_fat?: number | null
          created_at?: string
          date: string
          ts: number
          updated_at?: string
          user_id: string
          weight: number
          weight_id: string
        }
        Update: {
          body_fat?: number | null
          created_at?: string
          date?: string
          ts?: number
          updated_at?: string
          user_id?: string
          weight?: number
          weight_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weights_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
      workouts: {
        Row: {
          created_at: string
          date: string
          minutes: number
          name: string
          notes: string
          rpe: number | null
          type: string
          updated_at: string
          user_id: string
          workout_id: string
        }
        Insert: {
          created_at?: string
          date: string
          minutes: number
          name: string
          notes?: string
          rpe?: number | null
          type: string
          updated_at?: string
          user_id: string
          workout_id: string
        }
        Update: {
          created_at?: string
          date?: string
          minutes?: number
          name?: string
          notes?: string
          rpe?: number | null
          type?: string
          updated_at?: string
          user_id?: string
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "share_snapshot_view"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      share_snapshot_view: {
        Row: {
          injections: Json | null
          meals: Json | null
          mood: Json | null
          patient_first_name: string | null
          photos: Json | null
          settings: Json | null
          sleep: Json | null
          supplements: Json | null
          symptoms: Json | null
          user_id: string | null
          vials: Json | null
          weights: Json | null
          workouts: Json | null
        }
        Insert: {
          injections?: never
          meals?: never
          mood?: never
          patient_first_name?: never
          photos?: never
          settings?: never
          sleep?: never
          supplements?: never
          symptoms?: never
          user_id?: string | null
          vials?: never
          weights?: never
          workouts?: never
        }
        Update: {
          injections?: never
          meals?: never
          mood?: never
          patient_first_name?: never
          photos?: never
          settings?: never
          sleep?: never
          supplements?: never
          symptoms?: never
          user_id?: string | null
          vials?: never
          weights?: never
          workouts?: never
        }
        Relationships: []
      }
    }
    Functions: {
      create_share: {
        Args: { p_expires_at: string; p_label: string }
        Returns: {
          raw_code: string
          raw_token: string
          share_id: string
        }[]
      }
      finalize_account_deletion: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      increment_rate_limit: {
        Args: { p_bucket_start: string; p_user_id: string; p_window: string }
        Returns: number
      }
      increment_share_attempt: { Args: { p_share_id: string }; Returns: number }
      initiate_account_deletion: { Args: never; Returns: undefined }
      log_share_view: {
        Args: { p_ip_family: string; p_share_id: string; p_ua_family: string }
        Returns: undefined
      }
      redeem_share: {
        Args: {
          p_ip_family: string
          p_recipient_session_hash: string
          p_share_id: string
          p_ua_family: string
        }
        Returns: undefined
      }
      revoke_share: { Args: { p_share_id: string }; Returns: undefined }
      run_finalize_account_deletions_cron_now: {
        Args: never
        Returns: undefined
      }
      verify_share_code: {
        Args: { p_code: string; p_share_id: string }
        Returns: boolean
      }
    }
    Enums: {
      audit_actor_type: "user" | "share_recipient" | "system"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      audit_actor_type: ["user", "share_recipient", "system"],
    },
  },
} as const
