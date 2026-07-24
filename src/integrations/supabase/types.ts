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
  public: {
    Tables: {
      loyalty_points: {
        Row: {
          client_user_id: string
          id: string
          points: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          client_user_id: string
          id?: string
          points?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          client_user_id?: string
          id?: string
          points?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_points_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      postes: {
        Row: {
          client_name: string | null
          created_at: string
          drink_count: number
          duration_min: number | null
          emoji: string | null
          ends_at: string | null
          id: string
          name: string
          paused: boolean
          position: number
          remaining_ms: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["poste_status"]
          tenant_id: string
          ticket_code: string | null
          ticket_id: string | null
          updated_at: string
        }
        Insert: {
          client_name?: string | null
          created_at?: string
          drink_count?: number
          duration_min?: number | null
          emoji?: string | null
          ends_at?: string | null
          id?: string
          name: string
          paused?: boolean
          position: number
          remaining_ms?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["poste_status"]
          tenant_id: string
          ticket_code?: string | null
          ticket_id?: string | null
          updated_at?: string
        }
        Update: {
          client_name?: string | null
          created_at?: string
          drink_count?: number
          duration_min?: number | null
          emoji?: string | null
          ends_at?: string | null
          id?: string
          name?: string
          paused?: boolean
          position?: number
          remaining_ms?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["poste_status"]
          tenant_id?: string
          ticket_code?: string | null
          ticket_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "postes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      sessions_caisse: {
        Row: {
          amount: number
          client_name: string | null
          created_at: string
          created_by: string | null
          day: string
          drink_count: number
          duration_min: number
          id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          poste_id: string | null
          poste_name: string
          tenant_id: string
          ticket_code: string | null
          ticket_id: string | null
          ts: string
        }
        Insert: {
          amount?: number
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          day?: string
          drink_count?: number
          duration_min: number
          id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          poste_id?: string | null
          poste_name: string
          tenant_id: string
          ticket_code?: string | null
          ticket_id?: string | null
          ts?: string
        }
        Update: {
          amount?: number
          client_name?: string | null
          created_at?: string
          created_by?: string | null
          day?: string
          drink_count?: number
          duration_min?: number
          id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          poste_id?: string | null
          poste_name?: string
          tenant_id?: string
          ticket_code?: string | null
          ticket_id?: string | null
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_caisse_poste_id_fkey"
            columns: ["poste_id"]
            isOneToOne: false
            referencedRelation: "postes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_caisse_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_caisse_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_settings: {
        Row: {
          custom_price_per_minute: number
          poste_count: number
          price_drink: number
          prices: Json
          tenant_id: string
          updated_at: string
          warn_minutes: number
        }
        Insert: {
          custom_price_per_minute?: number
          poste_count?: number
          price_drink?: number
          prices?: Json
          tenant_id: string
          updated_at?: string
          warn_minutes?: number
        }
        Update: {
          custom_price_per_minute?: number
          poste_count?: number
          price_drink?: number
          prices?: Json
          tenant_id?: string
          updated_at?: string
          warn_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          billing_status: string
          city: string | null
          country: string | null
          created_at: string
          id: string
          logo_url: string | null
          name: string
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
          updated_at: string
        }
        Insert: {
          billing_status?: string
          city?: string | null
          country?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
        }
        Update: {
          billing_status?: string
          city?: string | null
          country?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          updated_at?: string
        }
        Relationships: []
      }
      tickets: {
        Row: {
          age: number | null
          client_user_id: string | null
          code: string
          created_at: string
          date_creation: string
          date_expiration: string
          id: string
          nom: string
          prenom: string
          saved_remaining_ms: number | null
          tenant_id: string
          total_amount: number
          total_minutes_played: number
          used_saved_time: boolean
        }
        Insert: {
          age?: number | null
          client_user_id?: string | null
          code: string
          created_at?: string
          date_creation?: string
          date_expiration: string
          id?: string
          nom: string
          prenom: string
          saved_remaining_ms?: number | null
          tenant_id: string
          total_amount?: number
          total_minutes_played?: number
          used_saved_time?: boolean
        }
        Update: {
          age?: number | null
          client_user_id?: string | null
          code?: string
          created_at?: string
          date_creation?: string
          date_expiration?: string
          id?: string
          nom?: string
          prenom?: string
          saved_remaining_ms?: number | null
          tenant_id?: string
          total_amount?: number
          total_minutes_played?: number
          used_saved_time?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_tenant_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_tenant_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_tenants: { Args: { _user_id: string }; Returns: string[] }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _tenant_id?: string
          _user_id: string
        }
        Returns: boolean
      }
      has_tenant_access: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "platform_admin" | "lounge_admin" | "staff" | "client"
      payment_method: "cash" | "airtel_money" | "mtn_money"
      poste_status: "idle" | "busy"
      tenant_status: "active" | "suspended"
      ticket_status: "valid" | "exhausted" | "expired"
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
  public: {
    Enums: {
      app_role: ["platform_admin", "lounge_admin", "staff", "client"],
      payment_method: ["cash", "airtel_money", "mtn_money"],
      poste_status: ["idle", "busy"],
      tenant_status: ["active", "suspended"],
      ticket_status: ["valid", "exhausted", "expired"],
    },
  },
} as const
