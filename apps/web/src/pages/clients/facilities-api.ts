import type { AxiosInstance } from 'axios';

/**
 * Step 2.3 — web API for client facilities (CRUD).
 *
 * Mirrors apps/api/src/clients/client-facilities.controller.ts (mounted at
 * /api/clients/:clientId/facilities). The congressional district is the BARE number
 * ("12"); the state is carried separately ("TX"). Display strings combine them as "ST-NN".
 */

export interface ClientFacility {
  id: string;
  clientId: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** Bare district number, e.g. "12" or the at-large sentinel "00". */
  congressionalDistrict: string | null;
  districtSource: string | null;
  employeeCount: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Create/update payload. Bare district number; state separate. */
export interface FacilityPayload {
  name: string;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  congressionalDistrict?: string | null;
  districtSource?: string | null;
  employeeCount?: number | null;
  notes?: string | null;
}

export async function getClientFacilities(
  api: AxiosInstance,
  clientId: string,
): Promise<ClientFacility[]> {
  return (
    await api.get<ClientFacility[]>(`/api/clients/${encodeURIComponent(clientId)}/facilities`)
  ).data;
}

export async function createClientFacility(
  api: AxiosInstance,
  clientId: string,
  payload: FacilityPayload,
): Promise<ClientFacility> {
  return (
    await api.post<ClientFacility>(
      `/api/clients/${encodeURIComponent(clientId)}/facilities`,
      payload,
    )
  ).data;
}

export async function updateClientFacility(
  api: AxiosInstance,
  clientId: string,
  id: string,
  payload: Partial<FacilityPayload>,
): Promise<ClientFacility> {
  return (
    await api.patch<ClientFacility>(
      `/api/clients/${encodeURIComponent(clientId)}/facilities/${encodeURIComponent(id)}`,
      payload,
    )
  ).data;
}

export async function deleteClientFacility(
  api: AxiosInstance,
  clientId: string,
  id: string,
): Promise<{ deleted: true }> {
  return (
    await api.delete<{ deleted: true }>(
      `/api/clients/${encodeURIComponent(clientId)}/facilities/${encodeURIComponent(id)}`,
    )
  ).data;
}

/**
 * Bare district number ("12") or the at-large sentinel "00". Mirrors the API's
 * `/^[0-9]{1,2}$/` validator so the form rejects the same inputs the server would.
 */
export const DISTRICT_PATTERN = /^[0-9]{1,2}$/;

/** Combine a bare district number + state into the "ST-NN" display form. */
export function formatFacilityDistrict(
  state: string | null | undefined,
  district: string | null | undefined,
): string {
  const st = (state ?? '').trim().toUpperCase();
  const dist = (district ?? '').trim();
  if (st && dist) return `${st}-${dist}`;
  return st || dist || '';
}

/** US states + DC + territories, two-letter postal codes (for the facility state dropdown). */
export const US_STATE_CODES: string[] = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL',
  'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH',
  'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI',
  'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI',
  'WY', 'AS', 'GU', 'MP', 'PR', 'VI',
];
