
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { getTravelGuide } from './services/gemini.ts';
import { LocationData, TravelDetails } from './types.ts';
import { InfoCard } from './components/InfoCard.tsx';
import { CurrencyConverter } from './components/CurrencyConverter.tsx';
import { encode, decode, decodeAudioData, floatToPcm } from './utils/audio.ts';

interface ChatMessage {
  role: 'user' | 'guru';
  text: string;
}

type TabType = 'basics' | 'taste' | 'sights' | 'etiquette' | 'guide';

const App: React.FC = () => {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [guide, setGuide] = useState<TravelDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('basics');
  const [searchInput, setSearchInput] = useState("");
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);

  const fetchGuide = useCallback(async (loc: LocationData | string) => {
    setLoading(true);
    setError(null);
    try {
      const details = await getTravelGuide(loc);
      setGuide(details);
      setActiveTab('basics');
    } catch (err: any) {
      setError("Unable to reach travel experts. Please check your connection.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError("Geolocation not supported by this browser.");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const loc = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
        setLocation(loc);
        fetchGuide(loc);
      },
      (err) => {
        setError("Could not access location. Please search manually.");
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      fetchGuide(searchInput.trim());
    }
  };

  const stopVoiceSession = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    for (const source of sourcesRef.current) {
      try { source.stop(); } catch (e) {}
    }
    sourcesRef.current.clear();
    setIsListening(false);
    setIsSpeaking(false);
    setTranscription("");
  };

  const playPcmAudio = async (base64Data: string) => {
    if (!outputAudioContextRef.current) {
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    const ctx = outputAudioContextRef.current;
    if (ctx.state === 'suspended') await ctx.resume();
    
    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
    const buffer = await decodeAudioData(decode(base64Data), ctx, 24000, 1);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    
    source.onended = () => {
      sourcesRef.current.delete(source);
      if (sourcesRef.current.size === 0) setIsSpeaking(false);
    };
    
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += buffer.duration;
    sourcesRef.current.add(source);
  };

  const speakSafetyInfo = async () => {
    if (!guide || isSpeaking) return;
    setIsSpeaking(true);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `Read out safety information for ${guide.city} clearly: Dialing code is ${guide.dialingCode}. Emergency numbers are: Police ${guide.emergencyNumbers.police}, Ambulance ${guide.emergencyNumbers.ambulance}, and Fire department ${guide.emergencyNumbers.fire}.`;
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { voiceName: 'Zephyr' },
          },
        },
      });

      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (audioData) await playPcmAudio(audioData);
      else setIsSpeaking(false);
    } catch (err) {
      console.error("TTS failed:", err);
      setIsSpeaking(false);
    }
  };

  const startVoiceSession = async (initialQuery?: string) => {
    if (isListening) {
      stopVoiceSession();
      return;
    }

    if (initialQuery) {
      setHistory(prev => [...prev.slice(-4), { role: 'user', text: initialQuery }]);
    }

    try {
      setIsListening(true);
      setTranscription(initialQuery || "I'm listening...");
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;
      nextStartTimeRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmData = floatToPcm(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({
                  media: { data: encode(pcmData), mimeType: 'audio/pcm;rate=16000' }
                });
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);

            if (initialQuery) {
              sessionPromise.then(session => {
                session.sendRealtimeInput({ text: initialQuery });
              });
            }
          },
          onmessage: async (message) => {
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              setTranscription(prev => prev + text);
            }

            if (message.serverContent?.turnComplete) {
              setHistory(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'guru') return prev;
                return [...prev.slice(-4), { role: 'guru', text: transcription }];
              });
              setTranscription("");
            }

            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData) await playPcmAudio(audioData);

            if (message.serverContent?.interrupted) {
              for (const s of sourcesRef.current) try { s.stop(); } catch (e) {}
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => {
            console.error("Voice error:", e);
            stopVoiceSession();
          },
          onclose: () => stopVoiceSession()
        },
        config: {
          responseModalalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          systemInstruction: `You are a friendly travel guru in ${guide?.city}. Give very short, helpful travel tips.`,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
          }
        }
      });

      sessionRef.current = await sessionPromise;

    } catch (err) {
      setIsListening(false);
      setError("Microphone access is needed for voice chat.");
    }
  };

  const getSection = (titleKeywords: string[]) => {
    if (!guide) return "";
    const sections = guide.content.split('###');
    const section = sections.find(s => 
      titleKeywords.some(kw => s.toLowerCase().includes(kw.toLowerCase()))
    );
    if (!section) return "";
    return section.replace(/^[^\n]*\n/, '').trim();
  };

  const renderSources = () => {
    if (!guide?.groundingSources?.length) return null;
    return (
      <div className="mt-8 pt-6 border-t border-white/5">
        <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-4">Live Map & Web Sources</p>
        <div className="flex flex-wrap gap-2">
          {guide.groundingSources.map((source: any, idx) => (
            <a 
              key={idx} 
              href={source.uri} 
              target="_blank" 
              rel="noopener noreferrer"
              className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition-all border ${
                source.type === 'map' 
                ? 'bg-blue-600/10 border-blue-500/20 text-blue-400' 
                : 'bg-indigo-600/10 border-indigo-500/20 text-indigo-400'
              } hover:scale-105 active:scale-95`}
            >
              {source.type === 'map' ? '📍' : '🔗'} {source.title}
            </a>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 flex flex-col font-sans selection:bg-indigo-500/30">
      <header className="sticky top-0 z-50 glass border-b border-white/5 py-4 px-6 md:px-10">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center text-white text-xl shadow-lg shadow-indigo-600/20">
              ✈️
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight leading-none">Travel Guru</h1>
              <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-widest">Global Intelligence</span>
            </div>
          </div>
          {guide && (
             <div className="hidden md:flex items-center gap-2 bg-zinc-900 px-4 py-2 rounded-2xl border border-white/5">
                <span className="text-xs font-bold text-zinc-500">Currently in:</span>
                <span className="text-xs font-black text-white">{guide.city}, {guide.country}</span>
             </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto px-6 py-10 w-full space-y-12">
        <section className="text-center md:text-left space-y-8 max-w-3xl">
          <div className="space-y-4">
            <h2 className="text-5xl md:text-7xl font-black tracking-tighter text-white leading-[0.9]">
              Let's explore the <span className="text-indigo-500">World</span> together.
            </h2>
            <p className="text-lg md:text-xl text-zinc-400 font-medium">
              Find local food, secrets, and must-see sights in seconds.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <button 
              onClick={useCurrentLocation}
              disabled={loading}
              className="flex-1 px-8 py-5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-[2rem] font-black text-lg shadow-xl shadow-indigo-600/20 transition-all active:scale-95 flex items-center justify-center gap-3"
            >
              {loading && !searchInput ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" /></svg>
              )}
              Use My Current Location
            </button>
            
            <div className="flex-[1.5] relative group">
              <form onSubmit={handleManualSearch}>
                <input 
                  type="text" 
                  placeholder="Or type a city or address..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full bg-zinc-900 border border-white/10 rounded-[2rem] py-5 pl-8 pr-32 text-white font-bold text-lg focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all shadow-xl"
                />
                <button 
                  type="submit"
                  disabled={loading}
                  className="absolute right-2 top-2 bottom-2 px-6 bg-zinc-800 text-white rounded-[1.5rem] font-black text-sm active:scale-95 transition-all hover:bg-zinc-700"
                >
                  Search
                </button>
              </form>
            </div>
          </div>
          
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-6 py-4 rounded-[1.5rem] font-bold text-sm inline-block">
              ⚠️ {error}
            </div>
          )}
        </section>

        {loading && (
           <div className="flex flex-col items-center justify-center py-20 text-center animate-pulse">
              <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-6"></div>
              <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs">Getting live updates from Search & Maps...</p>
           </div>
        )}

        {guide && !loading && (
          <div className="animate-fade-in space-y-12">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              
              <div className="lg:col-span-4 space-y-8 order-2 lg:order-1">
                 <CurrencyConverter localCurrencyCode={guide.currency.code || "USD"} />

                 <div className="bg-zinc-900/40 rounded-[2.5rem] p-8 border border-white/5 space-y-6">
                    <h4 className="font-black text-white text-lg flex items-center gap-3">
                      <span className="text-green-500">💬</span> Travel Guru AI
                    </h4>
                    
                    {(history.length > 0 || transcription) && (
                      <div className="space-y-4 max-h-60 overflow-y-auto no-scrollbar pb-2">
                        {history.map((msg, i) => (
                          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                            <p className={`text-xs px-4 py-3 rounded-2xl font-medium ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-zinc-800 text-zinc-300 rounded-tl-none border border-white/5'}`}>{msg.text}</p>
                          </div>
                        ))}
                        {transcription && (
                          <div className="animate-pulse">
                             <p className="text-xs px-4 py-3 rounded-2xl bg-indigo-600/10 text-indigo-400 font-black rounded-tl-none border border-indigo-500/20">{transcription}</p>
                          </div>
                        )}
                      </div>
                    )}

                    <button 
                      onClick={() => startVoiceSession()}
                      className={`w-full py-5 rounded-[2rem] font-black text-sm flex items-center justify-center gap-3 transition-all active:scale-95 shadow-2xl ${isListening ? 'bg-red-600/20 border-red-500/40 text-red-500' : 'bg-white text-black hover:bg-zinc-200'}`}
                    >
                      {isListening ? (
                        <>
                          <div className="w-3 h-3 bg-red-500 rounded-full animate-ping"></div>
                          Stop Chat
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m8 0h-3m4-8a3 3 0 01-3 3H9a3 3 0 01-3-3V7a3 3 0 013-3h6a3 3 0 013 3v4z" /></svg>
                          Speak to Guru
                        </>
                      )}
                    </button>
                 </div>

                 <div className="bg-red-600/5 rounded-[2.5rem] p-8 border border-red-600/10 space-y-6">
                    <div className="flex justify-between items-center">
                      <h4 className="font-black text-white">Emergency 🆘</h4>
                      <button onClick={speakSafetyInfo} className="p-3 bg-zinc-900 rounded-2xl text-red-500 active:scale-90 transition-all border border-red-500/20">
                        🔊
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
                        <span className="text-[10px] uppercase font-black text-zinc-600 block mb-1">Police</span>
                        <span className="text-xl font-black text-red-500">{guide.emergencyNumbers.police || "911"}</span>
                      </div>
                      <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
                        <span className="text-[10px] uppercase font-black text-zinc-600 block mb-1">Ambulance</span>
                        <span className="text-xl font-black text-red-500">{guide.emergencyNumbers.ambulance || "911"}</span>
                      </div>
                      <div className="bg-black/40 p-4 rounded-2xl border border-white/5 sm:col-span-2">
                        <span className="text-[10px] uppercase font-black text-zinc-600 block mb-1">Fire Department</span>
                        <span className="text-xl font-black text-red-500">{guide.emergencyNumbers.fire || "911"}</span>
                      </div>
                    </div>
                    <div className="bg-black/40 p-3 rounded-xl border border-white/5 text-center">
                       <span className="text-[10px] uppercase font-black text-zinc-600 block mb-1">Dialing Code</span>
                       <span className="text-lg font-black text-indigo-400">{guide.dialingCode}</span>
                    </div>
                 </div>
              </div>

              <div className="lg:col-span-8 space-y-8 order-1 lg:order-2">
                <div className="bg-indigo-600/10 p-10 rounded-[3rem] border border-indigo-500/10">
                   <span className="inline-block px-3 py-1 bg-indigo-600/20 text-indigo-400 rounded-lg text-[10px] font-black tracking-widest uppercase mb-4">Discovery Mode</span>
                   <h3 className="text-4xl md:text-6xl font-black text-white tracking-tighter leading-none mb-4">
                     {guide.city}, <span className="text-zinc-600">{guide.country}</span>
                   </h3>
                </div>

                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                  {[
                    { id: 'basics', label: 'Basics', icon: '🗣️' },
                    { id: 'taste', label: 'Taste', icon: '🍲' },
                    { id: 'sights', label: 'Sights', icon: '🏛️' },
                    { id: 'etiquette', label: 'Do\'s & Don\'ts', icon: '🤝' },
                    { id: 'guide', label: 'Full Guide', icon: '📖' }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as TabType)}
                      className={`px-6 py-4 rounded-2xl text-sm font-black transition-all whitespace-nowrap flex items-center gap-3 ${
                        activeTab === tab.id 
                        ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/20 scale-105' 
                        : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800'
                      }`}
                    >
                      <span className="text-lg">{tab.icon}</span>
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="animate-fade-in">
                  {activeTab === 'basics' && (
                    <InfoCard title="The Basics" icon="🗣️">
                      {getSection(['language', 'basic']) || "Essentials coming soon..."}
                    </InfoCard>
                  )}
                  {activeTab === 'taste' && (
                    <InfoCard title="Taste & Tradition" icon="🍲">
                      {getSection(['food', 'dining', 'taste']) || "Cuisine insights loading..."}
                    </InfoCard>
                  )}
                  {activeTab === 'sights' && (
                    <InfoCard title="Must-See Sights" icon="🏛️">
                      {getSection(['landmark', 'attraction', 'sight']) || "Mapping the sights..."}
                      {renderSources()}
                    </InfoCard>
                  )}
                  {activeTab === 'etiquette' && (
                    <InfoCard title="Etiquette" icon="🤝">
                      {getSection(['etiquette', 'do', 'don']) || "Cultural tips loading..."}
                    </InfoCard>
                  )}
                  {activeTab === 'guide' && (
                    <InfoCard title="AI Master Guide" icon="📖">
                      <div className="text-sm md:text-base whitespace-pre-wrap">{guide.content}</div>
                      {renderSources()}
                    </InfoCard>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}
        
        {!guide && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-center text-zinc-600">
             <div className="w-24 h-24 bg-zinc-900 rounded-[2.5rem] flex items-center justify-center text-5xl mb-6 grayscale opacity-20">🌍</div>
             <p className="font-bold text-lg">Pick a spot on the map to get started.</p>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-[60] safe-bottom md:hidden px-6 pb-8">
         <div className="bg-zinc-900/80 backdrop-blur-2xl border border-white/5 rounded-[3rem] px-10 py-6 flex justify-between items-center shadow-2xl">
            <button className="text-indigo-500"><svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3L4 9V21H9V15H15V21H20V9L12 3Z" /></svg></button>
            <div className="w-14 h-14 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-xl -mt-16 border-[5px] border-black">
               <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
            </div>
            <button className="text-zinc-600"><svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg></button>
         </div>
      </nav>
    </div>
  );
};

export default App;
