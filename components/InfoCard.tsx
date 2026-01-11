
import React from 'react';

interface InfoCardProps {
  title: string;
  icon: string | React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const InfoCard: React.FC<InfoCardProps> = ({ title, icon, children, className = "" }) => {
  return (
    <div className={`bg-zinc-900/40 backdrop-blur-md rounded-[2.5rem] shadow-2xl border border-white/5 p-8 md:p-12 ${className}`}>
      <div className="flex items-center gap-6 mb-8">
        <div className="text-4xl bg-zinc-800 w-16 h-16 flex items-center justify-center rounded-[1.5rem] border border-white/5 shadow-inner">
          {icon}
        </div>
        <h3 className="font-black text-3xl text-white tracking-tighter leading-none">{title}</h3>
      </div>
      <div className="text-zinc-400 prose prose-invert prose-zinc max-w-none text-lg leading-relaxed font-medium">
        {children}
      </div>
    </div>
  );
};
