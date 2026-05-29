import type { AxiosInstance } from 'axios';
import type {
  ProgramElementBill,
  ProgramElementContractorsResponse,
  ProgramElementDetail,
  ProgramElementListResponse,
  ProgramElementMarkupMonitorResponse,
  ProgramTeamPerson,
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

export async function getProgramElementPersonnel(
  api: AxiosInstance,
  peCode: string,
): Promise<ProgramTeamPerson[]> {
  return (await api.get<ProgramTeamPerson[]>(`/api/program-elements/${encodeURIComponent(peCode)}/personnel`)).data;
}

export async function linkProgramElementPersonToCrm(
  api: AxiosInstance,
  personId: string,
  engagementContactId: string,
): Promise<{ linked: true }> {
  return (
    await api.post<{ linked: true }>(`/api/acquisition-personnel/${encodeURIComponent(personId)}/link-crm-contact`, {
      engagementContactId,
    })
  ).data;
}

export async function getProgramElementsList(
  api: AxiosInstance,
  params: { q?: string; service?: string; page?: number; limit?: number },
): Promise<ProgramElementListResponse> {
  return (await api.get<ProgramElementListResponse>('/api/program-elements', { params })).data;
}

export async function getMarkupMonitor(
  api: AxiosInstance,
  params: { service?: string; divergence_threshold?: number },
): Promise<ProgramElementMarkupMonitorResponse> {
  return (
    await api.get<ProgramElementMarkupMonitorResponse>('/api/program-elements', {
      params: {
        mode: 'markup-monitor',
        ...params,
      },
    })
  ).data;
}

export async function setProgramElementWatching(
  api: AxiosInstance,
  peCode: string,
  watching: boolean,
): Promise<{ peCode: string; watching: boolean }> {
  return (
    await api.post<{ peCode: string; watching: boolean }>(
      `/api/program-elements/${encodeURIComponent(peCode)}/watch`,
      { watching },
    )
  ).data;
}
