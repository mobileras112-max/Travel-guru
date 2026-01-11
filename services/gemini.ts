
import { GoogleGenAI } from "@google/genai";
import { TravelDetails, LocationData } from "../types.ts";

export const getTravelGuide = async (location: LocationData | string): Promise<TravelDetails> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const isCoords = typeof location !== 'string';
  const locationContext = isCoords 
    ? `Latitude: ${location.latitude}, Longitude: ${location.longitude}`
    : `Address/City: "${location}"`;

  const prompt = `
    I am looking for high-quality, real-time travel information for the following location: ${locationContext}.
    
    Use Google Search to find current events, seasonal festivals, today's weather impact on travel, and recent news relevant to a tourist.
    Use Google Maps to verify the exact locations and details of the top landmarks, restaurants, and emergency services.
    
    IMPORTANT: START YOUR RESPONSE WITH THIS EXACT STRUCTURED DATA BLOCK:
    City: [Name]
    Country: [Name]
    Currency: [Name] - [CODE]
    Dialing Code: [Code]
    Emergency: Police: [Number], Ambulance: [Number], Fire: [Number]
    
    THEN PROVIDE A GUIDE WITH THESE SECTIONS:
    ### Language Basics
    Include essential phrases like Hello, Thank you, Goodbye, Yes/No, and "Help" in the local language with pronunciation.
    
    ### Food & Dining
    Top customary dishes to try and specific, highly-rated local restaurants or markets.
    
    ### Cultural Etiquette
    3 major Dos and 3 major Don'ts for visitors.
    
    ### Landmarks & Attractions
    Top 3 must-visit attractions in this specific area with verified details.
    
    ### Live Updates & Events
    What's happening right now? Any seasonal tips, weather advice, or specific events happening this week.
    
    Please use Markdown for the body content. Use "###" for section headers.
  `;

  const config: any = {
    tools: [{ googleMaps: {} }, { googleSearch: {} }],
  };

  if (isCoords) {
    config.toolConfig = {
      retrievalConfig: {
        latLng: {
          latitude: location.latitude,
          longitude: location.longitude,
        }
      }
    };
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config,
  });

  const text = response.text || "Could not generate guide.";
  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  
  const sources: any[] = [];
  groundingChunks.forEach((chunk: any) => {
    if (chunk.maps) {
      sources.push({ 
        title: chunk.maps.title || "Location Details", 
        uri: chunk.maps.uri,
        type: 'map'
      });
    } else if (chunk.web) {
      sources.push({ 
        title: chunk.web.title || "Latest News/Source", 
        uri: chunk.web.uri,
        type: 'web'
      });
    }
  });

  // More robust parsing
  const extract = (regex: RegExp, fallback: string) => {
    const match = text.match(regex);
    return match ? match[1].trim() : fallback;
  };

  const city = extract(/City:\s*([^\n\r]+)/i, typeof location === 'string' ? location : "Unknown City");
  const country = extract(/Country:\s*([^\n\r]+)/i, "Unknown Country");
  const currencyCode = extract(/Currency:.*-\s*([A-Z]{3})/i, "USD");
  const dialingCode = extract(/Dialing Code:\s*([^\n\r]+)/i, "N/A");
  
  // Specific emergency parsing
  const police = extract(/Police:\s*([\d\w\s/+-]+)(?=,|$)/i, "911");
  const ambulance = extract(/Ambulance:\s*([\d\w\s/+-]+)(?=,|$)/i, "911");
  const fire = extract(/Fire:\s*([\d\w\s/+-]+)(?=,|$)/i, "911");

  return {
    city,
    country,
    currency: {
      name: "Local Currency",
      code: currencyCode,
      symbol: "" 
    },
    dialingCode,
    emergencyNumbers: {
      police,
      ambulance,
      fire
    },
    language: "Local Language",
    content: text,
    groundingSources: sources,
  };
};
