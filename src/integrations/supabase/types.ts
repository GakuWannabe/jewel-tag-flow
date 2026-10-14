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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      bot_clients: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          key_hint: string | null
          kind: string
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          key_hint?: string | null
          kind?: string
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          key_hint?: string | null
          kind?: string
          name?: string
        }
        Relationships: []
      }
      bot_results: {
        Row: {
          actual_ser_no: number | null
          bot_client_id: string | null
          created_at: string
          error_message: string | null
          expected_ser_no: number | null
          id: string
          mismatch: boolean
          sequence: number
          status: string
          sublot_id: string
        }
        Insert: {
          actual_ser_no?: number | null
          bot_client_id?: string | null
          created_at?: string
          error_message?: string | null
          expected_ser_no?: number | null
          id?: string
          mismatch?: boolean
          sequence: number
          status: string
          sublot_id: string
        }
        Update: {
          actual_ser_no?: number | null
          bot_client_id?: string | null
          created_at?: string
          error_message?: string | null
          expected_ser_no?: number | null
          id?: string
          mismatch?: boolean
          sequence?: number
          status?: string
          sublot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_results_sublot_id_fkey"
            columns: ["sublot_id"]
            isOneToOne: false
            referencedRelation: "sublots"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          active: boolean
          branch_code: string
          branch_name: string
          created_at: string
          created_by: string | null
          id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          branch_code: string
          branch_name: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          branch_code?: string
          branch_name?: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      hold_events: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          flag: Database["public"]["Enums"]["hold_flag"] | null
          id: string
          item_id: string
          note: string | null
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          flag?: Database["public"]["Enums"]["hold_flag"] | null
          id?: string
          item_id: string
          note?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          flag?: Database["public"]["Enums"]["hold_flag"] | null
          id?: string
          item_id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hold_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      huid_pool: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_item_id: string | null
          created_at: string
          created_by: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          huid: string
          id: string
          piece_weight: number | null
          source: string
          sublot_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_item_id?: string | null
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          huid: string
          id?: string
          piece_weight?: number | null
          source?: string
          sublot_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_item_id?: string | null
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          huid?: string
          id?: string
          piece_weight?: number | null
          source?: string
          sublot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "huid_pool_assigned_item_id_fkey"
            columns: ["assigned_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "huid_pool_sublot_id_fkey"
            columns: ["sublot_id"]
            isOneToOne: false
            referencedRelation: "sublots"
            referencedColumns: ["id"]
          },
        ]
      }
      item_corrections: {
        Row: {
          compartment_no: number | null
          corrected_at: string
          corrected_by: string
          gross_weight: number | null
          huids: string | null
          id: string
          item_id: string
          less_weight: number | null
          net_weight: number | null
          pcs: number
          reason: string
          sublot_id: string
          tray_code: string | null
        }
        Insert: {
          compartment_no?: number | null
          corrected_at?: string
          corrected_by?: string
          gross_weight?: number | null
          huids?: string | null
          id?: string
          item_id: string
          less_weight?: number | null
          net_weight?: number | null
          pcs: number
          reason: string
          sublot_id: string
          tray_code?: string | null
        }
        Update: {
          compartment_no?: number | null
          corrected_at?: string
          corrected_by?: string
          gross_weight?: number | null
          huids?: string | null
          id?: string
          item_id?: string
          less_weight?: number | null
          net_weight?: number | null
          pcs?: number
          reason?: string
          sublot_id?: string
          tray_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_corrections_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_corrections_sublot_id_fkey"
            columns: ["sublot_id"]
            isOneToOne: false
            referencedRelation: "sublots"
            referencedColumns: ["id"]
          },
        ]
      }
      item_huids: {
        Row: {
          created_at: string
          created_by: string | null
          huid_pool_id: string
          id: string
          item_id: string
          position: number
          removed_at: string | null
          removed_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          huid_pool_id: string
          id?: string
          item_id: string
          position: number
          removed_at?: string | null
          removed_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          huid_pool_id?: string
          id?: string
          item_id?: string
          position?: number
          removed_at?: string | null
          removed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_huids_huid_pool_id_fkey"
            columns: ["huid_pool_id"]
            isOneToOne: false
            referencedRelation: "huid_pool"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_huids_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_removals: {
        Row: {
          compartment_no: number | null
          gross_weight: number | null
          hold_flag: string | null
          huids: string | null
          id: string
          item_id: string
          less_weight: number | null
          net_weight: number | null
          pcs: number
          reason: string
          removed_at: string
          removed_by: string
          sublot_id: string
          tray_code: string | null
        }
        Insert: {
          compartment_no?: number | null
          gross_weight?: number | null
          hold_flag?: string | null
          huids?: string | null
          id?: string
          item_id: string
          less_weight?: number | null
          net_weight?: number | null
          pcs: number
          reason: string
          removed_at?: string
          removed_by: string
          sublot_id: string
          tray_code?: string | null
        }
        Update: {
          compartment_no?: number | null
          gross_weight?: number | null
          hold_flag?: string | null
          huids?: string | null
          id?: string
          item_id?: string
          less_weight?: number | null
          net_weight?: number | null
          pcs?: number
          reason?: string
          removed_at?: string
          removed_by?: string
          sublot_id?: string
          tray_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_removals_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_removals_sublot_id_fkey"
            columns: ["sublot_id"]
            isOneToOne: false
            referencedRelation: "sublots"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          actual_ser_no: number | null
          barcode: string | null
          cat_a: string | null
          cat_b: string | null
          cat_c: string | null
          compartment_no: number
          compcode: string | null
          created_at: string
          created_by: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          gross_weight: number | null
          hold_flag: Database["public"]["Enums"]["hold_flag"] | null
          hold_note: string | null
          ic: string | null
          id: string
          less_weight: number
          narration: string | null
          net_weight: number | null
          pcs: number
          photo_delivered_at: string | null
          photo_filename: string | null
          photo_matched_at: string | null
          photo_skip_reason: string | null
          photo_skipped_at: string | null
          photo_url: string | null
          scale_serial: string | null
          sequence: number | null
          ser_no: number | null
          size: string | null
          source_photo_name: string | null
          stone_pcs: number | null
          sublot_id: string
          tray_session_id: string
          type: string | null
          updated_at: string | null
          updated_by: string | null
          weighed_at: string | null
          weighed_by: string | null
        }
        Insert: {
          actual_ser_no?: number | null
          barcode?: string | null
          cat_a?: string | null
          cat_b?: string | null
          cat_c?: string | null
          compartment_no: number
          compcode?: string | null
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          gross_weight?: number | null
          hold_flag?: Database["public"]["Enums"]["hold_flag"] | null
          hold_note?: string | null
          ic?: string | null
          id?: string
          less_weight?: number
          narration?: string | null
          net_weight?: number | null
          pcs?: number
          photo_delivered_at?: string | null
          photo_filename?: string | null
          photo_matched_at?: string | null
          photo_skip_reason?: string | null
          photo_skipped_at?: string | null
          photo_url?: string | null
          scale_serial?: string | null
          sequence?: number | null
          ser_no?: number | null
          size?: string | null
          source_photo_name?: string | null
          stone_pcs?: number | null
          sublot_id: string
          tray_session_id: string
          type?: string | null
          updated_at?: string | null
          updated_by?: string | null
          weighed_at?: string | null
          weighed_by?: string | null
        }
        Update: {
          actual_ser_no?: number | null
          barcode?: string | null
          cat_a?: string | null
          cat_b?: string | null
          cat_c?: string | null
          compartment_no?: number
          compcode?: string | null
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          gross_weight?: number | null
          hold_flag?: Database["public"]["Enums"]["hold_flag"] | null
          hold_note?: string | null
          ic?: string | null
          id?: string
          less_weight?: number
          narration?: string | null
          net_weight?: number | null
          pcs?: number
          photo_delivered_at?: string | null
          photo_filename?: string | null
          photo_matched_at?: string | null
          photo_skip_reason?: string | null
          photo_skipped_at?: string | null
          photo_url?: string | null
          scale_serial?: string | null
          sequence?: number | null
          ser_no?: number | null
          size?: string | null
          source_photo_name?: string | null
          stone_pcs?: number | null
          sublot_id?: string
          tray_session_id?: string
          type?: string | null
          updated_at?: string | null
          updated_by?: string | null
          weighed_at?: string | null
          weighed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_sublot_id_fkey"
            columns: ["sublot_id"]
            isOneToOne: false
            referencedRelation: "sublots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_tray_session_id_fkey"
            columns: ["tray_session_id"]
            isOneToOne: false
            referencedRelation: "tray_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lot_deletions: {
        Row: {
          deleted_at: string
          deleted_by: string | null
          id: string
          lot_no: string
          summary: Json | null
        }
        Insert: {
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          lot_no: string
          summary?: Json | null
        }
        Update: {
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          lot_no?: string
          summary?: Json | null
        }
        Relationships: []
      }
      lot_targets: {
        Row: {
          created_at: string
          created_by: string | null
          lot_id: string
          total_gross_weight: number
          total_net_weight: number
          total_pcs: number
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          lot_id: string
          total_gross_weight: number
          total_net_weight: number
          total_pcs: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          lot_id?: string
          total_gross_weight?: number
          total_net_weight?: number
          total_pcs?: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lot_targets_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: true
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
        ]
      }
      lots: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          lot_no: string
          making_type: Database["public"]["Enums"]["making_type"] | null
          making_value: number | null
          melting: number | null
          notes: string | null
          purity_id: string | null
          received_date: string
          status: string
          updated_at: string | null
          updated_by: string | null
          vendor_id: string | null
          wastage_pct: number | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          lot_no: string
          making_type?: Database["public"]["Enums"]["making_type"] | null
          making_value?: number | null
          melting?: number | null
          notes?: string | null
          purity_id?: string | null
          received_date?: string
          status?: string
          updated_at?: string | null
          updated_by?: string | null
          vendor_id?: string | null
          wastage_pct?: number | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          lot_no?: string
          making_type?: Database["public"]["Enums"]["making_type"] | null
          making_value?: number | null
          melting?: number | null
          notes?: string | null
          purity_id?: string | null
          received_date?: string
          status?: string
          updated_at?: string | null
          updated_by?: string | null
          vendor_id?: string | null
          wastage_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lots_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lots_purity_id_fkey"
            columns: ["purity_id"]
            isOneToOne: false
            referencedRelation: "purities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lots_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_skips: {
        Row: {
          created_at: string
          device_id: string | null
          id: string
          item_id: string
          reason: string
          sequence: number | null
          sublot_id: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          id?: string
          item_id: string
          reason: string
          sequence?: number | null
          sublot_id: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          id?: string
          item_id?: string
          reason?: string
          sequence?: number | null
          sublot_id?: string
        }
        Relationships: []
      }
      product_types: {
        Row: {
          active: boolean
          allowed_pcs: number[]
          base_code: string
          branch_id: string
          created_at: string
          created_by: string | null
          default_pcs: number
          huid_pieces_per_tag: number
          id: string
          name: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          allowed_pcs?: number[]
          base_code: string
          branch_id: string
          created_at?: string
          created_by?: string | null
          default_pcs?: number
          huid_pieces_per_tag?: number
          id?: string
          name: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          allowed_pcs?: number[]
          base_code?: string
          branch_id?: string
          created_at?: string
          created_by?: string | null
          default_pcs?: number
          huid_pieces_per_tag?: number
          id?: string
          name?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_types_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          username: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id: string
          name: string
          username: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          username?: string
        }
        Relationships: []
      }
      purities: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          melting: number
          metal: string
          purity_label: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          melting: number
          metal?: string
          purity_label: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          melting?: number
          metal?: string
          purity_label?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      reconciliations: {
        Row: {
          created_at: string
          created_by: string | null
          entered_net: number | null
          entered_pcs: number | null
          entered_tags: number | null
          huids_remaining: number | null
          id: string
          passed: boolean
          sublot_id: string
          target_net: number | null
          target_pcs: number | null
          target_tags: number | null
          tolerance: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entered_net?: number | null
          entered_pcs?: number | null
          entered_tags?: number | null
          huids_remaining?: number | null
          id?: string
          passed: boolean
          sublot_id: string
          target_net?: number | null
          target_pcs?: number | null
          target_tags?: number | null
          tolerance?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entered_net?: number | null
          entered_pcs?: number | null
          entered_tags?: number | null
          huids_remaining?: number | null
          id?: string
          passed?: boolean
          sublot_id?: string
          target_net?: number | null
          target_pcs?: number | null
          target_tags?: number | null
          tolerance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliations_sublot_id_fkey"
            columns: ["sublot_id"]
            isOneToOne: false
            referencedRelation: "sublots"
            referencedColumns: ["id"]
          },
        ]
      }
      removal_voids: {
        Row: {
          id: string
          reason: string
          removal_id: string
          sublot_id: string
          voided_at: string
          voided_by: string
        }
        Insert: {
          id?: string
          reason: string
          removal_id: string
          sublot_id: string
          voided_at?: string
          voided_by?: string
        }
        Update: {
          id?: string
          reason?: string
          removal_id?: string
          sublot_id?: string
          voided_at?: string
          voided_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "removal_voids_removal_id_fkey"
            columns: ["removal_id"]
            isOneToOne: true
            referencedRelation: "item_removals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "removal_voids_sublot_id_fkey"
            columns: ["sublot_id"]
            isOneToOne: false
            referencedRelation: "sublots"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      station_events: {
        Row: {
          action: string
          created_at: string
          id: string
          item_id: string | null
          station: string
          sublot_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          item_id?: string | null
          station: string
          sublot_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          item_id?: string | null
          station?: string
          sublot_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "station_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "station_events_sublot_id_fkey"
            columns: ["sublot_id"]
            isOneToOne: false
            referencedRelation: "sublots"
            referencedColumns: ["id"]
          },
        ]
      }
      sublot_targets: {
        Row: {
          created_at: string
          created_by: string | null
          declared_net_weight: number
          declared_pieces: number
          declared_tags: number
          removed_net_weight: number
          removed_pieces: number
          removed_tags: number
          sublot_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          declared_net_weight: number
          declared_pieces: number
          declared_tags: number
          removed_net_weight?: number
          removed_pieces?: number
          removed_tags?: number
          sublot_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          declared_net_weight?: number
          declared_pieces?: number
          declared_tags?: number
          removed_net_weight?: number
          removed_pieces?: number
          removed_tags?: number
          sublot_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sublot_targets_sublot_id_fkey"
            columns: ["sublot_id"]
            isOneToOne: true
            referencedRelation: "sublots"
            referencedColumns: ["id"]
          },
        ]
      }
      sublot_unseals: {
        Row: {
          from_status: string | null
          id: string
          items: number | null
          reason: string
          sublot_id: string
          unsealed_at: string
          unsealed_by: string | null
        }
        Insert: {
          from_status?: string | null
          id?: string
          items?: number | null
          reason: string
          sublot_id: string
          unsealed_at?: string
          unsealed_by?: string | null
        }
        Update: {
          from_status?: string | null
          id?: string
          items?: number | null
          reason?: string
          sublot_id?: string
          unsealed_at?: string
          unsealed_by?: string | null
        }
        Relationships: []
      }
      sublots: {
        Row: {
          created_at: string
          created_by: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          halt_reason: string | null
          id: string
          lot_id: string
          making_type: Database["public"]["Enums"]["making_type"] | null
          making_value: number | null
          melting: number | null
          photographer_id: string | null
          product_type_id: string
          purity_id: string | null
          sealed_at: string | null
          sealed_by: string | null
          slot_headers: Json | null
          slots_imported_at: string | null
          status: Database["public"]["Enums"]["sublot_status"]
          sublot_no: number
          updated_at: string | null
          updated_by: string | null
          vendor_id: string | null
          wastage_pct: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          halt_reason?: string | null
          id?: string
          lot_id: string
          making_type?: Database["public"]["Enums"]["making_type"] | null
          making_value?: number | null
          melting?: number | null
          photographer_id?: string | null
          product_type_id: string
          purity_id?: string | null
          sealed_at?: string | null
          sealed_by?: string | null
          slot_headers?: Json | null
          slots_imported_at?: string | null
          status?: Database["public"]["Enums"]["sublot_status"]
          sublot_no: number
          updated_at?: string | null
          updated_by?: string | null
          vendor_id?: string | null
          wastage_pct?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          halt_reason?: string | null
          id?: string
          lot_id?: string
          making_type?: Database["public"]["Enums"]["making_type"] | null
          making_value?: number | null
          melting?: number | null
          photographer_id?: string | null
          product_type_id?: string
          purity_id?: string | null
          sealed_at?: string | null
          sealed_by?: string | null
          slot_headers?: Json | null
          slots_imported_at?: string | null
          status?: Database["public"]["Enums"]["sublot_status"]
          sublot_no?: number
          updated_at?: string | null
          updated_by?: string | null
          vendor_id?: string | null
          wastage_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sublots_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sublots_product_type_id_fkey"
            columns: ["product_type_id"]
            isOneToOne: false
            referencedRelation: "product_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sublots_purity_id_fkey"
            columns: ["purity_id"]
            isOneToOne: false
            referencedRelation: "purities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sublots_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_conflicts: {
        Row: {
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          item_id: string | null
          op: Json | null
          resolved_at: string | null
          resolved_by: string | null
          sublot_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          item_id?: string | null
          op?: Json | null
          resolved_at?: string | null
          resolved_by?: string | null
          sublot_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          item_id?: string | null
          op?: Json | null
          resolved_at?: string | null
          resolved_by?: string | null
          sublot_id?: string | null
        }
        Relationships: []
      }
      tag_slots: {
        Row: {
          assigned_item_id: string | null
          assumed: boolean
          cmd: string | null
          compcode: string
          ic: string
          id: string
          imported_at: string
          imported_by: string | null
          raw: Json | null
          ser_no: number
          sublot_id: string
          superseded_at: string | null
          type: string
        }
        Insert: {
          assigned_item_id?: string | null
          assumed?: boolean
          cmd?: string | null
          compcode: string
          ic: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          raw?: Json | null
          ser_no: number
          sublot_id: string
          superseded_at?: string | null
          type: string
        }
        Update: {
          assigned_item_id?: string | null
          assumed?: boolean
          cmd?: string | null
          compcode?: string
          ic?: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          raw?: Json | null
          ser_no?: number
          sublot_id?: string
          superseded_at?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "tag_slots_assigned_item_id_fkey"
            columns: ["assigned_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tag_slots_sublot_id_fkey"
            columns: ["sublot_id"]
            isOneToOne: false
            referencedRelation: "sublots"
            referencedColumns: ["id"]
          },
        ]
      }
      tray_sessions: {
        Row: {
          closed_at: string | null
          holder_id: string | null
          id: string
          opened_at: string
          opened_by: string | null
          station: string
          station_since: string
          status: Database["public"]["Enums"]["session_status"]
          sublot_id: string
          tray_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          closed_at?: string | null
          holder_id?: string | null
          id?: string
          opened_at?: string
          opened_by?: string | null
          station?: string
          station_since?: string
          status?: Database["public"]["Enums"]["session_status"]
          sublot_id: string
          tray_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          closed_at?: string | null
          holder_id?: string | null
          id?: string
          opened_at?: string
          opened_by?: string | null
          station?: string
          station_since?: string
          status?: Database["public"]["Enums"]["session_status"]
          sublot_id?: string
          tray_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tray_sessions_sublot_id_fkey"
            columns: ["sublot_id"]
            isOneToOne: false
            referencedRelation: "sublots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tray_sessions_tray_id_fkey"
            columns: ["tray_id"]
            isOneToOne: false
            referencedRelation: "trays"
            referencedColumns: ["id"]
          },
        ]
      }
      trays: {
        Row: {
          active: boolean
          columns: number
          compartment_count: number
          created_at: string
          created_by: string | null
          id: string
          rows: number
          suitable_product_types: string[]
          tray_code: string
          tray_type: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          columns: number
          compartment_count: number
          created_at?: string
          created_by?: string | null
          id?: string
          rows: number
          suitable_product_types?: string[]
          tray_code: string
          tray_type: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          columns?: number
          compartment_count?: number
          created_at?: string
          created_by?: string | null
          id?: string
          rows?: number
          suitable_product_types?: string[]
          tray_code?: string
          tray_type?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vendors: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _is_service: { Args: never; Returns: boolean }
      _require_editable: { Args: { _sublot: string }; Returns: undefined }
      _require_worker: { Args: never; Returns: undefined }
      assign_item_huids: {
        Args: { p_huids: string[]; p_item: string }
        Returns: undefined
      }
      assign_photographer: {
        Args: { p_sublot: string; p_user: string }
        Returns: undefined
      }
      check_huids: {
        Args: { p_huids: string[] }
        Returns: {
          assigned_item_id: string
          compartment_no: number
          huid: string
          lot_no: string
          sublot_id: string
          sublot_no: number
          tray_code: string
        }[]
      }
      clear_hold: {
        Args: { p_item: string; p_note: string }
        Returns: undefined
      }
      clear_tray_session: { Args: { p_session: string }; Returns: undefined }
      close_sublot: { Args: { p_sublot: string }; Returns: boolean }
      close_tray_session: { Args: { p_session: string }; Returns: undefined }
      correct_item: {
        Args: { p_item: string; p_reason: string }
        Returns: undefined
      }
      delete_lot: {
        Args: { p_confirm: string; p_lot: string }
        Returns: string[]
      }
      has_any_role: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      huid_pool_admin: {
        Args: { p_sublot: string }
        Returns: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_item_id: string | null
          created_at: string
          created_by: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          huid: string
          id: string
          piece_weight: number | null
          source: string
          sublot_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "huid_pool"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      import_huids: {
        Args: { p_rows: Json; p_sublot: string }
        Returns: number
      }
      import_tag_numbers: {
        Args: { p_ser_nos: number[]; p_sublot: string }
        Returns: number
      }
      import_tag_slots: {
        Args: { p_headers: Json; p_rows: Json; p_sublot: string }
        Returns: number
      }
      is_mgr: { Args: never; Returns: boolean }
      is_mgr_or_aud: { Args: never; Returns: boolean }
      manager_reopen_sublot: {
        Args: {
          p_status: Database["public"]["Enums"]["sublot_status"]
          p_sublot: string
        }
        Returns: undefined
      }
      mark_exported: { Args: { p_sublot: string }; Returns: undefined }
      match_photo: {
        Args: { p_item: string; p_name: string; p_path: string }
        Returns: undefined
      }
      move_item: { Args: { p_item: string; p_to: number }; Returns: undefined }
      open_tray_session: {
        Args: { p_sublot: string; p_tray: string }
        Returns: string
      }
      refresh_photo_status: { Args: { p_sublot: string }; Returns: string }
      remove_item: {
        Args: { p_item: string; p_reason: string }
        Returns: undefined
      }
      save_weight: {
        Args: {
          p_gross: number
          p_item: string
          p_less: number
          p_narration: string
          p_pcs: number
        }
        Returns: undefined
      }
      seal_sublot: { Args: { p_sublot: string }; Returns: number }
      set_compartment: {
        Args: {
          p_compartment: number
          p_item_id?: string
          p_occupied: boolean
          p_session: string
        }
        Returns: string
      }
      set_hold: {
        Args: {
          p_flag: Database["public"]["Enums"]["hold_flag"]
          p_item: string
          p_note: string
        }
        Returns: undefined
      }
      start_weighing: { Args: { p_session: string }; Returns: undefined }
      suggest_huids: {
        Args: { p_fragment?: string; p_item: string }
        Returns: {
          huids: string[]
        }[]
      }
      unassign_item_huids: { Args: { p_item: string }; Returns: undefined }
      unseal_sublot: {
        Args: { p_reason: string; p_sublot: string }
        Returns: string[]
      }
      void_removal: {
        Args: { p_reason: string; p_removal: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "manager" | "staff" | "photo" | "auditor"
      hold_flag: "damaged" | "wrong_item" | "re_photo" | "weight_disputed"
      making_type: "percentage" | "per_gram" | "per_piece"
      session_status:
        | "empty"
        | "loaded"
        | "weighed"
        | "photographed"
        | "tagged"
        | "cleared"
      sublot_status:
        | "draft"
        | "issued"
        | "loading"
        | "weighing"
        | "photography"
        | "ready_to_seal"
        | "sealed"
        | "exported"
        | "closed"
        | "halted"
        | "ready_to_export"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["manager", "staff", "photo", "auditor"],
      hold_flag: ["damaged", "wrong_item", "re_photo", "weight_disputed"],
      making_type: ["percentage", "per_gram", "per_piece"],
      session_status: [
        "empty",
        "loaded",
        "weighed",
        "photographed",
        "tagged",
        "cleared",
      ],
      sublot_status: [
        "draft",
        "issued",
        "loading",
        "weighing",
        "photography",
        "ready_to_seal",
        "sealed",
        "exported",
        "closed",
        "halted",
        "ready_to_export",
      ],
    },
  },
} as const
