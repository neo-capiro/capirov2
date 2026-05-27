import { ClientIntelV1Page } from './intelligence-v1/ClientIntelV1Page.js';

interface IntelligenceTabProps {
  clientId: string;
  clientName: string;
}

export function IntelligenceTab({ clientId, clientName }: IntelligenceTabProps) {
  return <ClientIntelV1Page clientId={clientId} clientName={clientName} />;
}
