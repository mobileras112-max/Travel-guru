
import React, { useState, useEffect, useMemo, useRef } from 'react';

interface Props {
  localCurrencyCode: string;
}

export const CurrencyConverter: React.FC<Props> = ({ localCurrencyCode }) => {
  const [amount, setAmount] = useState<number>(1);
  const [targetCurrency, setTargetCurrency] = useState<string>("EUR");
  const [rates, setRates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (localCurrencyCode && localCurrencyCode !== '???' && localCurrencyCode !== 'USD') {
      setTargetCurrency(localCurrencyCode);
    }
  }, [localCurrencyCode]);

  useEffect(() => {
    const fetchRates = async () => {
      setLoading(true);
      try {
        const res = await fetch(`https://open.er-api.com/v6/latest/USD`);
        const data = await res.json();
        if (data && data.rates) {
          setRates(data.rates);
        }
      } catch (err) {
        console.error("Failed to fetch rates", err);
      } finally {
        setLoading(false);
      }
    };
    fetchRates();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredCurrencies = useMemo(() => {
    const keys = Object.keys(rates);
    if (search === "") return keys.sort();
    return keys
      .filter(c => c.toLowerCase().includes(search.toLowerCase()))
      .sort();
  }, [rates, search]);

  const currentRate = rates[targetCurrency] || 1;

  return (
    <div className="bg-zinc-900/40 rounded-[2.5rem] p-8 border border-white/5 relative">
      <div className="flex justify-between items-center mb-6">
        <h4 className="font-black text-white text-lg flex items-center gap-2">
          <span>💰</span> Money
        </h4>
        <div ref={dropdownRef} className="relative">
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className="bg-zinc-800 hover:bg-zinc-700 text-white text-[11px] font-black px-4 py-2 rounded-xl border border-white/5 transition-all flex items-center gap-2"
          >
            {targetCurrency}
            <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isOpen && (
            <div className="absolute top-full right-0 mt-2 w-48 bg-zinc-800 border border-zinc-700 rounded-2xl shadow-2xl z-[100] overflow-hidden">
              <div className="p-2 bg-zinc-900">
                <input 
                  type="text" 
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  autoFocus
                />
              </div>
              <div className="max-h-48 overflow-y-auto no-scrollbar">
                {filteredCurrencies.map(code => (
                  <button
                    key={code}
                    onClick={() => {
                      setTargetCurrency(code);
                      setIsOpen(false);
                      setSearch("");
                    }}
                    className={`w-full text-left px-4 py-3 text-xs font-bold transition-colors flex justify-between items-center ${targetCurrency === code ? 'text-indigo-400 bg-indigo-500/10' : 'text-zinc-400 hover:bg-zinc-700'}`}
                  >
                    {code}
                    {targetCurrency === code && <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></div>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <label className="text-[10px] text-zinc-500 uppercase tracking-widest font-black block mb-2">From USD</label>
          <div className="relative">
            <span className="absolute left-6 top-1/2 -translate-y-1/2 text-zinc-600 font-black text-xl">$</span>
            <input 
              type="number" 
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full bg-black/40 border border-white/5 rounded-2xl pl-12 pr-6 py-5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-3xl font-black text-white"
            />
          </div>
        </div>

        <div className="flex justify-center -my-3 relative z-10">
          <div className="bg-indigo-600 p-2 rounded-full text-white shadow-lg">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
          </div>
        </div>

        <div className="bg-indigo-600/10 border border-indigo-500/20 rounded-2xl p-6">
          <label className="text-[10px] text-indigo-400/60 uppercase tracking-widest font-black block mb-2">To {targetCurrency}</label>
          <div className="text-4xl font-black text-indigo-400 overflow-hidden text-ellipsis">
            {loading ? "..." : (amount * currentRate).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
          </div>
          <p className="text-[10px] text-zinc-600 mt-3 font-bold uppercase">
            1 USD = {currentRate.toFixed(4)} {targetCurrency}
          </p>
        </div>
      </div>
    </div>
  );
};
