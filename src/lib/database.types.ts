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
      accounts: {
        Row: {
          archived: boolean
          created_at: string
          currency: string
          household_id: string
          id: string
          initial_balance: number
          name: string
          owner_profile_id: string | null
          type: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          currency?: string
          household_id: string
          id?: string
          initial_balance?: number
          name: string
          owner_profile_id?: string | null
          type: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          currency?: string
          household_id?: string
          id?: string
          initial_balance?: number
          name?: string
          owner_profile_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          active: boolean
          amount: number
          category_id: string
          household_id: string
          id: string
          period: string
          profile_id: string | null
          scope: string
        }
        Insert: {
          active?: boolean
          amount: number
          category_id: string
          household_id: string
          id?: string
          period?: string
          profile_id?: string | null
          scope?: string
        }
        Update: {
          active?: boolean
          amount?: number
          category_id?: string
          household_id?: string
          id?: string
          period?: string
          profile_id?: string | null
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string | null
          household_id: string
          icon: string
          id: string
          is_default: boolean
          kind: string
          name: string
          parent_id: string | null
        }
        Insert: {
          color?: string | null
          household_id: string
          icon?: string
          id?: string
          is_default?: boolean
          kind?: string
          name: string
          parent_id?: string | null
        }
        Update: {
          color?: string | null
          household_id?: string
          icon?: string
          id?: string
          is_default?: boolean
          kind?: string
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_transactions: {
        Row: {
          confidence: number | null
          id: string
          payload: Json
          statement_id: string
          status: string
        }
        Insert: {
          confidence?: number | null
          id?: string
          payload?: Json
          statement_id: string
          status?: string
        }
        Update: {
          confidence?: number | null
          id?: string
          payload?: Json
          statement_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "draft_transactions_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "statements"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          ars_per_usd: number
          date: string
          fetched_at: string
          source: string
        }
        Insert: {
          ars_per_usd: number
          date: string
          fetched_at?: string
          source: string
        }
        Update: {
          ars_per_usd?: number
          date?: string
          fetched_at?: string
          source?: string
        }
        Relationships: []
      }
      goal_contributions: {
        Row: {
          amount: number
          goal_id: string
          id: string
          note: string | null
          occurred_on: string
          profile_id: string
        }
        Insert: {
          amount: number
          goal_id: string
          id?: string
          note?: string | null
          occurred_on?: string
          profile_id: string
        }
        Update: {
          amount?: number
          goal_id?: string
          id?: string
          note?: string | null
          occurred_on?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_contributions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_contributions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          archived: boolean
          color: string | null
          created_at: string
          current_amount: number
          deadline: string | null
          household_id: string
          icon: string | null
          id: string
          name: string
          profile_id: string | null
          scope: string
          target_amount: number
          target_currency: string
        }
        Insert: {
          archived?: boolean
          color?: string | null
          created_at?: string
          current_amount?: number
          deadline?: string | null
          household_id: string
          icon?: string | null
          id?: string
          name: string
          profile_id?: string | null
          scope?: string
          target_amount: number
          target_currency?: string
        }
        Update: {
          archived?: boolean
          color?: string | null
          created_at?: string
          current_amount?: number
          deadline?: string | null
          household_id?: string
          icon?: string | null
          id?: string
          name?: string
          profile_id?: string | null
          scope?: string
          target_amount?: number
          target_currency?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      household_invites: {
        Row: {
          accepted_by: string | null
          code: string
          created_by: string
          expires_at: string
          household_id: string
          id: string
        }
        Insert: {
          accepted_by?: string | null
          code: string
          created_by: string
          expires_at?: string
          household_id: string
          id?: string
        }
        Update: {
          accepted_by?: string | null
          code?: string
          created_by?: string
          expires_at?: string
          household_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_invites_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          base_currency: string
          created_at: string
          fx_source: string
          id: string
          name: string
        }
        Insert: {
          base_currency?: string
          created_at?: string
          fx_source?: string
          id?: string
          name: string
        }
        Update: {
          base_currency?: string
          created_at?: string
          fx_source?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      inflation_rates: {
        Row: {
          date: string
          fetched_at: string
          id: string
          monthly_pct: number
          source: string
        }
        Insert: {
          date: string
          fetched_at?: string
          id?: string
          monthly_pct: number
          source?: string
        }
        Update: {
          date?: string
          fetched_at?: string
          id?: string
          monthly_pct?: number
          source?: string
        }
        Relationships: []
      }
      insights: {
        Row: {
          body: string
          created_at: string
          household_id: string
          id: string
          kind: string | null
          metric: Json | null
          period: string | null
          seen: boolean
          severity: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          household_id: string
          id?: string
          kind?: string | null
          metric?: Json | null
          period?: string | null
          seen?: boolean
          severity?: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          household_id?: string
          id?: string
          kind?: string | null
          metric?: Json | null
          period?: string | null
          seen?: boolean
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_aliases: {
        Row: {
          category_id: string | null
          household_id: string
          id: string
          merchant_clean: string | null
          raw_pattern: string
        }
        Insert: {
          category_id?: string | null
          household_id: string
          id?: string
          merchant_clean?: string | null
          raw_pattern: string
        }
        Update: {
          category_id?: string | null
          household_id?: string
          id?: string
          merchant_clean?: string | null
          raw_pattern?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_aliases_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_aliases_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          household_id: string | null
          id: string
          nickname: string | null
          push_token: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          household_id?: string | null
          id: string
          nickname?: string | null
          push_token?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          household_id?: string | null
          id?: string
          nickname?: string | null
          push_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          profile_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          profile_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_rules: {
        Row: {
          active: boolean
          amount: number
          anchor_day: number | null
          cadence: string
          category_id: string | null
          direction: string
          household_id: string
          id: string
          is_variable: boolean
          label: string
          next_run: string | null
          profile_id: string
          scope: string
        }
        Insert: {
          active?: boolean
          amount: number
          anchor_day?: number | null
          cadence: string
          category_id?: string | null
          direction: string
          household_id: string
          id?: string
          is_variable?: boolean
          label: string
          next_run?: string | null
          profile_id: string
          scope?: string
        }
        Update: {
          active?: boolean
          amount?: number
          anchor_day?: number | null
          cadence?: string
          category_id?: string | null
          direction?: string
          household_id?: string
          id?: string
          is_variable?: boolean
          label?: string
          next_run?: string | null
          profile_id?: string
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_rules_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_rules_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      savings_goals: {
        Row: {
          created_at: string
          household_id: string
          id: string
          month: string
          target_pct: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          month: string
          target_pct?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          month?: string
          target_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "savings_goals_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      settlements: {
        Row: {
          amount: number
          from_profile: string
          household_id: string
          id: string
          note: string | null
          occurred_on: string
          to_profile: string
        }
        Insert: {
          amount: number
          from_profile: string
          household_id: string
          id?: string
          note?: string | null
          occurred_on?: string
          to_profile: string
        }
        Update: {
          amount?: number
          from_profile?: string
          household_id?: string
          id?: string
          note?: string | null
          occurred_on?: string
          to_profile?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlements_from_profile_fkey"
            columns: ["from_profile"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlements_to_profile_fkey"
            columns: ["to_profile"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      splits: {
        Row: {
          amount: number
          id: string
          ower_profile_id: string
          payer_profile_id: string
          settled: boolean
          settled_at: string | null
          transaction_id: string
        }
        Insert: {
          amount: number
          id?: string
          ower_profile_id: string
          payer_profile_id: string
          settled?: boolean
          settled_at?: string | null
          transaction_id: string
        }
        Update: {
          amount?: number
          id?: string
          ower_profile_id?: string
          payer_profile_id?: string
          settled?: boolean
          settled_at?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "splits_ower_profile_id_fkey"
            columns: ["ower_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "splits_payer_profile_id_fkey"
            columns: ["payer_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "splits_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      statements: {
        Row: {
          account_id: string | null
          created_at: string
          error: string | null
          file_path: string | null
          household_id: string
          id: string
          period_end: string | null
          period_start: string | null
          profile_id: string
          raw_excerpt: string | null
          status: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          error?: string | null
          file_path?: string | null
          household_id: string
          id?: string
          period_end?: string | null
          period_start?: string | null
          profile_id: string
          raw_excerpt?: string | null
          status?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          error?: string | null
          file_path?: string | null
          household_id?: string
          id?: string
          period_end?: string | null
          period_start?: string | null
          profile_id?: string
          raw_excerpt?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "statements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statements_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statements_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_items: {
        Row: {
          created_at: string
          household_id: string
          id: string
          item_group: string
          line_total: number
          name: string
          qty: number | null
          transaction_id: string
        }
        Insert: {
          created_at?: string
          household_id: string
          id?: string
          item_group?: string
          line_total?: number
          name: string
          qty?: number | null
          transaction_id: string
        }
        Update: {
          created_at?: string
          household_id?: string
          id?: string
          item_group?: string
          line_total?: number
          name?: string
          qty?: number | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string | null
          amount: number
          category_id: string | null
          created_at: string
          currency: string
          description: string | null
          household_id: string
          id: string
          installment_group_id: string | null
          installment_number: number | null
          installment_total: number | null
          is_shared: boolean
          merchant: string | null
          occurred_on: string
          profile_id: string
          scope: string
          source: string
          statement_id: string | null
          type: string
          usd_rate_snapshot: number | null
        }
        Insert: {
          account_id?: string | null
          amount: number
          category_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          household_id: string
          id?: string
          installment_group_id?: string | null
          installment_number?: number | null
          installment_total?: number | null
          is_shared?: boolean
          merchant?: string | null
          occurred_on?: string
          profile_id: string
          scope?: string
          source?: string
          statement_id?: string | null
          type: string
          usd_rate_snapshot?: number | null
        }
        Update: {
          account_id?: string | null
          amount?: number
          category_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          household_id?: string
          id?: string
          installment_group_id?: string | null
          installment_number?: number | null
          installment_total?: number | null
          is_shared?: boolean
          merchant?: string | null
          occurred_on?: string
          profile_id?: string
          scope?: string
          source?: string
          statement_id?: string | null
          type?: string
          usd_rate_snapshot?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_household: { Args: { household_name?: string }; Returns: string }
      generate_invite_code: { Args: never; Returns: string }
      join_household: { Args: { invite_code: string }; Returns: string }
      my_household_id: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
