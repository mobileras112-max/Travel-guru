
export interface LocationData {
  latitude: number;
  longitude: number;
}

export interface GroundingLink {
  title: string;
  uri: string;
}

export interface TravelDetails {
  city: string;
  country: string;
  currency: {
    name: string;
    code: string;
    symbol: string;
  };
  dialingCode: string;
  emergencyNumbers: {
    police: string;
    ambulance: string;
    fire: string;
    general?: string;
  };
  language: string;
  content: string; // Markdown formatted content from Gemini
  groundingSources: GroundingLink[];
}

export interface ExchangeRate {
  base: string;
  rates: Record<string, number>;
}
