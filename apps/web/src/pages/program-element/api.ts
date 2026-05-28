import type { AxiosInstance } from 'axios';
import type {
  ProgramElementBill,
  ProgramElementContractorsResponse,
  ProgramElementDetail,
  ProgramElementListResponse,
} from './types.js';

export async function getProgramElementDetail(
  api: AxiosInstance,
  peCode: string,
): Promise<ProgramElementDetail> {
  return (await api.get<ProgramElementDetail>(`/api/program-elements/${encodeURIComponent(peCode)}`)).data;
}

export async function getProgramElementBills(
  api: AxiosInstance,
  peCode: string,
): Promise<ProgramElementBill[]> {
  return (await api.get<ProgramElementBill[]>(`/api/program-elements/${encodeURIComponent(peCode)}/bills`)).data;
}

export async function getProgramElementContractors(
  api: AxiosInstance,
  peCode: string,
): Promise<ProgramElementContractorsResponse> {
  return (
    await api.get<ProgramElementContractorsResponse>(
      `/api/program-elements/${encodeURIComponent(peCode)}/contractors`,
    )
  ).data;
}

export async function getProgramElementsList(
  api: AxiosInstance,
  params: { q?: string; service?: string; page?: number; limit?: number },
): Promise<ProgramElementListResponse> {
  return (await api.get<ProgramElementListResponse>('/api/program-elements', { params })).data;
}
