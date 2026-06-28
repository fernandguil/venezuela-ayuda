export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      admin_emails: {
        Row: {
          added_by: string | null
          created_at: string
          email: string
          is_super_admin: boolean
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          email: string
          is_super_admin?: boolean
        }
        Update: {
          added_by?: string | null
          created_at?: string
          email?: string
          is_super_admin?: boolean
        }
        Relationships: []
      }
      // Hand-added for 202606280002_dedupe_reviewers_and_locks (the /deduplicar
      // reviewer allowlist + per-group locks). A fresh `npm run types:*` after
      // applying the migration to the introspected DB will include them.
      reviewer_emails: {
        Row: {
          added_by: string | null
          created_at: string
          email: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          email: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      group_locks: {
        Row: {
          expires_at: string
          group_id: string
          locked_at: string
          locked_by: string
          locked_by_email: string | null
        }
        Insert: {
          expires_at: string
          group_id: string
          locked_at?: string
          locked_by: string
          locked_by_email?: string | null
        }
        Update: {
          expires_at?: string
          group_id?: string
          locked_at?: string
          locked_by?: string
          locked_by_email?: string | null
        }
        Relationships: []
      }
      api_partners: {
        Row: {
          active: boolean
          contact: string | null
          created_at: string
          id: string
          key_hash: string | null
          key_prefix: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          source: string
        }
        Insert: {
          active?: boolean
          contact?: string | null
          created_at?: string
          id?: string
          key_hash?: string | null
          key_prefix?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
          source: string
        }
        Update: {
          active?: boolean
          contact?: string | null
          created_at?: string
          id?: string
          key_hash?: string | null
          key_prefix?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
          source?: string
        }
        Relationships: []
      }
      applied_migrations: {
        Row: {
          applied_at: string
          version: string
        }
        Insert: {
          applied_at?: string
          version: string
        }
        Update: {
          applied_at?: string
          version?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          external_id: string | null
          ip: string | null
          occurred_at: string
          partner_id: string | null
          request_id: string | null
          resource_id: string
          resource_table: string
          seq: number
          source: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          external_id?: string | null
          ip?: string | null
          occurred_at?: string
          partner_id?: string | null
          request_id?: string | null
          resource_id: string
          resource_table: string
          seq?: never
          source?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          external_id?: string | null
          ip?: string | null
          occurred_at?: string
          partner_id?: string | null
          request_id?: string | null
          resource_id?: string
          resource_table?: string
          seq?: never
          source?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "api_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      checkins: {
        Row: {
          city: string | null
          created_at: string
          dedup_key: string | null
          external_id: string | null
          found_at: string | null
          hidden: boolean
          id: string
          latitude: number | null
          location: unknown
          longitude: number | null
          manage_token: string | null
          manage_token_hash: string | null
          message: string | null
          name: string
          phone_private: string | null
          photo_url: string | null
          place_name: string | null
          source: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["checkin_status"]
        }
        Insert: {
          city?: string | null
          created_at?: string
          dedup_key?: string | null
          external_id?: string | null
          found_at?: string | null
          hidden?: boolean
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          manage_token?: string | null
          manage_token_hash?: string | null
          message?: string | null
          name: string
          phone_private?: string | null
          photo_url?: string | null
          place_name?: string | null
          source?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["checkin_status"]
        }
        Update: {
          city?: string | null
          created_at?: string
          dedup_key?: string | null
          external_id?: string | null
          found_at?: string | null
          hidden?: boolean
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          manage_token?: string | null
          manage_token_hash?: string | null
          message?: string | null
          name?: string
          phone_private?: string | null
          photo_url?: string | null
          place_name?: string | null
          source?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["checkin_status"]
        }
        Relationships: []
      }
      collection_centers: {
        Row: {
          address: string | null
          can_ship_to_venezuela: boolean | null
          city: string | null
          contact: string | null
          country: string
          created_at: string
          description: string | null
          hidden: boolean
          id: string
          latitude: number | null
          location: unknown
          longitude: number | null
          manage_token: string | null
          manage_token_hash: string | null
          name: string
          needs: string[]
          needs_volunteers: boolean | null
          organizers: string | null
          resources: string | null
          source: string | null
          state: string | null
          verified: boolean
          volunteers_count: number | null
          website: string | null
        }
        Insert: {
          address?: string | null
          can_ship_to_venezuela?: boolean | null
          city?: string | null
          contact?: string | null
          country: string
          created_at?: string
          description?: string | null
          hidden?: boolean
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          manage_token?: string | null
          manage_token_hash?: string | null
          name: string
          needs?: string[]
          needs_volunteers?: boolean | null
          organizers?: string | null
          resources?: string | null
          source?: string | null
          state?: string | null
          verified?: boolean
          volunteers_count?: number | null
          website?: string | null
        }
        Update: {
          address?: string | null
          can_ship_to_venezuela?: boolean | null
          city?: string | null
          contact?: string | null
          country?: string
          created_at?: string
          description?: string | null
          hidden?: boolean
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          manage_token?: string | null
          manage_token_hash?: string | null
          name?: string
          needs?: string[]
          needs_volunteers?: boolean | null
          organizers?: string | null
          resources?: string | null
          source?: string | null
          state?: string | null
          verified?: boolean
          volunteers_count?: number | null
          website?: string | null
        }
        Relationships: []
      }
      damaged_reports: {
        Row: {
          city: string | null
          contact: string | null
          created_at: string
          dedup_key: string | null
          description: string | null
          external_id: string | null
          hidden: boolean
          id: string
          latitude: number | null
          location: unknown
          longitude: number | null
          manage_token: string | null
          manage_token_hash: string | null
          photo_url: string | null
          place_name: string
          risk_answers: Json | null
          risk_level: string | null
          risk_priority: boolean | null
          severity: Database["public"]["Enums"]["damage_severity"]
          source: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["request_status"]
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          city?: string | null
          contact?: string | null
          created_at?: string
          dedup_key?: string | null
          description?: string | null
          external_id?: string | null
          hidden?: boolean
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          manage_token?: string | null
          manage_token_hash?: string | null
          photo_url?: string | null
          place_name: string
          risk_answers?: Json | null
          risk_level?: string | null
          risk_priority?: boolean | null
          severity?: Database["public"]["Enums"]["damage_severity"]
          source?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          city?: string | null
          contact?: string | null
          created_at?: string
          dedup_key?: string | null
          description?: string | null
          external_id?: string | null
          hidden?: boolean
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          manage_token?: string | null
          manage_token_hash?: string | null
          photo_url?: string | null
          place_name?: string
          risk_answers?: Json | null
          risk_level?: string | null
          risk_priority?: boolean | null
          severity?: Database["public"]["Enums"]["damage_severity"]
          source?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: []
      }
      help_offers: {
        Row: {
          availability: string | null
          available: boolean
          category: Database["public"]["Enums"]["offer_category"]
          city: string | null
          contact: string | null
          created_at: string
          description: string | null
          external_id: string | null
          hidden: boolean
          id: string
          latitude: number | null
          location: unknown
          longitude: number | null
          source: string | null
          source_url: string | null
        }
        Insert: {
          availability?: string | null
          available?: boolean
          category: Database["public"]["Enums"]["offer_category"]
          city?: string | null
          contact?: string | null
          created_at?: string
          description?: string | null
          external_id?: string | null
          hidden?: boolean
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          source?: string | null
          source_url?: string | null
        }
        Update: {
          availability?: string | null
          available?: boolean
          category?: Database["public"]["Enums"]["offer_category"]
          city?: string | null
          contact?: string | null
          created_at?: string
          description?: string | null
          external_id?: string | null
          hidden?: boolean
          id?: string
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          source?: string | null
          source_url?: string | null
        }
        Relationships: []
      }
      help_requests: {
        Row: {
          category: Database["public"]["Enums"]["help_category"]
          city: string | null
          contact: string | null
          created_at: string
          description: string
          external_id: string | null
          hidden: boolean
          id: string
          items: Json | null
          latitude: number | null
          location: unknown
          longitude: number | null
          manage_token: string | null
          manage_token_hash: string | null
          place_name: string | null
          source: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["request_status"]
          urgency: Database["public"]["Enums"]["urgency_level"]
        }
        Insert: {
          category: Database["public"]["Enums"]["help_category"]
          city?: string | null
          contact?: string | null
          created_at?: string
          description: string
          external_id?: string | null
          hidden?: boolean
          id?: string
          items?: Json | null
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          manage_token?: string | null
          manage_token_hash?: string | null
          place_name?: string | null
          source?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          urgency?: Database["public"]["Enums"]["urgency_level"]
        }
        Update: {
          category?: Database["public"]["Enums"]["help_category"]
          city?: string | null
          contact?: string | null
          created_at?: string
          description?: string
          external_id?: string | null
          hidden?: boolean
          id?: string
          items?: Json | null
          latitude?: number | null
          location?: unknown
          longitude?: number | null
          manage_token?: string | null
          manage_token_hash?: string | null
          place_name?: string | null
          source?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          urgency?: Database["public"]["Enums"]["urgency_level"]
        }
        Relationships: []
      }
      request_responses: {
        Row: {
          created_at: string
          id: string
          message: string | null
          request_id: string
          responder_contact: string | null
          responder_name: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          request_id: string
          responder_contact?: string | null
          responder_name?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          request_id?: string
          responder_contact?: string | null
          responder_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "request_responses_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "help_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_responses_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "public_help_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      sightings: {
        Row: {
          checkin_id: string
          created_at: string
          finder_contact: string | null
          finder_name: string | null
          id: string
          message: string | null
        }
        Insert: {
          checkin_id: string
          created_at?: string
          finder_contact?: string | null
          finder_name?: string | null
          id?: string
          message?: string | null
        }
        Update: {
          checkin_id?: string
          created_at?: string
          finder_contact?: string | null
          finder_name?: string | null
          id?: string
          message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sightings_checkin_id_fkey"
            columns: ["checkin_id"]
            isOneToOne: false
            referencedRelation: "checkins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sightings_checkin_id_fkey"
            columns: ["checkin_id"]
            isOneToOne: false
            referencedRelation: "public_checkins"
            referencedColumns: ["id"]
          },
        ]
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      public_checkins: {
        Row: {
          city: string | null
          created_at: string | null
          found_at: string | null
          id: string | null
          latitude: number | null
          longitude: number | null
          message: string | null
          name: string | null
          photo_url: string | null
          place_name: string | null
          source: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["checkin_status"] | null
        }
        Insert: {
          city?: string | null
          created_at?: string | null
          found_at?: string | null
          id?: string | null
          latitude?: number | null
          longitude?: number | null
          message?: string | null
          name?: string | null
          photo_url?: string | null
          place_name?: string | null
          source?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["checkin_status"] | null
        }
        Update: {
          city?: string | null
          created_at?: string | null
          found_at?: string | null
          id?: string | null
          latitude?: number | null
          longitude?: number | null
          message?: string | null
          name?: string | null
          photo_url?: string | null
          place_name?: string | null
          source?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["checkin_status"] | null
        }
        Relationships: []
      }
      public_collection_centers: {
        Row: {
          address: string | null
          can_ship_to_venezuela: boolean | null
          city: string | null
          contact: string | null
          country: string | null
          created_at: string | null
          description: string | null
          id: string | null
          latitude: number | null
          longitude: number | null
          name: string | null
          needs: string[] | null
          needs_volunteers: boolean | null
          organizers: string | null
          resources: string | null
          state: string | null
          volunteers_count: number | null
          website: string | null
        }
        Insert: {
          address?: string | null
          can_ship_to_venezuela?: boolean | null
          city?: string | null
          contact?: string | null
          country?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          needs?: string[] | null
          needs_volunteers?: boolean | null
          organizers?: string | null
          resources?: string | null
          state?: string | null
          volunteers_count?: number | null
          website?: string | null
        }
        Update: {
          address?: string | null
          can_ship_to_venezuela?: boolean | null
          city?: string | null
          contact?: string | null
          country?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          needs?: string[] | null
          needs_volunteers?: boolean | null
          organizers?: string | null
          resources?: string | null
          state?: string | null
          volunteers_count?: number | null
          website?: string | null
        }
        Relationships: []
      }
      public_damaged_reports: {
        Row: {
          city: string | null
          created_at: string | null
          description: string | null
          id: string | null
          latitude: number | null
          longitude: number | null
          photo_url: string | null
          place_name: string | null
          risk_level: string | null
          risk_priority: boolean | null
          severity: Database["public"]["Enums"]["damage_severity"] | null
          source: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["request_status"] | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          latitude?: number | null
          longitude?: number | null
          photo_url?: string | null
          place_name?: string | null
          risk_level?: string | null
          risk_priority?: boolean | null
          severity?: Database["public"]["Enums"]["damage_severity"] | null
          source?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["request_status"] | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          latitude?: number | null
          longitude?: number | null
          photo_url?: string | null
          place_name?: string | null
          risk_level?: string | null
          risk_priority?: boolean | null
          severity?: Database["public"]["Enums"]["damage_severity"] | null
          source?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["request_status"] | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: []
      }
      public_help_offers: {
        Row: {
          availability: string | null
          available: boolean | null
          category: Database["public"]["Enums"]["offer_category"] | null
          city: string | null
          created_at: string | null
          description: string | null
          id: string | null
          latitude: number | null
          longitude: number | null
          source: string | null
          source_url: string | null
        }
        Insert: {
          availability?: string | null
          available?: boolean | null
          category?: Database["public"]["Enums"]["offer_category"] | null
          city?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          latitude?: number | null
          longitude?: number | null
          source?: string | null
          source_url?: string | null
        }
        Update: {
          availability?: string | null
          available?: boolean | null
          category?: Database["public"]["Enums"]["offer_category"] | null
          city?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          latitude?: number | null
          longitude?: number | null
          source?: string | null
          source_url?: string | null
        }
        Relationships: []
      }
      public_help_requests: {
        Row: {
          category: Database["public"]["Enums"]["help_category"] | null
          city: string | null
          created_at: string | null
          description: string | null
          id: string | null
          items: Json | null
          latitude: number | null
          longitude: number | null
          place_name: string | null
          source: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["request_status"] | null
          urgency: Database["public"]["Enums"]["urgency_level"] | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["help_category"] | null
          city?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          items?: Json | null
          latitude?: number | null
          longitude?: number | null
          place_name?: string | null
          source?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["request_status"] | null
          urgency?: Database["public"]["Enums"]["urgency_level"] | null
        }
        Update: {
          category?: Database["public"]["Enums"]["help_category"] | null
          city?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          items?: Json | null
          latitude?: number | null
          longitude?: number | null
          place_name?: string | null
          source?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["request_status"] | null
          urgency?: Database["public"]["Enums"]["urgency_level"] | null
        }
        Relationships: []
      }
    }
    Functions: {
      // Login throttle (migration 0021_login_throttle). Hand-added because these
      // types were generated from a DB before 0021 existed; a fresh
      // `npm run types:*` will include them automatically.
      login_guard: { Args: { p_key: string }; Returns: number }
      login_clear: { Args: { p_key: string }; Returns: undefined }
      login_record_failure: {
        Args: {
          p_key: string
          p_limit: number
          p_window_sec: number
          p_lockout_sec: number
        }
        Returns: undefined
      }
      // Hand-added for 0022_rate_limit (durable rate limiter). A fresh
      // `npm run types:*` after applying the migration will include it.
      rate_limit_hit: {
        Args: { p_key: string; p_limit: number; p_window_sec: number }
        Returns: { allowed: boolean; retry_after: number }[]
      }
      // Hand-added for 202606280002_dedupe_reviewers_and_locks (group locks for
      // the /deduplicar console). A fresh `npm run types:*` after applying the
      // migration to the introspected DB will include them automatically.
      claim_group_lock: {
        Args: {
          p_group_id: string
          p_user_id: string
          p_email: string
          p_ttl_seconds?: number
        }
        Returns: boolean
      }
      release_group_lock: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: undefined
      }
      active_group_locks: {
        Args: Record<PropertyKey, never>
        Returns: {
          group_id: string
          locked_by: string
          locked_by_email: string | null
          expires_at: string
        }[]
      }
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      delete_report: {
        Args: {
          p_id: string
          p_ip: string
          p_partner: string
          p_request_id: string
          p_source: string
          p_table: string
          p_user_agent: string
        }
        Returns: Json
      }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      gettransactionid: { Args: never; Returns: unknown }
      ingest_reports: {
        Args: {
          p_ip: string
          p_partner: string
          p_request_id: string
          p_rows: Json
          p_source: string
          p_table: string
          p_user_agent: string
        }
        Returns: Json
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
      patch_report: {
        Args: {
          p_id: string
          p_ip: string
          p_partner: string
          p_patch: Json
          p_request_id: string
          p_source: string
          p_table: string
          p_user_agent: string
        }
        Returns: Json
      }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
    }
    Enums: {
      checkin_status: "SAFE" | "NEEDS_HELP" | "LOOKING_FOR_SOMEONE"
      damage_severity: "CRACKS" | "PARTIAL" | "COLLAPSE_RISK" | "COLLAPSED"
      help_category:
        | "medical"
        | "food"
        | "water"
        | "shelter"
        | "transportation"
        | "electricity"
        | "rescue"
        | "tools"
      offer_category:
        | "transportation"
        | "food"
        | "shelter"
        | "medical"
        | "supplies"
        | "translation"
      request_status: "OPEN" | "IN_PROGRESS" | "RESOLVED"
      urgency_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
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
      checkin_status: ["SAFE", "NEEDS_HELP", "LOOKING_FOR_SOMEONE"],
      damage_severity: ["CRACKS", "PARTIAL", "COLLAPSE_RISK", "COLLAPSED"],
      help_category: [
        "medical",
        "food",
        "water",
        "shelter",
        "transportation",
        "electricity",
        "rescue",
        "tools",
      ],
      offer_category: [
        "transportation",
        "food",
        "shelter",
        "medical",
        "supplies",
        "translation",
      ],
      request_status: ["OPEN", "IN_PROGRESS", "RESOLVED"],
      urgency_level: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
    },
  },
} as const

