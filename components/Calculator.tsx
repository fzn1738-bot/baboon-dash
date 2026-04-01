import React, { useState } from 'react';
import { UserRole } from '../types';
import { Calculator as CalculatorIcon, Info } from 'lucide-react';

interface CalculatorProps {
  userRole: UserRole;
}

const DEPOSIT_FEE_RATE = 0.14; // 14% upfront fee

const PAYOUT_TIERS = [
  { threshold: 50, rate: 0.07, name: 'Standard', label: '>50%', theme: 'emerald' },
  { threshold: 75, rate: 0.13, name: 'Premium', label: '>75%', theme: 'sky' },
  { threshold: 100, rate: 0.20, name: 'Elite', label: '>100%', theme: 'purple' },
];

export const Calculator: React.FC<CalculatorProps> = ({ userRole }) => {
    const isInvestor = userRole === 'INVESTOR';
    const [calculatorInvestment, setCalculatorInvestment] = useState<string>('');
    const [selectedTierIndex, setSelectedTierIndex] = useState<number>(0);

    const selectedTier = PAYOUT_TIERS[selectedTierIndex];
    const investmentNum = parseFloat(calculatorInvestment) || 0;
    
    // Fee Calculation
    const upfrontFee = investmentNum * DEPOSIT_FEE_RATE;
    const netPrincipal = investmentNum - upfrontFee;

    // ROI Simulation
    const simulatedROI = selectedTier.threshold === 50 ? 0.55 : selectedTier.threshold === 75 ? 0.80 : 1.10;
    
    // Profit calculated on Net Principal (after fee)
    const grossProfit = netPrincipal * simulatedROI;
    // Quarterly payout is based on equity invested (net principal), not gross profit.
    const payoutAmount = netPrincipal * selectedTier.rate;
    const rolloverNextQuarter = netPrincipal + grossProfit - payoutAmount;

    return (
      <div className="space-y-6 pb-20 animate-fade-in">
        <h2 className={`text-2xl font-bold px-4 ${'text-white'}`}>Calculator</h2>

        <div className={`
          ${'bg-slate-900 border border-slate-800'}
          rounded-3xl shadow-sm p-6 transition-all mx-auto max-w-xl
        `}>
           <div className="flex items-center gap-3 mb-6">
              <div className={`${'bg-purple-500/20 text-purple-400'} p-3 rounded-2xl`}>
                  <CalculatorIcon size={24} />
              </div>
              <div>
                  <h3 className={`font-bold text-lg ${'text-white'}`}>Profit Simulator</h3>
                  <p className="text-xs text-slate-500">Project your quarterly returns based on tier.</p>
              </div>
           </div>

           <div className="space-y-6">
              <div className={`p-4 rounded-xl ${'bg-slate-800'}`}>
                  <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-2">Input Capital</label>
                  <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-bold text-xl">$</span>
                  <input 
                      type="number"
                      value={calculatorInvestment}
                      onChange={(e) => setCalculatorInvestment(e.target.value)}
                      placeholder="0"
                      className={`w-full bg-transparent font-mono font-bold text-3xl outline-none ${'text-white'}`}
                      autoFocus
                  />
                  </div>
                  {investmentNum > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-200/50 flex flex-col gap-1">
                          <div className="flex justify-between text-[10px] text-slate-400">
                              <span>Deposit Fee (14%)</span>
                              <span className="text-rose-500">-${upfrontFee.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                          </div>
                          <div className="flex justify-between text-[10px] font-bold">
                              <span className={'text-slate-300'}>Net Trading Capital</span>
                              <span className={'text-white'}>${netPrincipal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                          </div>
                      </div>
                  )}
              </div>
              
              <div>
                  <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-3">Select Performance Tier</label>
                  <div className="grid grid-cols-3 gap-2">
                      {PAYOUT_TIERS.map((tier, idx) => (
                      <button
                          key={tier.name}
                          onClick={() => setSelectedTierIndex(idx)}
                          className={`py-3 rounded-xl text-xs font-bold transition-all border-b-4 active:border-b-0 active:translate-y-1 ${
                          selectedTierIndex === idx 
                              ? `bg-${tier.theme}-500 text-white border-${tier.theme}-700 shadow-lg shadow-${tier.theme}-500/30` 
                              : `${'bg-slate-800 border-slate-700 text-slate-400'}`
                          }`}
                      >
                          <div className="mb-0.5">{tier.label}</div>
                          <div className="text-[9px] opacity-80 font-normal mb-1">{tier.name}</div>
                          <div className={`text-[9px] font-mono font-bold uppercase tracking-wide opacity-90 ${selectedTierIndex === idx ? 'text-white' : 'text-slate-400'}`}>
                              {(tier.rate * 100).toFixed(0)}% Paid Out
                          </div>
                      </button>
                      ))}
                  </div>
              </div>
              
              <div className="pt-6 border-t border-slate-100">
                  <div className="flex justify-between items-end mb-2">
                      <span className="text-sm text-slate-500 font-medium">Quarterly Gross Profit</span>
                      <span className={`font-mono font-bold ${'text-white'}`}>${grossProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex justify-between items-end">
                      <span className="text-sm text-emerald-600 font-bold">Your Quarterly Payout</span>
                      <span className={`font-mono font-bold text-3xl ${'text-emerald-400'}`}>
                          ${payoutAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                  </div>
                  <div className="mt-4 rounded-xl bg-slate-800 border border-slate-700 p-3 space-y-1.5">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Payout Calculation</div>
                      <div className="flex justify-between text-xs">
                          <span className="text-slate-400">Payout % Used</span>
                          <span className="font-mono font-bold text-emerald-400">{(selectedTier.rate * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex justify-between text-xs">
                          <span className="text-slate-400">Equity Amount Used</span>
                          <span className="font-mono font-bold text-white">${netPrincipal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                          <span className="text-slate-400">Formula</span>
                          <span className="font-mono text-slate-300">Equity Invested × {(selectedTier.rate * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex justify-between text-xs">
                          <span className="text-slate-400">Next Quarter Rollover Est.</span>
                          <span className="font-mono font-bold text-sky-300">${rolloverNextQuarter.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      </div>
                  </div>
              </div>
           </div>
        </div>
      </div>
    );
};
