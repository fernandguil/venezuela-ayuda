import type {
  CheckinStatus,
  HelpCategory,
  OfferCategory,
  UrgencyLevel,
  RequestStatus,
  DamageSeverity,
  RiskLevel,
} from "./constants";

// These mirror the privacy-safe public_* views — they intentionally omit
// phone / contact fields so private data can never reach the client.

export interface PublicCheckin {
  id: string;
  name: string;
  status: CheckinStatus;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  message: string | null;
  photo_url: string | null;
  created_at: string;
  found_at: string | null;
  place_name: string | null;
  source: string | null;
  source_url: string | null;
  fr_consent: boolean;
}

// A needed tool/equipment with an estimated quantity.
export interface NeededItem {
  name: string;
  qty: number;
}

export interface PublicHelpRequest {
  id: string;
  category: HelpCategory;
  description: string;
  urgency: UrgencyLevel;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  status: RequestStatus;
  created_at: string;
  place_name: string | null;
  items: NeededItem[] | null;
  source: string | null;
  source_url: string | null;
}

export interface PublicHelpOffer {
  id: string;
  category: OfferCategory;
  description: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  availability: string | null;
  available: boolean;
  created_at: string;
}

// Mirrors public_damaged_reports (no contact / manage_token).
export interface PublicDamagedReport {
  id: string;
  place_name: string;
  description: string | null;
  severity: DamageSeverity;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  photo_url: string | null;
  status: RequestStatus;
  created_at: string;
  verified_at: string | null;
  verified_by: string | null;
  source: string | null;
  source_url: string | null;
  risk_level: RiskLevel | null;
  risk_priority: boolean | null;
}

// A sighting / "aviso" left by someone who recognized a missing person.
export interface Sighting {
  id: string;
  finder_name: string | null;
  finder_contact: string | null;
  message: string | null;
  created_at: string;
}

// A volunteer's response to a help request (relay).
export interface RequestResponse {
  id: string;
  responder_name: string | null;
  responder_contact: string | null;
  message: string | null;
  created_at: string;
}

// A person found in the external hospital / Cruz Roja patient registry sheet.
// Privacy: we deliberately omit phone, cédula and full address — only enough to
// recognize/locate the person is exposed, matching the public_* convention above.
export interface HospitalRegistryMatch {
  id: string;
  name: string; // nombre_completo
  hospital: string; // hospital
  location: string | null; // direccion (city / zone)
  age: string | null; // edad
  status: string | null; // estado
  source: string | null; // fuente
  updated: string | null; // fecha_actualizacion
}

// A person from the external missing-persons API (desaparecidosterremoto).
// Privacy: we omit `contacto` — matching the app's ingest, which stores it as
// the private phone_private field. Photos are shown publicly (see CheckinCard).
export interface MissingPersonMatch {
  id: string;
  name: string; // nombre
  location: string | null; // ubicacion
  description: string | null; // descripcion
  photoUrl: string | null; // foto
  located: boolean; // estado === "localizado"
  date: string | null; // fecha
  sourceUrl: string;
}

// Mirrors public_collection_centers. A center's contact/website ARE public (org
// info); manage_token / verified / hidden are not exposed.
export interface PublicCollectionCenter {
  id: string;
  name: string;
  country: string;
  state: string | null;
  city: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  resources: string | null;
  organizers: string | null;
  contact: string | null;
  website: string | null;
  can_ship_to_venezuela: boolean | null;
  volunteers_count: number | null;
  needs_volunteers: boolean | null;
  needs: string[];
  created_at: string;
}

export type LatLng = { lat: number; lng: number };

// Unified shape consumed by the map. Kinds: places that need help, missing
// people, available helpers, and curated relief/collection centers.
export type MarkerKind = "need" | "missing" | "helper" | "center" | "damaged";

export interface MapMarker {
  id: string;
  kind: MarkerKind;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  href: string;
  // Optional popup extras (used by damaged-building reports / centers).
  confidence?: string; // e.g. "Alta plausibilidad"
  source?: string; // e.g. "@ReporteYa + familiares"
  note?: string; // caution note
  linkLabel?: string; // overrides the popup link text (e.g. "Ver fuente →")
  approx?: boolean; // location is approximate (geocoded by area)
  color?: string; // overrides the kind color for this pin (e.g. by severity)
  city?: string; // used by the map city filter
}
